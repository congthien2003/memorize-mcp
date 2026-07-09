import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { saveMemory, searchMemories } from "./src/storage/index.js";
import { pullAgentFile } from "./src/storage/agent.js";
import { getMemoryDir, getProjectRoot } from "./src/dirs.js";

const server = new Server(
  { name: "memorize-mcp-server", version: "1.4.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "save_memorize",
        description:
          "Lưu bản tóm tắt nội dung công việc vào file local dưới dạng JSON",
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
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                "(Optional) Tags do agent tự sinh để dễ filter. Nếu không cung cấp sẽ tự động extract từ #hashtag trong content.",
            },
            decisions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: {
                    type: "string",
                    description: "Câu hỏi / vấn đề được đặt ra",
                  },
                  answer: {
                    type: "string",
                    description: "Câu trả lời / quyết định của user",
                  },
                  note: {
                    type: "string",
                    description: "(Optional) Ghi chú thêm",
                  },
                  sectionId: {
                    type: "string",
                    description: "(Optional) ID của section liên quan",
                  },
                },
                required: ["question", "answer"],
              },
              description:
                "(Optional) Danh sách các quyết định/question-answer pairs",
            },
            scope: {
              type: "object",
              properties: {
                included_files: {
                  type: "array",
                  items: { type: "string" },
                  description: "Danh sách file đã sửa/tạo trong session này",
                },
                excluded_files: {
                  type: "array",
                  items: { type: "string" },
                  description: "Danh sách file cố tình không động tới",
                },
                excluded_reason: {
                  type: "string",
                  description: "(Optional) Lý do không động tới excluded_files",
                },
              },
              required: ["included_files", "excluded_files"],
              description:
                "(Optional) Phạm vi ảnh hưởng của session — file nào đụng tới, file nào không",
            },
          },
          required: ["filename", "topic", "content"],
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
                "(Optional) Thư mục project đích. Mặc định: thư mục đang gọi MCP.",
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
      {
        name: "search_memorize",
        description:
          "Tìm kiếm memories theo từ khóa, tags, hoặc topic. Sử dụng index.json để tìm kiếm nhanh mà không cần đọc từng file.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "(Optional) Từ khóa tìm kiếm — khớp với topic, filename, hoặc tags",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                "(Optional) Lọc theo danh sách tags (tìm memory có ít nhất một tag trùng khớp)",
            },
            limit: {
              type: "number",
              description: "(Optional) Số lượng kết quả tối đa. Mặc định: 10",
            },
          },
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.log(
    `[${new Date().toISOString()}] Received tool request: ${
      request.params.name
    }`,
  );

  if (request.params.name === "save_memorize") {
    const { filename, topic, content, tags, decisions, scope } = request.params
      .arguments as any;

    console.log(`[${new Date().toISOString()}] Processing save_memorize:`, {
      filename,
      topic,
      contentLength: content?.length || 0,
      decisionsCount: decisions?.length || 0,
      hasScope: !!scope,
    });

    try {
      const result = await saveMemory({
        filename,
        topic,
        content,
        tags,
        decisions,
        scope,
      });

      return {
        content: [
          { type: "text", text: `✅ Đã lưu tóm tắt vào: ${result.localPath}` },
        ],
      };
    } catch (error: any) {
      console.error(
        `[${new Date().toISOString()}] ❌ Error in save_memorize:`,
        error,
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
      targetDir: targetDir || "(default: CWD)",
      overwrite: overwrite || false,
    });

    try {
      const result = await pullAgentFile({
        targetDir,
        overwrite,
      });

      return {
        content: [{ type: "text", text: result.message }],
        isError: !result.success,
      };
    } catch (error: any) {
      console.error(
        `[${new Date().toISOString()}] ❌ Error in pull_agent_file:`,
        error,
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

  if (request.params.name === "search_memorize") {
    const { query, tags, limit } = request.params.arguments as any;
    const memoryDir = getMemoryDir();

    console.log(`[${new Date().toISOString()}] Processing search_memorize:`, {
      query: query || "(none)",
      tags: tags || [],
      limit: limit || 10,
    });

    try {
      const result = searchMemories({ query, tags, limit }, memoryDir);

      let message = result.message;
      if (result.results.length > 0) {
        message += "\n\n📋 Results:";
        for (const entry of result.results) {
          message += `\n\n  📄 **${entry.filename}**`;
          message += `\n     Topic: ${entry.topic}`;
          if (entry.tags.length > 0) {
            message += `\n     Tags: ${entry.tags.map((t) => `#${t}`).join(", ")}`;
          }
          message += `\n     Sections: ${entry.sectionCount}`;
          message += `\n     Updated: ${entry.timestamp}`;
        }
        if (result.total > result.results.length) {
          message += `\n\n  … and ${result.total - result.results.length} more. Use limit parameter to see more.`;
        }
      }

      return {
        content: [{ type: "text", text: message }],
      };
    } catch (error: any) {
      console.error(
        `[${new Date().toISOString()}] ❌ Error in search_memorize:`,
        error,
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

  console.warn(
    `[${new Date().toISOString()}] ⚠️ Unknown tool requested: ${
      request.params.name
    }`,
  );
  throw new Error("Tool not found");
});

import { ensureDirectoryExists } from "./src/storage/local.js";

const transport = new StdioServerTransport();
await server.connect(transport);

const memoryDir = getMemoryDir();
ensureDirectoryExists(memoryDir);

console.log("=".repeat(50));
console.log("🚀 Memorize MCP Server v1.3.0 Started");
console.log(`📂 Project Root: ${getProjectRoot()}`);
console.log(`📁 Memory Dir:   ${memoryDir}`);
console.log(`⏰ Started at: ${new Date().toLocaleString("vi-VN")}`);
console.log("=".repeat(50));
