# @sylo/sylo-coder

Coding-quality package for Pi/Sylo. Closes the loop gap between Sylo (Pi + a coding model) and tuned coding agents like Cursor + Composer, by shipping the three things that actually matter inside the agent loop — minus the diff-review UI (operator is a vibe coder; git checkpoint is the rollback path).

## What's in it

| Component | Status | What it does |
|-----------|--------|--------------|
| `smart_edit` tool | **Phase 1.6 — live** | Fuzzy/whitespace-tolerant edit of an existing file. Exact-match first; normalized (whitespace-collapsed, case-insensitive) fallback that splices the real bytes. **Multi-block `edits[]`** — N disjoint edits in one call, each matched against the original file, all-or-nothing. Returns candidate line ranges on ambiguity, closest region on no match. Never blind-applies. A `tool_result` handler flips the chat pill to red on every refusal so a refusal is never mistaken for a success. |
| `sylo-coder` skill | **Phase 1.6 — live** | Plan-before-edit, prefer-`smart_edit` (single-pair or `edits[]`), verify-after-edit discipline, plus a researcher→planner→implementer→reviewer subagent chain for multi-file refactors. |
| `semantic_search` + indexer | Phase 2 — planned | Local Ollama embeddings, SQLite store, gitignore-aware incremental index, `semantic_search(query)` tool. |
| Subagent chain | Phase 3 — planned | Chain wrapper documented in the skill today; extension wiring in Phase 3. |

See `features_tracker/active/2026-07-21_14-30-00_sylo_coder_package.md` for the full plan.

## Validate

A deterministic test framework lives under `packages/sylo-coder/test/` — no broker, no model, runs via `tsx`:

```bash
npx tsx packages/sylo-coder/test/run.ts
```

Two layers (plus a multi-block suite):
- **Matching scenarios** (`test/scenarios.ts`) — 18 data-driven cases covering exact apply, exact ambiguous, normalized apply (indent/CRLF/trailing-whitespace drift), normalized ambiguous, no-match near-miss hint, zero-overlap no-hint, partial-line edits, file boundaries, adjacent-block boundary safety, enclosing-scope annotation on ambiguous candidates, and a real-repo rename refactor. Append a `Scenario` object to add coverage.
- **Multi-block scenarios** (`test/scenarios.ts` → `MULTI_SCENARIOS`) — 6 cases for `smartEditMany`: two/three disjoint exact edits, mixed exact+normalized, second-edit-ambiguous refusal (file untouched), second-edit-no-match refusal, and overlapping-edit refusal.
- **Tool-execute integration** (`test/tool-execute.ts`) — drives the real registered `smart_edit` tool via a fake `ExtensionAPI` + mock `ctx`, validating path resolution, `edits[]` multi-block apply, single-pair shorthand backward-compat, refusal-result formatting, and the deterministic `tool_result` refusal-visibility gate (17 checks).

**40 deterministic checks, no broker, no model.**

Phase 1.5 (AST) and Phase 2 (`semantic_search`) add their own scenario files and reuse this harness.

## Enable

1. Run `npm run bootstrap-pi` (copies the skill to `~/.pi/agent/skills/sylo-coder/`).
2. **Capability manager → Sylo optional packages → Coder → On.**
3. **Restart broker.**

No Python deps in Phase 1. Phase 2 (indexer) will add a `requirements.txt`.

## `smart_edit` — why it exists

Pi's built-in `edit` uses exact text match. It fails on trailing whitespace, tab-vs-space drift, and reformatted files — then the agent re-reads and retries, burning turns. `smart_edit` matches a normalized version of the file and splices the original bytes, so whitespace/indent drift no longer blocks the edit. On ambiguity (multiple matches) it refuses and surfaces candidates; on no match it surfaces the closest region so the agent can `read` and retry with exact text. Failure is loud and recoverable, never silent. When candidates are ambiguous, each one is annotated with its enclosing function/class/def (and the normalized line range), so the agent can pick the right block by its surrounding scope without re-reading the whole file — include that enclosing header in `oldText` to make the match unique.

### Tool signature

```
# multiple disjoint edits in one call (preferred for multi-spot refactors):
smart_edit(path, edits: [{ oldText, newText }, ...], allow_fuzzy=true)

# single-edit shorthand (backward compatible):
smart_edit(path, oldText, newText, allow_fuzzy=true)
```

- `path` — file to edit (resolved against the session cwd).
- `edits` — array of `{ oldText, newText }`. Each `oldText` is matched against the **original** file (not incrementally); entries must not overlap. If any one is ambiguous or missing, the whole call refuses and the file is left untouched, naming the offending `edits[i]`.
- `oldText` / `newText` — single-edit shorthand. Use `edits[]` for multiple disjoint edits. If both are given, `edits[]` wins.
- `allow_fuzzy` — allow normalized matching when exact match fails (default `true`).

### When to use which

| Situation | Tool |
|------------|------|
| New file | `write` |
| Whole-file rewrite (>60% of lines) | `write` |
| One targeted edit in an existing file | `smart_edit` (single-pair shorthand) |
| Several disjoint edits in one file | `smart_edit` with `edits[]` (one call, not N) |
| You are certain of exact text | `smart_edit` (it does exact-match first anyway) |

## Design notes

- `smart_edit` is **deterministic** — no extra model dependency, runs locally, predictable. Cursor's apply model is a separate LLM that hallucinates diffs; we trade occasional "refuse and re-read" for never guessing wrong.
- **Multi-block `edits[]`** gives `smart_edit` parity with Pi `edit`'s array form, so there is no capability reason to fall back to `edit` on a multi-spot refactor. Each `oldText` matches the original file; all-or-nothing semantics mean a half-applied file is impossible.
- **Refusal visibility** is a deterministic harness gate, not a prompt nudge. Returning `isError: true` from `execute()` is a silent no-op (the agent loop owns that flag), so the extension registers a `pi.on('tool_result', ...)` handler keyed off `details.applied !== true` that flips the chat pill to red on every refusal. The operator sees a refusal instead of a silent green "ok"; the model receives a tool-error signal that prompts a retry.
- AST-aware node matching (TS/JS/Python/ST) is a Phase 1.5 stretch. The normalized match covers the dominant real-world failure (indent drift). The `matchMode` field in the result is the extension point.

## Reference

Pattern borrowed from `packages/sylo-web-access/` and `packages/sylo-pdf-reader/`. Authoring skill: `sylo-optional-package-author`.