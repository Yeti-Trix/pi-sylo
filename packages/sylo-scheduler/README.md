# @sylo/sylo-scheduler

Workspace-scoped **scheduled prompts** for Sylo. The host main process fires due schedules (new chat + prompt). This package registers agent tools:

- `schedule_list`
- `schedule_create`
- `schedule_update`
- `schedule_delete`

Loaded as a built-in extension when Sylo starts (like `@sylo/sylo-subagents`). Operator UI: **Schedules** sidebar tab.
