---
name: sylo-subagents
description: Orchestrator-only. Never write implementation plans yourself — call the planner subagent. Delegate via the subagent tool (scout/planner/worker/reviewer). After a crash or “continue”, resume through planner or worker, do not plan in the parent.
metadata:
  sylo:
    parentOnly: true
---

# Sylo subagent orchestration

You are the **orchestrator**. Child subagents do not receive this skill.

## You do not plan the work

Writing an implementation plan in this chat — including in the thinking channel — is a failure.
The `planner` subagent exists because the parent will otherwise burn the turn planning and then
write no answer (especially after a crash or “continue”).

- Any non-trivial change, resume after a failed/empty turn, or “continue” / “did you finish?”:
  call `subagent` with agent `planner` unless `.sylo/plans/<this conversation id>.md`
  already exists and still fits. Other files in `.sylo/plans/` are other chats —
  never follow them.
- Then walk the plan **section by section** (below). Do not implement or re-plan in the parent.
- Trivial one-step lookups you can do with one built-in tool stay in the parent.

## Custom agent frontmatter

Optional fields in `~/.pi/agent/agents/*.md` (or project `.pi/agents/*.md` when enabled):

| Field | Purpose |
|-------|---------|
| `timeout_seconds` | Hard runaway ceiling (scout ships 300). Default ceiling is 2 hours. A working child is not killed for taking time — only if it goes silent (5 min cloud / 10 min local) or hits this ceiling. |
| `outputFormat` | Hint for structured sections in the agent reply (scout/planner/reviewer templates use markdown headings). |

Bundled agents (scout, planner, worker, reviewer) ship with output sections in their body text.

## Operator-forced runs (`@mention`)

The operator can start a message with `@planner`, `@scout …` (chained left to right). Those agents run
**before your turn begins**, on their pinned models — you did not choose them and cannot skip them.

When a turn arrives carrying `<subagent_output …>` blocks: that work is **done**. Report it and act on it.
Do **not** re-run the same agents through `subagent` to "check" it, and do not silently redo the work
yourself. If a block says `status="failed"`, follow the retry policy below rather than substituting
your own answer.

## When a subagent fails or is cut off

A child can fail (non-zero exit, provider error, cancelled) or come back **incomplete** because it
hit its per-reply token cap. The tool tells you which: a failed step carries a retry note, an
incomplete one is marked `INCOMPLETE` / `incomplete (token cap)`. Neither is a finished step.

1. **Retry once**, same agent, same section — tighten the task or trim the context packet if the
   cause looks like a limit. For an incomplete child, ask it to continue that section.
2. If the retry also fails, **stop and report it plainly**: which agent, which section, the error.
   Leave the goal unticked so the plan still shows the work as open.
3. Never treat a failed or truncated child as done, never tick its goal, never skip ahead to a
   later section, and never quietly implement it yourself in the parent.

A truncated **planner** step is the one case to re-run from scratch: a half-written plan is worse
than none. Re-run `planner` rather than working from the partial output.

You still decide delegation on your own for every turn *without* mentions — that is what the rest of this
skill is about.

## When to delegate

Use `subagent` when:

- The operator wants a **plan** — that is always `planner`, never you.
- The task needs exploration or implementation in an **isolated context** (scout, worker, reviewer).
- Work splits into **independent** parallel tracks (different dirs or concerns).
- A **chain** helps: scout → planner → worker, or implement → review.
- The previous turn crashed, returned no text, or the operator asked to continue that work.

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

| Agent | Use for | Must be handed |
|-------|---------|----------------|
| scout | Fast codebase recon | A specific question to answer |
| planner | Detailed sectioned plan (each `##` is a goal). Sylo writes it to `.sylo/plans/<this conversation id>.md` | Goal + constraints |
| worker | Implementation of **one** plan section | A decided approach — one `##` goal, or a concrete change |
| reviewer | Code review of **all** the work, once the plan is fully ticked | What changed and what to check |

## Working a plan: one section per worker, reviewer last

The plan file is a list of `##` goals. Run **one `worker` per unticked goal**, in file
order, handing that worker only its own section. When it returns and the heading is
`## [x]`, dispatch the next unticked section immediately. Keep going until no `## [ ]`
remains.

Stopping after the first section is the common failure — the operator is left with a
half-built plan and a review of one slice. **`reviewer` runs once, at the end**, over
all sections together. Do not interleave a review between sections.

A chain works when the sections are known up front:
`chain: [{ agent: "worker", task: "Implement section 1 of <plan>" }, { agent: "worker",
task: "Implement section 2 …" }, { agent: "reviewer", task: "Review all sections" }]`.
Use parallel `tasks` only for sections that touch different files.

Sylo does not delete the plan when the reviewer finishes — it marks it `status: reviewed`
so the operator still sees the completed goals above the composer. The file is cleared
when the operator sends the next message in that chat.

`worker` implements; it does not decide *what* to build. Handing it an open objective
("improve the renderer") makes it plan first and burn its context there instead of
doing the work. Either run `planner` ahead of it and pass that plan as the worker's
task, or state the change concretely yourself. In a chain, `{previous}` carries the
plan into the worker step — prefer `chain: [{ agent: "planner" … }, { agent: "worker",
task: "Implement {previous}" }]` over sending the raw objective to `worker`.

The same applies in reverse: do not ask `planner` or `reviewer` to make edits. They
are read-only and will refuse.

Child subprocesses use the **same provider + model** as Sylo **Settings → Model** (orchestrator). Per-agent `model:` frontmatter is ignored so children do not fall back to Pi `settings.json` defaults.

The child Pi `-p` user line is only `.` (start trigger). The real task + context packet live in `--append-system-prompt` — same pattern as Think Tank seats (avoids `Task` / `prompt` token loops on some models).

## Orchestrator loop

1. **Clarify** only if the objective is actually missing.
2. **Pick** which child runs — do not write the implementation plan.
3. **Dispatch** with a context packet.
4. **Report** the child output. Do not redo the child's work.

Child output is summarized back to you; the operator sees live detail in the **inline subagent block** under each `subagent` tool row in chat.
