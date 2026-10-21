import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { MEMORY_TOOLS, MEMORY_INSTRUCTIONS, callMemoryTool } from "./tools.js";

const roots: string[] = [];
afterEach(async () => { for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function root() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memorize-tools-")); roots.push(dir); return dir; }

test("exposes exactly five strict tool contracts with proactive instructions", () => {
	expect(MEMORY_TOOLS.map(tool => tool.name).sort()).toEqual(["read_memorize", "save_memorize", "search_memorize", "start_session", "update_memorize"]);
	expect(MEMORY_TOOLS.every(tool => tool.inputSchema.additionalProperties === false)).toBe(true);
	expect(MEMORY_TOOLS.find(tool => tool.name === "save_memorize")!.inputSchema.required).toEqual(["sessionId", "entryId", "title", "content"]);
	expect(MEMORY_INSTRUCTIONS).toContain("proactively");
});
test("old replace/section or missing IDs fail before writing", async () => {
	const dir = await root();
	for (const args of [{ mode: "replace", content: "old" }, { section: "Decisions", content: "old" }, { content: "missing IDs" }]) {
		const result = await callMemoryTool(dir, "save_memorize", args);
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).toContain("INVALID_ARGUMENT");
		expect(JSON.stringify(result)).toMatch(/update_memorize|sessionId/);
	}
	await expect(fs.stat(path.join(dir, "MEMORY.md"))).rejects.toMatchObject({ code: "ENOENT" });
});
test("start, append, read, search and resume compose structured results", async () => {
	const dir = await root();
	const started = await callMemoryTool(dir, "start_session", { goal: "Tools" });
	expect(started.isError).not.toBe(true);
	const sessionId = started.structuredContent!.sessionId as string;
	const options = { sessionId, entryId: crypto.randomUUID(), title: "Storage", content: "Markdown durable knowledge" };
	const saved = await callMemoryTool(dir, "save_memorize", options);
	expect(saved.isError).not.toBe(true);
	expect(JSON.stringify(saved.content)).not.toContain(options.content);
	const found = await callMemoryTool(dir, "search_memorize", { query: "durable" });
	expect(found.structuredContent!.kind).toBe("search");
	const read = await callMemoryTool(dir, "read_memorize", { sessionId });
	expect(read.structuredContent!.content).toContain(options.content);
	expect((await callMemoryTool(dir, "start_session", { sessionId })).structuredContent!.resumed).toBe(true);
	const updated = await callMemoryTool(dir, "update_memorize", { sessionId, expectedRevision: (started.structuredContent!.memory as { revision: string }).revision, content: `# Memory\n\nMarkdown. [Source](sessions/${sessionId}.md#entry-${options.entryId})`, sources: [{ sessionId, entryId: options.entryId }] });
	expect(updated.isError).not.toBe(true);
});
test("runtime rejects unknown fields, bad types, bounds and unknown tool names", async () => {
	const dir = await root();
	for (const [name, args] of [
		["start_session", { typo: true }], ["start_session", null], ["read_memorize", { maxBytes: 1.5 }],
		["read_memorize", { maxBytes: 65537 }], ["search_memorize", { query: 12 }], ["search_memorize", { query: "x", scope: "wrong" }],
		["update_memorize", { sources: [{ sessionId: "x", entryId: "y", extra: true }] }], ["missing_tool", {}],
	] as const) expect((await callMemoryTool(dir, name, args)).isError).toBe(true);
});
