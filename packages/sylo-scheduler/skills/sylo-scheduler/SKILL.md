---
name: sylo-scheduler
description: Create and manage workspace-scoped scheduled prompts that start new chats automatically.
---

# Scheduled prompts

Use when the operator wants recurring or one-shot prompts in the **current workspace**.

## Tools

| Tool | Use |
|------|-----|
| `schedule_list` | List schedules for this workspace |
| `schedule_create` | Add a schedule (once, daily, weekly, monthly) |
| `schedule_update` | Change fields or disable |
| `schedule_delete` | Remove a schedule |

## Rules

- Times are **local timezone** (operator machine).
- Each fire starts a **new chat** with the prompt text.
- `catchup_on_startup` (default true): if Sylo was closed when a run was due, fire **once** on next startup (not once per missed interval).
- `max_runs`: omit for indefinite; set a number to auto-complete.
- Sylo must be **running** for schedules to fire.

## Examples

Create a weekday 9am briefing:

```
schedule_create({
  title: "Morning brief",
  prompt_text: "Summarize open tasks and today's calendar.",
  recurrence: "daily",
  start_at: Date.now(),
  time_local: "09:00"
})
```

One-shot reminder:

```
schedule_create({
  title: "Deploy check",
  prompt_text: "Run the deploy checklist and report blockers.",
  recurrence: "once",
  start_at: new Date("2026-07-04T14:00:00").getTime()
})
```
