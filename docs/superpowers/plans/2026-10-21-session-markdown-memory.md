# Session Markdown Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task, according to the execution method selected by the user. Steps use checkbox (`- [ ]`) syntax for tracking. User restrictions override automatic test execution and commits.

**Goal:** Lưu diễn biến theo session bằng Markdown append và duy trì `MEMORY.md` tổng hợp có nguồn, với agent chủ động capture và consolidate.

**Architecture:** Markdown là dữ liệu gốc, không có database hoặc index bền vững. Storage tách format, filesystem/migration, session, summary và retrieval; MCP adapter chỉ validate contract, dispatch và hướng dẫn agent. Một workspace lock bảo vệ mutation, hash revision bảo vệ summary và cursor.

**Tech Stack:** TypeScript strict, Bun, Node `fs`/`path`/`crypto`, MCP SDK hiện có; không thêm dependency.

**Spec:** `docs/superpowers/specs/2026-10-21-session-markdown-memory-design.md` — đã được người dùng duyệt trong hội thoại ngày 2026-10-21.

**Status:** Người dùng đã duyệt và chọn Native. Task 1–8 đã triển khai, review độc lập và sửa finding. Sau khi người dùng cho phép verify: 29/29 test pass, typecheck pass và MCP stdio smoke test trong workspace tạm pass, gồm resume sau restart. Chưa kiểm chứng host tự gọi tool chủ động hoặc stress đa process. Không có commit.

**Verification authorization:** Người dùng đã cho phép chạy verify sau khi triển khai. Kết quả mới này thay thế trạng thái chưa chạy và giới hạn chỉ người dùng tự chạy trong bản plan ban đầu; các bước/command bên dưới được giữ làm bản ghi kế hoạch.

## Global Constraints

- `MEMORY.md` tổng hợp; `sessions/<session-id>.md` giữ lịch sử append. Không có index hoặc registry JSON cần đồng bộ.
- Marker: `<!-- memorize:memory version=1 -->` và `<!-- memorize:session version=1 -->`.
- Title/heading Markdown tự do, không dùng enum section cố định.
- Mỗi payload ghi tối đa 64 KiB UTF-8; không giới hạn 64 KiB trên tổng session/workspace.
- Read mặc định 16 KiB, cho phép budget từ 1 đến 64 KiB, không cắt ký tự UTF-8.
- Search mặc định 3 kết quả, tối đa 20; snippet tối đa 2 KiB/kết quả và tổng 16 KiB.
- Summary vượt khoảng 16 KiB trả khuyến nghị gộp gọn; không tự cắt nội dung hay xóa nguồn.
- Revision là SHA-256 của bytes trên đĩa; timestamp UTC ISO-8601.
- Chỉ `start_session` có thể khởi tạo/migration; read/search không tự tạo file.
- Không database, embeddings, cloud, hook tự cài, retention hoặc tự đọc transcript.
- Không chạy build/test/lint/typecheck hoặc lệnh verify. Command trong plan chỉ dành cho người dùng tự chạy. Không commit.
- Không sửa dữ liệu `.memorize` thực tế trong lúc implement; các test dùng temporary workspace nếu người dùng chạy.
- Giữ workspace resolution trong `src/dirs.ts`; không sửa host configuration hoặc `AGENT.md`.

## Review Focus

Năm tình huống cần pin bằng regression coverage trong các task tương ứng:

1. Markdown có code fence/comment giống metadata phải round-trip thành cùng payload, không tạo entry giả — Task 1.
2. Process giữ lock còn sống quá 30 giây hoặc cleanup sai owner không được mất lock — Task 2.
3. Migration dừng sau backup/legacy nhưng trước thay summary phải tiếp tục đúng, không trùng hoặc mất dữ liệu — Task 3.
4. Read Unicode ở mép byte budget hoặc file đổi giữa hai trang không được trả chữ lỗi hay ghép revision — Task 6.
5. Client cũ gửi `mode: replace`, `section`, hoặc thiếu session/entry ID phải nhận lỗi chuyển đổi, không ghi nhầm — Task 7.

