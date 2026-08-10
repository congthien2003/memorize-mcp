import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
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

	test("search returns only matching sections regardless of case", () => {
		const memoryDir = createMemoryDir();
		startSession(memoryDir);
		saveSessionMemory(memoryDir, {
			content: "Authentication now uses an OTP challenge.",
			mode: "append",
		});
		saveSessionMemory(memoryDir, {
			content: "The dashboard remains unchanged.",
			mode: "append",
		});

		const result = searchSessionMemory(memoryDir, { query: "otp" });
		expect(result.content).toContain("Authentication now uses an OTP challenge.");
		expect(result.content).not.toContain("The dashboard remains unchanged.");
	});
});
