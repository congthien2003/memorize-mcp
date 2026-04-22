/**
 * Agent module: Handle pulling AGENT.md from source to target project
 */
import type { Config } from "../config.js";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import type { PullAgentFileOptions, PullAgentFileResult } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_FILENAME = "AGENT.md";

function getLocalAgentFilePath(): string {
	return path.resolve(__dirname, "../../AGENT.md");
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readLocalAgentFile(): Promise<string> {
	const filePath = getLocalAgentFilePath();
	try {
		return await fs.readFile(filePath, "utf-8");
	} catch (error: any) {
		throw new Error(`Failed to read ${AGENT_FILENAME}: ${error.message}`);
	}
}

export async function pullAgentFile(
	options: PullAgentFileOptions,
	config: Config
): Promise<PullAgentFileResult> {
	const targetDir = options.targetDir || config.agent.targetProjectDir || "";

	if (!targetDir) {
		return {
			success: false,
			targetPath: "",
			action: "skipped",
			message:
				"Target directory not configured. Set MEMORIZE_MCP_TARGET_PROJECT_DIR or provide targetDir parameter.",
			errors: ["Target directory not configured"],
		};
	}

	const targetExists = await fileExists(targetDir);
	if (!targetExists) {
		return {
			success: false,
			targetPath: path.join(targetDir, AGENT_FILENAME),
			action: "skipped",
			message: `Target directory does not exist: ${targetDir}`,
			errors: [`Target directory not found: ${targetDir}`],
		};
	}

	const targetPath = path.join(targetDir, AGENT_FILENAME);
	const targetFileExists = await fileExists(targetPath);

	if (targetFileExists && !options.overwrite) {
		return {
			success: true,
			targetPath,
			action: "skipped",
			message: `⏭️ ${AGENT_FILENAME} already exists. Use overwrite=true to update.\n📁 Target: ${targetPath}`,
		};
	}

	try {
		const content = await readLocalAgentFile();
		await fs.writeFile(targetPath, content, "utf-8");

		const action = targetFileExists ? "updated" : "created";
		const icon = action === "updated" ? "🔄" : "📥";
		const actionText = action === "updated" ? "updated" : "created";

		return {
			success: true,
			targetPath,
			action,
			message: `✅ Pull AGENT.md completed!\n${icon} ${AGENT_FILENAME} ${actionText}.\n📁 Target: ${targetPath}`,
		};
	} catch (error: any) {
		return {
			success: false,
			targetPath,
			action: "skipped",
			message: `Error pulling ${AGENT_FILENAME}: ${error.message}`,
			errors: [error.message],
		};
	}
}