## File map và thứ tự phụ thuộc

| File | Thao tác | Trách nhiệm |
|---|---|---|
| `src/storage/types.ts` | Create | Constants, DTO, mã lỗi dùng chung |
| `src/storage/format.ts` | Create | Render/parse Markdown envelope, entry framing, nguồn và revision |
| `src/storage/format.test.ts` | Create | Round-trip format và byte framing |
| `src/storage/files.ts` | Create | Path confinement, lock, atomic write, đọc snapshot |
| `src/storage/files.test.ts` | Create | Lock/ownership, filesystem failure và confinement |
| `src/storage/migration.ts` | Create | Khởi tạo/migration có backup và resume sau gián đoạn |
| `src/storage/migration.test.ts` | Create | Legacy, empty/custom format và migration retry |
| `src/storage/session.ts` | Modify | Tạo/resume session, append/deduplicate |
| `src/storage/session.test.ts` | Modify | Thay kỳ vọng destructive replace bằng session journal |
| `src/storage/summary.ts` | Create | Compare revision, validate nguồn và ghi summary |
| `src/storage/summary.test.ts` | Create | Conflict, source validation và compact warning |
| `src/storage/retrieval.ts` | Create | Paged reads và keyword search |
| `src/storage/retrieval.test.ts` | Create | Cursor, Unicode, ranking và budget |
| `src/storage/index.ts` | Modify | Export API mới, bỏ API fixed section cũ |
| `src/tools.ts` | Create | Schema, validation runtime, tool dispatch và instructions |
| `src/tools.test.ts` | Create | Contract năm tool và compatibility errors |
| `index.ts` | Modify | Khởi tạo server, đăng ký adapter, stdio và stderr |
| `README.md` | Modify | Workflow chủ động, contract mới, migration và command người dùng chạy |

Thứ tự: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Mỗi task sửa tối đa ba file; approval plan bao gồm các file đã liệt kê. Nếu cần đổi scope hoặc thêm file ngoài danh sách, trình điều chỉnh trước. Không thay package version, changelog, lockfile hoặc dependency trong plan này.

## Interfaces dùng chung

Task 1 định nghĩa các DTO dưới đây trong `types.ts`; các task sau import trực tiếp, không tạo bản sao kiểu.

```ts
type SourceRef = { sessionId: string; entryId: string };
type SessionMeta = { sessionId: string; startedAt: string; goal?: string;
  legacyHash?: string; importedAt?: string };
type Entry = { entryId: string; title: string; timestamp: string; content: string };
type StartOptions = { goal?: string; sessionId?: string };
type SessionResult = { sessionId: string; path: string; resumed: boolean;
  migration: MigrationResult };
type MigrationResult = { status: "none" | "initialized" | "migrated";
  backupPath?: string; legacySource?: SourceRef };
type SaveOptions = SourceRef & { title: string; content: string };
type SaveResult = SourceRef & { path: string; anchor: string;
  timestamp: string; deduplicated: boolean };
type UpdateOptions = { sessionId: string; expectedRevision: string;
  content: string; sources: SourceRef[] };
type UpdateResult = { path: string; revision: string; updatedAt: string;
  warnings: string[] };
type ReadOptions = { sessionId?: string; cursor?: string; maxBytes?: number };
type ReadPage = { status: "ok" | "missing"; path: string; revision?: string;
  sessionId?: string; content: string; truncated: boolean; nextCursor?: string };
type SearchOptions = { query?: string; scope?: "all" | "memory" | "sessions";
  sessionId?: string; limit?: number };
type SearchHit = { path: string; reference: string; snippet: string;
  snippetTruncated: boolean; sessionId?: string; entryId?: string;
  timestamp?: string; importedAt?: string };
type SearchResult = { kind: "search"; results: SearchHit[]; returned: number;
  truncated: boolean; truncationReasons: ("limit" | "budget")[] };
type SearchResponse = SearchResult | (ReadPage & { kind: "read" });
```

