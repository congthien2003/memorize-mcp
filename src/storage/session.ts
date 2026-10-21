import crypto from "node:crypto";
import { atomicWrite, readSnapshot, resolveMemoryPath, withWorkspaceLock } from "./files.js";
import { parseSession, renderEntry, renderSession, validateEntryId, validateSessionId } from "./format.js";
import { ensureWorkspaceUnderLock } from "./migration.js";
import { MemoryError, requireContent } from "./types.js";
import type { StartOptions, SessionResult, SaveOptions, SaveResult } from "./types.js";

export async function startSession(memoryDir: string, options: StartOptions = {}): Promise<SessionResult> {
	if (options.sessionId !== undefined) validateSessionId(options.sessionId);
	if (options.goal !== undefined && (typeof options.goal !== "string" || /[\r\n]/.test(options.goal))) throw new MemoryError("INVALID_ARGUMENT", "goal must be one line.");
	const goal = options.goal?.trim();
	return withWorkspaceLock(memoryDir, async () => {
		if (options.sessionId) {
			const file = await resolveMemoryPath(memoryDir, "session", options.sessionId);
			const current = await readSnapshot(file);
			if (!current) throw new MemoryError("SESSION_NOT_FOUND", "Session does not exist. Start a new session without an ID.");
			const session = parseSession(current.bytes);
			if (session.meta.sessionId !== options.sessionId) throw new MemoryError("UNSUPPORTED_FORMAT", "Session metadata does not match its filename.");
			if (goal !== undefined && goal !== (session.meta.goal ?? "")) throw new MemoryError("INVALID_ARGUMENT", "Resume cannot change a session goal. Omit goal or use the existing value.");
			const migration = await ensureWorkspaceUnderLock(memoryDir);
			return { sessionId: options.sessionId, path: `sessions/${options.sessionId}.md`, resumed: true, migration };
		}
		const migration = await ensureWorkspaceUnderLock(memoryDir);
		const sessionId = crypto.randomUUID(); const file = await resolveMemoryPath(memoryDir, "session", sessionId);
		await atomicWrite(file, renderSession({ sessionId, startedAt: new Date().toISOString(), ...(goal ? { goal } : {}) }, []));
		return { sessionId, path: `sessions/${sessionId}.md`, resumed: false, migration };
	});
}
export async function saveSessionMemory(memoryDir: string, options: SaveOptions): Promise<SaveResult> {
	validateSessionId(options.sessionId); validateEntryId(options.entryId); requireContent(options.content);
	if (typeof options.title !== "string" || !options.title.trim() || /[\r\n]/.test(options.title) || Buffer.from(options.title, "utf8").toString("utf8") !== options.title) throw new MemoryError("INVALID_ARGUMENT", "title must be a non-empty single line of well-formed Unicode.");
	const title = options.title.trim();
	return withWorkspaceLock(memoryDir, async () => {
		const file = await resolveMemoryPath(memoryDir, "session", options.sessionId);
		const current = await readSnapshot(file);
		if (!current) throw new MemoryError("SESSION_NOT_FOUND", "Session does not exist. Call start_session first or resume an existing ID.");
		const session = parseSession(current.bytes);
		if (session.meta.sessionId !== options.sessionId) throw new MemoryError("UNSUPPORTED_FORMAT", "Session metadata does not match its filename.");
		const existing = session.entries.find(entry => entry.entryId === options.entryId);
		if (existing && (existing.title !== title || existing.content !== options.content)) throw new MemoryError("ENTRY_CONFLICT", "This entry ID already stores different content. Use a new entry ID for a new update.");
		const timestamp = existing?.timestamp ?? new Date().toISOString();
		if (!existing) await atomicWrite(file, Buffer.concat([current.bytes, renderEntry({ entryId: options.entryId, title, timestamp, content: options.content })]));
		return { sessionId: options.sessionId, entryId: options.entryId, path: `sessions/${options.sessionId}.md`, anchor: `entry-${options.entryId}`, timestamp, deduplicated: Boolean(existing) };
	});
}
