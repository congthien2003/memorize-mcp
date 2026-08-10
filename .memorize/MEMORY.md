# Session Memory

- Session ID: 1ade647d-a585-4a9d-97a5-e891610a0ebe
- Started: 2026-08-10T01:45:19.240Z
- Goal: Document memorize-mcp v2.0.0
---

## Snapshot — 2026-08-10T01:45:19.242Z

## Version 2.0.0

- Replaced the multi-file JSON memory store with one workspace-local Markdown file: `.memorize/MEMORY.md`.
- Session memory is capped at 64 KiB and uses direct case-insensitive section search.

## Removed

- Removed the `pull_agent_file` MCP tool and its AGENT.md copy implementation.
- Removed JSON index, tags, decisions, history, legacy migrations, and Supabase dependency.

## Added

- Added `start_session` to reset the active session.
- Added `save_memorize` modes: `append` for updates and `replace` for concise snapshots.
- Updated `search_memorize`: no query returns the full current memory; a query returns matching Markdown sections.
- Added a one-prompt Codex setup guide in README.