`MemoryError` extends `Error`, có `code`, `retryable`, `writeState: "not-written" | "unknown"`, và message hướng xử lý. Mã lỗi lấy đúng danh sách trong spec §7. DTO path/reference là relative path dùng slash để Markdown dùng được trên Windows; filesystem dùng `path` bên trong.

Mutation và retrieval API là async, trả `Promise<T>`. Format helpers là sync. Workspace lock chỉ được acquire một lần ở public mutation boundary; helper migration/ghi bên trong không acquire lồng nhau. Tool `start_session` ghép `SessionResult`, `readMemory(...)` và instructions thành kết quả cuối.

---

### Task 1: Định dạng Markdown và DTO

**Files:** Create `src/storage/types.ts`, `src/storage/format.ts`, `src/storage/format.test.ts`.

**Interfaces:**

- Produces DTO/constants ở trên; `MAX_WRITE_BYTES = 65536`, `DEFAULT_READ_BYTES = 16384`, `MAX_READ_BYTES = 65536`, `SUMMARY_WARN_BYTES = 16384`, `MAX_SNIPPET_BYTES = 2048`, `SEARCH_BUDGET_BYTES = 16384`.
- `revisionOf(bytes: Buffer): string`.
- `renderSummary(content: string): Buffer`; `parseSummary(bytes: Buffer): { content: string }`.
- `renderSession(meta: SessionMeta, entries: Entry[]): Buffer`; `parseSession(bytes: Buffer): { meta: SessionMeta; entries: Entry[] }`.
- `renderEntry(entry: Entry): Buffer`; `sourceReference(source: SourceRef): string`.
- `validateSessionId(value: string): void`; `validateEntryId(value: string): void`.

- [x] **Step 1 — Viết regression cho format.** Test `round-trips free Markdown and UTF-8 byte framing`: payload có tiếng Việt, emoji, CRLF, `##`, code fence và comment metadata giả; assert parsed content bằng input. Test bytes bị cắt hoặc metadata sai trả `UNSUPPORTED_FORMAT`; marker version lạ bị từ chối. **Success Criteria:** assertions phân biệt framing theo byte với split heading.
- [x] **Step 2 — Định nghĩa constants, DTO và errors.** UUID kiểm tra syntax; session còn chấp nhận đúng `legacy-` + 64 hex. Source reference là `sessions/<id>.md#entry-<entry-id>`. **Success Criteria:** các task sau dùng một bộ signature/type duy nhất.
- [x] **Step 3 — Implement parser/renderer.** Header session dùng một comment JSON metadata sau marker và một title hiển thị. Entry dùng anchor, heading title, comment JSON `{entryId,timestamp,contentBytes}`, newline, đúng `contentBytes` rồi newline separator. Escape `&`, `<`, `>`, hyphen trong JSON comment bằng JSON Unicode escapes để không có delimiter HTML sớm. Validate title một dòng; chỉ trim title, giữ nguyên content không rỗng sau kiểm tra whitespace. Parser lỗi khi metadata/byte count không khớp; không tự sửa. **Success Criteria:** format không phụ thuộc heading bên trong content và retry so cùng payload không bị chuẩn hóa khác nhau.
- [ ] **Step 4 — Bàn giao command cho người dùng.** `bun test src/storage/format.test.ts` — kỳ vọng pass khi người dùng chạy. **Success Criteria:** ghi rõ trạng thái chưa chạy; không đánh dấu test passing bằng source review.

### Task 2: Filesystem, lock và atomic writes

**Files:** Create `src/storage/files.ts`, `src/storage/files.test.ts`.

**Interfaces:**

