---
name: sylo-subagents
description: Orchestrator-only. How to decide whether a turn needs subagents, and how to run them when it does. Most turns you handle yourself; delegate multi-step or multi-file work to scout/planner/worker/reviewer via the subagent tool. Never hand-write an implementation plan — that is the planner's job. After a crash or “continue”, resume the work rather than re-planning in the parent.
metadata:
  sylo:
    parentOnly: true
---

# Sylo subagent orchestration

You are the **orchestrator**. Child subagents do not receive this skill.

## Decide first — most turns are yours

**Delegation is your call, and the default answer is no.** A subagent costs a subprocess, a
cold context, and often minutes of wall time. Spending that on a question or a one-file edit
gives the operator a slower, worse answer, not a safer one — and it buries a simple reply
under machinery they have to expand and read.

Handle it yourself, this turn, when the request is:

- a question about the code, the repo, or what you just did,
- reading, searching, explaining, or summarizing,
- a small or single-file change, a quick fix, a rename, a config edit,
- running a command or a test and reporting what happened,
- a follow-up, correction, or clarification of work already in this chat.

**Delegate** when the work is genuinely bigger than a turn — see [When to delegate](#when-to-delegate).
The operator can also force it with `@mentions`, and that choice is theirs, not yours to second-guess.

### The one thing you never do yourself

Do not hand-write a multi-section implementation plan, here or in the thinking channel. If you
catch yourself drafting one, that is the signal the work needs `planner` — not that you should
keep drafting. The parent that plans in its own head burns the turn and writes no answer,
which is the failure `planner` exists to prevent.

When a plan is warranted: call `subagent` with agent `planner` unless
`.sylo/plans/<this conversation id>.md` already exists and still fits, then walk it
**section by section** (below) rather than implementing in the parent. Other files in
`.sylo/plans/` belong to other chats — never follow them.

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

A turn *without* mentions is yours to judge — that is what the rest of this skill is about.

## When to delegate

Use `subagent` when:

- The operator wants a **plan** — that is always `planner`, never you.
- The change spans **several files or several steps**, enough that working it in one turn would
  crowd out the answer.
- The task needs exploration or implementation in an **isolated context** (scout, worker, reviewer)
  — typically because it would otherwise flood this chat's context.
- Work splits into **independent** parallel tracks (different dirs or concerns).
- A **chain** helps: scout → planner → worker, or implement → review.
- The previous turn crashed or returned no text on work that was already being delegated.

Do **not** delegate:

- anything in the "handle it yourself" list above,
- a lookup, edit, or command you could finish before a child even loads,
- work you have already done — do not spawn a `reviewer` to bless your own small edit,
- a resumed turn purely *because* it was resumed. Resume the actual work; if that work was
  small, finish it yourself.

When it is borderline, ask whether the operator would rather wait minutes for a subprocess than
read your answer now. Usually they would not.

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
| reviewer | Code review that closes a goal, or the whole plan | What changed and what to check |

## Working a plan: one stack per section

The plan file is a list of `##` goals. Each goal gets **its own run of agents, start to
finish**, before you move to the next one — the planner writes each section with its own
scout/worker/reviewer steps and its own `### Done when`, so work the sections one at a
time in file order:

```
chain: [
  { agent: "scout",    task: "…recon for this section…",   goal: "Finalize gun models and first-person presentation" },
  { agent: "worker",   task: "Implement {previous}",       goal: "Finalize gun models and first-person presentation" },
  { agent: "reviewer", task: "Review against Done when…",  goal: "Finalize gun models and first-person presentation" },
]
```

Pass `goal` on every step with the exact heading text (no `## [ ]` marker). Skip the
`scout` step when the section already names the files and the change.

When that section's reviewer passes, the goal is closed and you start the next section's
stack. Keep going until every section is `## [x]` — stopping after the first section is
the common failure, and it leaves the operator with a half-built plan. Never batch the
building and leave the reviews for the end: a review that is handed several unfinished
sections has to fail them, so nothing ever closes. Use parallel `tasks` only for sections
that touch different files.

### Who marks a goal, and what the marks mean

**You never edit the plan file, and neither do the agents.** Sylo owns the heading marks:

| Mark | Meaning | Set by |
|------|---------|--------|
| `## [ ]` | Not started | the planner |
| `## [~]` | Built, waiting on a review | a `worker` finishing that section |
| `## [x]` | Passed review — closed | a `reviewer` replying `VERDICT: PASS` |

So the operator sees progress the moment a section is built, but nothing counts as done
until it is reviewed — the agent that wrote the code cannot certify it. A plan is only
`status: reviewed` once every section has passed.

A `FAIL` sends that section back to `## [ ]`. Hand it straight to a `worker` with the
reviewer's findings and review it again — the same goal, a fresh reviewer. Do not move to
the next section with a failed one behind you, and never re-dispatch a `## [x]` section.

**Always pass `goal`.** When you omit it Sylo has to guess which section the run was
about, and it guesses by the protocol above: a `worker` was building the first `## [ ]`,
a `reviewer` was judging the first `## [~]`. That is usually right and it keeps progress
moving, but if you worked out of order it will mark the wrong section. A `goal` string
that matches no heading is treated the same way as none at all, so copy the heading text
exactly rather than inventing your own section names.

Sylo does not delete the plan once every section has passed — it marks it
`status: reviewed` so the operator still sees the completed goals above the composer.
Only a reviewer's sign-off does that: a plan whose boxes were all built but never
reviewed stays open, and stays on the operator's bar.
The next message in that chat takes it off the bar (`hidden: true`) but leaves the file,
so nothing is lost to a crash, an End, or a restart: when the operator asks to continue
or to see the plan again, Sylo un-hides it and tells you where it stood. Report what the
plan scope note says stands open — never re-run a section that is already `## [x]`.

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

Once you have decided a turn warrants delegation — not before:

1. **Clarify** only if the objective is actually missing.
2. **Pick** which child runs — do not write the implementation plan.
3. **Dispatch** with a context packet.
4. **Report** the child output. Do not redo the child's work.

A turn you handle yourself skips all of this. Answer, and say what you did.

Child output is summarized back to you; the operator sees live detail in the **inline subagent block** under each `subagent` tool row in chat.
