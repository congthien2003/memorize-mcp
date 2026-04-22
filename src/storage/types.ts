/**
 * Shared types for storage layer
 */

/**
 * Memory data structure
 */
export interface MemoryData {
	filename: string;
	topic: string;
	content: string;
	timestamp: string; // ISO string
	createdAt: string; // Localized string
	createdFrom?: string; // Machine name or user info
}

/**
 * Options for saving memory
 */
export interface SaveMemoryOptions {
	filename: string;
	topic: string;
	content: string;
	projectSlug?: string;
	timestamp?: string;
	createdFrom?: string;
}

/**
 * Result of save operation
 */
export interface SaveResult {
	localPath: string;
	cloudSynced: boolean;
	cloudError?: string;
}

/**
 * Project information from Supabase
 */
export interface Project {
	id: string;
	name: string;
	slug: string;
	created_at: string;
}

/**
 * Memory record in Supabase
 */
export interface MemoryRecord {
	id: string;
	project_id: string;
	filename: string;
	topic: string;
	content: string;
	timestamp: string;
	created_at: string;
	created_from?: string;
}

/**
 * Options for syncing memories from cloud to local
 */
export interface SyncOptions {
	projectSlug?: string;
	overwrite?: boolean; // Default: true
	filename?: string; // Optional: sync single file only
}

/**
 * Sync action decision
 */
export type SyncDecision = {
	action: "create" | "update" | "skip";
	reason: string;
};

/**
 * Stats for sync operation
 */
export interface SyncStats {
	created: number;
	updated: number;
	skipped: number;
	failed: number;
	total: number;
}

/**
 * Result of sync operation
 */
export interface SyncResult {
	success: boolean;
	stats: SyncStats;
	memoryDir: string;
	projectSlug: string;
	errors?: string[];
	message: string;
}

/**
 * v1.2.1: Agent file pull types
 */

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
