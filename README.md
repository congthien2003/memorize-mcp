# memorize-mcp

An MCP server that stores shared Markdown memory for all sessions in the current workspace.

- Single file: `.memorize/MEMORY.md`.
- Multiple sessions share stable sections and session-scoped entries. There is no cloud sync, database, tag, or index.
- The file is capped at 64 KiB, so agents can read and search it directly.

**Version:** `2.0.1`

## Set up with one prompt

Paste the following prompt into your current Codex or Claude Code session. It detects the host, configures only the matching MCP server, runs verification, and reports the outcome.

```text
Set up memorize-mcp for this local agent host.

1. Detect the current host. Do not configure both:
   - If running in Codex, use the Codex commands below.
   - If running in Claude Code, use the Claude Code commands below.
   - If the host cannot be identified, stop and ask which one to configure.
2. Confirm that git, bun, and the selected host CLI are available. If any are missing, stop and report the exact missing prerequisite.
3. Clone https://github.com/congthien2003/memorize-mcp.git into a stable user-owned tools directory outside of any application workspace. If that clone already exists, update it without deleting uncommitted user changes.
4. Change into the cloned repository and run `bun install`.
5. Run these verification commands and stop on failure:
   - `bunx tsc --noEmit`
   - `bun test src/storage/session.test.ts`
6. Configure only the selected host. First list the existing `memorize` server and remove only that server if it exists:
   - Codex: `codex mcp list`, then `codex mcp remove memorize` if needed.
   - Claude Code: `claude mcp list`, then `claude mcp remove memorize` if needed.
7. Add the server using the repository's absolute `index.ts` path:
   - Codex: `codex mcp add memorize -- bun "ABSOLUTE_PATH_TO_MEMORIZE_MCP/index.ts"`
   - Claude Code: `claude mcp add --transport stdio --scope user memorize -- bun "ABSOLUTE_PATH_TO_MEMORIZE_MCP/index.ts"`
   Do not set a fixed working directory, `MEMORIZE_MCP_PROJECT_ROOT`, or memory path. The server must inherit the current workspace so it writes `.memorize/MEMORY.md` in the project being worked on.
8. Run the selected host's MCP list command again and confirm that `memorize` is enabled.
9. Report the clone path, verification results, MCP list result, and the reminder to restart/reload the current host before using the new server.

Do not commit or modify unrelated repositories, configurations, or MCP servers.
```

After setup, restart or reload the current host and use `/mcp` to inspect active servers.

## Run the server manually

```bash
bun install
bun run index.ts
```

The server uses stdio. Its working directory determines where `.memorize/MEMORY.md` is created.

## Agent workflow

1. Call `start_session` at the beginning of a new work session. It registers a session without deleting existing memory.
2. Call `save_memorize` with `section` and `mode: "append"` for structured progress updates.
3. Call `save_memorize` with `section` and `mode: "replace"` to replace one section. Omitting `section` keeps the legacy full snapshot behavior.
4. Call `search_memorize` without a query to load all workspace context. Pass `query`, `section`, or `sessionId` to retrieve only relevant content.

Do not store passwords, tokens, API keys, or other secrets in session memory.

## Tools

### `start_session`

Creates a new session entry in the shared `.memorize/MEMORY.md` without replacing existing memory.

```json
{
  "goal": "Refactor the memory MCP"
}
```

`goal` is optional. The new file includes a session ID and start time.
Calling this tool preserves all previous sessions and updates.

### `save_memorize`

Writes Markdown to the shared workspace memory. Call `start_session` first.

```json
{
  "content": "Removed the JSON index and moved to one Markdown file.",
  "mode": "append"
}
```

- `append` is the default. Without `section`, it adds a timestamped `## Update` section; with `section`, it adds a session-stamped nested entry.
- `replace` keeps the workspace header and replaces the selected section. Without `section`, it preserves registered sessions and replaces the snapshot body.
- Structured saves support `Context`, `Constraints`, `Decisions`, `Current State`, `Verification`, `Open Questions`, `Next Steps`, and `Session Updates`.
- Writes are serialized with a short-lived lock so concurrent sessions do not silently overwrite each other.
- Writes are rejected when the file would exceed 64 KiB. Use `replace` with a shorter snapshot.
- Successful saves report current usage as `used KiB / 64 KiB`. At 80% capacity or above, the response recommends a concise `replace` snapshot.

### `search_memorize`

Reads or searches `.memorize/MEMORY.md`.

```json
{
  "query": "Markdown",
  "limit": 3
}
```

- Without `query`, it returns the complete workspace memory for agent context.
- With `query`, whitespace-separated terms are matched case-insensitively with AND semantics within `##` sections. The newest matches are returned first, up to three sections by default.
- `section` filters to one top-level section and `sessionId` filters nested session entries.
- When no workspace memory or match exists, it returns an explanatory message instead of an error.
