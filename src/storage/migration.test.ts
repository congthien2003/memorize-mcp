import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureWorkspaceUnderLock } from "./migration.js";
import { withWorkspaceLock } from "./files.js";
import { parseSession, parseSummary, revisionOf } from "./format.js";

const roots: string[] = [];
async function root() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memorize-migrate-")); roots.push(dir); return dir; }
afterEach(async () => { for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
const migrate = (dir: string) => withWorkspaceLock(dir, () => ensureWorkspaceUnderLock(dir));

test("migrates both legacy titles without losing original bytes", async () => {
	for (const title of ["Session Memory", "Workspace Memory"]) {
		const dir = await root(); const original = Buffer.from(`\uFEFF# ${title}\r\n\r\n## Update\r\nTiếng Việt 🙂\r\n`);
		await fs.writeFile(path.join(dir, "MEMORY.md"), original);
		const result = await migrate(dir);
		expect(result.status).toBe("migrated");
		expect(await fs.readFile(path.join(dir, result.backupPath!))).toEqual(original);
		const legacy = parseSession(await fs.readFile(path.join(dir, "sessions", `${result.legacySource!.sessionId}.md`)));
		expect(legacy.entries[0]?.content).toBe(original.toString());
		expect(parseSummary(await fs.readFile(path.join(dir, "MEMORY.md"))).content).toContain(result.legacySource!.entryId);
		expect((await migrate(dir)).status).toBe("none");
	}
});
test("empty files get exact backup but no empty legacy entry; missing files bootstrap", async () => {
	for (const text of ["", " \r\n\t"]) {
		const dir = await root(); await fs.writeFile(path.join(dir, "MEMORY.md"), text);
		const result = await migrate(dir);
		expect(result.legacySource).toBeUndefined();
		expect(await fs.readFile(path.join(dir, result.backupPath!), "utf8")).toBe(text);
	}
	expect((await migrate(await root())).status).toBe("initialized");
});
test("resumes backup-only and backup-plus-legacy migration; mismatches fail safely", async () => {
	const dir = await root(); const original = Buffer.from("# Workspace Memory\n\nA decision\n");
	const hash = revisionOf(original); const file = path.join(dir, "MEMORY.md");
	await fs.writeFile(file, original); await fs.mkdir(path.join(dir, "backups"));
	await fs.writeFile(path.join(dir, "backups", `legacy-${hash}.md`), original);
	const first = await migrate(dir);
	const legacyPath = path.join(dir, "sessions", `${first.legacySource!.sessionId}.md`);
	const legacyBefore = await fs.readFile(legacyPath);
	await fs.writeFile(file, original);
	await migrate(dir);
	expect(await fs.readFile(legacyPath)).toEqual(legacyBefore);
	await fs.writeFile(file, original);
	await fs.writeFile(path.join(dir, "backups", `legacy-${hash}.md`), "different");
	await expect(migrate(dir)).rejects.toMatchObject({ code: "MIGRATION_CONFLICT" });
	expect(await fs.readFile(file)).toEqual(original);
});
test("unrecognized non-empty memory is not overwritten", async () => {
	const dir = await root(); const file = path.join(dir, "MEMORY.md");
	await fs.writeFile(file, "# My custom notes");
	await expect(migrate(dir)).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
	expect(await fs.readFile(file, "utf8")).toBe("# My custom notes");
});
