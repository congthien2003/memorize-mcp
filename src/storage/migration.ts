import { atomicWrite, createImmutable, readSnapshot, resolveMemoryPath } from "./files.js";
import { parseSession, parseSummary, renderSession, renderSummary, revisionOf, sourceReference } from "./format.js";
import { MEMORY_MARKER, MemoryError } from "./types.js";
import type { MigrationResult, SourceRef } from "./types.js";

function legacyEntryId(hash: string): string {
	const bytes = Buffer.from(hash.slice(0, 32), "hex");
	bytes[6] = (bytes[6]! & 15) | 128;
	bytes[8] = (bytes[8]! & 63) | 128;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Caller holds the workspace lock. No nested acquisition. */
export async function ensureWorkspaceUnderLock(memoryDir: string): Promise<MigrationResult> {
	const file = await resolveMemoryPath(memoryDir, "memory");
	const existing = await readSnapshot(file);
	if (!existing) {
		await atomicWrite(file, renderSummary("# Project Memory\n\nNo durable knowledge has been consolidated yet.\n"));
		return { status: "initialized" };
	}
	let text: string;
	try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(existing.bytes); }
	catch { throw new MemoryError("UNSUPPORTED_FORMAT", "Legacy memory must be valid UTF-8; no migration was performed."); }
	if (text.startsWith(MEMORY_MARKER)) { parseSummary(existing.bytes); return { status: "none" }; }
	if (text.trim() && !/^\uFEFF?# (?:Session|Workspace) Memory[^\S\r\n]*(?:\r?\n|$)/.test(text)) throw new MemoryError("UNSUPPORTED_FORMAT", "Unrecognized MEMORY.md. Preserve it and convert it to a supported legacy format before migration.");
	const hash = revisionOf(existing.bytes);
	const backupPath = `backups/legacy-${hash}.md`;
	await createImmutable(await resolveMemoryPath(memoryDir, "backup", hash), existing.bytes);
	let source: SourceRef | undefined;
	let summary = "# Project Memory\n\nNo durable knowledge has been consolidated yet.\n";
	if (text.trim()) {
		// Validate UTF-8, even if the source is a legacy document without framing.
		const sessionId = `legacy-${hash}`; const entryId = legacyEntryId(hash);
		source = { sessionId, entryId };
		const legacyFile = await resolveMemoryPath(memoryDir, "session", sessionId);
		const legacy = await readSnapshot(legacyFile);
		if (legacy) {
			const parsed = parseSession(legacy.bytes);
			if (parsed.meta.sessionId !== sessionId || parsed.meta.legacyHash !== hash || parsed.entries.length !== 1 || parsed.entries[0]?.entryId !== entryId || parsed.entries[0]?.content !== text) throw new MemoryError("MIGRATION_CONFLICT", "Existing legacy session does not match the original memory; restore the matching artifact.");
		} else {
			const now = new Date().toISOString();
			await createImmutable(legacyFile, renderSession({ sessionId, startedAt: now, importedAt: now, legacyHash: hash, goal: "Imported legacy workspace memory" }, [{ entryId, title: "Original legacy memory (import time, not event time)", timestamp: now, content: text }]));
		}
		summary = `# Project Memory\n\n## Legacy memory awaiting consolidation\n\nRead [the original workspace memory](${sourceReference(source)}) before consolidating useful knowledge. Imported content has not been revalidated; import time is not the original event time.\n`;
	}
	await atomicWrite(file, renderSummary(summary));
	return { status: "migrated", backupPath, ...(source ? { legacySource: source } : {}) };
}
