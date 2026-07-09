# Structured Decisions & Section IDs for memorize-mcp

**Date:** 2026-07-09
**Version:** 1.0
**Status:** Approved

## Summary

Mở rộng `save_memorize` để lưu structured Q&A decisions gắn với sections, cải thiện khả năng tra cứu context của các phiên làm việc.

## 1. Schema Changes

### Section (mở rộng)
```ts
interface Section {
  id: string;           // NEW: slug từ heading (e.g. "database-design")
  heading: string;
  level: number;
  body: string;
  type: "text" | "code" | "list";
  language?: string;
}
```

### Decision (mới)
```ts
interface Decision {
  question: string;
  answer: string;
  note?: string;
  sectionId?: string;   // link tới section.id
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
}
```

### MemoryData v3
```ts
interface MemoryData {
  version: 3;           // bumped from 2
  filename: string;
  topic: string;
  tags: string[];
  timestamp: string;
  contentHash: string;
  createdFrom?: string;
  updatedAt: string;
  rawContent: string;
  sections: Section[];  // Section có id
  decisions: Decision[]; // NEW
  history: HistoryEntry[];
}
```

## 2. Tool Changes

### save_memorize — thêm param `decisions`
```ts
{
  name: "save_memorize",
  inputSchema: {
    properties: {
      filename: { type: "string" },
      topic: { type: "string" },
      content: { type: "string" },
      projectSlug: { type: "string" },
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
            note: { type: "string" },
            sectionId: { type: "string" }
          },
          required: ["question", "answer"]
        }
      }
    },
    required: ["filename", "topic", "content"]
  }
}
```

## 3. Merge Logic

- Khi lưu memory, đọc decisions cũ từ file (nếu tồn tại).
- Với mỗi decision mới: so sánh `question` (case-insensitive).
  - Trùng → update `answer`, `note`, `updatedAt`.
  - Không trùng → append với `createdAt`/`updatedAt` là thời điểm hiện tại.
- Decisions không bị ảnh hưởng giữ nguyên.
- Implement trong `saveLocalMemory`.

## 4. Section ID Generation

Section ID được sinh từ heading text:
- `# Database Design` → `"database-design"`
- `## API Endpoints` → `"api-endpoints"`
- Content trước heading đầu tiên → `"preamble"`
- Slug trùng → append số: `"api-endpoints-2"`
- Slugify rules: lowercase, replace spaces với `-`, remove non-`[\w-]`

## 5. Search

Giữ nguyên như hiện tại. Search chỉ hoạt động trên `_index.json` (topic, filename, tags). Decisions được xem khi đọc file memory.

## 6. Migrations

### v2 → v3 (lazy, trong `readLocalMemory`)
- Bump `version`: `2` → `3`
- Thêm `decisions: []`
- Với mỗi `section` trong `sections[]`: generate `id` nếu chưa có.

### v1 → v2 (giữ nguyên)
- Không thay đổi so với hiện tại.

## 7. Files cần sửa

| File | Thay đổi |
|------|----------|
| `src/storage/types.ts` | Thêm `Section.id`, `Decision`, `MemoryData.version=3`, `SaveMemoryOptions.decisions` |
| `src/storage/markdown.ts` | Generate `id` trong `parseMarkdownToSections` |
| `src/storage/local.ts` | Merge decisions trong `saveLocalMemory`, lazy migrate v2→v3 trong `readLocalMemory` |
| `index.ts` | Thêm `decisions` input schema cho `save_memorize`, pass vào tool handler |
| `src/storage/index.ts` | Export `decisions` trong `SaveMemoryOptions` nếu cần |

## 8. Không thay đổi

- `src/storage/supabase.ts` — cloud schema không đổi (vẫn save content dạng markdown string)
- `src/storage/sync.ts` — sync logic giữ nguyên
- `src/storage/agent.ts` — không liên quan
- `src/config.ts` — không cần config mới
- Response format — giữ nguyên để không break client
