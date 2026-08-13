# Shared Workspace Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple MCP/Codex sessions in one workspace to share `.memorize/MEMORY.md` without `start_session` deleting existing memory or concurrent writes silently losing updates.

**Architecture:** Keep one workspace-local Markdown file. Add stable top-level sections, register each session under `## Sessions`, scope structured saves to an optional section, and serialize read-modify-write operations with a short-lived lock plus the existing atomic rename. Preserve legacy save behavior when no section is supplied.

**Tech Stack:** Bun, TypeScript, Node `fs`, MCP SDK, Markdown section parsing, Bun test.

**Scope boundary:** Commit steps are intentionally excluded. The repository and user instructions forbid Codex from running build, test, lint, or verification commands; those commands are listed for the user to run after implementation.

---

## File map

- Modify `src/storage/session.ts`: workspace layout, session registration, section-scoped save/search, migration, and write lock.
- Modify `src/storage/session.test.ts`: shared-session, section, migration, filtering, and lock-safe write coverage.
- Modify `index.ts`: expose the new optional tool fields and retain the MCP process's active session ID.
- Modify `README.md`: document non-destructive sessions and section-scoped shared memory.
- Do not add dependencies, database tables, index files, or additional memory files.

## Data shape

New files start with these stable top-level sections:

```md
# Workspace Memory

- Memory ID: <uuid>
- Updated: <iso timestamp>

---

## Context

## Constraints

## Decisions

## Current State

## Verification

## Open Questions

## Next Steps

## Sessions

### Session <session-id> — <iso timestamp>

- Goal: <optional goal>
```

Structured appends use a nested heading so the originating session remains visible without creating another top-level search chunk:

```md
## Decisions

### Session <session-id> — <iso timestamp>

<content>
```

Canonical section names are `Context`, `Constraints`, `Decisions`, `Current State`, `Verification`, `Open Questions`, `Next Steps`, and `Session Updates`. `Sessions` is managed by `start_session` and is not a normal save target.

### Task 1: Add failing storage tests for shared workspace behavior

**Files:**
- Modify: `src/storage/session.test.ts`

- [ ] **Step 1: Test that starting multiple sessions preserves the same file**

Create two sessions with different goals. Assert the second `startSession` result has a different session ID, both goals remain in the full memory, and the first session's previous update remains.

- [ ] **Step 2: Test section-scoped append and replace**

Start one session, append content to `Decisions`, append content to `Current State`, then replace only `Decisions`. Assert `Current State` survives, the old decision is gone, the new decision is present, and the section headings remain unique.

- [ ] **Step 3: Test session and section search filters**

Create two sessions and write distinct content to the same section. Search by section and by session ID separately. Assert only the requested top-level section/session entries are returned while the existing case-insensitive AND matching and newest-first ordering remain intact.

- [ ] **Step 4: Test migration of the existing session format**

Seed a legacy `# Session Memory` file containing a goal, `## Snapshot`, and `## Update`. Start a new session. Assert all legacy content remains, the file contains the workspace header/layout, and a new session entry is registered.

- [ ] **Step 5: Test concurrent-safe writes at the storage boundary**

Create a lock-file collision before a save and assert the save fails with a retryable memory-lock error. Remove the lock and assert the next save succeeds. This verifies the no-silent-overwrite guard without depending on timing-sensitive process races.

### Task 2: Implement workspace layout, migration, and session registration

**Files:**
- Modify: `src/storage/session.ts`

- [ ] **Step 1: Define the canonical section list and result/options types**

Add typed section names and optional `section`, `sessionId`, and search filters while keeping existing `SaveMode`, `SessionSearchOptions`, and return fields compatible where possible. Make `startSession` return both `filePath` and `sessionId` so the MCP handler can keep the active ID.

- [ ] **Step 2: Add workspace initialization without destructive reset**

When no memory exists, create the workspace header and canonical sections. When a legacy file exists, preserve its body, rename only the top-level title to `# Workspace Memory`, append missing canonical sections, and never remove old snapshots or updates.

- [ ] **Step 3: Register sessions under `## Sessions`**

