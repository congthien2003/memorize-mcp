/**
 * Local storage implementation for memorize-mcp
 * Handles saving memory data to local JSON files (v2 schema)
 */
import fs from "fs";
import path from "path";
import {
	computeContentHash,
	extractTags,
	parseMarkdownToSections,
	MAX_HISTORY_ENTRIES,
} from "./markdown.js";
import type {
	MemoryData,
	SaveMemoryOptions,
	HistoryEntry,
	IndexEntry,
	MemoryIndex,
	SearchMemorizeOptions,
	SearchMemorizeResult,
} from "./types.js";

const INDEX_FILENAME = "_index.json";

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/**
 * Ensure directory exists, create if not
 */
export function ensureDirectoryExists(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

function readIndex(memoryDir: string): MemoryIndex {
	const indexPath = path.join(memoryDir, INDEX_FILENAME);
	if (fs.existsSync(indexPath)) {
		try {
			return JSON.parse(fs.readFileSync(indexPath, "utf8")) as MemoryIndex;
		} catch {
			// Corrupted index — start fresh
		}
	}
	return { version: 1, updatedAt: new Date().toISOString(), entries: [] };
}

/**
 * Update (or insert) a single entry in _index.json.
 */
export function updateIndex(memoryDir: string, entry: IndexEntry): void {
	const index = readIndex(memoryDir);

	const existingIdx = index.entries.findIndex(
		(e) => e.filename === entry.filename
	);
	if (existingIdx >= 0) {
		index.entries[existingIdx] = entry;
	} else {
		index.entries.push(entry);
	}

	index.updatedAt = new Date().toISOString();
	const indexPath = path.join(memoryDir, INDEX_FILENAME);
	fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
}

/**
 * Rebuild _index.json by scanning every .json file in memoryDir.
 * Useful after a batch sync operation.
 */
export function rebuildIndex(memoryDir: string): void {
	if (!fs.existsSync(memoryDir)) return;

	const files = fs
		.readdirSync(memoryDir)
		.filter((f: string) => f.endsWith(".json") && f !== INDEX_FILENAME);

	const entries: IndexEntry[] = [];
	for (const filename of files) {
		const data = readLocalMemory(filename, memoryDir);
		if (data) {
			entries.push({
				filename: data.filename,
				topic: data.topic,
				tags: data.tags,
				timestamp: data.timestamp,
				contentHash: data.contentHash,
				sectionCount: data.sections.length,
			});
		}
	}

	const index: MemoryIndex = {
		version: 1,
		updatedAt: new Date().toISOString(),
		entries,
	};

	const indexPath = path.join(memoryDir, INDEX_FILENAME);
	fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");

	console.log(
		`[${new Date().toISOString()}] 🗂️  Index rebuilt: ${entries.length} entries`
	);
}

// ---------------------------------------------------------------------------
// V1 → V2 migration
// ---------------------------------------------------------------------------

/**
 * Migrate a v1 memory file (no `version` field) to the v2 schema.
 * The migrated object is returned in memory; callers may persist it.
 */
function migrateV1ToV2(v1Data: Record<string, unknown>): MemoryData {
	const rawContent = (v1Data.content as string) || "";
	const timestamp = (v1Data.timestamp as string) || new Date().toISOString();

	return {
		version: 2,
		filename: v1Data.filename as string,
		topic: v1Data.topic as string,
		tags: extractTags(rawContent),
		timestamp,
		contentHash: computeContentHash(rawContent),
		createdFrom: v1Data.createdFrom as string | undefined,
		updatedAt: timestamp,
		rawContent,
		sections: parseMarkdownToSections(rawContent),
		history: [],
	};
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Check if a local memory file exists
 */
export function localMemoryExists(
	filename: string,
	memoryDir: string
): boolean {
	return fs.existsSync(path.join(memoryDir, filename));
}

/**
 * Read a local memory file and return v2 MemoryData.
 * If the file is in the old v1 format it is automatically migrated to v2
 * and written back to disk (lazy migration).
 *
 * @returns MemoryData (v2) or null if the file is missing / unreadable.
 */
export function readLocalMemory(
	filename: string,
	memoryDir: string
): MemoryData | null {
	try {
		const filePath = path.join(memoryDir, filename);
		if (!fs.existsSync(filePath)) return null;

		const raw = JSON.parse(
			fs.readFileSync(filePath, "utf8")
		) as Record<string, unknown>;

		// Validate minimum required fields
		if (!raw.filename || !raw.topic) {
			console.warn(
				`[${new Date().toISOString()}] Invalid memory file (missing required fields): ${filePath}`
			);
			return null;
		}

		// V1 → V2 lazy migration
		if (!raw.version) {
			console.log(
				`[${new Date().toISOString()}] 🔄 Migrating v1 → v2: ${filename}`
			);
			const migrated = migrateV1ToV2(raw);
			// Persist the migrated file
			fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2), "utf8");
			// Update index entry
			updateIndex(memoryDir, {
				filename: migrated.filename,
				topic: migrated.topic,
				tags: migrated.tags,
				timestamp: migrated.timestamp,
				contentHash: migrated.contentHash,
				sectionCount: migrated.sections.length,
			});
			return migrated;
		}

		return raw as unknown as MemoryData;
	} catch (error) {
		console.error(
			`[${new Date().toISOString()}] Error reading local memory ${filename}:`,
			error
		);
		return null;
	}
}

