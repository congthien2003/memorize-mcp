import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { saveMemory, syncFromCloud, pullAgentFile } from "./src/storage/index.js";
import { getConfig } from "./src/config.js";

const config = getConfig();

const server = new Server(
	{ name: "memorize-mcp-server", version: "1.2.1" },
	{ capabilities: { tools: {} } }
);

// 1. Khai báo Tool
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "save_memorize",
				description:
					"Lưu bản tóm tắt nội dung công việc vào file local dưới dạng JSON (có thể sync lên Supabase Cloud)",
				inputSchema: {
					type: "object",
					properties: {
						filename: {
							type: "string",
							description: "Tên file (vd: summary_v1.json)",
						},
						topic: {
							type: "string",
							description: "Chủ đề chính của phiên làm việc",
						},
						content: {
							type: "string",
							description: "Nội dung tóm tắt chi tiết",
						},
						projectSlug: {
							type: "string",
							description:
								"(Optional) Slug của project để sync lên Supabase. Nếu không có sẽ dùng MEMORIZE_MCP_PROJECT_SLUG từ env.",
						},
					},
					required: ["filename", "topic", "content"],
				},
			},
			{
				name: "sync_memorize",
				description:
					"Đồng bộ memories từ Supabase Cloud về local storage. Kiểm tra timestamp và chỉ cập nhật file nào mới hơn trên cloud.",
				inputSchema: {
					type: "object",
					properties: {
						projectSlug: {
							type: "string",
							description:
								"(Optional) Slug của project để sync. Nếu không có sẽ dùng MEMORIZE_MCP_PROJECT_SLUG từ env.",
						},
						overwrite: {
							type: "boolean",
							description:
								"(Optional) Bắt buộc ghi đè tất cả file local, bỏ qua kiểm tra timestamp. Mặc định: false",
						},
						filename: {
							type: "string",
							description:
								"(Optional) Chỉ sync file cụ thể thay vì tất cả memories",
						},
					},
					required: [],
				},
			},
			{
				name: "pull_agent_file",
				description:
					"Pull file AGENT.md từ source local của memorize-mcp về thư mục project đích.",
				inputSchema: {
					type: "object",
					properties: {
						targetDir: {
							type: "string",
							description:
								"(Optional) Thư mục project đích. Nếu không có sẽ dùng MEMORIZE_MCP_TARGET_PROJECT_DIR từ env.",
						},
						overwrite: {
							type: "boolean",
							description:
								"(Optional) Ghi đè AGENT.md nếu đã tồn tại. Mặc định: false",
						},
					},
					required: [],
				},
			},
		],
	};
});

// 2. Xử lý lưu file
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	console.log(
		`[${new Date().toISOString()}] Received tool request: ${
			request.params.name
		}`
	);

	if (request.params.name === "save_memorize") {
		const { filename, topic, content, projectSlug } = request.params
			.arguments as any;

		console.log(`[${new Date().toISOString()}] Processing save_memorize:`, {
			filename,
			topic,
			projectSlug: projectSlug || "(from env)",
			contentLength: content?.length || 0,
		});

		try {
			const result = await saveMemory({
				filename,
				topic,
				content,
				projectSlug,
			});

			// Build response message
			let message = `✅ Đã lưu tóm tắt vào: ${result.localPath}`;

			if (result.cloudSynced) {
				message += `\n☁️ Cloud sync: Thành công`;
			} else if (result.cloudError) {
				message += `\n⚠️ Cloud sync: Thất bại (${result.cloudError})`;
			} else {
				message += `\n📍 Cloud sync: Không được cấu hình`;
			}

			return {
				content: [{ type: "text", text: message }],
			};
		} catch (error: any) {
			console.error(
				`[${new Date().toISOString()}] ❌ Error in save_memorize:`,
				error
			);
			return {
				content: [
					{
						type: "text",
						text: `❌ Lỗi: ${error.message || String(error)}`,
					},
				],
				isError: true,
			};
		}
	}

	if (request.params.name === "sync_memorize") {
		const { projectSlug, overwrite, filename } = request.params
			.arguments as any;

		console.log(`[${new Date().toISOString()}] Processing sync_memorize:`, {
			projectSlug: projectSlug || "(from env)",
			overwrite: overwrite || false,
			filename: filename || "(all files)",
		});

		try {
			const result = await syncFromCloud({
				projectSlug,
				overwrite,
				filename,
			});

			// Build response message
			let message = result.success ? "✅ " : "❌ ";
			message += result.message;

			if (result.stats) {
				message += `\n\n📊 Statistics:`;
				if (result.stats.created > 0)
					message += `\n  ➕ Created: ${result.stats.created}`;
				if (result.stats.updated > 0)
					message += `\n  🔄 Updated: ${result.stats.updated}`;
				if (result.stats.skipped > 0)
					message += `\n  ⏭️  Skipped: ${result.stats.skipped}`;
				if (result.stats.failed > 0)
					message += `\n  ❌ Failed: ${result.stats.failed}`;
			}

			return {
				content: [{ type: "text", text: message }],
				isError: !result.success,
			};
		} catch (error: any) {
			console.error(
				`[${new Date().toISOString()}] ❌ Error in sync_memorize:`,
				error
			);
			return {
				content: [
					{
						type: "text",
						text: `❌ Lỗi: ${error.message || String(error)}`,
					},
				],
				isError: true,
			};
		}
	}

	if (request.params.name === "pull_agent_file") {
		const { targetDir, overwrite } = request.params.arguments as any;

		console.log(`[${new Date().toISOString()}] Processing pull_agent_file:`, {
			targetDir: targetDir || "(from env)",
			overwrite: overwrite || false,
		});

		try {
			const result = await pullAgentFile(
				{
					targetDir,
					overwrite,
				},
				config
			);

			return {
				content: [{ type: "text", text: result.message }],
				isError: !result.success,
			};
		} catch (error: any) {
			console.error(
				`[${new Date().toISOString()}] ❌ Error in pull_agent_file:`,
				error
			);
			return {
				content: [
					{
						type: "text",
						text: `❌ Error: ${error.message || String(error)}`,
					},
				],
				isError: true,
			};
		}
	}

	console.warn(
		`[${new Date().toISOString()}] ⚠️ Unknown tool requested: ${
			request.params.name
		}`
	);
	throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.log("=".repeat(50));
console.log("🚀 Memorize MCP Server v1.2.1 Started");
console.log(`📁 Memory Directory: ${config.memoryDir}`);
console.log(
	`☁️  Supabase: ${
		config.supabase.url ? "Configured ✓" : "Not configured (local-only)"
	}`
);
console.log(
	`📋 AGENT.md target dir: ${
		config.agent.targetProjectDir ? "Configured ✓" : "Not configured"
	}`
);
console.log(`⏰ Started at: ${new Date().toLocaleString("vi-VN")}`);
console.log("=".repeat(50));
