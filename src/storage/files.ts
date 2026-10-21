import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { validateSessionId, revisionOf } from "./format.js";
import { MemoryError } from "./types.js";

function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException)?.code; }
function io(message: string, uncertain = false): MemoryError {
	return new MemoryError("IO_ERROR", message, true, uncertain ? "unknown" : "not-written");
}
async function assertSafePath(memoryDir: string, target: string): Promise<void> {
	const root = path.resolve(memoryDir);
	const relative = path.relative(root, target);
	if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new MemoryError("INVALID_ARGUMENT", "Memory path must stay inside the workspace memory directory.");
	let current = root;
	for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
		if (part) current = path.join(current, part);
		try {
			if ((await fs.lstat(current)).isSymbolicLink()) throw new MemoryError("INVALID_ARGUMENT", "Symlinks and junctions are not supported inside memory storage.");
		} catch (error) { if (code(error) !== "ENOENT") throw error; }
	}
}
export async function resolveMemoryPath(memoryDir: string, target: "memory" | "session" | "backup", id?: string): Promise<string> {
	let relative = "MEMORY.md";
	if (target === "session") { validateSessionId(id as string); relative = path.join("sessions", `${id}.md`); }
	if (target === "backup") {
		if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) throw new MemoryError("INVALID_ARGUMENT", "Invalid backup hash.");
		relative = path.join("backups", `legacy-${id}.md`);
	}
	const result = path.resolve(memoryDir, relative); await assertSafePath(memoryDir, result); return result;
}
export async function readSnapshot(filePath: string): Promise<{ bytes: Buffer; revision: string } | null> {
	try { const bytes = await fs.readFile(filePath); return { bytes, revision: revisionOf(bytes) }; }
	catch (error) { if (code(error) === "ENOENT") return null; throw io("Cannot read memory file; check file permissions and retry."); }
}
export async function atomicWrite(filePath: string, bytes: Buffer): Promise<void> {
	const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
	let committed = false;
	try {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(temporary, bytes, { flag: "wx" });
		await fs.rename(temporary, filePath); committed = true;
	} catch { throw io("Atomic memory write failed. Retry the same entry ID, or read the current summary revision.", committed); }
	finally {
		try { await fs.unlink(temporary); }
		catch (error) { if (code(error) !== "ENOENT") throw io("Temporary-file cleanup failed; inspect the current memory before retrying.", true); }
	}
}
export async function createImmutable(filePath: string, bytes: Buffer): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const existing = await readSnapshot(filePath);
	if (existing) {
		if (!existing.bytes.equals(bytes)) throw new MemoryError("MIGRATION_CONFLICT", "Migration artifact differs from the original source. Restore the matching artifact before retrying.");
		return;
	}
	// The workspace lock serializes migration writers. Rename prevents a crash
	// during write from leaving a partial immutable artifact at the final path.
	await atomicWrite(filePath, bytes);
}

type Lock = { pid: number; token: string };
function parseLock(raw: string): Lock | null {
	try {
		const value = JSON.parse(raw) as Partial<Lock>;
		if (Number.isSafeInteger(value.pid) && (value.pid ?? 0) > 0 && typeof value.token === "string" && value.token) return value as Lock;
	} catch { /* A legacy lock can still protect a live pre-migration process. */ }
	const legacy = /^(\d+)\r?\n\d+$/.exec(raw);
	if (legacy?.[1] && Number(legacy[1]) > 0) return { pid: Number(legacy[1]), token: raw };
	return null;
}
export async function withWorkspaceLock<T>(memoryDir: string, action: () => Promise<T>): Promise<T> {
	const lockPath = path.resolve(memoryDir, "MEMORY.md.lock");
	const recoveryPath = `${lockPath}.recovery`;
	await assertSafePath(memoryDir, lockPath);
	await assertSafePath(memoryDir, recoveryPath);
	await fs.mkdir(memoryDir, { recursive: true });
	const token = crypto.randomUUID();
	const raw = JSON.stringify({ pid: process.pid, token, createdAt: Date.now() });
	const busy = () => new MemoryError("MEMORY_BUSY", "Memory is being updated or its lock owner cannot be confirmed. Retry shortly; do not delete a live lock.", true);
	const recoveryExists = async () => {
		try { await fs.lstat(recoveryPath); return true; }
		catch (error) { if (code(error) === "ENOENT") return false; throw busy(); }
	};
	const removeOwned = async (file: string, expected: string) => {
		if (await fs.readFile(file, "utf8") !== expected) throw io("Lock ownership changed; inspect current memory before retrying.", true);
		await fs.unlink(file);
	};
	const recover = async (original: string) => {
		// Only one reclaimer may authorize unlink. Every normal acquisition
		// checks this guard before and after creating its main lock.
		let guard: Awaited<ReturnType<typeof fs.open>>;
		try { guard = await fs.open(recoveryPath, "wx"); }
		catch { throw busy(); }
		const recoveryRaw = JSON.stringify({ pid: process.pid, token: crypto.randomUUID() });
		try { await guard.writeFile(recoveryRaw, "utf8"); }
		catch { await guard.close().catch(() => undefined); throw io("Recovery guard initialization failed. Inspect its owner before retrying."); }
		await guard.close();
		try {
			let current: string;
			try { current = await fs.readFile(lockPath, "utf8"); }
			catch (error) { if (code(error) === "ENOENT") return; throw busy(); }
			if (current !== original) throw busy();
			const owner = parseLock(current); if (!owner) throw busy();
			try { process.kill(owner.pid, 0); throw busy(); }
			catch (error) { if (code(error) !== "ESRCH") throw busy(); }
			await fs.unlink(lockPath);
		} finally {
			// A guard left by a crashed reclaimer is not guessed safe to delete.
			// Conservatively report busy until its owner/state is inspected.
			await removeOwned(recoveryPath, recoveryRaw);
		}
	};
	let acquired = false;
	for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
		if (await recoveryExists()) throw busy();
		let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
		try {
			handle = await fs.open(lockPath, "wx");
			await handle.writeFile(raw, "utf8"); await handle.close(); handle = undefined;
			if (await recoveryExists()) { await removeOwned(lockPath, raw); throw busy(); }
			acquired = true;
		} catch (error) {
			if (handle) { await handle.close().catch(() => undefined); throw io("Could not initialize the workspace lock; inspect the lock before retrying."); }
			if (code(error) !== "EEXIST") throw error instanceof MemoryError ? error : io("Cannot acquire the memory lock.");
			let original: string;
			try { original = await fs.readFile(lockPath, "utf8"); }
			catch (readError) { if (code(readError) === "ENOENT") continue; throw busy(); }
			const owner = parseLock(original); if (!owner) throw busy();
			try { process.kill(owner.pid, 0); throw busy(); }
			catch (ownerError) { if (code(ownerError) !== "ESRCH") throw busy(); }
			await recover(original);
		}
	}
	if (!acquired) throw busy();
	try { return await action(); }
	catch (error) { if (error instanceof MemoryError) throw error; throw io("Memory operation failed; inspect current memory before retrying.", true); }
	finally {
		try {
			const current = parseLock(await fs.readFile(lockPath, "utf8"));
			if (current?.token !== token) throw io("Memory lock ownership changed; current data must be read before retrying.", true);
			await fs.unlink(lockPath);
		} catch { throw io("Memory lock cleanup failed; retry only after checking current memory and the lock owner.", true); }
	}
}
