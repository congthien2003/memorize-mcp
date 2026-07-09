/**
 * Shared types for storage layer
 */

/**
 * A single parsed section from markdown content
 */
export interface Section {
	id: string;
	heading: string;
	level: number; // 0 = preamble (before first heading), 1-6 = heading level
	body: string;
	type: "text" | "code" | "list";
	language?: string; // only for code sections
}

/**
 * A historical snapshot entry stored inside a memory file
 */
export interface HistoryEntry {
	timestamp: string; // ISO string — when this version was saved
	contentHash: string;
	changedBy?: string;
}

/**
 * A structured Q&A decision stored in memory
 */
export interface Decision {
	question: string;
	answer: string;
	note?: string;
	sectionId?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Phạm vi ảnh hưởng của session — file nào đụng tới, file nào không
 */
export interface Scope {
	included_files: string[];
	excluded_files: string[];
	excluded_reason?: string;
}

/**
 * Memory data structure (v3)
 */
export interface MemoryData {
	version: 3;
	filename: string;
	topic: string;
	tags: string[];
	timestamp: string; // ISO string — original creation time
	contentHash: string; // SHA-256 of original content
	createdFrom?: string; // Machine name or user info
	updatedAt: string; // ISO string — last modification time
	sections: Section[]; // parsed markdown sections
	decisions: Decision[]; // structured Q&A decisions
	scope?: Scope; // files affected in this session
	history: HistoryEntry[]; // previous versions (newest-first, max 10)
}

/**
 * Options for saving memory
 */
export interface SaveMemoryOptions {
	filename: string;
	topic: string;
	content: string; // raw markdown
	timestamp?: string;
	createdFrom?: string;
	contentHash?: string; // pre-computed SHA-256 hash (set by saveMemory orchestrator)
	tags?: string[]; // tags do agent tự sinh (nếu không cung cấp sẽ extract từ #hashtag trong content)
	decisions?: Decision[]; // structured Q&A decisions
	scope?: Scope; // files affected in this session
}

/**
 * Result of save operation
 */
export interface SaveResult {
	localPath: string;
}

/**
 * Options for pulling AGENT.md
 */
export interface PullAgentFileOptions {
	targetDir?: string;
	overwrite?: boolean;
}

/**
 * Result of pull AGENT.md operation
 */
export interface PullAgentFileResult {
	success: boolean;
	targetPath: string;
	action: "created" | "updated" | "skipped";
	message: string;
	errors?: string[];
}

/**
 * A single entry in the local memory index (_index.json)
 */
export interface IndexEntry {
	filename: string;
	topic: string;
	tags: string[];
	timestamp: string; // ISO string — original creation time
	contentHash: string;
	sectionCount: number;
}

/**
 * Structure of _index.json
 */
export interface MemoryIndex {
	version: 1;
	updatedAt: string;
	entries: IndexEntry[];
}

/**
 * Options for search_memorize tool
 */
export interface SearchMemorizeOptions {
	query?: string; // matches topic, filename, or tags
	tags?: string[]; // filter by tags
	limit?: number; // default 10
}

/**
 * Result of search_memorize operation
 */
export interface SearchMemorizeResult {
	success: boolean;
	results: IndexEntry[];
	total: number;
	message: string;
}
