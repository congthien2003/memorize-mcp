# Structured Decisions & Section IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured Q&A decisions and section IDs to memorize-mcp's save flow

**Architecture:** Extend existing v2 schema to v3 with `Decision` entries embedded in memory files. Decisions merge by `question` key (dedup). Section IDs generated from heading text via slugify. Lazy migration v2→v3 on read.

**Tech Stack:** TypeScript, Bun, MCP SDK

**Spec:** `docs/superpowers/specs/2026-07-09-structured-decisions-design.md`

---

### Task 1: Update types — Section.id + Decision + MemoryData v3 + SaveMemoryOptions.decisions

**Files:**
- Modify: `src/storage/types.ts:8-14` (Section)
- Modify: `src/storage/types.ts:28-40` (MemoryData)

- [ ] **Step 1: Add `id` to Section and create Decision type**

Edit `src/storage/types.ts`:

```ts
export interface Section {
  id: string;
  heading: string;
  level: number;
  body: string;
  type: "text" | "code" | "list";
  language?: string;
}
```

After the `HistoryEntry` interface, add:

```ts
export interface Decision {
  question: string;
  answer: string;
  note?: string;
  sectionId?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Bump MemoryData to version 3 and add decisions array**

Edit `src/storage/types.ts` — change MemoryData:

```ts
export interface MemoryData {
  version: 3;
  filename: string;
  topic: string;
  tags: string[];
  timestamp: string;
  contentHash: string;
  createdFrom?: string;
  updatedAt: string;
  rawContent: string;
  sections: Section[];
  decisions: Decision[];
  history: HistoryEntry[];
}
```

- [ ] **Step 3: Add decisions to SaveMemoryOptions**

Edit `src/storage/types.ts`:

```ts
export interface SaveMemoryOptions {
  filename: string;
  topic: string;
  content: string;
  projectSlug?: string;
  timestamp?: string;
  createdFrom?: string;
  contentHash?: string;
  decisions?: Decision[];
}
```

- [ ] **Step 4: Export Decision type from storage index**

Edit `src/storage/index.ts` — add `Decision` to the export list:

```ts
export type {
  MemoryData,
  SaveMemoryOptions,
  SaveResult,
  Project,
  MemoryRecord,
  SyncOptions,
  SyncDecision,
  SyncStats,
  SyncResult,
  PullAgentFileOptions,
  PullAgentFileResult,
  Section,
  Decision,
  HistoryEntry,
  IndexEntry,
  MemoryIndex,
  SearchMemorizeOptions,
  SearchMemorizeResult,
} from "./types.js";
```

---

### Task 2: Generate section IDs in markdown parser

**Files:**
- Modify: `src/storage/markdown.ts:75-128`

- [ ] **Step 1: Add slugify helper and update parseMarkdownToSections**

Edit `src/storage/markdown.ts` — add this function before `parseMarkdownToSections`:

```ts
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

Inside `parseMarkdownToSections`, add a `usedIds` set for dedup, and generate `id` when creating sections:

```ts
const usedIds = new Set<string>();

function generateId(heading: string): string {
  let id = heading ? slugify(heading) : "preamble";
  if (!id) id = "section";
  let deduped = id;
  let counter = 2;
  while (usedIds.has(deduped)) {
    deduped = `${id}-${counter++}`;
  }
  usedIds.add(deduped);
  return deduped;
}
```

Update the `flush` function to include `id`:

```ts
function flush(): void {
  const body = pendingLines.join("\n").trim();
  if (pendingHeading !== null || body) {
    const type = determineSectionType(body);
    const section: Section = {
      id: generateId(pendingHeading ?? ""),
      heading: pendingHeading ?? "",
      level: pendingLevel,
      body,
      type,
    };
    if (type === "code") {
      const lang = extractCodeLanguage(body);
      if (lang) section.language = lang;
    }
    sections.push(section);
  }
  pendingHeading = null;
  pendingLevel = 0;
  pendingLines = [];
}
```

---

### Task 3: Merge decisions + lazy v2→v3 migration in local storage

**Files:**
- Modify: `src/storage/local.ts:256-324` (saveLocalMemory)
- Modify: `src/storage/local.ts:162-210` (readLocalMemory)

- [ ] **Step 1: Add Decision to local.ts imports and add decisions merge helper**

Add `Decision` to the import from `"./types.js"`:

```ts
import type {
  MemoryData,
  SaveMemoryOptions,
  HistoryEntry,
  IndexEntry,
  MemoryIndex,
  SearchMemorizeOptions,
  SearchMemorizeResult,
  Decision,
} from "./types.js";
```

Then add before `saveLocalMemory`:

```ts
function mergeDecisions(
  existing: Decision[],
  incoming: Decision[]
): Decision[] {
  const map = new Map<string, Decision>();
  for (const d of existing) {
    map.set(d.question.toLowerCase(), d);
  }
  const now = new Date().toISOString();
  for (const d of incoming) {
    const key = d.question.toLowerCase();
    if (map.has(key)) {
      const prev = map.get(key)!;
      map.set(key, {
        ...prev,
        answer: d.answer,
        note: d.note ?? prev.note,
        sectionId: d.sectionId ?? prev.sectionId,
        updatedAt: now,
      });
    } else {
      map.set(key, {
        question: d.question,
        answer: d.answer,
        note: d.note,
        sectionId: d.sectionId,
        createdAt: d.createdAt || now,
        updatedAt: now,
      });
    }
  }
  return Array.from(map.values());
}
```

