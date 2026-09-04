---
name: sylo-subagents
description: When and how to delegate work to subagents via the subagent tool (orchestrator-only)
metadata:
  sylo:
    parentOnly: true
---

# Sylo subagent orchestration

You are the **orchestrator**. Child subagents do not receive this skill.

## Custom agent frontmatter

Optional fields in `~/.pi/agent/agents/*.md` (or project `.pi/agents/*.md` when enabled):

| Field | Purpose |
|-------|---------|
| `timeout_seconds` | Suggested wall-clock limit (default 600 s in the extension). Document for recon agents (e.g. 300). Enforcement follows extension defaults until per-agent overrides land. |
| `outputFormat` | Hint for structured sections in the agent reply (scout/planner/reviewer templates use markdown headings). |

Bundled agents (scout, planner, worker, reviewer) ship with output sections in their body text.

## When to delegate

Use `subagent` when:

- The task needs exploration or implementation in an **isolated context** (scout, worker, reviewer).
- Work splits into **independent** parallel tracks (different dirs or concerns).
- A **chain** helps: scout → planner → worker, or implement → review.

Do **not** delegate trivial one-step lookups you can do with one tool call.

## Context packet (required discipline)

Pass a **`context`** string with curated facts — never paste the full parent chat.

Include: goal, relevant paths, constraints, and excerpts the child needs.

## Agent scope (default: user)

Omit **`agentScope`** on most calls — children use bundled + `~/.pi/agent/agents/` personas only.

| When | `agentScope` |
|------|----------------|
| Normal delegation (default) | omit or `"user"` |
| Operator enabled **Settings → Subagents → Allow project agents** for a trusted repo | `"both"` only when you need `.pi/agents/*.md` in the workspace |

Do **not** pass `agentScope: "both"` unless project-local agents are required. Sylo Settings can also set the default scope for omitted calls.

## Subagent runs (operator UI)

Runs appear **inline in chat** under each `subagent` tool row (expand the block). The chat header shows a running count when children are live.

- **Stop run** / **Stop all** kills the child subprocess and marks the row **cancelled**.
- **Copy subagent JSON** copies a spec to the clipboard — it does **not** spawn a new run. A new run appears only when **you** call `subagent` again (paste JSON or ask the orchestrator to re-run).
- Stale **running** rows after a Sylo restart become **orphaned**; use **Clear orphaned** under **Settings → Subagents → Diagnostics**.

| Mode | Tool shape |
|------|------------|
| Single | `{ agent, task, context? }` |
| Parallel | `{ tasks: [{ agent, task }], context? }` |
| Chain | `{ chain: [{ agent, task }], context? }` — use `{previous}` in later steps |

## Builtin agents

| Agent | Use for |
|-------|---------|
| scout | Fast codebase recon |
| planner | Implementation plan (read-only) |
| worker | Implementation |
| reviewer | Code review |

Child subprocesses use the **same provider + model** as Sylo **Settings → Model** (orchestrator). Per-agent `model:` frontmatter is ignored so children do not fall back to Pi `settings.json` defaults.

The child Pi `-p` user line is only `.` (start trigger). The real task + context packet live in `--append-system-prompt` — same pattern as Think Tank seats (avoids `Task` / `prompt` token loops on some models).

## Orchestrator loop

1. **Clarify** objective and success criteria.
2. **Plan** which agents and mode.
3. **Dispatch** with context packet.
4. **Verify** output before telling the operator you're done.

Child output is summarized back to you; the operator sees live detail in the **inline subagent block** under each `subagent` tool row in chat.
