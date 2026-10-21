import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { startSession, saveSessionMemory } from "./session.js";
import { parseSession } from "./format.js";

const roots: string[] = [];
async function root() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memorize-session-")); roots.push(dir); return dir; }
afterEach(async () => { for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
const update = (sessionId: string, content = "Decision") => ({ sessionId, entryId: crypto.randomUUID(), title: "Progress", content });

test("separate sessions append and resume after process state is lost", async () => {
	const dir = await root(); const first = await startSession(dir, { goal: "Research" });
	await saveSessionMemory(dir, update(first.sessionId));
	const before = await fs.readFile(path.join(dir, first.path));
	const second = await startSession(dir, { goal: "Implement" });
	expect(second.sessionId).not.toBe(first.sessionId);
	expect((await startSession(dir, { sessionId: first.sessionId, goal: "Research" })).resumed).toBe(true);
	expect(await fs.readFile(path.join(dir, first.path))).toEqual(before);
	await expect(startSession(dir, { sessionId: first.sessionId, goal: "Changed" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	await expect(startSession(dir, { sessionId: crypto.randomUUID() })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
});
test("same entry retry is idempotent and different payload conflicts", async () => {
	const dir = await root(); const session = await startSession(dir);
	const options = update(session.sessionId, "\uFEFFTiếng Việt 🙂\r\n");
	const saved = await saveSessionMemory(dir, options);
	const before = await fs.readFile(path.join(dir, session.path));
	const again = await saveSessionMemory(dir, options);
	expect(again.deduplicated).toBe(true); expect(again.timestamp).toBe(saved.timestamp);
	expect(await fs.readFile(path.join(dir, session.path))).toEqual(before);
	await expect(saveSessionMemory(dir, { ...options, content: "different" })).rejects.toMatchObject({ code: "ENTRY_CONFLICT" });
});
test("concurrent appends can be retried without losses and sessions exceed 64 KiB", async () => {
	const dir = await root(); const session = await startSession(dir);
	const options = [update(session.sessionId, "x".repeat(40000)), update(session.sessionId, "y".repeat(40000))];
	const outcomes = await Promise.allSettled(options.map(option => saveSessionMemory(dir, option)));
	for (let index = 0; index < outcomes.length; index++) {
		const outcome = outcomes[index]!;
		if (outcome.status === "rejected") { expect(outcome.reason.code).toBe("MEMORY_BUSY"); await saveSessionMemory(dir, options[index]!); }
	}
	const bytes = await fs.readFile(path.join(dir, session.path));
	expect(bytes.length).toBeGreaterThan(65536); expect(parseSession(bytes).entries).toHaveLength(2);
	await expect(saveSessionMemory(dir, update(session.sessionId, "z".repeat(65537)))).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
	await expect(saveSessionMemory(dir, update(session.sessionId, " \n"))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	await expect(saveSessionMemory(dir, { ...update(session.sessionId), title: "a\nb" })).rejects.toThrow();
	await expect(saveSessionMemory(dir, update(session.sessionId, "broken\uD800"))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
});
