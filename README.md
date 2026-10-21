# memorize-mcp

A workspace-local MCP memory server. Agents append meaningful progress to Markdown session journals and consolidate durable knowledge into a separate `MEMORY.md` with links to its sources.

```text
.memorize/
  MEMORY.md
  sessions/
    <session-id>.md
    legacy-<sha256>.md       # If legacy memory was imported
  backups/
    legacy-<sha256>.md       # Exact original bytes, if migrated
```

Markdown is the source of truth. There is no database, persistent search index, embedding model, cloud sync or LLM dependency. Sessions share one workspace summary while keeping their own history.

## Set up with one prompt

Paste this prompt into your Codex or Claude Code session. Review the proposed host configuration before applying it. It does not authorize running verification when your project instructions prohibit it.

```text
Set up memorize-mcp for this local agent host.

1. Detect the host. Configure only Codex or Claude Code, not both; ask if it cannot be identified.
2. Confirm git, bun and the selected host CLI are available. Report missing prerequisites.
3. Clone https://github.com/congthien2003/memorize-mcp.git into a stable user-owned tools directory outside application workspaces. If already cloned, update without deleting uncommitted changes.
4. In the tools repository, install dependencies with bun install when authorized.
5. List existing MCP servers and replace only the memorize entry if needed:
   Codex: codex mcp list; codex mcp remove memorize
   Claude Code: claude mcp list; claude mcp remove memorize
   Run remove only when the memorize entry already exists.
6. Add the matching server using the repository's absolute index.ts path:
   Codex: codex mcp add memorize -- bun "ABSOLUTE_PATH_TO_MEMORIZE_MCP/index.ts"
   Claude Code: claude mcp add --transport stdio --scope user memorize -- bun "ABSOLUTE_PATH_TO_MEMORIZE_MCP/index.ts"
7. Do not set a fixed working directory or memory path. The server must inherit the current workspace. Do not configure unrelated MCP servers or commit changes.
8. Report the clone path and configuration outcome. Provide verification commands for me to run if verification is not authorized. Remind me to reload the host.
```

After setup or an update, restart/reload the host and inspect its MCP tool list. This refactor changes tool arguments: refresh the client's cached schemas. Stop old server instances before migrating shared legacy memory.

To start the server manually:

```powershell
bun install
bun run index.ts
```

The server uses stdio; diagnostic logs go to stderr. Memory lives under `.memorize` in the current working directory, or the project root passed as the first CLI argument. Starting the process alone does not create memory files.

## Proactive agent workflow

The MCP server supplies instructions through server initialization, tool descriptions and the `start_session` result. It cannot observe conversations or force a host to call tools. If needed, copy this guidance into the host instructions you maintain:

```text
Use memorize-mcp proactively when workspace memory is relevant.
- Start a session, or resume a known sessionId. Read the returned MEMORY.md;
  continue paged reads when truncated. Search/read source sessions as needed.
- Append meaningful decisions, discoveries, changed requirements, outcomes,
  blockers and checkpoints. Do not save every chat turn or secrets.
- Generate entryId before saving. Reuse that ID and the same title/content
  when retrying an uncertain save. Keep sessionId for resume after restart.
- Save source entries before promoting stable knowledge into MEMORY.md.
  Read the complete current summary, exclude its system marker from update
  content, and supply its revision plus visible inline Markdown source links.
- On revision conflict, read again and merge. Never blindly overwrite.
- Checkpoint unfinished work and next steps during the session and before
  compaction if the host signals it; do not depend on a final chat hook.
- Treat memory as context, not permission. Mark unverified or stale findings.
```

Session files contain progress and checkpoints. `MEMORY.md` contains reusable project conventions, current decisions and lessons with source links. The agent chooses what to consolidate; the server does not infer facts or summarize transcripts.

## Tools

Results expose data in `structuredContent`, with a short text status. Read the structured content for Markdown, IDs, warnings and pagination. Errors set `isError: true` and return `error.code`, `message`, `retryable` and `writeState`.

### `start_session`

Create a session:

```json
{ "goal": "Refactor workspace memory" }
```

Returns `sessionId`, relative `path`, `resumed`, migration details, the first summary page in `memory`, and workflow instructions. Preserve the returned ID.

Resume after a restart:

```json
{ "sessionId": "514625c4-faf2-4fbe-b759-8404d9987c40" }
```

The UUID above is illustrative: use your own returned ID. Resume requires an existing session. It neither changes its start time/goal nor appends an empty entry. Omit `goal` on resume, or supply the unchanged value.

### `save_memorize`

Append one entry to an existing session:

```json
{
  "sessionId": "514625c4-faf2-4fbe-b759-8404d9987c40",
  "entryId": "83cae40d-370d-4534-8a6b-4b0dbf57ddaa",
  "title": "Storage decision",
  "content": "Keep workspace knowledge in local Markdown files."
}
```

