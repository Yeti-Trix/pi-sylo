# sylo-tasks

Per-workspace task lists shared by the agent and the operator. Part of the Sylo live-Canvas + tasks feature (see `features_tracker/active/2026-07-25_12-11-42_live_canvas_sylo_tasks.md`).

## What it does (Phase 1)

Agent tools to build / read / update task lists that persist per workspace. Storage owns truth; the operator can edit the JSON file directly, and the agent re-reads on its turn (eventual consistency).

- **Store:** `<workspace>/.sylo/tasks.json` (per workspace; `SYLO_PI_CWD`-rooted).
- **Tools:** `sylo_task_create_list`, `sylo_task_add`, `sylo_task_update`, `sylo_task_list`, `sylo_task_get`, `sylo_task_delete`.
- **Model:** lists + flat tasks; statuses `todo` / `in_progress` / `done` / `blocked` / `skipped`; `blocked_by`/`blocks` dependency edges kept in sync; `notes` (markdown), `due` (ISO date); per-list mode `agent_driven` | `operator_driven`.
- **Change notification:** every mutation `process.send({type:'sylo-tasks:changed', workspaceKey, listId, snapshot})` to the host main process, which (Phase 2) fans `canvas:live-update` to subscribers.

## Later phases

- **Phase 2:** live task-board Canvas view (host-owned React, bound to a `liveId` per list).
- **Phase 3:** thin sidebar dashboard (package-owned Vite iframe route).
- **Phase 4:** mid-turn operator-edit channel (eventual consistency + force-push via `deliverQueued`).
- **Phase 6:** reminders via `sylo-scheduler` (`schedule_create` referencing a task).
- **Phase 7:** pilots (Ableton roadmap → controls-engineering checklist).

## Enable

Capability manager → Sylo optional packages → **Tasks** → On, then restart the broker. The `tasks` skill loads from `~/.pi/agent/skills/tasks/` (bootstrapped by `scripts/bootstrap-pi.mjs`).