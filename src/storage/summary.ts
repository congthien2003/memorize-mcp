import { atomicWrite, readSnapshot, resolveMemoryPath, withWorkspaceLock } from "./files.js";
import { parseSession, parseSummary, renderSummary, revisionOf, sourceReference, validateEntryId, validateSessionId } from "./format.js";
import { MEMORY_MARKER, MemoryError, requireContent, SUMMARY_WARN_BYTES } from "./types.js";
import type { SourceRef, UpdateOptions, UpdateResult } from "./types.js";

function sourceLinks(content: string): Map<string, SourceRef> {
	const links = new Map<string, SourceRef>();
	const prose: string[] = [];
	let fence: { character: string; length: number } | undefined;
	for (const line of content.split(/\r?\n/)) {
		let structural = line;
		while (/^ {0,3}>[ \t]?/.test(structural)) structural = structural.replace(/^ {0,3}>[ \t]?/, "");
		structural = structural.replace(/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/, "");
		const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(structural);
		if (marker?.[1]) {
			if (!fence) fence = { character: marker[1][0]!, length: marker[1].length };
			else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2]?.trim()) fence = undefined;
			continue;
		}
		if (!fence && !/^(?: {4}|\t)/.test(structural)) prose.push(structural);
	}
	// Mask comments, escaped syntax and code spans before recognizing links.
	const text = prose.join("\n"); let visible = "";
	for (let index = 0; index < text.length;) {
		if (text.startsWith("<!--", index)) { const end = text.indexOf("-->", index + 4); index = end < 0 ? text.length : end + 3; visible += " "; continue; }
		if (text[index] === "\\") { visible += "  "; index += 2; continue; }
		if (text[index] === "`") {
			let length = 1; while (text[index + length] === "`") length++;
			const delimiter = "`".repeat(length); let end = text.indexOf(delimiter, index + length);
			while (end >= 0 && (text[end - 1] === "`" || text[end + length] === "`")) end = text.indexOf(delimiter, end + length);
			if (end >= 0) { visible += " "; index = end + length; continue; }
			visible += delimiter; index += length; continue;
		}
		visible += text[index]!; index++;
	}
	for (const match of visible.matchAll(/(?<!!)\[([^\]\n]+)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)) {
			if (!match[1]?.trim()) continue;
			let target = match[2] ?? match[3]!;
			try { target = decodeURIComponent(target); } catch { throw new MemoryError("INVALID_ARGUMENT", "Invalid source-link encoding."); }
			if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
			if (!/(?:^|[\\/])sessions[\\/]/.test(target)) continue;
			const source = /^sessions\/([^/]+)\.md#entry-([^/#]+)$/.exec(target);
			if (!source?.[1] || !source[2]) throw new MemoryError("INVALID_ARGUMENT", "Use source links in sessions/<session-id>.md#entry-<entry-id> form.");
			const ref = { sessionId: source[1], entryId: source[2] };
			validateSessionId(ref.sessionId); validateEntryId(ref.entryId);
			links.set(sourceReference(ref), ref);
	}
	return links;
}
export async function updateMemory(memoryDir: string, options: UpdateOptions): Promise<UpdateResult> {
	validateSessionId(options.sessionId); requireContent(options.content);
	if (options.content.startsWith(MEMORY_MARKER) || !/^[0-9a-f]{64}$/.test(options.expectedRevision)) throw new MemoryError("INVALID_ARGUMENT", "Supply the Markdown body and the revision returned by read_memorize.");
	if (!Array.isArray(options.sources) || options.sources.length === 0) throw new MemoryError("INVALID_ARGUMENT", "sources must include at least one saved session entry.");
	const links = sourceLinks(options.content);
	for (const source of options.sources) {
		if (!source || typeof source !== "object" || !links.has(sourceReference(source))) throw new MemoryError("INVALID_ARGUMENT", "Every declared source must have a visible inline Markdown link in the summary.");
	}
	return withWorkspaceLock(memoryDir, async () => {
		const caller = await readSnapshot(await resolveMemoryPath(memoryDir, "session", options.sessionId));
		if (!caller) throw new MemoryError("SESSION_NOT_FOUND", "Start or resume the calling session before updating memory.");
		if (parseSession(caller.bytes).meta.sessionId !== options.sessionId) throw new MemoryError("UNSUPPORTED_FORMAT", "Caller session metadata does not match its filename.");
		const file = await resolveMemoryPath(memoryDir, "memory"); const current = await readSnapshot(file);
		if (!current) throw new MemoryError("INVALID_ARGUMENT", "Call start_session before updating summary memory.");
		parseSummary(current.bytes);
		if (current.revision !== options.expectedRevision) throw new MemoryError("REVISION_CONFLICT", "Summary changed. Read it again, merge your knowledge, and retry with the new revision.", true);
		const sessions = new Map<string, Set<string>>();
		for (const source of links.values()) {
			let entries = sessions.get(source.sessionId);
			if (!entries) {
				const snapshot = await readSnapshot(await resolveMemoryPath(memoryDir, "session", source.sessionId));
				if (!snapshot) throw new MemoryError("INVALID_ARGUMENT", "A source session does not exist; save the source before consolidation.");
				const parsed = parseSession(snapshot.bytes);
				if (parsed.meta.sessionId !== source.sessionId) throw new MemoryError("UNSUPPORTED_FORMAT", "Source session metadata does not match its filename.");
				entries = new Set(parsed.entries.map(entry => entry.entryId)); sessions.set(source.sessionId, entries);
			}
			if (!entries.has(source.entryId)) throw new MemoryError("INVALID_ARGUMENT", "A source entry does not exist; save it before consolidation.");
		}
		const bytes = renderSummary(options.content); await atomicWrite(file, bytes);
		return { path: "MEMORY.md", revision: revisionOf(bytes), updatedAt: new Date().toISOString(), warnings: Buffer.byteLength(options.content) > SUMMARY_WARN_BYTES ? ["Summary exceeds 16 KiB. Consolidate repeated knowledge while preserving source references; history is not deleted."] : [] };
	});
}
