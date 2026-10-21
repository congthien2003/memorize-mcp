import { afterEach, expect, spyOn, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWrite, createImmutable, resolveMemoryPath, withWorkspaceLock } from "./files.js";

const roots: string[] = [];
async function root() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memorize-files-")); roots.push(dir); return dir; }
afterEach(async () => { for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

test("a live old lock stays busy and another owner is never released", async () => {
	const dir = await root(); const lock = path.join(dir, "MEMORY.md.lock");
	await fs.writeFile(lock, JSON.stringify({ pid: process.pid, token: "live", createdAt: 1 }));
	await expect(withWorkspaceLock(dir, async () => undefined)).rejects.toMatchObject({ code: "MEMORY_BUSY" });
	await fs.unlink(lock);
	await expect(withWorkspaceLock(dir, async () => { await fs.writeFile(lock, JSON.stringify({ pid: process.pid, token: "other" })); })).rejects.toMatchObject({ code: "IO_ERROR", writeState: "unknown" });
	expect(JSON.parse(await fs.readFile(lock, "utf8")).token).toBe("other");
});
test("lock recovery checks process liveness, including permission uncertainty", async () => {
	const dir = await root(); const lock = path.join(dir, "MEMORY.md.lock");
	const kill = spyOn(process, "kill");
	try {
		await fs.writeFile(lock, JSON.stringify({ pid: 1234567, token: "dead" }));
		kill.mockImplementation(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
		await withWorkspaceLock(dir, async () => undefined);
		await fs.writeFile(lock, JSON.stringify({ pid: 1234567, token: "unknown" }));
		kill.mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
		await expect(withWorkspaceLock(dir, async () => undefined)).rejects.toMatchObject({ code: "MEMORY_BUSY" });
	} finally { kill.mockRestore(); }
});
test("two stale-lock reclaimers never overlap mutation or delete the winner's lock", async () => {
	const dir = await root(); const lock = path.join(dir, "MEMORY.md.lock");
	const original = JSON.stringify({ pid: 1234567, token: "dead" }); await fs.writeFile(lock, original);
	const realRead = fs.readFile.bind(fs); const realKill = process.kill.bind(process);
	let observed = 0; let releaseReads!: () => void;
	const bothRead = new Promise<void>(resolve => { releaseReads = resolve; });
	const read = spyOn(fs, "readFile").mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
		const value = await realRead(...args);
		if (String(args[0]) === lock && String(value) === original && observed < 2) { observed++; if (observed === 2) releaseReads(); await bothRead; }
		return value;
	}) as typeof fs.readFile);
	const kill = spyOn(process, "kill").mockImplementation((pid, signal) => {
		if (pid === 1234567) throw Object.assign(new Error("gone"), { code: "ESRCH" });
		return realKill(pid, signal);
	});
	let active = 0; let maximum = 0; let releaseMutation!: () => void;
	const mutationGate = new Promise<void>(resolve => { releaseMutation = resolve; });
	const mutate = async () => { active++; maximum = Math.max(maximum, active); if (active > 1) releaseMutation(); await mutationGate; active--; };
	try {
		const a = withWorkspaceLock(dir, mutate); const b = withWorkspaceLock(dir, mutate);
		await bothRead;
		// Wait for the loser to report busy; keep the winner's lock until then.
		await Promise.race([a.catch(() => undefined), b.catch(() => undefined)]);
		releaseMutation();
		const outcomes = await Promise.allSettled([a, b]);
		expect(outcomes.filter(result => result.status === "fulfilled").length).toBeLessThanOrEqual(1);
		for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason.code).toBe("MEMORY_BUSY");
		await withWorkspaceLock(dir, mutate);
		expect(maximum).toBe(1);
	} finally { releaseReads(); releaseMutation(); read.mockRestore(); kill.mockRestore(); }
});
test("uncertain recovery guard ownership fails conservatively", async () => {
	const dir = await root(); await fs.writeFile(path.join(dir, "MEMORY.md.lock.recovery"), "unknown owner");
	await expect(withWorkspaceLock(dir, async () => undefined)).rejects.toMatchObject({ code: "MEMORY_BUSY" });
});
test("rejects path traversal and symlinked storage", async () => {
	const dir = await root(); const outside = await root();
	await expect(resolveMemoryPath(dir, "session", "../outside")).rejects.toThrow();
	await expect(resolveMemoryPath(dir, "session", path.resolve(outside))).rejects.toThrow();
	try { await fs.symlink(outside, path.join(dir, "sessions"), process.platform === "win32" ? "junction" : "dir"); }
	catch (error) {
		if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) { console.warn("Symlink assertion skipped: OS did not grant symlink permission."); return; }
		throw error;
	}
	await expect(resolveMemoryPath(dir, "session", crypto.randomUUID())).rejects.toThrow();
});
test("atomic write failure preserves target and immutable artifacts never overwrite", async () => {
	const dir = await root(); const file = path.join(dir, "MEMORY.md");
	await fs.writeFile(file, "old");
	const rename = spyOn(fs, "rename").mockRejectedValueOnce(new Error("injected rename failure"));
	try { await expect(atomicWrite(file, Buffer.from("new"))).rejects.toThrow(); }
	finally { rename.mockRestore(); }
	expect(await fs.readFile(file, "utf8")).toBe("old");
	const immutable = path.join(dir, "backup.md");
	await createImmutable(immutable, Buffer.from("original"));
	await createImmutable(immutable, Buffer.from("original"));
	await expect(createImmutable(immutable, Buffer.from("different"))).rejects.toMatchObject({ code: "MIGRATION_CONFLICT" });
});
