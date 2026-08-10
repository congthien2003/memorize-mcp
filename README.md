# memorize-mcp

An MCP server that stores one Markdown memory for the current workspace session.

- Single file: `.memorize/MEMORY.md`.
- `start_session` replaces the previous session. There is no history, cloud sync, database, tag, or index.
- The file is capped at 64 KiB, so agents can read and search it directly.

**Version:** `2.0.0`

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

## Run the server manually

```bash
bun install
bun run index.ts
```

The server uses stdio. Its working directory determines where `.memorize/MEMORY.md` is created.

## Agent workflow

1. Call `start_session` at the beginning of a new work session.
2. Call `save_memorize` with `mode: "append"` for short progress updates.
3. Call `save_memorize` with `mode: "replace"` for a compact handoff snapshot.
4. Call `search_memorize` without a query to load all session context. Pass a query to retrieve only relevant sections.

Do not store passwords, tokens, API keys, or other secrets in session memory.

## Tools

### `start_session`

Creates a new session by replacing `.memorize/MEMORY.md`.

```json
{
  "goal": "Refactor the memory MCP"
}
```

`goal` is optional. The new file includes a session ID and start time.

### `save_memorize`

Writes Markdown to the active session. Call `start_session` first.

```json
{
  "content": "Removed the JSON index and moved to one Markdown file.",
  "mode": "append"
}
```

- `append` is the default. It adds a timestamped `## Update` section.
- `replace` keeps the session header and replaces all earlier updates with a new `## Snapshot` section.
- Writes are rejected when the file would exceed 64 KiB. Use `replace` with a shorter snapshot.

### `search_memorize`

Reads or searches `.memorize/MEMORY.md`.

```json
{
  "query": "Markdown",
  "limit": 3
}
```

- Without `query`, it returns the complete session memory for agent context.
- With `query`, it searches case-insensitively within `##` sections and returns up to three sections by default.
- When no active session or match exists, it returns an explanatory message instead of an error.
