import crypto from "crypto";
import fs from "fs";
import path from "path";

export const SESSION_FILENAME = "MEMORY.md";
export const MAX_SESSION_BYTES = 64 * 1024;

export type SaveMode = "append" | "replace";

export const MEMORY_SECTIONS = [
	"Context",
	"Constraints",
	"Decisions",
	"Current State",
	"Verification",
	"Open Questions",
	"Next Steps",
	"Session Updates",
	"Sessions",
] as const;

export type MemorySection = (typeof MEMORY_SECTIONS)[number];

export interface StartSessionResult {
	filePath: string;
	sessionId: string;
}

export interface SaveSessionOptions {
	content: string;
	mode?: SaveMode;
	section?: string;
	sessionId?: string;
}

export interface SessionSearchOptions {
	query?: string;
	limit?: number;
	section?: string;
	sessionId?: string;
}

export interface SessionSearchResult {
	content: string;
	matches: number;
}

const HEADER_SEPARATOR = "\n---\n";
const LOCK_FILENAME = `${SESSION_FILENAME}.lock`;
const LOCK_STALE_MS = 30_000;
const STRUCTURED_SAVE_SECTIONS = MEMORY_SECTIONS.filter(
	(section) => section !== "Sessions",
);

function ensureDirectory(memoryDir: string): void {
	fs.mkdirSync(memoryDir, { recursive: true });
}

function getSessionPath(memoryDir: string): string {
	return path.join(memoryDir, SESSION_FILENAME);
}

function getLockPath(memoryDir: string): string {
	return path.join(memoryDir, LOCK_FILENAME);
}

function acquireMemoryLock(memoryDir: string): string {
	const lockPath = getLockPath(memoryDir);

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			fs.writeFileSync(lockPath, `${process.pid}\n${Date.now()}`, {
				encoding: "utf8",
				flag: "wx",
			});
			return lockPath;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				throw error;
			}

			try {
				const isStale = Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS;
				if (isStale) {
					fs.unlinkSync(lockPath);
					continue;
				}
			} catch (statError) {
				if ((statError as NodeJS.ErrnoException).code === "ENOENT") {
					continue;
				}
				throw statError;
			}

			throw new Error("Memory is being updated by another session. Retry shortly.");
		}
	}

	throw new Error("Memory lock could not be acquired. Retry shortly.");
}

