import fs from "node:fs/promises";
import path from "node:path";
import { readSnapshot, resolveMemoryPath } from "./files.js";
import { parseSession, parseSummary, sourceReference, validateSessionId } from "./format.js";
import { DEFAULT_READ_BYTES, MAX_READ_BYTES, MAX_SNIPPET_BYTES, SEARCH_BUDGET_BYTES, MemoryError } from "./types.js";
import type { ReadOptions, ReadPage, SearchHit, SearchOptions, SearchResponse } from "./types.js";

type Cursor = { version: 1; target: string; revision: string; offset: number };
function decodeCursor(raw: string, target: string): Cursor {
	try {
		if (typeof raw !== "string" || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
		const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
		if (value.version !== 1 || value.target !== target || !/^[0-9a-f]{64}$/.test(value.revision) || !Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error();
		return value;
	} catch { throw new MemoryError("INVALID_ARGUMENT", "Invalid cursor or cursor target. Use the cursor returned for this exact document."); }
}
function utf8End(bytes: Buffer, offset: number, budget: number): number {
	let end = Math.min(bytes.length, offset + budget);
	while (end > offset && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
	return end;
}
export async function readMemory(memoryDir: string, options: ReadOptions = {}): Promise<ReadPage> {
	if (options.sessionId !== undefined) validateSessionId(options.sessionId);
	const budget = options.maxBytes ?? DEFAULT_READ_BYTES;
	if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_READ_BYTES) throw new MemoryError("INVALID_ARGUMENT", "maxBytes must be an integer between 1 and 65536.");
	const target = options.sessionId ?? "memory";
	const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor, target);
	const relative = options.sessionId ? `sessions/${options.sessionId}.md` : "MEMORY.md";
	const snapshot = await readSnapshot(await resolveMemoryPath(memoryDir, options.sessionId ? "session" : "memory", options.sessionId));
	if (!snapshot) {
		if (cursor) throw new MemoryError("STALE_CURSOR", "The document no longer exists. Read it again without a cursor.", true);
		if (options.sessionId) throw new MemoryError("SESSION_NOT_FOUND", "Session does not exist.");
		return { status: "missing", path: relative, content: "No workspace memory. Call start_session to initialize it.", truncated: false };
	}
	if (cursor && cursor.revision !== snapshot.revision) throw new MemoryError("STALE_CURSOR", "The document changed between pages. Restart reading without a cursor.", true);
	if (options.sessionId) {
		if (parseSession(snapshot.bytes).meta.sessionId !== options.sessionId) throw new MemoryError("UNSUPPORTED_FORMAT", "Session metadata does not match its filename.");
	} else parseSummary(snapshot.bytes);
	const offset = cursor?.offset ?? 0;
	if (offset > snapshot.bytes.length || (offset < snapshot.bytes.length && (snapshot.bytes[offset]! & 0xc0) === 0x80)) throw new MemoryError("INVALID_ARGUMENT", "Cursor offset is not a valid UTF-8 boundary.");
	const end = utf8End(snapshot.bytes, offset, budget);
	if (end === offset && offset < snapshot.bytes.length) throw new MemoryError("INVALID_ARGUMENT", "maxBytes is too small for the next UTF-8 character. Increase the byte budget.");
	const truncated = end < snapshot.bytes.length;
	return { status: "ok", path: relative, revision: snapshot.revision, ...(options.sessionId ? { sessionId: options.sessionId } : {}), content: snapshot.bytes.subarray(offset, end).toString("utf8"), truncated,
		...(truncated ? { nextCursor: Buffer.from(JSON.stringify({ version: 1, target, revision: snapshot.revision, offset: end } satisfies Cursor)).toString("base64url") } : {}) };
}

function paragraphs(content: string): string[] {
	const result: string[] = []; let current: string[] = []; let fence: { character: string; length: number } | undefined;
	for (const line of content.split(/\r?\n/)) {
		const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (marker?.[1]) {
			if (!fence) fence = { character: marker[1][0]!, length: marker[1].length };
			else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2]?.trim()) fence = undefined;
		}
		if (!line.trim() && !fence) { if (current.length) result.push(current.join("\n")); current = []; }
		else current.push(line);
	}
	if (current.length) result.push(current.join("\n")); return result;
}
type Candidate = SearchHit & { sortTime: string; sortId: string; priority: number };
export async function searchMemory(memoryDir: string, options: SearchOptions = {}): Promise<SearchResponse> {
	if (options.query !== undefined && typeof options.query !== "string") throw new MemoryError("INVALID_ARGUMENT", "query must be a string.");
	const query = options.query?.trim();
	if (!query) {
		if (options.scope !== undefined || options.sessionId !== undefined || options.limit !== undefined) throw new MemoryError("INVALID_ARGUMENT", "Search filters require a query. Use read_memorize to read a session.");
		return { kind: "read", ...await readMemory(memoryDir) };
	}
	const scope = options.scope ?? "all"; const limit = options.limit ?? 3;
	if (!["all", "memory", "sessions"].includes(scope) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new MemoryError("INVALID_ARGUMENT", "Use scope all/memory/sessions and a limit from 1 to 20.");
	if (options.sessionId !== undefined) validateSessionId(options.sessionId);
	if (scope === "memory" && options.sessionId) throw new MemoryError("INVALID_ARGUMENT", "scope memory cannot be combined with sessionId.");
	const terms = query.toLowerCase().split(/\s+/); const candidates: Candidate[] = [];
	const compare = (a: Candidate, b: Candidate) => a.priority - b.priority || b.sortTime.localeCompare(a.sortTime) || a.sortId.localeCompare(b.sortId);
	const offer = (content: string, metadata: Omit<Candidate, "snippet" | "snippetTruncated">) => {
		const normalized = content.toLowerCase(); if (!terms.every(term => normalized.includes(term))) return;
		const first = terms.reduce((earliest, term) => Math.min(earliest, normalized.indexOf(term)), normalized.length);
		// Lowercasing can expand a code point (e.g. İ → i + combining dot).
		// Map the normalized match back to an original UTF-16 offset.
		let originalOffset = 0; let normalizedOffset = 0;
		for (const character of content) {
			const length = character.toLowerCase().length;
			if (normalizedOffset + length > first) break;
			normalizedOffset += length; originalOffset += character.length;
		}
		let start = Math.max(0, originalOffset - 120);
		if (start > 0 && /[\uDC00-\uDFFF]/.test(content[start]!)) start--;
		const bytes = Buffer.from(content.slice(start)); const end = utf8End(bytes, 0, MAX_SNIPPET_BYTES);
		candidates.push({ ...metadata, snippet: bytes.subarray(0, end).toString("utf8"), snippetTruncated: start > 0 || end < bytes.length });
		candidates.sort(compare); if (candidates.length > limit + 1) candidates.pop();
	};
	if (scope !== "sessions" && !options.sessionId) {
		const memory = await readSnapshot(await resolveMemoryPath(memoryDir, "memory"));
		if (memory) paragraphs(parseSummary(memory.bytes).content).forEach((paragraph, index) => offer(paragraph, { path: "MEMORY.md", reference: "MEMORY.md", priority: 0, sortTime: "", sortId: String(index).padStart(12, "0") }));
	}
	if (scope !== "memory") {
		let ids: string[];
		if (options.sessionId) ids = [options.sessionId];
		else {
			const probe = await resolveMemoryPath(memoryDir, "session", "00000000-0000-4000-8000-000000000000");
			try { ids = (await fs.readdir(path.dirname(probe))).filter(name => name.endsWith(".md")).map(name => name.slice(0, -3)); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") ids = []; else throw new MemoryError("IO_ERROR", "Cannot list session memory; no search result can be guaranteed.", true); }
		}
		for (const sessionId of ids) {
			const snapshot = await readSnapshot(await resolveMemoryPath(memoryDir, "session", sessionId));
			if (!snapshot) throw new MemoryError(options.sessionId ? "SESSION_NOT_FOUND" : "IO_ERROR", "A session disappeared during search. Retry the search.", true);
			const session = parseSession(snapshot.bytes);
			if (session.meta.sessionId !== sessionId) throw new MemoryError("UNSUPPORTED_FORMAT", "Session metadata does not match its filename.");
			for (const [index, entry] of session.entries.entries()) offer(entry.content, { path: `sessions/${sessionId}.md`, reference: sourceReference({ sessionId, entryId: entry.entryId }), sessionId, entryId: entry.entryId,
				...(session.meta.legacyHash && index === 0 ? { importedAt: session.meta.importedAt } : { timestamp: entry.timestamp }), priority: 1, sortTime: entry.timestamp, sortId: `${sessionId}/${entry.entryId}` });
		}
	}
	const results: SearchHit[] = []; let used = 0; const reasons = new Set<"limit" | "budget">();
	if (candidates.length > limit) reasons.add("limit");
	for (const candidate of candidates.slice(0, limit)) {
		const size = Buffer.byteLength(candidate.snippet);
		if (used + size > SEARCH_BUDGET_BYTES) { reasons.add("budget"); break; }
		const { sortTime, sortId, priority, ...hit } = candidate; results.push(hit); used += size;
	}
	return { kind: "search", results, returned: results.length, truncated: reasons.size > 0, truncationReasons: [...reasons] };
}
