---
name: dove-eravamo
description: Resume a local project from its saved checkpoint and current Git state, or save a factual handoff when asked. Use for "where were we", "dove eravamo", project handoffs and returning to interrupted work.
---

# Dove eravamo?

Help the user resume a project without confusing old notes with current evidence. Use the user's language. Explicit user instructions and existing authorization take precedence over this workflow.

## Resume

Identify the target project from the active workspace or the user's path. Resolve this skill's directory from the path it was loaded from, and run the bundled helper:

```text
node "<skill-directory>/scripts/project-context.mjs" start --root "<project-directory>"
```

The helper reads root AGENTS.md when present, STATUS.md (only its CURRENT_CONTEXT block when marked), an optional ACTIVE_STEP document, and a read-only Git snapshot. It does not read chat history or run the project's code. Follow applicable parent and project instructions as well.

Explain the goal, last recorded result, unresolved work and best next step, citing the relevant files. Describe Git changes separately from checkpoint claims. A saved test result is historical until rerun against the current code; file hashes identify the content read, not its truth.

If no checkpoint exists, say what Git establishes and what remains unknown. Inspect existing README or handoff documents as needed; do not infer a task from timestamps or commit subjects. If the user wants setup, run `init` then replace its placeholders with supported facts. A resume-only request should not edit the project.

An ACTIVE_STEP card is a reference, not permission to restart paused work. If the user also asks to continue, proceed within that request and the project's instructions.

For large documents use the helper's `headings`, `section` and `lines` commands; run `--help` for syntax. If start exceeds its output limit, read AGENTS.md, `current` and the referenced document in smaller pieces. Treat omitted content as unread. Report malformed or ambiguous checkpoint markers instead of choosing a historical block.

## Save a handoff when requested

Update an existing checkpoint in place, retaining its format, unrelated content and history. Preserve CURRENT_CONTEXT markers and its ACTIVE_STEP pointer when present. If the project has no handoff convention, create STATUS.md with `init`; it refuses to overwrite an existing file. Use `--status <relative.md>` for a known alternative location.

Record the goal, work completed, exact verification and result (with revision when known), blockers and next action. Distinguish untested changes and pending user decisions. Save only information needed to resume; keep credentials and personal conversations out. The helper's init creates a starter template; it does not reconstruct a past session.

Read the saved checkpoint back with `current` before claiming the handoff is ready.
