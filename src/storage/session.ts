import crypto from "crypto";
import fs from "fs";
import path from "path";

export const SESSION_FILENAME = "MEMORY.md";
export const MAX_SESSION_BYTES = 64 * 1024;

export type SaveMode = "append" | "replace";

export interface SessionSearchOptions {
	query?: string;
	limit?: number;
}

export interface SessionSearchResult {
	content: string;
	matches: number;
}

const HEADER_SEPARATOR = "\n---\n";

function ensureDirectory(memoryDir: string): void {
	fs.mkdirSync(memoryDir, { recursive: true });
}

function getSessionPath(memoryDir: string): string {
	return path.join(memoryDir, SESSION_FILENAME);
}

function writeSession(filePath: string, content: string): void {
	if (Buffer.byteLength(content, "utf8") > MAX_SESSION_BYTES) {
		throw new Error(
			"Session memory exceeds 64 KiB. Replace it with a concise snapshot before saving more.",
		);
	}

	const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(temporaryPath, content, "utf8");
	fs.renameSync(temporaryPath, filePath);
}

function readSession(memoryDir: string): string | null {
	const filePath = getSessionPath(memoryDir);
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function splitHeader(content: string): { header: string; body: string } {
	const separatorIndex = content.indexOf(HEADER_SEPARATOR);
	if (separatorIndex === -1) {
		return { header: content.trimEnd(), body: "" };
	}

	return {
		header: content.slice(0, separatorIndex).trimEnd(),
		body: content.slice(separatorIndex + HEADER_SEPARATOR.length).trim(),
	};
}

export function startSession(memoryDir: string, goal?: string): string {
	ensureDirectory(memoryDir);

	const now = new Date().toISOString();
	const goalLine = goal?.trim() ? `\n- Goal: ${goal.trim()}` : "";
	const content = [
		"# Session Memory",
		"",
		`- Session ID: ${crypto.randomUUID()}`,
		`- Started: ${now}${goalLine}`,
		"---",
		"",
	].join("\n");

	const filePath = getSessionPath(memoryDir);
	writeSession(filePath, content);
	return filePath;
}

export function saveSessionMemory(
	memoryDir: string,
	options: { content: string; mode?: SaveMode },
): string {
	const content = options.content.trim();
	if (!content) {
		throw new Error("content must be a non-empty string.");
	}

	const currentSession = readSession(memoryDir);
	if (!currentSession) {
		throw new Error("No active session. Call start_session before saving memory.");
	}

	const mode = options.mode ?? "append";
	if (mode !== "append" && mode !== "replace") {
		throw new Error("mode must be either 'append' or 'replace'.");
	}

	const now = new Date().toISOString();
	const nextContent =
		mode === "append"
			? `${currentSession.trimEnd()}\n\n## Update — ${now}\n\n${content}\n`
			: `${splitHeader(currentSession).header}${HEADER_SEPARATOR}\n## Snapshot — ${now}\n\n${content}\n`;

	const filePath = getSessionPath(memoryDir);
	writeSession(filePath, nextContent);
	return filePath;
}

export function searchSessionMemory(
	memoryDir: string,
	options: SessionSearchOptions,
): SessionSearchResult {
	const content = readSession(memoryDir);
	if (!content) {
		return {
			content: "No active session. Call start_session first.",
			matches: 0,
		};
	}

	const query = options.query?.trim();
	if (!query) {
		return { content, matches: 1 };
	}

	const limit = options.limit ?? 3;
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new Error("limit must be a positive integer.");
	}

	const { body } = splitHeader(content);
	const matches = body
		.split(/(?=^##\s+)/m)
		.filter((section) => section.toLowerCase().includes(query.toLowerCase()))
		.slice(0, limit);

	return {
		content: matches.length > 0 ? matches.join("\n\n").trim() : "No matching sections.",
		matches: matches.length,
	};
}
