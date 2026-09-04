---
name: sylo-coder
description: Coding-quality workflow. When editing an existing file, ALWAYS use smart_edit instead of Pi edit — it is whitespace/indent-tolerant and refuses cleanly on ambiguity instead of patching the wrong spot. Plan before editing, verify after editing, and use the researcher→planner→implementer→reviewer subagent chain for multi-phase refactors. Enable when writing or refactoring code.
metadata:
  sylo:
    category: coding
    icon: code
---

# Sylo-coder workflow

A coding-tuned protocol for the Pi agent loop. Two parts: an **edit discipline** (use `smart_edit`, not `edit`) and a **multi-phase chain** for non-trivial refactors (delegate to `sylo-subagents`).

## Part 1 — Edit discipline

### `smart_edit` is the default for editing existing files

**Rule: for any targeted edit to an existing file, use `smart_edit` — not Pi `edit`.** Reserve `write` for new files and whole-file rewrites (>60% of lines). `smart_edit` is a fuzzy/whitespace-tolerant replacement for Pi's exact-match `edit`; it exact-matches first, so it is a strict superset of `edit` for existing files — including the same `edits: [{ oldText, newText }, ...]` array for multiple disjoint edits in one call. It applies when the file has been reformatted or your indentation recall is imperfect. Failure modes are **designed to self-correct**:

| `smart_edit` result | What you do |
|---------------------|-------------|
| Applied (exact or normalized match) | Proceed. |
| **Ambiguous** — returns candidate line ranges | Each candidate is annotated with its **enclosing named scope** (e.g. `function bar`, line 83). Include that scope's header line in `oldText` and retry — usually no separate `read` needed. Only re-`read` if the enclosing scopes are identical or absent. |
| **No match** — returns the closest region it found | `read` that region, retry with the exact current text. |

Rules:
- **For new files:** use `write`, not `smart_edit`.
- **For whole-file rewrites** (>60% of lines changing): use `write`.
- **For targeted edits inside an existing file:** use `smart_edit`.
- **Multiple disjoint edits in one file:** pass them as `edits: [{ oldText, newText }, ...]` in a single `smart_edit` call. Each `oldText` is matched against the **original** file (not incrementally), and edits must not overlap — merge nearby changes into one entry instead. If any one edit is ambiguous or missing, the whole call refuses and leaves the file untouched (all-or-nothing), naming the offending edit index.
- **Never blind-apply.** If `smart_edit` refuses, that refusal is correct — the alternative is patching the wrong spot. A refusal now surfaces as a red tool-error pill in the chat (not a silent green "ok"), so both you and the operator can tell it did not apply. Re-read and narrow your `oldText`.

### Plan before you edit

1. **Read first.** Before editing a file, read the relevant region (or the whole file if small). Do not edit from memory.
2. **State the change in one sentence** before emitting the tool call. What, why, where.
3. **Smallest sufficient `oldText`.** Include enough context to be unique, no more. A few lines usually beats a whole function.
4. **Batch disjoint edits in one call.** When several independent regions in the same file change together, send them as one `smart_edit` call with `edits[]` rather than N serial calls. Each `oldText` matches the original file; keep entries non-overlapping.

### Verify after you edit

- After a `smart_edit` that touches logic, **read the changed region back** (the tool returns a preview — read it).
- If the project has a typecheck/lint/test command, **run it** with `bash` before declaring done. A passing edit is not done; a verified edit is done.
- If verification fails, fix with another `smart_edit` — do not hand-write a whole-file `write` unless the file is genuinely broken.

## Part 2 — Multi-phase refactors (subagent chain)

For work that spans multiple files, has a clear research phase, or risks regression — do not freehand it. Spawn a `sylo-subagents` **chain**:

```
researcher  →  planner  →  implementer  →  reviewer
```

- **researcher** — maps the current code: where the relevant logic lives, what depends on it, what tests exist. Output: a brief the next seat can act on without re-reading everything.
- **planner** — turns the brief into an ordered, minimal edit plan (which files, which `smart_edit` calls, what order). Reject scope that is not needed.
- **implementer** — executes the plan using `smart_edit` + `bash` (typecheck/test). Stops and reports if a step fails.
- **reviewer** — reads the diff (git diff or the changed regions), checks for regressions, missed call sites, and verification gaps. Reports pass/fail with specifics.

Use the chain when:
- The change touches 3+ files or 1 file with >3 distinct logical edits.
- You are unsure of the blast radius (call sites, dependents).
- The operator said "refactor", "rewrite", or named a subsystem.

Do **not** use the chain for a one-line fix or a single-function tweak — that is Part 1.

## What this skill does NOT do

- No tab autocomplete, inline edit, or `@`-mention retrieval UI (host-renderer work, out of scope).
- No codebase semantic search yet (Phase 2 — `semantic_search` tool, planned). Until then, use `grep`/`find`/`read` for discovery.
- No model routing. Coding quality is downstream of the model + this loop.