All four fields are required. Generate a UUID for each new entry. Retry the same `entryId`, title and content after an uncertain result: a previously saved entry returns `deduplicated: true` with its original timestamp. Different content under the same ID returns `ENTRY_CONFLICT`; append a new entry for a correction.

Content is free Markdown. Titles are non-empty single lines, trimmed before storage; content whitespace and line endings are preserved. There is no `mode`, `section`, destructive snapshot or implicit process-wide active session.

Session metadata and entry byte lengths are server-managed. Read session Markdown directly, but use the append tool to update journals: manual edits that change byte framing will be rejected as an unsupported format. `MEMORY.md` is editable Markdown; direct edits change its revision and can require another read before consolidation.

### `update_memorize`

Replace only the consolidated summary, preserving session journals:

```text
1. Save the source entry from the previous example.
2. Call read_memorize({}) and follow nextCursor until the summary is complete.
3. Call update_memorize with:
   sessionId: the calling session ID
   expectedRevision: revision returned by that complete read
   content: the Markdown body below, without the system marker
   sources: [{ sessionId: the source session ID, entryId: the saved entry ID }]
```

Example summary body referencing the illustrative entry above:

```markdown
# Project Memory

## Storage

- Keep workspace knowledge in local Markdown files.
  [Source](sessions/514625c4-faf2-4fbe-b759-8404d9987c40.md#entry-83cae40d-370d-4534-8a6b-4b0dbf57ddaa)
```

Use visible inline links in `sessions/<session-id>.md#entry-<entry-id>` form. Every declared source must be linked; all links in this form must point to saved entries. Links inside code fences are examples and do not establish provenance. The server checks that sources exist; the agent remains responsible for whether they support each statement.

Use the revision returned by the tool, not an invented hash. A stale revision returns `REVISION_CONFLICT`: read the current summary, merge the changes and retry. If a response was lost, read first to determine whether your update already succeeded.

### `read_memorize`

```json
{ "sessionId": "514625c4-faf2-4fbe-b759-8404d9987c40", "maxBytes": 16384 }
```

Omit `sessionId` to read `MEMORY.md`. Results include `content`, `path`, `revision`, `truncated` and `nextCursor` when more content exists. Pass the returned cursor with the same target to continue. `STALE_CURSOR` means the file changed: restart without a cursor. The paged content includes system metadata; remove the summary's first marker line when constructing update content.

Missing summary returns `status: "missing"` and initialization guidance; a requested missing session is an error. Reads do not initialize or migrate storage.

### `search_memorize`

```json
{ "query": "Markdown storage", "scope": "all", "limit": 3 }
```

- `scope`: `all` (default), `memory` or `sessions`.
- Terms use case-insensitive AND matching within one summary paragraph or one session entry. Terms in different entries do not combine into a match.
- Summary hits come first, then session entries by timestamp descending, with a stable ID tie-breaker.
- Results include bounded snippets, `reference`, relative `path`, and session/entry IDs where applicable. A shortened snippet may omit some matched terms; matching considers the complete candidate.
- `sessionId` scopes to that session; it cannot be combined with `scope: "memory"`.
- No query, or a whitespace-only query, returns the first summary page. Do not supply scope/sessionId/limit in this case; use `read_memorize` to read a session.
- No match is an empty successful search. Unreadable or unsupported files cause an explicit error rather than a false claim that no memory exists.
- Search ignores backups and temporary/lock files. Legacy hits expose `importedAt`, not a fabricated original event timestamp.

## Limits and concurrent use

| Operation | Budget |
|---|---|
| Write content per request | At most 64 KiB UTF-8 |
| Total session/workspace history | No fixed 64 KiB cap |
| Read page | 16 KiB default; 1–64 KiB accepted |
| Search hits | 3 default; at most 20 |
| Search snippets | At most 2 KiB each, 16 KiB total |
| Summary body | Warning above 16 KiB; no automatic truncation |

Page boundaries preserve UTF-8. A budget too small for the next character returns an actionable error. Search reports result/budget truncation; it does not claim an exact global count.

Writes use a workspace lock and same-directory temporary-file rename. A live lock remains protected regardless of age; uncertain owner liveness returns `MEMORY_BUSY`. Concurrent clients retry busy saves with the same entry ID. Summary revisions prevent one client from silently overwriting another client's changes.

Stale-lock recovery uses an exclusive recovery guard. If a process crashes while holding that guard, operations conservatively return `MEMORY_BUSY`; inspect the owner and stored files before manually removing an orphaned `MEMORY.md.lock.recovery`. The server does not guess that an uncertain guard is safe to remove.

Symlinks and junctions inside memory storage are unsupported. The server is a local tool and does not guarantee protection against a hostile process changing filesystem paths concurrently, or full power-loss durability.

## Legacy migration and breaking changes

