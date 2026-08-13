import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
	MAX_SESSION_BYTES,
	SESSION_FILENAME,
	searchSessionMemory,
	saveSessionMemory,
	startSession,
} from "./session.js";

const directories: string[] = [];

function createMemoryDir(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "memorize-mcp-"));
	directories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("workspace memory", () => {
	test("startSession registers multiple sessions without deleting existing updates", () => {
		const memoryDir = createMemoryDir();
		const first = startSession(memoryDir, "First goal");
		saveSessionMemory(memoryDir, {
			content: "Old decision",
			section: "Decisions",
			sessionId: first.sessionId,
		});

		const second = startSession(memoryDir, "Second goal");
		const result = searchSessionMemory(memoryDir, {});

		expect(second.sessionId).not.toBe(first.sessionId);
		expect(result.content).toContain("First goal");
		expect(result.content).toContain("Second goal");
		expect(result.content).toContain("Old decision");
	});

	test("replace without a section keeps registered sessions and removes legacy updates", () => {
		const memoryDir = createMemoryDir();
		startSession(memoryDir, "Ship memory");
		saveSessionMemory(memoryDir, { content: "First update", mode: "append" });

		saveSessionMemory(memoryDir, { content: "Concise handoff", mode: "replace" });

		const result = searchSessionMemory(memoryDir, {});
		expect(result.content).toContain("Ship memory");
		expect(result.content).toContain("Concise handoff");
		expect(result.content).not.toContain("First update");
	});

	test("section-scoped replace preserves other sections", () => {
		const memoryDir = createMemoryDir();
		const session = startSession(memoryDir);
		saveSessionMemory(memoryDir, {
			content: "Old decision",
			section: "Decisions",
			sessionId: session.sessionId,
		});
		saveSessionMemory(memoryDir, {
			content: "Current implementation",
			section: "Current State",
			sessionId: session.sessionId,
		});
		saveSessionMemory(memoryDir, {
			content: "New decision",
			section: "Decisions",
			mode: "replace",
			sessionId: session.sessionId,
		});

		const decisions = searchSessionMemory(memoryDir, { section: "Decisions" });
		const currentState = searchSessionMemory(memoryDir, { section: "Current State" });
		expect(decisions.content).toContain("New decision");
		expect(decisions.content).not.toContain("Old decision");
		expect(currentState.content).toContain("Current implementation");
	});

	test("search filters nested entries by section and session ID", () => {
		const memoryDir = createMemoryDir();
		const first = startSession(memoryDir, "First");
		saveSessionMemory(memoryDir, {
			content: "First session decision",
			section: "Decisions",
			sessionId: first.sessionId,
		});
		const second = startSession(memoryDir, "Second");
		saveSessionMemory(memoryDir, {
			content: "Second session decision",
			section: "Decisions",
			sessionId: second.sessionId,
		});

		const result = searchSessionMemory(memoryDir, {
			section: "Decisions",
			sessionId: second.sessionId,
		});

		expect(result.matches).toBe(1);
		expect(result.content).toContain("Second session decision");
		expect(result.content).not.toContain("First session decision");
	});

	test("search requires every query term and returns newest matches first", () => {
		const memoryDir = createMemoryDir();
		startSession(memoryDir);
		saveSessionMemory(memoryDir, {
			content: "Legacy authentication uses an OTP challenge.",
			mode: "append",
		});
		saveSessionMemory(memoryDir, {
			content: "The authentication dashboard remains unchanged.",
			mode: "append",
		});
		saveSessionMemory(memoryDir, {
			content: "The current OTP flow completes authentication.",
			mode: "append",
		});

		const result = searchSessionMemory(memoryDir, {
			query: "authentication otp",
			limit: 2,
		});

		expect(result.matches).toBe(2);
		expect(result.content.indexOf("current OTP")).toBeLessThan(
			result.content.indexOf("Legacy authentication"),
		);
		expect(result.content).not.toContain("dashboard");
	});

	test("starting a session migrates the legacy file without losing content", () => {
		const memoryDir = createMemoryDir();
		const filePath = path.join(memoryDir, SESSION_FILENAME);
		fs.writeFileSync(
			filePath,
			[
				"# Session Memory",
				"",
				"- Session ID: legacy",
				"- Started: 2026-08-10T00:00:00.000Z",
				"---",
				"",
				"## Snapshot — 2026-08-10T00:00:00.000Z",
				"",
				"Legacy snapshot",
				"",
				"## Update — 2026-08-10T00:01:00.000Z",
				"",
				"Legacy update",
			].join("\n"),
		);

		startSession(memoryDir, "New goal");

		const result = searchSessionMemory(memoryDir, {});
		expect(result.content).toContain("# Workspace Memory");
		expect(result.content).toContain("Legacy snapshot");
		expect(result.content).toContain("Legacy update");
		expect(result.content).toContain("New goal");
		expect(result.content).toContain("## Decisions");
	});

	test("a fresh lock prevents a silent concurrent overwrite", () => {
		const memoryDir = createMemoryDir();
		startSession(memoryDir);
		const lockPath = path.join(memoryDir, `${SESSION_FILENAME}.lock`);
		fs.writeFileSync(lockPath, `${process.pid}\n${Date.now()}`);

		expect(() =>
			saveSessionMemory(memoryDir, {
				content: "Blocked update",
				section: "Current State",
			}),
		).toThrow("Memory is being updated");

		fs.unlinkSync(lockPath);
		const result = saveSessionMemory(memoryDir, {
			content: "Allowed update",
			section: "Current State",
		});
		expect(result.bytes).toBeGreaterThan(0);
	});

	test("save reports the 80 percent capacity boundary", () => {
		const memoryDir = createMemoryDir();
		startSession(memoryDir);

		const belowLimit = saveSessionMemory(memoryDir, {
			content: "Concise snapshot",
			mode: "replace",
		});
		expect(belowLimit.nearLimit).toBe(false);

		const result = saveSessionMemory(memoryDir, {
			content: "x".repeat(Math.ceil(MAX_SESSION_BYTES * 0.8)),
			mode: "replace",
		});

		expect(result.bytes).toBeGreaterThanOrEqual(MAX_SESSION_BYTES * 0.8);
		expect(result.nearLimit).toBe(true);
	});
});
