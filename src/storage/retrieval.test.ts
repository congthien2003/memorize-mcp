import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { startSession, saveSessionMemory } from "./session.js";
import { readMemory, searchMemory } from "./retrieval.js";
import { parseSession, renderSession, renderSummary } from "./format.js";

const roots: string[] = [];
afterEach(async () => { for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memorize-read-")); roots.push(dir); const session = await startSession(dir); return { dir, session }; }

test("paged read preserves Unicode and rejects stale, mismatched or invalid cursors", async () => {
	const { dir, session } = await fixture();
	await saveSessionMemory(dir, { sessionId: session.sessionId, entryId: crypto.randomUUID(), title: "Unicode", content: "Tiếng Việt 🙂\r\n".repeat(500) });
	let page = await readMemory(dir, { sessionId: session.sessionId, maxBytes: 37 }); const chunks = [page.content];
	while (page.nextCursor) { page = await readMemory(dir, { sessionId: session.sessionId, cursor: page.nextCursor, maxBytes: 37 }); chunks.push(page.content); }
	expect(chunks.join("")).toBe(await fs.readFile(path.join(dir, session.path), "utf8"));
	const first = await readMemory(dir, { sessionId: session.sessionId, maxBytes: 37 });
	await expect(readMemory(dir, { cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	await saveSessionMemory(dir, { sessionId: session.sessionId, entryId: crypto.randomUUID(), title: "New", content: "Next" });
	await expect(readMemory(dir, { sessionId: session.sessionId, cursor: first.nextCursor })).rejects.toMatchObject({ code: "STALE_CURSOR" });
	await expect(readMemory(dir, { maxBytes: 0 })).rejects.toThrow();
	await expect(readMemory(dir, { maxBytes: 65537 })).rejects.toThrow();
	await expect(readMemory(dir, { cursor: "not-json" })).rejects.toThrow();
	await fs.writeFile(path.join(dir, "MEMORY.md"), renderSummary("🙂"));
	const beforeEmoji = await readMemory(dir, { maxBytes: Buffer.byteLength(renderSummary("")) });
	await expect(readMemory(dir, { cursor: beforeEmoji.nextCursor, maxBytes: 1 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
});
test("search matches AND within entries, ranks actual timestamps, and excludes backup", async () => {
	const { dir, session } = await fixture();
	const records = [
		{ entryId: crypto.randomUUID(), title: "new", timestamp: "2026-10-21T00:02:00.000Z", content: "authentication OTP newest" },
		{ entryId: crypto.randomUUID(), title: "old", timestamp: "2026-10-21T00:01:00.000Z", content: "authentication OTP older" },
		{ entryId: crypto.randomUUID(), title: "split", timestamp: "2026-10-21T00:03:00.000Z", content: "authentication only" },
		{ entryId: crypto.randomUUID(), title: "split", timestamp: "2026-10-21T00:04:00.000Z", content: "OTP only" },
	];
	const current = parseSession(await fs.readFile(path.join(dir, session.path)));
	await fs.writeFile(path.join(dir, session.path), renderSession(current.meta, records));
	await fs.writeFile(path.join(dir, "MEMORY.md"), renderSummary("# Memory\n\nauthentication OTP stable knowledge\n"));
	await fs.mkdir(path.join(dir, "backups")); await fs.writeFile(path.join(dir, "backups", "hidden.md"), "authentication OTP backup");
	const found = await searchMemory(dir, { query: "authentication otp" });
	if (found.kind !== "search") throw new Error("Expected search");
	expect(found.returned).toBe(3); expect(found.results[0]?.path).toBe("MEMORY.md");
	expect(found.results[1]?.entryId).toBe(records[0]!.entryId);
	expect(found.results[2]?.entryId).toBe(records[1]!.entryId);
	expect(JSON.stringify(found)).not.toContain("backup");
	await expect(searchMemory(dir, { query: "OTP", scope: "memory", sessionId: session.sessionId })).rejects.toThrow();
	await expect(searchMemory(dir, { query: "OTP", limit: 21 })).rejects.toThrow();
	await expect(searchMemory(dir, { sessionId: session.sessionId })).rejects.toThrow();
});
test("search limits snippets and aggregate output without losing full-entry matching", async () => {
	const { dir, session } = await fixture();
	for (let index = 0; index < 12; index++) await saveSessionMemory(dir, { sessionId: session.sessionId, entryId: crypto.randomUUID(), title: String(index), content: "start " + "🙂".repeat(900) + " end" });
	const result = await searchMemory(dir, { query: "start end", limit: 20 });
	if (result.kind !== "search") throw new Error("Expected search");
	expect(result.results.length).toBeGreaterThan(0); expect(result.truncated).toBe(true);
	expect(result.results.every(hit => hit.snippetTruncated && Buffer.byteLength(hit.snippet) <= 2048)).toBe(true);
	expect(result.results.reduce((sum, hit) => sum + Buffer.byteLength(hit.snippet), 0)).toBeLessThanOrEqual(16384);
	expect((await searchMemory(dir)).kind).toBe("read");
});
test("reads never initialize missing storage; legacy import timestamps are explicit", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memorize-missing-")); roots.push(dir);
	const missing = path.join(dir, ".memorize");
	expect((await readMemory(missing)).status).toBe("missing");
	await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
	await fs.writeFile(path.join(dir, "MEMORY.md"), "# Workspace Memory\n\nlegacy needle");
	await startSession(dir);
	const found = await searchMemory(dir, { query: "needle", scope: "sessions" });
	if (found.kind !== "search") throw new Error("Expected search");
	expect(found.results[0]?.importedAt).toBeDefined(); expect(found.results[0]?.timestamp).toBeUndefined();
	const legacyId = found.results[0]!.sessionId!;
	const saved = await saveSessionMemory(dir, { sessionId: legacyId, entryId: crypto.randomUUID(), title: "Later decision", content: "fresh legacy update" });
	const later = await searchMemory(dir, { query: "fresh", sessionId: legacyId });
	if (later.kind !== "search") throw new Error("Expected search");
	expect(later.results[0]?.timestamp).toBe(saved.timestamp); expect(later.results[0]?.importedAt).toBeUndefined();
	await fs.writeFile(path.join(dir, "sessions", `${crypto.randomUUID()}.md`), "broken");
	await expect(searchMemory(dir, { query: "nothing", scope: "sessions" })).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
});
test("Unicode lowercase expansion does not move the snippet away from its match", async () => {
	const { dir, session } = await fixture();
	await saveSessionMemory(dir, { sessionId: session.sessionId, entryId: crypto.randomUUID(), title: "Unicode", content: "İ".repeat(1000) + " needle" });
	const result = await searchMemory(dir, { query: "needle" });
	if (result.kind !== "search") throw new Error("Expected search");
	expect(result.results[0]?.snippet).toContain("needle");
});
