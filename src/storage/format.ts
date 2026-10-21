import crypto from "node:crypto";
import { MemoryError, MEMORY_MARKER, SESSION_MARKER } from "./types.js";
import type { Entry, SessionMeta, SourceRef } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(message: string): never { throw new MemoryError("UNSUPPORTED_FORMAT", message); }
export function validateEntryId(value: string): void {
	if (typeof value !== "string" || !UUID.test(value)) throw new MemoryError("INVALID_ARGUMENT", "entryId must be a UUID.");
}
export function validateSessionId(value: string): void {
	if (typeof value !== "string" || (!UUID.test(value) && !/^legacy-[0-9a-f]{64}$/.test(value))) throw new MemoryError("INVALID_ARGUMENT", "sessionId must be a UUID or a migration legacy ID.");
}
export function revisionOf(bytes: Buffer): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function jsonComment(value: unknown): string {
	return JSON.stringify(value).replace(/[&<>-]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function decode(bytes: Buffer): string {
	try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
	catch { return invalid("Memory contains invalid UTF-8; restore it from a valid source before writing."); }
}
function parseObject(text: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(text);
		if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Invalid metadata object.");
		return value as Record<string, unknown>;
	} catch { return invalid("Invalid metadata JSON."); }
}
function isTimestamp(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function renderSummary(content: string): Buffer { return Buffer.from(`${MEMORY_MARKER}\n${content}`, "utf8"); }
export function parseSummary(bytes: Buffer): { content: string } {
	const text = decode(bytes);
	const separator = text.startsWith(`${MEMORY_MARKER}\r\n`) ? 2 : text.startsWith(`${MEMORY_MARKER}\n`) ? 1 : 0;
	if (!separator) return invalid("Unsupported memory format. Call start_session to migrate recognized legacy memory.");
	return { content: text.slice(MEMORY_MARKER.length + separator) };
}
export function sourceReference(source: SourceRef): string {
	validateSessionId(source.sessionId); validateEntryId(source.entryId);
	return `sessions/${source.sessionId}.md#entry-${source.entryId}`;
}
export function renderEntry(entry: Entry): Buffer {
	validateEntryId(entry.entryId);
	if (!entry.title.trim() || /[\r\n]/.test(entry.title) || !isTimestamp(entry.timestamp)) return invalid("Invalid entry title or timestamp.");
	const metadata = jsonComment({ entryId: entry.entryId, timestamp: entry.timestamp, contentBytes: Buffer.byteLength(entry.content, "utf8") });
	return Buffer.from(`<a id="entry-${entry.entryId}"></a>\n## ${entry.title}\n<!-- memorize:entry ${metadata} -->\n${entry.content}\n\n`, "utf8");
}
export function renderSession(meta: SessionMeta, entries: Entry[]): Buffer {
	validateSessionId(meta.sessionId);
	const header = `${SESSION_MARKER}\n<!-- memorize:meta ${jsonComment(meta)} -->\n# Session ${meta.sessionId}\n\n`;
	return Buffer.concat([Buffer.from(header, "utf8"), ...entries.map(renderEntry)]);
}
export function parseSession(bytes: Buffer): { meta: SessionMeta; entries: Entry[] } {
	let offset = 0;
	const line = (): string => {
		const end = bytes.indexOf(10, offset);
		if (end < 0) return invalid("Truncated session metadata.");
		const value = decode(bytes.subarray(offset, end)); offset = end + 1; return value;
	};
	if (line() !== SESSION_MARKER) return invalid("Unsupported session format/version.");
	const header = /^<!-- memorize:meta (.+) -->$/.exec(line());
	if (!header?.[1]) return invalid("Missing session metadata.");
	const value = parseObject(header[1]);
	try { validateSessionId(value.sessionId as string); } catch { return invalid("Invalid session ID in metadata."); }
	if (!isTimestamp(value.startedAt) || (value.goal !== undefined && (typeof value.goal !== "string" || /[\r\n]/.test(value.goal)))) return invalid("Invalid session metadata.");
	if (String(value.sessionId).startsWith("legacy-")) {
		if (value.legacyHash !== String(value.sessionId).slice(7) || !isTimestamp(value.importedAt)) return invalid("Invalid legacy session metadata.");
	} else if (value.legacyHash !== undefined || value.importedAt !== undefined) return invalid("Legacy metadata on a regular session.");
	const meta = value as SessionMeta;
	if (line() !== `# Session ${meta.sessionId}` || line() !== "") return invalid("Invalid session heading.");
	const entries: Entry[] = []; const seen = new Set<string>();
	while (offset < bytes.length) {
		const anchor = /^<a id="entry-([^"]+)"><\/a>$/.exec(line());
		const titleLine = line();
		const metadata = /^<!-- memorize:entry (.+) -->$/.exec(line());
		if (!anchor?.[1] || !titleLine.startsWith("## ") || !titleLine.slice(3).trim() || !metadata?.[1]) return invalid("Invalid entry framing.");
		const entry = parseObject(metadata[1]);
		try { validateEntryId(entry.entryId as string); } catch { return invalid("Invalid entry ID in metadata."); }
		const entryId = entry.entryId as string;
		if (anchor[1] !== entryId || seen.has(entryId) || !isTimestamp(entry.timestamp) || !Number.isSafeInteger(entry.contentBytes) || (entry.contentBytes as number) < 0) return invalid("Invalid or duplicate entry metadata.");
		const end = offset + (entry.contentBytes as number);
		if (end > bytes.length || bytes.subarray(end, end + 2).toString() !== "\n\n") return invalid("Truncated entry payload or invalid byte length.");
		const content = decode(bytes.subarray(offset, end)); offset = end + 2;
		entries.push({ entryId, title: titleLine.slice(3), timestamp: entry.timestamp, content }); seen.add(entryId);
	}
	return { meta, entries };
}