function withMemoryLock<T>(memoryDir: string, action: () => T): T {
	ensureDirectory(memoryDir);
	const lockPath = acquireMemoryLock(memoryDir);

	try {
		return action();
	} finally {
		try {
			fs.unlinkSync(lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}
}

function writeSession(filePath: string, content: string): number {
	const bytes = Buffer.byteLength(content, "utf8");
	if (bytes > MAX_SESSION_BYTES) {
		throw new Error(
			"Session memory exceeds 64 KiB. Replace it with a concise snapshot before saving more.",
		);
	}

	const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(temporaryPath, content, "utf8");
	fs.renameSync(temporaryPath, filePath);
	return bytes;
}

function readSession(memoryDir: string): string | null {
	const filePath = getSessionPath(memoryDir);
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function splitHeader(content: string): { header: string; body: string } {
	const separatorMatch = /\r?\n---\r?\n/.exec(content);
	if (separatorMatch && separatorMatch.index !== undefined) {
		return {
			header: content.slice(0, separatorMatch.index).trimEnd(),
			body: content.slice(separatorMatch.index + separatorMatch[0].length).trim(),
		};
	}

	const firstSectionIndex = content.search(/^##\s+/m);
	if (firstSectionIndex >= 0) {
		return {
			header: content.slice(0, firstSectionIndex).trimEnd(),
			body: content.slice(firstSectionIndex).trim(),
		};
	}

	return { header: content.trimEnd(), body: "" };
}

function splitSections(body: string): string[] {
	return body
		.split(/(?=^##\s+)/m)
		.map((section) => section.trim())
		.filter(Boolean);
}

function getSectionName(section: string): string | null {
	const heading = section.match(/^##\s+([^\r\n]+)$/m);
	return heading?.[1].trim() || null;
}

function getSectionIndex(sections: string[], name: string): number {
	return sections.findIndex((section) => getSectionName(section) === name);
}

function renderDocument(header: string, sections: string[]): string {
	return `${header.trimEnd()}${HEADER_SEPARATOR}\n${sections.join("\n\n").trim()}\n`;
}

function createWorkspaceContent(): string {
	const header = [
		"# Workspace Memory",
		"",
		`- Memory ID: ${crypto.randomUUID()}`,
		`- Updated: ${new Date().toISOString()}`,
	].join("\n");
	const sections = MEMORY_SECTIONS.map((section) => `## ${section}`);
	return renderDocument(header, sections);
}

function normalizeWorkspaceContent(content: string): string {
	const normalizedTitle = content.replace(
		/^# Session Memory\s*$/m,
		"# Workspace Memory",
	);
	const { header, body } = splitHeader(normalizedTitle);
	const sections = splitSections(body);

	for (const section of MEMORY_SECTIONS) {
		if (getSectionIndex(sections, section) === -1) {
			sections.push(`## ${section}`);
		}
	}

	return renderDocument(header || "# Workspace Memory", sections);
}

function normalizeSectionName(
	section: string | undefined,
	options: { allowSessions?: boolean } = {},
): MemorySection | undefined {
	if (section === undefined) return undefined;

	const normalized = section.trim();
	const validSections = options.allowSessions
		? MEMORY_SECTIONS
		: STRUCTURED_SAVE_SECTIONS;
	if (!validSections.some((validSection) => validSection === normalized)) {
		throw new Error(
			`section must be one of: ${validSections.join(", ")}.`,
		);
	}

	return normalized as MemorySection;
}

function appendToSection(
	content: string,
	sectionName: MemorySection,
	entry: string,
): string {
	const { header, body } = splitHeader(content);
	const sections = splitSections(body);
	const sectionIndex = getSectionIndex(sections, sectionName);
	if (sectionIndex === -1) {
		sections.push(`## ${sectionName}\n\n${entry.trim()}`);
	} else {
		sections[sectionIndex] = `${sections[sectionIndex].trimEnd()}\n\n${entry.trim()}`;
	}

	return renderDocument(header || "# Workspace Memory", sections);
}

function replaceSection(
	content: string,
	sectionName: MemorySection,
	entry: string,
): string {
	const { header, body } = splitHeader(content);
	const sections = splitSections(body);
	const sectionIndex = getSectionIndex(sections, sectionName);
	const nextSection = `## ${sectionName}\n\n${entry.trim()}`;

	if (sectionIndex === -1) {
		sections.push(nextSection);
	} else {
		sections[sectionIndex] = nextSection;
	}

	return renderDocument(header || "# Workspace Memory", sections);
}

function replaceLegacySnapshot(
	content: string,
	now: string,
	snapshot: string,
): string {
	const { header, body } = splitHeader(content);
	const sessionSection = splitSections(body).find(
		(section) => getSectionName(section) === "Sessions",
	);
	const sections = [
		...(sessionSection ? [sessionSection] : []),
		`## Snapshot — ${now}\n\n${snapshot}`,
	];

	return renderDocument(header || "# Workspace Memory", sections);
}

function filterSectionBySession(section: string, sessionId: string): string | null {
	if (!section.includes(sessionId)) return null;

	const nestedSections = section
		.split(/(?=^###\s+)/m)
		.map((nestedSection) => nestedSection.trim())
		.filter(Boolean);
	if (nestedSections.length < 2) return section;

	const heading = nestedSections[0] ?? section;
	const matchingEntries = nestedSections.slice(1).filter((entry) => entry.includes(sessionId));
	return matchingEntries.length > 0
		? [heading, ...matchingEntries].join("\n\n")
		: null;
}

function appendSessionEntry(
	content: string,
	sectionName: MemorySection,
	sessionId: string,
	goal: string | undefined,
	now: string,
): string {
	const goalLine = goal ? `\n- Goal: ${goal}` : "";
	return appendToSection(
		content,
		sectionName,
		`### Session ${sessionId} — ${now}\n\n- Started: ${now}${goalLine}`,
	);
}

export function startSession(memoryDir: string, goal?: string): StartSessionResult {
	return withMemoryLock(memoryDir, () => {
		const now = new Date().toISOString();
		const sessionId = crypto.randomUUID();
		const safeGoal = goal?.trim().replace(/\r?\n/g, " ");
		const currentSession = readSession(memoryDir);
		const workspace = currentSession
			? normalizeWorkspaceContent(currentSession)
			: createWorkspaceContent();
		const content = appendSessionEntry(
			workspace,
			"Sessions",
			sessionId,
			safeGoal,
			now,
		);
		const filePath = getSessionPath(memoryDir);
		writeSession(filePath, content);

		return { filePath, sessionId };
	});
}

export function saveSessionMemory(
	memoryDir: string,
	options: SaveSessionOptions,
): { filePath: string; bytes: number; nearLimit: boolean } {
	const content = options.content.trim();
	if (!content) {
		throw new Error("content must be a non-empty string.");
	}

	const mode = options.mode ?? "append";
	if (mode !== "append" && mode !== "replace") {
		throw new Error("mode must be either 'append' or 'replace'.");
	}

	const sectionName = normalizeSectionName(options.section);
	const sessionId = options.sessionId?.trim() || "legacy";

	return withMemoryLock(memoryDir, () => {
		const currentSession = readSession(memoryDir);
		if (!currentSession) {
			throw new Error("No active workspace memory. Call start_session before saving memory.");
		}

		const now = new Date().toISOString();
		let nextContent: string;
		if (!sectionName) {
			nextContent =
				mode === "append"
					? `${currentSession.trimEnd()}\n\n## Update — ${now}\n\n${content}\n`
					: replaceLegacySnapshot(currentSession, now, content);
		} else {
			const workspace = normalizeWorkspaceContent(currentSession);
			const entry =
				mode === "append"
					? `### Session ${sessionId} — ${now}\n\n${content}`
					: `- Last updated by session: ${sessionId}\n- Updated: ${now}\n\n${content}`;
			nextContent =
				mode === "append"
					? appendToSection(workspace, sectionName, entry)
					: replaceSection(workspace, sectionName, entry);
		}

		const filePath = getSessionPath(memoryDir);
		const bytes = writeSession(filePath, nextContent);
		return {
			filePath,
			bytes,
			nearLimit: bytes >= MAX_SESSION_BYTES * 0.8,
		};
	});
}

export function searchSessionMemory(
	memoryDir: string,
	options: SessionSearchOptions,
): SessionSearchResult {
	const content = readSession(memoryDir);
	if (!content) {
		return {
			content: "No active workspace memory. Call start_session first.",
			matches: 0,
		};
	}

	const query = options.query?.trim();
	const sectionName = normalizeSectionName(options.section, { allowSessions: true });
	const sessionId = options.sessionId?.trim();
	if (!query && !sectionName && !sessionId) {
		return { content, matches: 1 };
	}

	const limit = options.limit ?? 3;
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new Error("limit must be a positive integer.");
	}

	const { body } = splitHeader(content);
	const terms = query ? query.toLowerCase().split(/\s+/) : [];
	const matches = splitSections(body)
		.map((section) => (sessionId ? filterSectionBySession(section, sessionId) : section))
		.filter((section): section is string => {
			if (!section) return false;
			if (sectionName && getSectionName(section) !== sectionName) return false;
			const normalizedSection = section.toLowerCase();
			return terms.every((term) => normalizedSection.includes(term));
		})
		.reverse()
		.slice(0, limit);

	return {
		content: matches.length > 0 ? matches.join("\n\n").trim() : "No matching sections.",
		matches: matches.length,
	};
}
