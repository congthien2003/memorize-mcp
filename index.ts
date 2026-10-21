import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getMemoryDir, getProjectRoot } from "./src/dirs.js";
import { callMemoryTool, MEMORY_INSTRUCTIONS, MEMORY_TOOLS } from "./src/tools.js";

const server = new Server(
	{ name: "memorize-mcp-server", version: "2.0.1" },
	{ capabilities: { tools: {} }, instructions: MEMORY_INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MEMORY_TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async request => callMemoryTool(getMemoryDir(), request.params.name, request.params.arguments));

await server.connect(new StdioServerTransport());
console.error(`Memorize MCP Server started. Project root: ${getProjectRoot()}`);
