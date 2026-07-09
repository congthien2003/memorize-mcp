/**
 * Storage layer main exports
 */
import { getConfig, isSupabaseConfigured } from "../config.js";
import { saveLocalMemory, updateIndex, rebuildIndex, searchMemories } from "./local.js";
import { saveSupabaseMemory } from "./supabase.js";
import { computeContentHash } from "./markdown.js";
import type { SaveMemoryOptions, SaveResult } from "./types.js";

export {
	saveLocalMemory,
	ensureDirectoryExists,
	readLocalMemory,
	listLocalMemories,
	localMemoryExists,
	updateIndex,
	rebuildIndex,
	searchMemories,
} from "./local.js";
export {
	isSupabaseConfigured as isSupabaseConfiguredDirect,
	ensureProject,
	saveSupabaseMemory,
	getProjectBySlug,
	getProjectMemories,
	getMemoryByFilename,
} from "./supabase.js";
export { syncFromCloud, decideSyncAction } from "./sync.js";
export { pullAgentFile } from "./agent.js";
export { computeContentHash, extractTags, parseMarkdownToSections } from "./markdown.js";
export type {
	MemoryData,
	SaveMemoryOptions,
	SaveResult,
	Project,
	MemoryRecord,
	Scope,
	SyncOptions,
	SyncDecision,
	SyncStats,
	SyncResult,
	PullAgentFileOptions,
	PullAgentFileResult,
	Section,
	HistoryEntry,
	Decision,
	IndexEntry,
	MemoryIndex,
	SearchMemorizeOptions,
	SearchMemorizeResult,
} from "./types.js";

/**
 * Main orchestrator function to save memory
 * Handles both local and cloud storage with graceful degradation
 *
 * @param options - Memory data to save
 * @returns Result with local path and cloud sync status
 */
export async function saveMemory(
	options: SaveMemoryOptions
): Promise<SaveResult> {
	const config = getConfig();
	const timestamp = options.timestamp || new Date().toISOString();
	// Compute hash once so both local and cloud layers can reuse it
	const contentHash = options.contentHash || computeContentHash(options.content);

	const enrichedOptions: SaveMemoryOptions = {
		...options,
		timestamp,
		createdFrom: options.createdFrom || config.createdFrom,
		contentHash,
	};

	console.log(
		`[${new Date().toISOString()}] saveMemory: Starting save operation for ${
			options.filename
		}`
	);

	// Step 1: Always save to local storage first
	let localPath: string;
	try {
		localPath = saveLocalMemory(enrichedOptions, config.memoryDir);
		console.log(
			`[${new Date().toISOString()}] ✅ Local save successful: ${localPath}`
		);
	} catch (error: any) {
		console.error(`[${new Date().toISOString()}] ❌ Local save failed:`, error);
		throw new Error(`Failed to save local memory: ${error.message}`);
	}

	// Step 2: Try to sync to Supabase if configured
	let cloudSynced = false;
	let cloudError: string | undefined;

	if (isSupabaseConfigured(config)) {
		console.log(
			`[${new Date().toISOString()}] Supabase configured, attempting cloud sync...`
		);
		try {
			cloudSynced = await saveSupabaseMemory(enrichedOptions, config);
			if (!cloudSynced) {
				cloudError = "Supabase sync returned false (check logs for details)";
				console.warn(
					`[${new Date().toISOString()}] ⚠️ Cloud sync failed but local save succeeded`
				);
			}
		} catch (error: any) {
			cloudError = error.message || String(error);
			console.error(
				`[${new Date().toISOString()}] ⚠️ Cloud sync exception:`,
				error
			);
			// Do NOT throw - local save was successful
		}
	} else {
		console.log(
			`[${new Date().toISOString()}] Supabase not configured, skipping cloud sync`
		);
	}

	return {
		localPath,
		cloudSynced,
		cloudError,
	};
}
