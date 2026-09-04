---
name: tasks
description: "Per-workspace task lists shared by agent and operator. Use when the operator asks for a roadmap, a checklist, a learning plan, or a project task list — build it with sylo_task_* tools so it persists in the workspace store, then call sylo_task_open_on_canvas to surface it on the live Canvas board. The board is interactive — the operator can click a checkbox to toggle a task done/todo, edit per-task notes inline, and send you a queued message mid-turn. Re-read with sylo_task_list on your next turn to pick up operator edits."
metadata:
  sylo:
    category: productivity
    icon: check-square
routes:
  - id: tasks
    title: Tasks
    icon: check-square
    nav_section: domain
    entry: routes/tasks/index.html
    fallback: routes/tasks/fallback.md
route_protocol_version: 0
---

# Tasks (sylo-tasks)

Build and maintain per-workspace **task lists** that the agent and operator share. The store owns truth; you read it back with `sylo_task_list` / `sylo_task_get` on your turn, so operator edits land automatically (eventual consistency).

## Current capability (be honest with the operator)

- **Phase 1 (shipped):** lists live in `<workspace>/.sylo/tasks.json` and are read/written via the `sylo_task_*` tools.
- **Phase 2 (shipped):** a live **task-board Canvas view**. Call `sylo_task_open_on_canvas({list_id})` to surface a list on the docked Canvas (and any popped-out canvas window). The board live-updates as you mutate the list.
- **Phase 4 (shipped):** the board is **interactive** — the operator can click a checkbox to toggle a task done/todo, click a note (or "+ add note") to edit per-task notes inline, and use the "Send" box at the bottom to push a queued message to you mid-turn. Operator edits flow renderer → main → broker → store → `sylo-tasks:changed` → the board reconciles (eventual consistency). **Re-read the list with `sylo_task_list` on your next turn** to pick up anything the operator checked off or noted while you were running.
- **Phase 3 (shipped):** a sidebar **Tasks dashboard** under the Dashboards sidebar section — browse all lists in the workspace, edit titles/notes, cycle status, quick-add. Writes hit the same store and fan to a Canvas board if one is open.
- **Phase 6 (shipped):** **due dates + reminders.** `due` renders on the board + dashboard with overdue (red) state. Reminders route through `sylo-scheduler` `schedule_create` — see **Reminders** below.
- **Phase 5 (shipped):** **draw mode** on the Canvas — a Draw toggle switches the canvas to a freehand sketch surface; "Send to agent" exports the sketch as a PNG image attachment the model can see. Useful for concepts the operator can't explain in words.

When you build a list and the operator wants to SEE it, call `sylo_task_open_on_canvas({list_id})`. Until you call that tool, the list is only in the JSON store — do NOT claim it's on the Canvas. Point them at `<workspace>/.sylo/tasks.json` for the raw store. The operator's checkbox/notes edits on the board do NOT need a tool call from you — they write directly to the store; just re-read with `sylo_task_list` when you resume.

## When to use

- The operator asks for a **learning roadmap** ("make me an Ableton learning plan"), a **project checklist** ("set up a controls-engineering task list"), or any multi-step plan that should persist and be checkable.
- You want a list that survives the chat and that the operator can edit (check off, add notes) between your turns.
- A plan has **dependencies** (blocked-by relationships) the operator wants visible.

Do **not** use this for ephemeral bullet lists that belong in the chat reply — use it when the operator wants a *persistent, editable, live* list.

## Tools

| Tool | Use |
|------|-----|
| `sylo_task_create_list` | Create a list. `mode`: `agent_driven` (you own structure; default) or `operator_driven` (operator owns structure). |
| `sylo_task_add` | Add a task. `blocked_by` = task ids that must finish first (reverse `blocks` edges auto-sync). `due` = `YYYY-MM-DD`. `notes` = markdown. `reminder_schedule_id` = store a scheduler reminder id after you call `schedule_create`. **Position:** default = append to end. To insert mid-sequence pass `after_task_id` (insert immediately after that task, same list) or `before_task_id` (insert before it; used only if `after_task_id` is unset/not found). The board + dashboard render in this order, so place a step where it belongs instead of letting it land at the bottom. |
| `sylo_task_update` | Update title / status / notes / due / blocked_by / reminder_schedule_id. Pass `null` for `notes`/`due`/`reminder_schedule_id` to clear. |
| `sylo_task_move` | Reorder an existing task WITHIN its own list. Pass `after_task_id` (move after it) or `before_task_id` (move before it); `after_task_id` wins. Neither / id-not-found → moves to the END. Use this to fix sequencing without deleting and re-adding. Cannot move across lists — use `sylo_task_add` (with `after_task_id`) + `sylo_task_delete` for that. |
| `sylo_task_list` | No args → all lists. With `list_id` → all tasks in that list. **Re-read this on your turn** to pick up operator edits. |
| `sylo_task_get` | One list (with tasks) via `list_id`, or one task via `task_id`. |
| `sylo_task_delete` | Delete a task (`task_id`) or a whole list (`list_id`). |
| `sylo_task_open_on_canvas` | Surface a list on the live Canvas (docked + popout). View-only this phase; live-updates as you mutate the list. Call this **after** building/updating a list when the operator wants to watch it. |

