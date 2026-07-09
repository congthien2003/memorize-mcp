# memorize-mcp (Memory MCP Server)

## Tóm tắt nhanh

- MCP server đơn giản dùng để lưu trữ bản tóm tắt nội dung công việc ra file JSON trên máy local.
- Cung cấp 3 tools:
  - `save_memorize`: Lưu memory mới
  - `pull_agent_file`: Pull file `AGENT.md` về project
  - `search_memorize`: Tìm kiếm memories
- Thư mục lưu trữ mặc định: `./memorize/` (tính từ thư mục gọi MCP).

**Phiên bản hiện tại**: `1.4.0`

---

## Giới thiệu

memorize-mcp là một [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server nhỏ gọn, dùng để giúp AI/LLM lưu lại "memory" dưới dạng file JSON.

Mục tiêu:

- Lưu lại bản tóm tắt hoặc ghi chú của từng phiên làm việc.
- Lưu trữ ở dạng file JSON dễ đọc, dễ backup và dễ tái sử dụng.
- Dùng chuẩn MCP nên có thể cắm vào nhiều client hỗ trợ MCP (Claude Desktop, VS Code extension, v.v.).

Server này chạy qua stdin/stdout (stdio) nên phù hợp để được gọi bởi các MCP client.

## Yêu cầu môi trường

- [Bun](https://bun.sh) >= 1.2.x
- Node.js chỉ cần cho type definitions (dev), không bắt buộc để chạy.
- TypeScript được khai báo là `peerDependency` (dùng cho phát triển).

## Cài đặt & chạy local

### 1. Cài dependencies

```bash
bun install
```

### 2. Chạy server bằng Bun

```bash
bun run index.ts
```

Khi chạy trực tiếp, bạn sẽ thấy log dạng:

```text
==================================================
🚀 Memorize MCP Server v1.3.0 Started
📁 Memory Directory: Z:\path\to\project\memorize
⏰ Started at: 09/07/2026, 14:30:00
==================================================
```

## Tích hợp với MCP client (ví dụ Claude Desktop)

```jsonc
{
  "mcpServers": {
    "memorize-mcp": {
      "command": "bun",
      "args": ["run", "index.ts"],
    },
  },
}
```

## Available Tools

Server cung cấp 3 tools:

---

## Tool 1: `save_memorize`

### Mô tả

- **Chức năng**: Lưu bản tóm tắt nội dung công việc vào file local dưới dạng JSON.

### Input schema

```json
{
  "type": "object",
  "properties": {
    "filename": {
      "type": "string",
      "description": "Tên file (vd: summary_v1.json)"
    },
    "topic": {
      "type": "string",
      "description": "Chủ đề chính của phiên làm việc"
    },
    "content": { "type": "string", "description": "Nội dung tóm tắt chi tiết" },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "(Optional) Tags do agent tự sinh"
    },
    "decisions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "question": { "type": "string" },
          "answer": { "type": "string" },
          "note": { "type": "string" },
          "sectionId": { "type": "string" }
        },
        "required": ["question", "answer"]
      }
    },
    "scope": {
      "type": "object",
      "properties": {
        "included_files": { "type": "array", "items": { "type": "string" } },
        "excluded_files": { "type": "array", "items": { "type": "string" } },
        "excluded_reason": { "type": "string" }
      },
      "required": ["included_files", "excluded_files"]
    }
  },
  "required": ["filename", "topic", "content"]
}
```

### Quy trình hoạt động

1. MCP client gọi tool `save_memorize` với 3 tham số: `filename`, `topic`, `content`.
2. Server tạo đường dẫn file: `filePath = path.join(memoryDir, filename)`.
3. Ghi file JSON với nội dung dạng:

```json
{
  "topic": "Tên chủ đề",
  "timestamp": "2026-01-05T14:23:45.000Z",
  "content": "Nội dung tóm tắt chi tiết..."
}
```

4. Nếu thành công, server trả về:

```text
✅ Đã lưu tóm tắt vào: /path/to/memorize/summary_v1.json
```

Nếu có lỗi, server trả về nội dung text với mô tả lỗi và `isError: true`.

---

## Tool 2: `pull_agent_file`

### Mô tả

- **Chức năng**: Pull file `AGENT.md` từ source local của memorize-mcp về thư mục project của user.

### Input schema

```json
{
  "type": "object",
  "properties": {
    "targetDir": {
      "type": "string",
      "description": "(Optional) Thư mục project đích. Mặc định: thư mục đang gọi MCP."
    },
    "overwrite": {
      "type": "boolean",
      "description": "(Optional) Ghi đè AGENT.md nếu đã tồn tại. Mặc định: false"
    }
  },
  "required": []
}
```

### Quy trình hoạt động

1. Client gọi tool `pull_agent_file`.
2. Server xác định target directory (mặc định là thư mục đang chạy).
3. Server đọc file `AGENT.md` từ source local.
4. Nếu file đích đã tồn tại:
   - `overwrite=true` → **Update** (ghi đè)
   - ngược lại → **Skip**
5. Nếu file đích chưa tồn tại → **Create**
6. Trả về kết quả:

```text
✅ AGENT.md created.
📁 Target: /path/to/project/AGENT.md
```

---

## Tool 3: `search_memorize`

### Mô tả

- **Chức năng**: Tìm kiếm memories theo từ khóa, tags, hoặc topic sử dụng `index.json`.

### Input schema

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "(Optional) Từ khóa tìm kiếm" },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "(Optional) Lọc theo tags"
    },
    "limit": {
      "type": "number",
      "description": "(Optional) Số lượng tối đa. Mặc định: 10"
    }
  },
  "required": []
}
```

---

## Logging

Server in log ra console mỗi khi:

- Nhận request gọi tool (`save_memorize`, `pull_agent_file`, `search_memorize`).
- Bắt đầu xử lý tool với thông tin parameters.

Log này hữu ích để debug khi tích hợp với client MCP.

## Tóm tắt

- Đây là một MCP server nhỏ, chạy bằng Bun, dùng stdio.
- Server cung cấp 3 tools: `save_memorize`, `pull_agent_file`, `search_memorize`.
- Thư mục lưu mặc định: `./memorize/`.
- Phù hợp để dùng như "bộ nhớ ngoài" cho các phiên làm việc với AI/LLM.