- Consumes `MemoryError`, validation và `revisionOf` của Task 1.
- `resolveMemoryPath(memoryDir: string, target: "memory" | "session" | "backup", id?: string): Promise<string>`.
- `withWorkspaceLock<T>(memoryDir: string, action: () => Promise<T>): Promise<T>`.
- `readSnapshot(filePath: string): Promise<{ bytes: Buffer; revision: string } | null>`.
- `atomicWrite(filePath: string, bytes: Buffer): Promise<void>`.
- `createImmutable(filePath: string, bytes: Buffer): Promise<void>` — tạo mới hoặc xác nhận cùng bytes; khác nhau trả `MIGRATION_CONFLICT`.

- [x] **Step 1 — Viết regression lock và đường dẫn.** Assert lock PID còn sống với timestamp cũ vẫn trả `MEMORY_BUSY`; token khác không được release. PID chắc chắn không tồn tại được recover; `EPERM`/owner không xác định phải busy. Assert `../`, absolute ID và symlink/junction ra ngoài root bị từ chối; kiểm tra symlink chỉ skip khi OS không cấp quyền tạo và báo rõ lý do. **Success Criteria:** không coi tuổi lock là bằng chứng owner chết.
- [x] **Step 2 — Implement confinement.** Validate ID trước dựng path, dùng resolved root/realpath của ancestor tồn tại, kiểm tra từng thành phần và target symlink trước đọc/ghi. Read missing không mkdir; mutation mới tạo thư mục. **Success Criteria:** không đọc/ghi ra ngoài memory root qua đường dẫn caller cung cấp; không quảng bá bảo vệ trước filesystem bị một process thù địch thay đổi đồng thời.
- [x] **Step 3 — Implement lock và write.** Lock độc quyền `wx` chứa PID/token; kiểm tra PID trước reclaim, xác nhận token lại trước xóa, nhả lock chỉ khi còn đúng token. Không chờ vòng lặp dài. Temporary file cùng thư mục; cleanup lỗi sau rename trả writeState unknown, không báo chưa lưu. **Success Criteria:** rename thành công là điểm commit; lỗi trước đó giữ target cũ.
- [x] **Step 4 — Viết test failure và immutable artifact.** Inject lỗi rename bằng mock filesystem trong test, assert target cũ nguyên vẹn; immutable retry cùng bytes thành công, bytes khác conflict. **Success Criteria:** không overwrite backup đã có.
- [ ] **Step 5 — Bàn giao command.** `bun test src/storage/files.test.ts` — kỳ vọng pass, agent không chạy. **Success Criteria:** có coverage lock sống/chết, ownership, write failure và confinement.

### Task 3: Bootstrap và migration có thể tiếp tục

**Files:** Create `src/storage/migration.ts`, `src/storage/migration.test.ts`.

**Interfaces:**

- Consumes Task 1 format và Task 2 filesystem helpers.
- `ensureWorkspaceUnderLock(memoryDir: string): Promise<MigrationResult>`; caller đã giữ workspace lock.
- ID legacy là `legacy-<sha256 full bytes gốc>`. Entry UUID suy ra từ 16 byte đầu SHA-256, đặt bits version 8 và RFC variant; tạo lại luôn cùng ID.

