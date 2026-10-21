export const MEMORY_MARKER = "<!-- memorize:memory version=1 -->";
export const SESSION_MARKER = "<!-- memorize:session version=1 -->";
export const MAX_WRITE_BYTES = 65536;
export const DEFAULT_READ_BYTES = 16384;
export const MAX_READ_BYTES = 65536;
export const SUMMARY_WARN_BYTES = 16384;
export const MAX_SNIPPET_BYTES = 2048;
export const SEARCH_BUDGET_BYTES = 16384;

export type ErrorCode = "INVALID_ARGUMENT" | "PAYLOAD_TOO_LARGE" | "SESSION_NOT_FOUND" | "ENTRY_CONFLICT" | "REVISION_CONFLICT" | "STALE_CURSOR" | "MEMORY_BUSY" | "UNSUPPORTED_FORMAT" | "MIGRATION_CONFLICT" | "IO_ERROR";
export class MemoryError extends Error {
	constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false, public readonly writeState: "not-written" | "unknown" = "not-written") {
		super(message);
		this.name = "MemoryError";
	}
}
export type SourceRef = { sessionId: string; entryId: string };
export type SessionMeta = { sessionId: string; startedAt: string; goal?: string; legacyHash?: string; importedAt?: string };
export type Entry = { entryId: string; title: string; timestamp: string; content: string };
export type StartOptions = { goal?: string; sessionId?: string };
export type MigrationResult = { status: "none" | "initialized" | "migrated"; backupPath?: string; legacySource?: SourceRef };
export type SessionResult = { sessionId: string; path: string; resumed: boolean; migration: MigrationResult };
export type SaveOptions = SourceRef & { title: string; content: string };
export type SaveResult = SourceRef & { path: string; anchor: string; timestamp: string; deduplicated: boolean };
export type UpdateOptions = { sessionId: string; expectedRevision: string; content: string; sources: SourceRef[] };
export type UpdateResult = { path: string; revision: string; updatedAt: string; warnings: string[] };
export type ReadOptions = { sessionId?: string; cursor?: string; maxBytes?: number };
export type ReadPage = { status: "ok" | "missing"; path: string; revision?: string; sessionId?: string; content: string; truncated: boolean; nextCursor?: string };
export type SearchOptions = { query?: string; scope?: "all" | "memory" | "sessions"; sessionId?: string; limit?: number };
export type SearchHit = { path: string; reference: string; snippet: string; snippetTruncated: boolean; sessionId?: string; entryId?: string; timestamp?: string; importedAt?: string };
export type SearchResult = { kind: "search"; results: SearchHit[]; returned: number; truncated: boolean; truncationReasons: ("limit" | "budget")[] };
export type SearchResponse = SearchResult | (ReadPage & { kind: "read" });

export function requireContent(content: string): void {
	if (typeof content !== "string" || !content.trim()) throw new MemoryError("INVALID_ARGUMENT", "content must be non-empty Markdown.");
	if (Buffer.from(content, "utf8").toString("utf8") !== content) throw new MemoryError("INVALID_ARGUMENT", "content must be well-formed Unicode; unpaired surrogates cannot be preserved as UTF-8.");
	if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new MemoryError("PAYLOAD_TOO_LARGE", "Each write accepts at most 64 KiB of UTF-8 content; split session updates into entries.");
}
