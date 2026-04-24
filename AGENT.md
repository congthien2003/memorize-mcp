# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Mandatory Planning Phase

**No code shall be written without an approved plan.**

- Before implementing any change, you must output a `[PLAN]` block.
- The plan must break the task into small, verifiable steps.
- Each step must include a "Success Criteria" (e.g., "Run `npm test`, check if X log appears").
- Wait for a "Proceed" or "Approved" signal if the plan involves structural changes (DB schema, API contracts, Folder structure).

## 3. Sub-agent & Context Management

**Keep the context window lean. Execute modularly.**

- **Modular Execution:** Treat each major step in the plan as a task for a "Sub-agent". Focus strictly on the files required for that specific step.
- **Context Hygiene:** Do not read files that are not directly relevant to the current sub-task. If using Cursor, use `@` to reference only the specific files/folders needed.
- **State Handoff:** At the end of each sub-task, summarize the changes made and the current state of the system so the next "turn" (or sub-agent) has a clear starting point without re-reading the entire history.
- **Avoid Token Bloat:** Do not output large blocks of existing code. Use partial diffs or focus only on the modified lines.

## 4. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 5. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

For multi-file edits: Stop and ask for confirmation before modifying more than 3 files at once. List the files you intend to touch.

## 6. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
