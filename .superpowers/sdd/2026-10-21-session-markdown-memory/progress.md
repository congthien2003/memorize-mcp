# SDD ledger — plan: docs/superpowers/plans/2026-10-21-session-markdown-memory.md

Execution: Native, authorized in conversation. Spec approved. No commits or verification commands authorized.

Ruling: Work on feat/session-markdown-memory in the existing checkout — preserve the approved documents and existing user files rather than move them into a worktree — no isolation from concurrent edits in the same checkout.
Ruling: Write regression tests but do not execute TDD/helper verification scripts — explicit user restriction overrides skill commands — runtime/type errors remain unverified until the user runs the supplied commands.
Ruling: Maintain this local ledger directly, without commit-based task scripts — commits and verification are forbidden — progress evidence is source-only.

Pre-flight: 1→2→3 format/files/migration interfaces consistent; mutation helpers called under one workspace lock.
Pre-flight: 3→4 session bootstrap consistent; start returns metadata, tool adapter composes paged summary later.
Pre-flight: 1/2/4→5 summary uses session format, not mutation API; avoids import cycle.
Pre-flight: 1/2→6 retrieval independent of mutation; all exports wired after retrieval exists.
Pre-flight: 4/5/6→7 adapter composes result types; structuredContent plus concise status text.
Pre-flight: 7→8 README follows actual contract, no automatic host configuration.

Task 1: source implemented; format regression tests written, not run.
Task 2: source implemented; filesystem regression tests written, not run.
Task 3: source implemented; migration regression tests written, not run.
Task 4: source implemented; session regression tests written, not run.
Ruling: Reject all symlinks/junctions within memory storage — simpler confinement on Windows than resolving internal links — internally linked memory directories are unsupported.
Task 5: source implemented; summary regression tests written, not run.
Task 6: source implemented; retrieval regression tests written, not run; public exports updated.
Task 7: source implemented; tool contract tests written, not run; stdio logs moved to stderr and startup no longer creates storage.
Task 8: README updated for contracts, proactive workflow, migration and user-run commands. Source read-through performed.

Final independent review: one read-only reviewer, gpt-6-astra, completed. No Critical findings; four Important findings and one Minor finding. No runtime or typecheck evidence.
Final fix pass: stale-lock reclaim race addressed with exclusive recovery guard checked by every acquisition path; controlled two-reclaimer regression written, not run.
Final fix pass: U+FEFF loss addressed by ignoreBOM:true; BOM title recognition separate from preserved legacy bytes; format/retry/migration regressions updated, not run.
Final fix pass: provenance extraction now masks comments, escaped syntax and code spans, requires actual labels, and handles quoted/list fenced code; negative fixtures added, not run.
Final fix pass: import metadata only applies to original first legacy entry; later appended entries expose real timestamp; migration→append→search fixture added, not run.
Final regrade: Unicode snippet offset issue treated as Important correctness for international text rather than polish; original-offset mapping and U+0130 regression added, not run.
Final fix pass: summary parsing accepts an editor's CRLF marker line; malformed Unicode payloads/titles are rejected before encoding can replace characters. Regressions written, not run.

Ruling: Recovery guard with uncertain ownership is never automatically reclaimed — avoid the recursive race of recovering the recovery lock — a crashed guard can require manual inspection/removal before writes resume.
Final: Ruling: TypeScript/Bun/SDK behavior, real Windows concurrency and host proactive capture remain unvalidated — user prohibits all verification commands — runtime/type/integration errors can remain until user-run checks.
Final: Ruling: Power-loss durability and hostile concurrent filesystem mutation remain outside guarantees — approved spec explicitly excludes them — no protection is promised in those environments.

Deferred minors: none; Unicode snippet issue was regraded and addressed in source.
Source implementation delivered for Tasks 1–8. All test/typecheck/manual MCP verification: NOT RUN. No commits or pushes. No actual workspace memory migrated or host configuration changed.
Retain ledger because there is no committed history and user validation remains pending.

## Verification authorized and executed

User subsequently explicitly authorized verification: "Cho phép chạy verify á". This supersedes the earlier prohibition for this verification pass. No source fix was necessary.

- Bun v1.4.0: planned seven test files, 29 pass, 0 fail, 132 expectations; exit 0.
- `bunx tsc --noEmit`: exit 0, no diagnostics.
- Actual MCP SDK client over stdio in an isolated OS temporary workspace: exit 0. Confirmed five tools, no memory creation at startup, start, append, deduplicated retry, read, summary consolidation, search with sources, and resume/read after server process restart. Temporary workspace removed after close; actual repository memory untouched.
- No build script exists; lint is an echo placeholder, so neither adds meaningful verification.
- Real multi-process contention stress, interruption/power-loss behavior and actual host proactive capture were not established by this smoke test. Unit coverage includes controlled concurrent append and stale-lock reclamation interleavings.
- No commits or pushes; branch remains feat/session-markdown-memory.
