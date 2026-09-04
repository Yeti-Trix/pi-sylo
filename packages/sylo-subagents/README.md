# @sylo/sylo-subagents

First-party Sylo Pi package: subagent delegation ported from [Pi's official subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent).

- **`subagent` tool** — single, parallel, and chain modes
- **Bundled agents** — scout, planner, worker, reviewer
- **Sylo host events** — `sylo_subagent` IPC for Tasks panel (Phase 2 UI)

Sylo loads this extension from the repo via broker `additionalExtensionPaths` (built-in, not marketplace `pi-subagents`).