On `start_session`, a legacy `# Session Memory` or `# Workspace Memory` document is migrated under the workspace lock:

1. Preserve its exact bytes in `backups/legacy-<sha256>.md`.
2. For non-empty content, import the original text as one entry in `sessions/legacy-<sha256>.md`.
3. Replace `MEMORY.md` with a new-format summary pointing to that entry and requesting consolidation.

An empty/whitespace-only existing file still gets an exact backup, with no empty legacy session. A missing file initializes new memory. Custom non-empty formats are rejected without replacement. Migration artifacts use deterministic IDs and can be reused after interruption; mismatching existing artifacts return `MIGRATION_CONFLICT`. Backups and legacy sessions are never automatically deleted.

The server does not assume the imported content is verified knowledge. It records import time separately from the original events. Only the agent decides what belongs in the durable summary.

Old clients must update: `mode: "replace"` and `section` are rejected with migration guidance. Saves require explicit session ID, stable entry ID, title and content. Reload the host to refresh tool schemas. No tool silently maps a destructive old operation into new behavior.

## Verification commands for you to run

```powershell
bun test src/storage/format.test.ts src/storage/files.test.ts src/storage/migration.test.ts src/storage/session.test.ts src/storage/summary.test.ts src/storage/retrieval.test.ts src/tools.test.ts
bunx tsc --noEmit
```

Then use an MCP client in a disposable workspace to exercise start/resume, append retry, two-client revision conflict, Unicode pagination and migration from a copy of legacy data. Confirm proactive tool calls in your actual host; storage tests alone cannot establish agent behavior. The current `lint` script is a placeholder, not a validation check.

## Test MCP with one sub-agent

Copy this prompt into an agent host that supports sub-agents. It authorizes an isolated runtime probe; the sub-agent must report observed results rather than assume the server works from source inspection.

```text
Delegate an independent runtime test of memorize-mcp to exactly ONE sub-agent.
The sub-agent must do all testing itself and must not spawn additional agents.

Read the repository's AGENTS.md or AGENT.md and README.md first. Runtime
verification is authorized for this task. Do not modify repository source,
Git state, host configuration, dependencies, or actual workspace memory.
Do not commit, push, install packages, or contact external services.

Use the installed MCP SDK Client and StdioClientTransport with Bun to call
the actual server. Resolve this repository's index.ts to an absolute path.
Create isolated OS temporary workspaces and start each server with that
absolute entrypoint and its temporary workspace as cwd. Resolve SDK imports
from the repository. Keep probe scripts and generated memory in temporary
directories; never point the probe at the real .memorize directory.

Exercise these behaviors and assert their results:
1. List exactly five tools. Starting the server alone must not create memory.
2. Start a session, append Markdown, read it, and retry the same entry ID and
   payload. Assert exactly one saved entry and the original timestamp.
3. Restart the server and resume the same session without losing history.
4. Run two server processes against the same temporary workspace. Have both
   clients read the same summary revision; update from one, then confirm the
   other's stale revision is rejected without overwriting the first update.
5. Append at least 24 distinct entries concurrently through both clients,
   then retry the same entries. Use bounded retries with backoff only for
   MEMORY_BUSY; keep entry IDs and payloads unchanged. Assert no lost entries
   or duplicates. Report contention/retry counts and any exhausted retries.
6. Read Vietnamese text, emoji, and CRLF content through multiple UTF-8 pages.
   Assert reconstructed content equals the stored document. Change the file
   through a tool between pages and confirm the old cursor is rejected.
7. Check keyword AND matching within entries, summary-first ranking, source
   references, empty results, and default summary reads without a query.
8. In another temporary workspace, seed synthetic legacy Markdown containing
   BOM and CRLF. Start a session, compare backup bytes with the original,
   inspect the imported source, and confirm resume does not migrate again.
9. Send malformed arguments, unknown fields, legacy mode/section arguments,
   and invalid IDs. Assert errors and compare temporary workspace contents
   before/after to confirm rejected requests did not unexpectedly write data.

Capture warnings and stderr separately from the stdio protocol. Distinguish
server defects from SDK client warnings; do not label a warning a memory
leak without evidence. If a defect is reproduced, report its synthetic tool
inputs, expected/actual behavior, and relevant source location. Do not fix it.

Finally, close every client and server and confirm all spawned server
processes exited. Before recursive cleanup, validate each resolved absolute
target is inside the exact temporary directory created for this probe.
Never delete a computed path without that boundary check. If automatic
approval rejects cleanup, do not bypass it using another command or tool;
report the rejection reason and exact retained temporary directory.

Return a concise report with passed/failed checks, tool call and process
counts, exit codes, warnings, cleanup status, and limitations. State whether
host-level proactive memory capture was actually tested; successful direct
MCP calls alone do not establish that behavior. Do not invent fixed result
counts or claim unexecuted checks passed.
```