- [x] **Step 1 — Viết fixtures legacy.** Test hai title cũ, file thiếu, zero-byte, whitespace-only và custom non-empty. Assert bytes backup bằng bytes gốc; non-empty legacy có đúng một entry nguyên văn, empty/whitespace không tạo session rỗng; custom không bị ghi. **Success Criteria:** migration không tổng hợp hoặc loại bỏ nội dung cũ.
- [x] **Step 2 — Implement bootstrap/migrate.** File missing tạo summary marker + title. Legacy ghi backup immutable, ghi legacy session immutable rồi mới atomic replace summary bằng nguồn dẫn tới legacy. Nhận schema mới trả `none`; marker version lạ lỗi. Summary mới lưu nhắc đọc/tổng hợp legacy và link nguồn để lần start sau vẫn thấy việc chưa tổng hợp. **Success Criteria:** format mới chỉ được công bố sau khi nguồn/backup đã tồn tại.
- [x] **Step 3 — Pin migration retry.** Seed backup-only, backup+legacy, và schema mới sau cutover; assert retry không thêm artifact hoặc đổi metadata legacy. Timestamp import đã ghi trong artifact phải được tái sử dụng; backup/legacy không khớp trả `MIGRATION_CONFLICT`. **Success Criteria:** restart không làm thay đổi nguồn deterministic hoặc giả thời gian import thành sự kiện gốc.
- [ ] **Step 4 — Bàn giao command.** `bun test src/storage/migration.test.ts` — kỳ vọng pass, agent không chạy. **Success Criteria:** fixtures kiểm tra cả trước/sau điểm thay summary.

### Task 4: Vòng đời session và append idempotent

**Files:** Modify `src/storage/session.ts`, `src/storage/session.test.ts`.

**Interfaces:**

- Consumes Task 1–3, không import retrieval hoặc MCP.
- `startSession(memoryDir: string, options?: StartOptions): Promise<SessionResult>`.
- `saveSessionMemory(memoryDir: string, options: SaveOptions): Promise<SaveResult>`.

- [x] **Step 1 — Thay test contract cũ.** Test hai session riêng, nhiều entry, resume giữ startedAt/goal, missing ID trả `SESSION_NOT_FOUND`, goal khác khi resume lỗi. Assert cùng entry ID/payload trả deduplicated và bytes không đổi; payload khác `ENTRY_CONFLICT`. **Success Criteria:** không còn kỳ vọng replace hoặc enum section.
- [x] **Step 2 — Implement start/resume.** Validate input trước mutation, acquire lock, bootstrap/migrate, tạo UUID mới hoặc kiểm tra session cũ; resume không ghi entry phụ. **Success Criteria:** ID trên đĩa đủ để tiếp tục sau restart, không cần biến active process.
- [x] **Step 3 — Implement append.** Acquire lock; validate session format/ID; kiểm tra entry ID trước timestamp; reject payload trên 65536 byte, whitespace-only content hoặc title multiline. Render bản session mới giữ prefix lịch sử nguyên trạng rồi atomic replace. Không áp trần lên tổng file. **Success Criteria:** append chỉ thêm bytes cuối, dedup retry giữ timestamp đầu tiên và không đổi lịch sử.
- [x] **Step 4 — Thêm test multiwriter và dung lượng.** Hai lệnh append qua storage đồng thời có thể thành công hoặc busy; retry cùng entry ID sau busy rồi assert đủ đúng một bản mỗi entry. Nhiều entry dưới giới hạn request tạo session trên 64 KiB vẫn đọc được. **Success Criteria:** không làm mất update hoặc hứa tự retry vô hạn.
- [ ] **Step 5 — Bàn giao command.** `bun test src/storage/session.test.ts` — kỳ vọng pass, agent không chạy. **Success Criteria:** test mới phản ánh session journal, không destructive snapshot.

### Task 5: Summary có revision và nguồn

**Files:** Create `src/storage/summary.ts`, `src/storage/summary.test.ts`.

**Interfaces:**

- Consumes format/files; đọc nguồn qua `parseSession`, không phụ thuộc session mutation API.
- `updateMemory(memoryDir: string, options: UpdateOptions): Promise<UpdateResult>`.