Generate a UUID and ISO timestamp for every `startSession` call. Under the existing `## Sessions` section, append one `### Session <id> — <timestamp>` entry with the optional goal. Return the new ID and path. Do not replace the file.

- [ ] **Step 4: Implement exact top-level section parsing**

Reuse the current Markdown approach: split only on headings matching `^## `, preserve the header and section order, identify section names from the heading text, and avoid treating nested `###` session entries as top-level sections.

### Task 3: Implement locked section-scoped storage and search

**Files:**
- Modify: `src/storage/session.ts`

- [ ] **Step 1: Serialize read-modify-write operations with a lock file**

Create `.memorize/MEMORY.md.lock` with exclusive creation before `startSession` and `saveSessionMemory`. If the lock exists and is fresh, return a clear retryable error. Store an acquisition timestamp, clean up stale locks older than 30 seconds, and always remove the lock in `finally`. Keep the existing temporary-file-plus-rename write path for atomic replacement.

- [ ] **Step 2: Preserve legacy save behavior when `section` is omitted**

Keep `append` as a timestamped `## Update` and `replace` as the existing header-preserving full snapshot. This avoids breaking current clients while allowing new clients to opt into structured sections.

- [ ] **Step 3: Add section-scoped append and replace**

For `section: "Decisions"` (or another canonical save target), append a nested session/timestamp heading and content. For `mode: "replace"`, replace only that top-level section body and retain all other sections, sessions, and legacy content. Reject `Sessions` as a direct save target so session registration has one owner.

- [ ] **Step 4: Extend search filters without changing default search**

Keep empty-query full-file behavior and current AND/newest-first query behavior. Add optional exact `section` filtering before query matching and optional `sessionId` filtering against the returned section text. Validate positive integer `limit` as today and reject unknown section names.

- [ ] **Step 5: Preserve capacity checks and save feedback**

Continue enforcing the 64 KiB UTF-8 limit, return bytes and `nearLimit`, and ensure lock cleanup also occurs when the size check rejects a write.

### Task 4: Wire the MCP tools to active sessions and update documentation

**Files:**
- Modify: `index.ts`
- Modify: `README.md`

- [ ] **Step 1: Track the active session ID per MCP server process**

Set a module-local `activeSessionId` after `start_session`; require an active session for structured saves and pass the ID into storage. Return the generated session ID in the start response. A separate MCP process gets its own ID while sharing the same file.

- [ ] **Step 2: Extend tool schemas minimally**

Add optional `section` and `sessionId` fields to `save_memorize`/`search_memorize`, retain existing fields and defaults, and remove the `destructiveHint` metadata from `start_session` because it no longer replaces the file.

- [ ] **Step 3: Update README behavior and workflow**

Document that `.memorize/MEMORY.md` is shared by sessions, `start_session` is non-destructive, structured saves target canonical sections, and concurrent writes are serialized. Remove claims that there is only one active session or that session start permanently replaces the file.

### Task 5: User-run verification handoff

**Files:**
- No further file changes.

- [ ] **Step 1: Ask the user to run focused storage tests**

```powershell
bun test src/storage/session.test.ts
```

Expected: all existing and new session-memory tests pass, including migration, section replacement, filters, capacity, and lock behavior.

- [ ] **Step 2: Ask the user to run TypeScript verification**

```powershell
bunx tsc --noEmit
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Ask the user to perform a manual MCP smoke check**

```powershell
bun run index.ts
```

Expected: the server starts on stdio without protocol output contamination. From two workspace sessions, call `start_session`, save different sections, then search the shared file and confirm both session IDs and updates remain.

No commit or push step is included.

## Self-review

- Spec coverage: shared single-file access, non-destructive session start, section structure, section-scoped save/search, concurrent-write protection, legacy migration, 64 KiB preservation, and explicit non-goals are covered above.
- Placeholder scan: no TODO/TBD implementation steps are required; all verification commands and expected outcomes are explicit.
- Type consistency: storage owns `sessionId` and section options; `index.ts` owns the process-local active ID; tests exercise the public storage functions.