- [ ] **Step 2: Refactor readLocalMemory to use migration helper**

In `readLocalMemory`, replace the v1 migration block with a unified `migrateToLatest` helper:

```ts
function migrateToLatest(raw: Record<string, unknown>): MemoryData {
  const filename = raw.filename as string;
  const topic = raw.topic as string;
  const rawContent = (raw.content as string) || "";

  // v1 → v2: no version field
  const memo: MemoryData = {
    version: 3,
    filename,
    topic,
    tags: (raw.tags as string[]) || extractTags(rawContent),
    timestamp: (raw.timestamp as string) || new Date().toISOString(),
    contentHash: (raw.contentHash as string) || computeContentHash(rawContent),
    createdFrom: raw.createdFrom as string | undefined,
    updatedAt: (raw.updatedAt as string) || (raw.timestamp as string) || new Date().toISOString(),
    rawContent,
    sections: [],
    decisions: (raw.decisions as Decision[]) || [],
    history: (raw.history as HistoryEntry[]) || [],
  };

  // Parse sections if missing or if migrating from v1 (sections don't have id yet)
  if (raw.sections) {
    const rawSections = raw.sections as any[];
    const version = (raw.version as number) || 1;
    if (version < 3) {
      // v1 or v2 sections lack id — regenerate with id
      memo.sections = parseMarkdownToSections(rawContent);
    } else {
      memo.sections = rawSections as Section[];
    }
  } else {
    memo.sections = parseMarkdownToSections(rawContent);
  }

  return memo;
}
```

Then update `readLocalMemory` to use it:

```ts
export function readLocalMemory(
  filename: string,
  memoryDir: string
): MemoryData | null {
  try {
    const filePath = path.join(memoryDir, filename);
    if (!fs.existsSync(filePath)) return null;

    const raw = JSON.parse(
      fs.readFileSync(filePath, "utf8")
    ) as Record<string, unknown>;

    if (!raw.filename || !raw.topic) {
      console.warn(
        `[${new Date().toISOString()}] Invalid memory file (missing required fields): ${filePath}`
      );
      return null;
    }

    const version = (raw.version as number) || 1;
    if (version < 3) {
      console.log(
        `[${new Date().toISOString()}] 🔄 Migrating v${version} → v3: ${filename}`
      );
      const migrated = migrateToLatest(raw);
      fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2), "utf8");
      updateIndex(memoryDir, {
        filename: migrated.filename,
        topic: migrated.topic,
        tags: migrated.tags,
        timestamp: migrated.timestamp,
        contentHash: migrated.contentHash,
        sectionCount: migrated.sections.length,
      });
      return migrated;
    }

    return raw as unknown as MemoryData;
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error reading local memory ${filename}:`,
      error
    );
    return null;
  }
}
```

Remove the old `migrateV1ToV2` function (lines 122-139) since `migrateToLatest` replaces it.

- [ ] **Step 3: Update saveLocalMemory to merge decisions**

In `saveLocalMemory`, after reading existing file and before building `dataToSave`, add decision merge logic:

```ts
// Merge decisions (dedup by question)
let decisions: Decision[] = options.decisions || [];
if (existing && decisions.length > 0) {
  decisions = mergeDecisions(existing.decisions, decisions);
} else if (existing) {
  decisions = existing.decisions;
}
```

Then in `dataToSave`, add `decisions`:

```ts
const dataToSave: MemoryData = {
  version: 3,
  filename,
  topic,
  tags: extractTags(content),
  timestamp: originalTimestamp,
  contentHash: newHash,
  createdFrom,
  updatedAt: now,
  rawContent: content,
  sections: parseMarkdownToSections(content),
  decisions,
  history,
};
```

---

### Task 4: Add decisions param to MCP tool

**Files:**
- Modify: `index.ts:22-47` (save_memorize input schema)
- Modify: `index.ts:135-183` (save_memorize handler)

- [ ] **Step 1: Update input schema**

In `index.ts`, add `decisions` to `save_memorize` input schema properties:

```ts
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
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "Câu hỏi / vấn đề được đặt ra" },
            answer: { type: "string", description: "Câu trả lời / quyết định của user" },
            note: { type: "string", description: "(Optional) Ghi chú thêm" },
            sectionId: { type: "string", description: "(Optional) ID của section liên quan" },
          },
          required: ["question", "answer"],
        },
        description: "(Optional) Danh sách các quyết định/question-answer pairs",
      },
    },
    required: ["filename", "topic", "content"],
  },
},
```

- [ ] **Step 2: Pass decisions to saveMemory**

In the handler, extract `decisions` from arguments and pass to `saveMemory`:

```ts
if (request.params.name === "save_memorize") {
  const { filename, topic, content, projectSlug, decisions } = request.params
    .arguments as any;

  console.log(`[${new Date().toISOString()}] Processing save_memorize:`, {
    filename,
    topic,
    projectSlug: projectSlug || "(from env)",
    contentLength: content?.length || 0,
    decisionsCount: decisions?.length || 0,
  });

  try {
    const result = await saveMemory({
      filename,
      topic,
      content,
      projectSlug,
      decisions,
    });
```
