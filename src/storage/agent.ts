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
	return await fs.readFile(filePath, "utf-8");
}

export async function pullAgentFile(
	options: PullAgentFileOptions
): Promise<PullAgentFileResult> {
	const targetDir = options.targetDir || process.cwd();

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

	const content = await readLocalAgentFile();
	await fs.writeFile(targetPath, content, "utf-8");
	const action = targetFileExists ? "updated" : "created";

	return {
		success: true,
		targetPath,
		action,
		message: `✅ ${AGENT_FILENAME} ${action}.\n📁 Target: ${targetPath}`,
	};
}
