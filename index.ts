import fs from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getMemoryDir, getProjectRoot } from "./src/dirs.js";
import {
	searchSessionMemory,
	saveSessionMemory,
	startSession,
} from "./src/storage/index.js";
import type { SaveMode } from "./src/storage/index.js";

const server = new Server(
	{ name: "memorize-mcp-server", version: "2.0.0" },
	{ capabilities: { tools: {} } },
);

function getArguments(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function getOptionalString(
	arguments_: Record<string, unknown>,
	name: string,
): string | undefined {
	const value = arguments_[name];
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`${name} must be a string.`);
	return value;
}

function getRequiredString(arguments_: Record<string, unknown>, name: string): string {
	const value = getOptionalString(arguments_, name);
	if (!value?.trim()) throw new Error(`${name} must be a non-empty string.`);
	return value;
}

function text(message: string, isError = false) {
	return {
		content: [{ type: "text" as const, text: message }],
		...(isError ? { isError: true } : {}),
	};
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "start_session",
			description:
				"Bắt đầu phiên memory mới bằng cách thay thế .memorize/MEMORY.md hiện tại.",
			inputSchema: {
				type: "object",
				properties: {
					goal: {
						type: "string",
						description: "(Optional) Mục tiêu của phiên làm việc.",
					},
				},
			},
		},
		{
			name: "save_memorize",
			description:
				"Lưu update hoặc snapshot cô đọng vào memory của phiên hiện tại. Hãy gọi start_session trước.",
			inputSchema: {
				type: "object",
				properties: {
					content: {
						type: "string",
						description: "Nội dung Markdown không rỗng để lưu.",
					},
					mode: {
						type: "string",
						enum: ["append", "replace"],
						description:
							"append (mặc định) thêm update; replace giữ header và thay bằng snapshot mới.",
					},
				},
				required: ["content"],
			},
		},
		{
			name: "search_memorize",
			description:
				"Đọc toàn bộ memory hiện tại khi không truyền query, hoặc tìm các section Markdown có query.",
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "(Optional) Từ khóa tìm không phân biệt hoa thường.",
					},
					limit: {
						type: "number",
						description: "(Optional) Số section tối đa, mặc định 3.",
					},
				},
			},
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const arguments_ = getArguments(request.params.arguments);
	const memoryDir = getMemoryDir();

	try {
		switch (request.params.name) {
			case "start_session": {
				const filePath = startSession(memoryDir, getOptionalString(arguments_, "goal"));
				return text(`Started session memory: ${filePath}`);
			}
			case "save_memorize": {
				const filePath = saveSessionMemory(memoryDir, {
					content: getRequiredString(arguments_, "content"),
					mode: getOptionalString(arguments_, "mode") as SaveMode | undefined,
				});
				return text(`Saved session memory: ${filePath}`);
			}
			case "search_memorize": {
				const limit = arguments_.limit;
				if (limit !== undefined && typeof limit !== "number") {
					throw new Error("limit must be a number.");
				}
				const result = searchSessionMemory(memoryDir, {
					query: getOptionalString(arguments_, "query"),
					limit,
				});
				return text(result.content);
			}
			default:
				throw new Error("Tool not found");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[${new Date().toISOString()}] ${request.params.name} failed:`, error);
		return text(`Error: ${message}`, true);
	}
});

const memoryDir = getMemoryDir();
fs.mkdirSync(memoryDir, { recursive: true });

const transport = new StdioServerTransport();
await server.connect(transport);

console.log("=".repeat(50));
console.log("Memorize MCP Server v2.0.0 started");
console.log(`Project root: ${getProjectRoot()}`);
console.log(`Session memory: ${memoryDir}`);
console.log("=".repeat(50));