- [x] **Step 1 — Viết regression revision.** Đọc một revision, ghi cập nhật A, thử cập nhật B bằng revision cũ; assert `REVISION_CONFLICT` và bytes A giữ nguyên. **Success Criteria:** lost update không bị che bởi lock tuần tự.
- [x] **Step 2 — Implement update.** Kiểm tra caller session tồn tại, content non-empty/tối đa 65536 byte, sources không rỗng; dưới lock kiểm tra expectedRevision và tất cả source tồn tại. Render marker hệ thống riêng, không nhận marker nhúng ở đầu content như schema mới. **Success Criteria:** chỉ summary thay đổi, session bytes không đổi.
- [x] **Step 3 — Validate nguồn chuẩn.** Parse Markdown link đích theo `sessions/<id>.md#entry-<id>`; mỗi nguồn khai báo phải có trong content, mọi link nội bộ chuẩn phải tồn tại. Link ngoài được giữ như văn bản tham khảo, không fetch. Reject link nội bộ malformed/path traversal; source trong code fence không được tính là dẫn nguồn thực. **Success Criteria:** nguồn có thể truy ngược, không dựa vào match substring ngẫu nhiên.
- [x] **Step 4 — Pin warning và source errors.** Assert missing entry/session hoặc sources rỗng không đổi summary; 16385 byte summary body trả warning nhưng giữ nguyên content; payload vượt 65536 bị từ chối. **Success Criteria:** warning khác hard limit; không tự cắt/gộp.
- [ ] **Step 5 — Bàn giao command.** `bun test src/storage/summary.test.ts` — kỳ vọng pass, agent không chạy. **Success Criteria:** có coverage revision, nguồn và budget.

### Task 6: Read phân trang và keyword search

**Files:** Create `src/storage/retrieval.ts`, `src/storage/retrieval.test.ts`; Modify `src/storage/index.ts`.

**Interfaces:**

- Consumes format/files, DTO và constants Task 1. Không acquire mutation lock hoặc bootstrap.
- `readMemory(memoryDir: string, options?: ReadOptions): Promise<ReadPage>`.
- `searchMemory(memoryDir: string, options?: SearchOptions): Promise<SearchResponse>`.
- `storage/index.ts` export DTO/errors và bốn mutation/read/search API mới; bỏ `MEMORY_SECTIONS`, `SaveMode`, `MAX_SESSION_BYTES`, `searchSessionMemory` cũ.

- [x] **Step 1 — Viết read regression.** Ghép các trang tiếng Việt/emoji phải bằng bytes snapshot ban đầu; budget 1 không đủ ký tự tiếp theo phải lỗi và không loop cursor. File đổi revision giữa trang trả `STALE_CURSOR`; cursor malformed hoặc target khác trả `INVALID_ARGUMENT`; budget ngoài 1..65536 lỗi. **Success Criteria:** mọi trang có cùng revision và UTF-8 hợp lệ.
- [x] **Step 2 — Implement read.** Cursor base64url JSON `{version:1,target,revision,offset}` validate đầy đủ; target chỉ memory hoặc session ID, không path tùy ý. Mở file handle một lần cho hash+read snapshot; không hash path rồi reopen bản khác. Offset tính theo bytes file, gồm marker; không cắt continuation byte. Missing summary trả `missing`, session missing lỗi. **Success Criteria:** paging có thể trả đúng toàn bộ tài liệu, kể cả metadata hệ thống; tool update vẫn chỉ nhận body Markdown.
- [x] **Step 3 — Viết search regression.** Assert query `authentication otp` không khớp hai entry riêng; một entry có đủ từ khớp dù snippet bị cắt. Summary đứng trước session; session timestamp quyết định thứ tự, tie theo session+entry ID. Assert 2048 byte/snippet, 16384 tổng, limit mặc định 3/max20; backup có từ khóa không xuất hiện. **Success Criteria:** ranking/budget không phụ thuộc thứ tự heading hoặc tên file.
- [x] **Step 4 — Implement search.** Xét paragraph summary theo blank line ngoài code fence và mỗi session entry; match AND case-insensitive. Quét từng file, giữ top `limit + 1` ứng viên để biết bị giới hạn, không tích lũy toàn workspace. Snippet theo vùng quanh match đầu; nếu không chứa mọi từ thì vẫn đánh `snippetTruncated` đúng nghĩa rút ngắn nội dung. Query rỗng chỉ chấp nhận không kèm filter/limit và delegate read trang đầu. Scope memory+sessionId lỗi; all+sessionId chỉ session đó. File lỗi trả error thay vì partial để tránh thêm loại response. **Success Criteria:** đủ metadata/anchor để dùng read tiếp, không trả tổng match không biết.
- [x] **Step 5 — Pin legacy và export.** Legacy hit có importedAt và timestamp ghi rõ là import; unsupported file trong sessions gây lỗi rõ; symlink ngoài root không bị search. Summary paragraph không tự gán timestamp entry. Export API đã chốt qua barrel. **Success Criteria:** search không biến legacy import thành sự kiện mới.
- [ ] **Step 6 — Bàn giao command.** `bun test src/storage/retrieval.test.ts` — kỳ vọng pass, agent không chạy. **Success Criteria:** read/search test bao phủ filter, paging, ranking và stale cursor.