Statuses: `todo` | `in_progress` | `done` | `blocked` | `skipped` (unrecognized coerces to `todo`).

## Workflow

1. `sylo_task_create_list` with a title and the right mode. Tell the operator the list id.
2. `sylo_task_add` for each item. Use `blocked_by` when a step depends on earlier steps (e.g. "Wire sensors" blocked_by "Mount enclosure"). Add `due` dates when the operator wants deadlines. **Position:** by default items append to the end — fine if you add them in order. But if the operator asks you to add a step that belongs earlier in the sequence, pass `after_task_id` (insert after the task that should precede it) or `before_task_id` (insert before the task that should follow it) so it lands in the right spot instead of at the bottom. If you realize later a step is out of order, use `sylo_task_move` to reposition it — no need to delete and re-add.
3. After your turn, the operator may check items off or add notes (Phase 2: on the Canvas board; Phase 3: in the sidebar dashboard; until then by editing the JSON file directly).
4. On your next turn, **call `sylo_task_list` first** to re-read the current state before advising — operator edits are eventually consistent, not pushed into your context.

## Mode guidance

- **agent_driven** (default): you structure the list, stage items, mark progress. The operator checks items off and adds notes. Use for roadmaps you build for the operator.
- **operator_driven**: the operator is actively building the plan; you read and advise but do **not** rewrite the structure. Use when the operator says "I'm making my own list" or is mid-authoring.

## Reminders

Due dates are stored on the task (`due`) and render on the board + dashboard with **overdue** (red) state when the date is past today and the task isn't done/skipped — that part is automatic and needs no scheduler.

An actual **reminder** (a prompt that fires at a time) is a `schedule_create` (sylo-scheduler) entry. It fires into a **new** chat at the scheduled time, out-of-band (not into a running agent). Create one when the operator asks for a reminder, or when a task has a real deadline worth nudging.

**Reminder flow (Phase 6):**

1. Set the task's `due` (`sylo_task_update` with `due: "YYYY-MM-DD"`).
2. Call `schedule_create` with `recurrence: "once"`, `start_at` = the due date at 09:00 local (Unix ms), and a `prompt_text` that references the task + list so the future agent can find it, e.g.:
   > `Reminder: the task "<title>" (list "<list title>", workspace <name>) is due today. Run sylo_task_list to check its status and follow up with the operator.`
3. Store the returned schedule id on the task: `sylo_task_update({ id, reminder_schedule_id: <schedule id> })`. The board/dashboard then shows a ⏰ reminder chip.
4. **Cleanup — always do this to avoid stale reminders:**
   - Clearing a due date → `schedule_delete(reminder_schedule_id)` first, then `sylo_task_update({ id, due: null, reminder_schedule_id: null })`.
   - Marking a task `done` or `skipped` → `schedule_delete(reminder_schedule_id)` (if set), then clear `reminder_schedule_id`.
   - Deleting a task → `schedule_delete(reminder_schedule_id)` first, then `sylo_task_delete`.
   - Deleting a whole list → first delete every task's reminder in that list, then `sylo_task_delete({ list_id })`.

`schedule_delete` on an already-gone id fails harmlessly — safe to call defensively. Reminders are workspace-scoped (the schedule is created in the active workspace), matching the per-workspace task store.

## Storage

The store is a JSON file at `<workspace>/.sylo/tasks.json` (per workspace). The operator can read/edit it directly by absolute path if needed; your tools are the normal interface. Phase 2 binds a live Canvas board to a list; Phase 3 adds a sidebar dashboard.