# Session-local Memory Implementation Plan

**Goal:** Replace the multi-file JSON memory store with one workspace-local Markdown file that only represents the active work session.

**Architecture:** `.memorize/MEMORY.md` is the single source of truth. `start_session` resets it, `save_memorize` appends or replaces its body, and `search_memorize` reads either the full document or matching Markdown sections. No index, history, tags, cloud sync, or database remains.

**Tech Stack:** TypeScript, Bun, MCP SDK, Node `fs` and `path`.

---

## File scope

- Create: `src/storage/session.ts` — session file lifecycle, writes, reads, and section search.
- Create: `src/storage/session.test.ts` — focused Bun tests for reset, append/replace, and section search.
- Modify: `index.ts` — expose exactly `start_session`, `save_memorize`, and `search_memorize`.
- Modify: `README.md` — document the session-only workflow and schemas.
- Modify: `package.json`, `bun.lock`, `package-lock.json` — remove unused Supabase dependency and synchronize locks.
- Delete: `src/storage/agent.ts`, `src/storage/index.ts`, `src/storage/local.ts`, `src/storage/markdown.ts`, `src/storage/types.ts` — previous agent-copy and multi-memory JSON/index implementation.

## Task 1: Add the single-file session store

**Files:**
- Create: `src/storage/session.ts`
- Create: `src/storage/session.test.ts`

- [ ] Define `startSession({ goal?: string })`, `saveSessionMemory({ content, mode })`, and `searchSessionMemory({ query?, limit? })` using the fixed `MEMORY.md` path below `.memorize`.
- [ ] `startSession` must create `.memorize` when absent and atomically replace `MEMORY.md` with a short Markdown header containing a generated `sessionId`, ISO `startedAt`, and optional goal.
- [ ] `saveSessionMemory` must reject empty content and unknown mode; `append` writes `## Update — <ISO timestamp>` plus content, while `replace` preserves the header and replaces all update content with `## Snapshot — <ISO timestamp>` plus content.
- [ ] Reject writes larger than 64 KiB, including the existing document for `append`, with an actionable compact-before-saving message.
- [ ] `searchSessionMemory` returns the full file if `query` is absent. With a query, split on level-two headings, case-insensitively match each whole section, and return at most `limit ?? 3` matching sections. It must return a successful empty result when no session or no match exists.
- [ ] Add Bun tests that create a temporary directory, assert `startSession` replaces prior content, assert append then replace leaves only the replacement snapshot, and assert case-insensitive section search returns only matching sections.

## Task 2: Replace the MCP tool contract

**Files:**
- Modify: `index.ts`
- Delete: `src/storage/agent.ts`
- Delete: `src/storage/index.ts`
- Delete: `src/storage/local.ts`
- Delete: `src/storage/markdown.ts`
- Delete: `src/storage/types.ts`

- [ ] Replace the current tool list with exactly:
  - `start_session`: optional `goal` string.
  - `save_memorize`: required non-empty `content` string and optional `mode` enum, defaulting to `append`.
  - `search_memorize`: optional `query` string and optional positive `limit` number.
- [ ] Update each handler to call `session.ts`, present returned Markdown directly for reads/searches, and return `isError: true` for validation or filesystem errors.
- [ ] Remove the `pull_agent_file` handler and every import/export that supports it.
- [ ] Retain stdio transport and existing project-root resolution; startup must only ensure `.memorize` exists and must not create a session automatically.

## Task 3: Remove stale dependency and document the workflow

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `package-lock.json`
- Modify: `README.md`

- [ ] Remove `@supabase/supabase-js`; no active source imports it and the revised design has no cloud backend.
- [ ] Regenerate both committed lockfiles after dependency removal.
- [ ] Rewrite README tool documentation around the three tools, document `.memorize/MEMORY.md`, show append and replace calls, clarify that `start_session` discards the previous session, and state the 64 KiB ceiling.
- [ ] Align visible version strings in `package.json`, server metadata, startup log, and README to one version selected during implementation.

## Verification for you to run

I will not run verification commands. After implementation, run:

```powershell
bun test src/storage/session.test.ts
bunx tsc --noEmit
bun run index.ts
```

Expected: the tests and type check exit with code 0; the last command prints startup information and waits for the MCP client over stdio.

## Out of scope

- Previous session history, cloud sync, embeddings, SQLite/FTS, semantic search, and automatic session detection.
- Committing changes.
