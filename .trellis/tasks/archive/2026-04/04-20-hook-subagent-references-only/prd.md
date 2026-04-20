# Hook-based Subagent References Only

## Goal
Replace hook-based subagent context expansion so JSONL entries are injected as ordered references instead of full file contents, while `prd.md` and `info.md` remain fully injected.

## Requirements
- Introduce a cleaner context-block model for OpenCode subagent injection instead of direct string assembly.
- Delete the old JSONL full-content expansion path in the OpenCode implementation.
- Keep `prd.md` and `info.md` as full document blocks.
- Render `implement.jsonl` and `check.jsonl` entries as reference lists using `path + reason` only.
- Treat both source files and spec files uniformly as references.
- Treat directory entries as directory references only; do not enumerate or inline child files.
- Preserve JSONL order and dedupe repeated paths by first occurrence.
- When `reason` is missing, render only the path.
- Update subagent prompts so they explicitly state that referenced files are not preloaded and must be read on demand.
- Apply the same behavior to the shared Python hook implementation used by hook-based platforms.
- Update workflow and inline comments so docs match the new injection model.

## Non-Goals
- Do not change pull-based platforms that already load context themselves.
- Do not summarize or excerpt referenced files automatically.
- Do not preserve backward-compatible helpers for JSONL full-content expansion.

## Acceptance Criteria
- [ ] OpenCode subagent injection uses explicit context blocks with full-document and reference-list variants.
- [ ] Shared Python hook injects JSONL entries as references only.
- [ ] Injected prompts still include full `prd.md` and optional `info.md` content.
- [ ] Injected prompts no longer claim that all dev specs are already inlined.
- [ ] Regression tests cover shared hook behavior and prove referenced file bodies are absent.
- [ ] OpenCode tests cover the new reference rendering behavior.
- [ ] Relevant docs/comments describe references-only injection for JSONL context.

## Technical Notes
- Keep the OpenCode context block model in a dedicated module instead of expanding `trellis-context.js` responsibilities.
- Remove the old `readJsonlWithFiles` / `buildContextFromEntries` style full-content pipeline rather than keeping unused compatibility code.
