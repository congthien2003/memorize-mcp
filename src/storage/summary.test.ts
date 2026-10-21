import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { startSession, saveSessionMemory } from "./session.js";
import { readSnapshot } from "./files.js";
import { parseSummary, sourceReference } from "./format.js";
import { updateMemory } from "./summary.js";

const roots: string[] = [];
afterEach(async () => { for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memorize-summary-")); roots.push(dir);
	const session = await startSession(dir); const source = { sessionId: session.sessionId, entryId: crypto.randomUUID() };
	await saveSessionMemory(dir, { ...source, title: "Storage", content: "Use Markdown." });
	const content = `# Memory\n\nUse Markdown. [Source](${sourceReference(source)})\n`;
	return { dir, session, source, content, file: path.join(dir, "MEMORY.md") };
}
test("summary revision conflict preserves the winning update and session history", async () => {
	const { dir, session, source, content, file } = await fixture();
	const before = await fs.readFile(path.join(dir, session.path));
	const revision = (await readSnapshot(file))!.revision;
	await updateMemory(dir, { sessionId: session.sessionId, expectedRevision: revision, content, sources: [source] });
	await expect(updateMemory(dir, { sessionId: session.sessionId, expectedRevision: revision, content: content + "Other", sources: [source] })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
	expect(parseSummary(await fs.readFile(file)).content).toBe(content);
	expect(await fs.readFile(path.join(dir, session.path))).toEqual(before);
});
test("summary validates sources, excludes code-fence links, and warns without truncating", async () => {
	const { dir, session, source, content, file } = await fixture();
	const revision = (await readSnapshot(file))!.revision;
	const base = { sessionId: session.sessionId, expectedRevision: revision, sources: [source] };
	await expect(updateMemory(dir, { ...base, content: "```md\n" + content + "```" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	const link = `[Source](${sourceReference(source)})`;
	for (const invalid of [`<!-- ${link} -->`, `](${sourceReference(source)})`, `\\${link}`, `> \`\`\`md\n> ${link}\n> \`\`\``, `- \`\`\`md\n  ${link}\n  \`\`\``]) {
		await expect(updateMemory(dir, { ...base, content: invalid })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	}
	await expect(updateMemory(dir, { ...base, sources: [], content })).rejects.toThrow();
	const missing = { ...source, entryId: crypto.randomUUID() };
	await expect(updateMemory(dir, { ...base, content: `[Source](${sourceReference(missing)})`, sources: [missing] })).rejects.toThrow();
	expect((await readSnapshot(file))!.revision).toBe(revision);
	const large = content + "x".repeat(16385 - Buffer.byteLength(content));
	const result = await updateMemory(dir, { ...base, content: large });
	expect(result.warnings).toHaveLength(1);
	expect(parseSummary(await fs.readFile(file)).content).toBe(large);
	await expect(updateMemory(dir, { ...base, expectedRevision: result.revision, content: content + "x".repeat(65536) })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
});
