import { getMemoryDir } from "../dirs.js";
import { saveLocalMemory, searchMemories } from "./local.js";
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
export { computeContentHash, extractTags, parseMarkdownToSections } from "./markdown.js";
export type {
	MemoryData,
	SaveMemoryOptions,
	SaveResult,
	Scope,
	Section,
	HistoryEntry,
	Decision,
	IndexEntry,
	MemoryIndex,
	SearchMemorizeOptions,
	SearchMemorizeResult,
	PullAgentFileOptions,
	PullAgentFileResult,
} from "./types.js";

export async function saveMemory(
	options: SaveMemoryOptions
): Promise<SaveResult> {
	const memoryDir = getMemoryDir();
	const contentHash = options.contentHash || computeContentHash(options.content);

	const enrichedOptions: SaveMemoryOptions = {
		...options,
		timestamp: options.timestamp || new Date().toISOString(),
		contentHash,
	};

	const localPath = saveLocalMemory(enrichedOptions, memoryDir);
	return { localPath };
}
