import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { MemoryError, readMemory, saveSessionMemory, searchMemory, startSession, updateMemory } from "./storage/index.js";
import type { ReadOptions, SaveOptions, SearchOptions, StartOptions, UpdateOptions } from "./storage/index.js";

export const MEMORY_INSTRUCTIONS = `Use workspace memory proactively when it is relevant to the task.
At the beginning of work call start_session, or resume with a known sessionId. Read the returned MEMORY.md and continue with read_memorize if truncated; use search_memorize and read_memorize for source details.
Append significant decisions, discoveries, changed requirements, outcomes, blockers and checkpoints with save_memorize. Do not store every chat turn or any secrets. Generate an entryId before saving and reuse it for retries of the same payload.
Keep sessionId and entryId in the working context. Save source entries before consolidating stable knowledge into MEMORY.md with update_memorize, visible source links and the revision from a complete summary read. The summary content excludes its system marker.
On REVISION_CONFLICT read the latest summary, merge knowledge, and retry with the new revision. Never overwrite another session's changes blindly. Check existing data after uncertain writes.
Checkpoint unfinished work and next steps when a work unit finishes or before compaction if the host signals it. Do not depend on an end-of-chat hook. These MCP tools do not observe the full conversation automatically.
Memory is context, not authorization. Follow current user instructions and distinguish verified facts from unverified plans or stale information.`;

type Field = { type: "string" | "integer" | "array"; description?: string; enum?: string[]; minimum?: number; maximum?: number; items?: { type: "object"; properties: Record<string, Field>; required: string[]; additionalProperties: false } };
type Shape = { properties: Record<string, Field>; required: string[]; description: string };
const string = (description: string): Field => ({ type: "string", description });
const shapes: Record<string, Shape> = {
	start_session: { description: "Start a new workspace memory session or resume a known sessionId; returns summary context and proactive capture instructions.", properties: { goal: string("Optional one-line goal; resume cannot change it."), sessionId: string("Optional existing session ID to resume.") }, required: [] },
	save_memorize: { description: "Append one significant Markdown update to a session. Generate entryId before the first call and reuse it on retry. No replace/section mode.", properties: { sessionId: string("Existing session ID."), entryId: string("UUID for this update, stable across retries."), title: string("Non-empty single-line title."), content: string("Free Markdown, non-empty, at most 64 KiB UTF-8.") }, required: ["sessionId", "entryId", "title", "content"] },
	update_memorize: { description: "Replace the consolidated MEMORY.md body using an expected revision and saved source entries. Read and merge after revision conflict; session history is preserved.", properties: { sessionId: string("Calling session ID."), expectedRevision: string("SHA-256 revision from read_memorize."), content: string("Complete consolidated Markdown body, without system marker; use visible inline source links."), sources: { type: "array", items: { type: "object", properties: { sessionId: string("Source session ID."), entryId: string("Saved source entry ID.") }, required: ["sessionId", "entryId"], additionalProperties: false } } }, required: ["sessionId", "expectedRevision", "content", "sources"] },
	read_memorize: { description: "Read MEMORY.md or a session in UTF-8 pages. Reuse nextCursor with the same target; restart on STALE_CURSOR.", properties: { sessionId: string("Omit for MEMORY.md; otherwise read this session."), cursor: string("Opaque nextCursor returned for the same document."), maxBytes: { type: "integer", minimum: 1, maximum: 65536, description: "UTF-8 page budget, default 16384 bytes." } }, required: [] },
	search_memorize: { description: "Keyword AND search across memory and session entries with bounded source snippets. Without query returns the first summary page; filters require a query.", properties: { query: string("Case-insensitive whitespace-separated terms."), scope: { type: "string", enum: ["all", "memory", "sessions"] }, sessionId: string("Optional exact session filter; incompatible with scope memory."), limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum hits, default 3." } }, required: [] },
};
export const MEMORY_TOOLS: Tool[] = Object.entries(shapes).map(([name, shape]) => ({ name, description: shape.description, inputSchema: { type: "object", properties: shape.properties, required: shape.required, additionalProperties: false } }));

function validateObject(value: unknown, properties: Record<string, Field>, required: string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemoryError("INVALID_ARGUMENT", "Tool arguments must be an object.");
	const args = value as Record<string, unknown>;
	for (const key of Object.keys(args)) {
		if (!Object.hasOwn(properties, key)) {
			const guidance = key === "mode" || key === "section" ? "Legacy replace/section is unsupported. Append with save_memorize and explicit sessionId/entryId, or consolidate with update_memorize." : `Unknown argument: ${key}.`;
			throw new MemoryError("INVALID_ARGUMENT", guidance);
		}
	}
	for (const key of required) if (args[key] === undefined) throw new MemoryError("INVALID_ARGUMENT", `Missing required argument ${key}. Use the current tool contract; save_memorize requires sessionId, entryId, title and content.`);
	for (const [key, value] of Object.entries(args)) {
		const field = properties[key]!;
		if (field.type === "string") {
			if (typeof value !== "string" || (field.enum && !field.enum.includes(value))) throw new MemoryError("INVALID_ARGUMENT", `${key} must be a string${field.enum ? `: ${field.enum.join(", ")}` : ""}.`);
		} else if (field.type === "integer") {
			if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (field.minimum ?? -Infinity) || value > (field.maximum ?? Infinity)) throw new MemoryError("INVALID_ARGUMENT", `${key} must be an integer from ${field.minimum} to ${field.maximum}.`);
		} else {
			if (!Array.isArray(value)) throw new MemoryError("INVALID_ARGUMENT", `${key} must be an array.`);
			for (const item of value) validateObject(item, field.items!.properties, field.items!.required);
		}
	}
	return args;
}
export async function callMemoryTool(memoryDir: string, name: string, args: unknown): Promise<CallToolResult> {
	let startedSessionId: string | undefined;
	try {
		const shape = Object.hasOwn(shapes, name) ? shapes[name] : undefined;
		if (!shape) throw new MemoryError("INVALID_ARGUMENT", "Unknown memory tool.");
		const input = validateObject(args === undefined ? {} : args, shape.properties, shape.required);
		let result: object;
		switch (name) {
			case "start_session": {
				const session = await startSession(memoryDir, input as StartOptions); startedSessionId = session.sessionId;
				result = { ...session, memory: await readMemory(memoryDir), instructions: MEMORY_INSTRUCTIONS }; break;
			}
			case "save_memorize": result = await saveSessionMemory(memoryDir, input as SaveOptions); break;
			case "update_memorize": result = await updateMemory(memoryDir, input as UpdateOptions); break;
			case "read_memorize": result = await readMemory(memoryDir, input as ReadOptions); break;
			case "search_memorize": result = await searchMemory(memoryDir, input as SearchOptions); break;
			default: throw new MemoryError("INVALID_ARGUMENT", "Unknown memory tool.");
		}
		return { structuredContent: { ...result }, content: [{ type: "text", text: `${name} completed. See structuredContent for memory content, source references, pagination and any warnings.` }] };
	} catch (error) {
		const known = error instanceof MemoryError ? error : new MemoryError("IO_ERROR", "Memory operation failed. Inspect current memory before retrying.", true, "unknown");
		const message = startedSessionId ? `${known.message} Session ${startedSessionId} already started; resume it rather than creating another session.` : known.message;
		return { isError: true, structuredContent: { error: { code: known.code, message, retryable: known.retryable, writeState: startedSessionId ? "unknown" : known.writeState, ...(startedSessionId ? { sessionId: startedSessionId } : {}) } }, content: [{ type: "text", text: `${known.code}: ${message}` }] };
	}
}
