import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
	MAX_SESSION_BYTES,
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

describe("session memory", () => {
	test("startSession replaces the previous session content", () => {
		const memoryDir = createMemoryDir();
		startSession(memoryDir, "First goal");
		saveSessionMemory(memoryDir, { content: "Old decision", mode: "append" });

		startSession(memoryDir, "Second goal");

		const result = searchSessionMemory(memoryDir, {});
		expect(result.content).toContain("Second goal");
		expect(result.content).not.toContain("Old decision");
	});

	test("replace keeps the session header and removes appended updates", () => {
		const memoryDir = createMemoryDir();
		startSession(memoryDir, "Ship memory");
		saveSessionMemory(memoryDir, { content: "First update", mode: "append" });

		saveSessionMemory(memoryDir, { content: "Concise handoff", mode: "replace" });

		const result = searchSessionMemory(memoryDir, {});
		expect(result.content).toContain("Ship memory");
		expect(result.content).toContain("Concise handoff");
		expect(result.content).not.toContain("First update");
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