/**
 * List all memory filenames in memoryDir.
 * Reads from _index.json when available; falls back to directory scan.
 */
export function listLocalMemories(memoryDir: string): string[] {
	try {
		if (!fs.existsSync(memoryDir)) return [];

		const indexPath = path.join(memoryDir, INDEX_FILENAME);
		if (fs.existsSync(indexPath)) {
			try {
				const index = JSON.parse(
					fs.readFileSync(indexPath, "utf8")
				) as MemoryIndex;
				return index.entries.map((e) => e.filename);
			} catch {
				// Fall through to directory scan
			}
		}

		// Fallback: scan directory
		return fs
			.readdirSync(memoryDir)
			.filter((f: string) => f.endsWith(".json") && f !== INDEX_FILENAME);
	} catch (error) {
		console.error(
			`[${new Date().toISOString()}] Error listing local memories:`,
			error
		);
		return [];
	}
}

/**
 * Save memory data to a local JSON file using the v2 schema.
 *
 * - If the file already exists and the content hash is unchanged, the save
 *   is skipped (the existing file path is returned without modification).
 * - If the content changed, the old version is pushed into `history`
 *   (capped at MAX_HISTORY_ENTRIES) before writing the new data.
 * - _index.json is updated after every successful write.
 *
 * @returns Absolute path to the saved file.
 */
export function saveLocalMemory(
	options: SaveMemoryOptions,
	memoryDir: string
): string {
	const { filename, topic, content, timestamp, createdFrom, contentHash } =
		options;

	ensureDirectoryExists(memoryDir);

	const filePath = path.join(memoryDir, filename);
	const now = new Date().toISOString();
	const newHash = contentHash || computeContentHash(content);

	// Read existing file (if any) and handle history / dedup
	let history: HistoryEntry[] = [];
	let originalTimestamp = timestamp || now;

	const existing = readLocalMemory(filename, memoryDir);
	if (existing) {
		// Skip write if content is identical
		if (existing.contentHash === newHash) {
			console.log(
				`[${new Date().toISOString()}] ⏩ Skipping save: content unchanged for ${filename}`
			);
			return filePath;
		}

		// Preserve original creation timestamp
		originalTimestamp = existing.timestamp;

		// Push old version to history (newest first, capped)
		history = [
			{
				timestamp: existing.updatedAt || existing.timestamp,
				contentHash: existing.contentHash,
				changedBy: existing.createdFrom,
			},
			...existing.history,
		].slice(0, MAX_HISTORY_ENTRIES);
	}

	const dataToSave: MemoryData = {
		version: 2,
		filename,
		topic,
		tags: extractTags(content),
		timestamp: originalTimestamp,
		contentHash: newHash,
		createdFrom,
		updatedAt: now,
		rawContent: content,
		sections: parseMarkdownToSections(content),
		history,
	};

	fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), "utf8");

	// Keep _index.json in sync
	updateIndex(memoryDir, {
		filename: dataToSave.filename,
		topic: dataToSave.topic,
		tags: dataToSave.tags,
		timestamp: dataToSave.timestamp,
		contentHash: dataToSave.contentHash,
		sectionCount: dataToSave.sections.length,
	});

	return filePath;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search memories using the _index.json for fast filtering.
 * Falls back to an empty result set when no index exists yet.
 */
export function searchMemories(
	options: SearchMemorizeOptions,
	memoryDir: string
): SearchMemorizeResult {
	if (!fs.existsSync(memoryDir)) {
		return {
			success: true,
			results: [],
			total: 0,
			message: "Memory directory does not exist yet.",
		};
	}

	const index = readIndex(memoryDir);
	let entries = index.entries;

	// Filter by tags (any tag matches)
	if (options.tags && options.tags.length > 0) {
		const lowerTags = options.tags.map((t) => t.toLowerCase());
		entries = entries.filter((e) =>
			lowerTags.some((t) => e.tags.includes(t))
		);
	}

	// Filter by query (topic, filename, or tags contain the query string)
	if (options.query) {
		const q = options.query.toLowerCase();
		entries = entries.filter(
			(e) =>
				e.topic.toLowerCase().includes(q) ||
				e.filename.toLowerCase().includes(q) ||
				e.tags.some((t) => t.includes(q))
		);
	}

	const total = entries.length;
	const limit = options.limit ?? 10;
	const results = entries.slice(0, limit);

	return {
		success: true,
		results,
		total,
		message:
			total === 0
				? "No memories matched the search criteria."
				: `Found ${total} memor${total === 1 ? "y" : "ies"}, showing ${results.length}.`,
	};
}
