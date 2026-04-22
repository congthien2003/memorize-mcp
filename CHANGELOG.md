# Changelog

Tất cả thay đổi quan trọng của dự án này sẽ được ghi lại trong file này.

Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
và version tuân theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-01-19

### Added

- **Pull AGENT.md**: Tool mới `pull_agent_file` để pull file `AGENT.md` về project của user.
- Module `src/storage/agent.ts` với function:
  - `pullAgentFile()`: Main function để pull `AGENT.md` từ source local.
- Agent configuration trong `src/config.ts`:
  - `agent.targetProjectDir`: Thư mục project đích.
- Environment variable:
  - `MEMORIZE_MCP_TARGET_PROJECT_DIR`: Thư mục project đích cho `pull_agent_file`.
- TypeScript types mới: `PullAgentFileOptions`, `PullAgentFileResult`.
- File `AGENT.md` được bundle trong package để user pull trực tiếp về project.

### Changed

- Server version bump: 1.2.0 → 1.2.1.
- Startup log hiển thị thêm AGENT.md target directory status.
- README.md updated với tool `pull_agent_file` documentation.

### Fixed

- N/A

## [1.2.0] - 2026-01-05

### Added

- **Sync from Cloud to Local**: Tool `sync_memorize` để đồng bộ memories từ Supabase về máy local.
- Các Supabase query functions:
  - `getProjectBySlug()`: Lấy thông tin project theo slug.
  - `getProjectMemories()`: Lấy tất cả memories của project.
  - `getMemoryByFilename()`: Lấy memory cụ thể theo filename.
- Local storage read functions:
  - `readLocalMemory()`: Đọc file JSON local.
  - `listLocalMemories()`: List tất cả file JSON trong thư mục.
  - `localMemoryExists()`: Kiểm tra file có tồn tại không.
- Module `src/storage/sync.ts` với logic:
  - `decideSyncAction()`: Quyết định create/update/skip dựa trên timestamp.
  - `syncFromCloud()`: Orchestrator cho quá trình sync từ cloud.
- Các TypeScript types mới: `SyncOptions`, `SyncResult`, `SyncDecision`, `SyncStats`.

### Changed

- Tool `sync_memorize` hỗ trợ các options:
  - `projectSlug` (optional): Chỉ định project, mặc định lấy từ env.
  - `overwrite` (optional): Force overwrite tất cả file local.
  - `filename` (optional): Chỉ sync 1 file cụ thể.
- Server version bump từ 1.1 → 1.2.

### Fixed

- N/A

## [1.1.0] - 2026-01-05

### Added

- **Supabase Cloud backend** cho khả năng sync memory qua nhiều máy.
- Optional field `projectSlug` trong tool `save_memorize` để chỉ định project khi sync.
- Module `src/storage/` với cấu trúc rõ ràng:
  - `local.ts`: xử lý lưu file JSON local.
  - `supabase.ts`: kết nối và sync lên Supabase.
  - `index.ts`: orchestrator điều phối giữa local và cloud.
- Module `src/config.ts` để quản lý environment variables.
- Các biến môi trường mới:
  - `MEMORIZE_MCP_SUPABASE_URL`
  - `MEMORIZE_MCP_SUPABASE_SERVICE_ROLE_KEY`
  - `MEMORIZE_MCP_PROJECT_SLUG`
- Database schema cho Supabase (bảng `projects` và `memories`).
- SQL migration file tại `docs/version1.1/migrations/001_initial_schema.sql`.
- Documentation chi tiết trong `docs/version1.1/overview.md` và `IMPLEMENTATION_PLAN.md`.

### Changed

- Tool `save_memorize` giờ vừa lưu local **vừa** sync cloud (nếu cấu hình Supabase).
- Response message của tool bao gồm cả thông tin cloud sync status.
- Server name đổi từ `memory-server` thành `memorize-mcp-server`.
- Cấu trúc code được refactor để dễ maintain và mở rộng.

### Fixed

- Graceful degradation: nếu Supabase lỗi, local storage vẫn thành công.
- Logging chi tiết hơn cho từng bước xử lý.

## [1.0.0] - 2026-01-05

### Added

- MVP `memorize-mcp` MCP server.
- Tool `save_memorize` để lưu tóm tắt phiên làm việc ra file JSON local.
- Cấu hình thư mục lưu bằng biến môi trường `MEMORIZE_MCP_PROJECT_ROOT` (mặc định `./.memories/data`).
- README mô tả cách chạy bằng Bun và cách tích hợp với MCP client.
