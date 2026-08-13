# memorize-mcp

An MCP server that stores shared Markdown memory for all sessions in the current workspace.

- Single file: `.memorize/MEMORY.md`.
- Multiple sessions share stable sections and session-scoped entries. There is no cloud sync, database, tag, or index.
- The file is capped at 64 KiB, so agents can read and search it directly.

**Version:** `2.0.1`

## Set up Codex with one prompt

Paste the following prompt into Codex. It clones this repository, configures the global MCP server, runs verification, and reports the outcome.

```text
Set up memorize-mcp for this local Codex host.

1. Confirm that git, bun, and codex are available. If any are missing, stop and report the exact missing prerequisite.
2. Clone https://github.com/congthien2003/memorize-mcp.git into a stable user-owned tools directory outside of any application workspace. If that clone already exists, update it without deleting uncommitted user changes.
3. Change into the cloned repository and run `bun install`.
4. Run these verification commands and stop on failure:
   - `bunx tsc --noEmit`
   - `bun test src/storage/session.test.ts`
5. Run `codex mcp list`. If an MCP server named `memorize` already exists, remove only that server with `codex mcp remove memorize`. Do not change any other MCP server.
6. Add the server using the repository's absolute `index.ts` path:
   `codex mcp add memorize -- bun "ABSOLUTE_PATH_TO_MEMORIZE_MCP/index.ts"`
   Do not set `cwd`, `MEMORIZE_MCP_PROJECT_ROOT`, or any fixed memory path. The server must inherit Codex's current workspace so it writes `.memorize/MEMORY.md` in the project being worked on.
7. Run `codex mcp list` again and confirm that `memorize` is enabled.
8. Report the clone path, verification results, MCP list result, and the reminder that Codex must start a new session or restart to load the new server.

Do not commit or modify unrelated repositories, configurations, or MCP servers.
```

Codex CLI, the desktop app, and the IDE extension share MCP configuration on the same host. Start a new Codex session after setup, then use `/mcp` to inspect active MCP servers.

## Set up Claude Code with one prompt

Paste the following prompt into Claude Code. It clones this repository, configures a user-scoped MCP server, runs verification, and reports the outcome.

```text
Set up memorize-mcp for this local Claude Code host.

1. Confirm that git, bun, and claude are available. If any are missing, stop and report the exact missing prerequisite.
2. Clone https://github.com/congthien2003/memorize-mcp.git into a stable user-owned tools directory outside of any application workspace. If that clone already exists, update it without deleting uncommitted user changes.
3. Change into the cloned repository and run `bun install`.
4. Run these verification commands and stop on failure:
   - `bunx tsc --noEmit`
   - `bun test src/storage/session.test.ts`
5. Run `claude mcp list`. If an MCP server named `memorize` already exists, remove only that server with `claude mcp remove memorize`. Do not change any other MCP server.
6. Add the server for all Claude Code projects using the repository's absolute `index.ts` path:
   `claude mcp add --transport stdio --scope user memorize -- bun "ABSOLUTE_PATH_TO_MEMORIZE_MCP/index.ts"`
   Do not set a fixed working directory or memory path. The server must inherit Claude Code's current workspace so it writes `.memorize/MEMORY.md` in the project being worked on.
7. Run `claude mcp list` again and confirm that `memorize` is enabled.
8. Report the clone path, verification results, MCP list result, and the reminder to reload Claude Code before using the new server.

Do not commit or modify unrelated repositories, configurations, or MCP servers.
```

After setup, reload Claude Code and use `/mcp` to inspect active servers.

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