### Task 7: Adapter năm tool và instructions chủ động

**Files:** Create `src/tools.ts`, `src/tools.test.ts`; Modify `index.ts`.

**Interfaces:**

- Consumes API từ `src/storage/index.ts`.
- `src/tools.ts` export `MEMORY_INSTRUCTIONS: string`, `MEMORY_TOOLS: Tool[]`, và `callMemoryTool(memoryDir: string, name: string, args: unknown): Promise<CallToolResult>`; `Tool`, `CallToolResult` lấy từ MCP SDK hiện có.
- Start response là `{...SessionResult, memory: ReadPage, instructions: string}`. Search response giữ discriminant đã định nghĩa.

- [x] **Step 1 — Viết tool contract test.** Assert đúng năm tool, JSON schema `additionalProperties:false`, required fields đúng spec; gọi handler trực tiếp vẫn reject unknown fields/type sai/number không nguyên. Assert `mode`, `section`, missing IDs trả `isError:true` và text hướng sang append/update phù hợp. **Success Criteria:** runtime không chỉ dựa client validate schema.
- [x] **Step 2 — Implement schema/dispatch.** Giữ tên start/save/search, thêm update/read; bỏ activeSessionId. Structured result là dữ liệu gốc, text ngắn chỉ trạng thái/đường dẫn/lỗi để tránh lặp nội dung; schema không hứa một output shape cho cả read fallback và search nếu chưa biểu diễn union đúng. **Success Criteria:** caller lấy content đầy đủ trong structuredContent và không có hai bản payload text trùng nhau.
- [x] **Step 3 — Implement instructions và start composition.** Hướng dẫn đọc summary đầu phiên, append thông tin đáng nhớ, tái dùng entry ID khi retry, lưu nguồn trước consolidate, merge sau conflict, checkpoint khi có cơ hội và không lưu secrets. `start_session` gọi start rồi read summary; nếu đọc fail sau tạo session, trả error kèm session ID đã tạo để resume, không khẳng định chưa tạo. **Success Criteria:** không hứa server tự đọc chat hoặc hook cuối phiên luôn chạy.
- [x] **Step 4 — Kết nối server.** Index đăng ký list/call handlers từ adapter, truyền instructions trong options SDK hỗ trợ theo type hiện có. Chuyển log startup sang stderr; bỏ mkdir startup để read không tạo dữ liệu; tiếp tục stdio và root resolution. Giữ version hiện tại, không tự bump release. **Success Criteria:** stdout chỉ chứa protocol, không tạo session khi khởi động.
- [ ] **Step 5 — Bàn giao command.** `bun test src/tools.test.ts` — kỳ vọng pass, agent không chạy. **Success Criteria:** unknown tool trả lỗi, mutation errors giữ code/retry/writeState và không làm lộ payload nhạy cảm trong log.

### Task 8: README và bàn giao kiểm chứng

**Files:** Modify `README.md`.

**Interfaces:** Consumes năm contract và instructions của Task 7; không thêm product code.

- [x] **Step 1 — Cập nhật layout/workflow.** Mô tả summary + session + backup; bỏ claim single file/cap64KiB/fixed section. Đưa đoạn host instructions người dùng có thể copy để agent lưu chủ động; nói rõ MCP không tự quan sát hội thoại. **Success Criteria:** tài liệu không yêu cầu host hooks hoặc tự sửa project instructions.
- [x] **Step 2 — Viết ví dụ gọi tool đầy đủ.** Start → save với UUID ổn định → read summary lấy revision → update có nguồn → search → resume sau restart. Ví dụ dùng cùng session/entry reference, cursor do tool trả, không hardcode revision giả như dữ liệu chạy thật. **Success Criteria:** ví dụ thể hiện thứ tự lưu nguồn trước tổng hợp và xử lý conflict.
- [x] **Step 3 — Tài liệu migration/breaking change.** Nêu backup nguyên trạng, legacy source, custom format bị từ chối, retry migration và lỗi replace/section cũ. Giữ hướng dẫn setup nhưng thêm lưu ý contract mới cần reload MCP; không chạy setup prompt. **Success Criteria:** người dùng biết dữ liệu cũ ở đâu và client cần đổi gì.
- [x] **Step 4 — Bàn giao source review.** Đọc các file đã sửa, đối chiếu spec/plan và ghi rõ những gì chỉ source-reviewed. Không chạy diff-check/build/test/lint/typecheck. **Success Criteria:** báo file thay đổi, rủi ro/giới hạn và các command bên dưới; không claim runtime pass.

## Command chỉ để người dùng tự chạy sau implementation

Chạy một lần bộ test thích hợp và typecheck; các command này chưa được agent chạy:

```powershell
bun test src/storage/format.test.ts src/storage/files.test.ts src/storage/migration.test.ts src/storage/session.test.ts src/storage/summary.test.ts src/storage/retrieval.test.ts src/tools.test.ts
bunx tsc --noEmit
```

Kỳ vọng: test và typecheck exit 0. Không dùng script `lint` hiện tại như bằng chứng vì nó chỉ echo chưa cấu hình linter.

Kiểm tra qua MCP client trong một workspace tạm do người dùng chọn:

1. List đúng năm tool; startup không in log vào stdout protocol.
2. Start hai phiên, lưu hai entry, retry một entry, resume sau restart và search đúng nguồn.
3. Hai client đọc cùng revision rồi update lần lượt: lần hai conflict, đọc/merge lại mới ghi được.
4. Đọc file trên 64 KiB qua nhiều trang, sửa file giữa hai trang rồi nhận stale cursor.
5. Dùng bản sao memory legacy để migration; so backup nguyên trạng và legacy chỉ có một bản sau retry.
6. Xác nhận agent thực sự gọi tool chủ động trong host đang dùng; đây là kiểm tra hành vi agent, không thể suy ra chỉ từ test storage.

## Handoff và approval

Plan này chỉ cho phép triển khai sau khi người dùng review, duyệt và chọn cách thực thi. `[PLAN]` trong phản hồi bàn giao tóm tắt task; file map ở trên là danh sách scope để approval.

- **Native:** main agent triển khai tuần tự trong session này theo executing-plans, rồi có một reviewer độc lập ở cuối theo workflow của skill. Không tự chạy verification hoặc commit.
- **Subagent-driven:** task implement/review tuần tự theo subagent-driven-development; mọi worker nhận đúng scope file và cùng lệnh cấm chạy verification/commit.

Đề xuất Native vì các task phụ thuộc chung format/DTO và ít có phần implementation độc lập để làm song song. Không bắt đầu execution hoặc spawn worker trước lựa chọn của người dùng.
