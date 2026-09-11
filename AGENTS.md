# AGENTS.md — contributing to Sylo

This repo is the public distribution of **Sylo**, a local-first desktop app that hosts
**[Pi](https://pi.dev/)**. If you are an AI agent (or a human) asked to make changes here,
this file tells you how to run, test, and submit work.

## Running Sylo

| Script | What it does |
| --- | --- |
| `build-sylo.cmd` (Windows) | Production compile: `npm install` → `bootstrap-pi` + skill-surface sync → `electron-vite build` → refreshes the Start Menu shortcut, then exits. Run after `git pull` or any source/skill/dependency change; the shortcut picks up the new build on next launch. |
| `install-shortcut.cmd` (Windows) | Creates/refreshes the Sylo Start Menu shortcut without rebuilding. Pass `-Uninstall` to remove it. Only needed if the shortcut is missing or the repo moved. |
| `full-build-run-sylo.cmd` (Windows) | Full first-run/build flow with a visible terminal: `npm install` → `bootstrap-pi` + skill-surface sync → launches the app in the foreground, pausing on error. Use for the first run, after `git pull`, or whenever dependencies/skill surfaces change. |
| `run-sylo.cmd` (Windows) | Quick launch — just the Electron window, no terminal, no rebuild. Skips install/prepare, so run `full-build-run-sylo.cmd` first after pulling changes. Use for a quiet launch (e.g. Startup folder). |
| `npm start` | Cross-platform equivalent of the start flow. |
| `npm run dev` | Dev mode (renderer + main hot reload) on any OS. |

Day-to-day use is the Start Menu shortcut (compiled build, no dev server). Use
`full-build-run-sylo.cmd` / `npm run dev` when you are actively editing Sylo and want
hot reload. Only one Sylo instance can run at a time; launching again focuses the
existing window.

Crashes and unhandled errors are appended to `%APPDATA%\@sylo\host\logs\crash.log`
(rotated at 2 MB). Include it in bug reports — the `logs\sylo-dev*.log` files in the
repo are truncated on every launch.

Note: `full-build-run-sylo.cmd` kills leftover Electron processes from this repo before launching.
If `npm install` fails with EPERM/EBUSY around `better-sqlite3`, close any running Sylo
window and run it again.

## Repo layout

- `apps/host/` — the Electron app (main process, renderer, companion server)
- `packages/sylo-*` — capability packages: skills, extensions, tools (TTS, tasks, web access, spreadsheets, workflows, …)
- `docs/` — user-facing docs (`GETTING_STARTED.md`, `COMPANION_PHONE_INSTALL.md`)
- `scripts/` — bootstrap, sync, and verify helpers

## Making changes

- Skills live under `packages/skills/` with a sidebar UI when applicable; extensions are
  TypeScript tools under `packages/`. Follow the patterns of an existing sibling package.
- After editing skills without restarting, re-run `npm run prepare:dev` (or `sync-skill-surfaces`)
  so test fixtures and the broker pick up changes.
- Keep changes local-first: no new network services, no telemetry, no hardcoded user paths,
  credentials, or personal data. The repo is public — sweep your diff for anything private
  before committing.

## Submitting changes upstream

Sylo is maintained by [@Yeti-Trix](https://github.com/Yeti-Trix). Community fixes and
improvements are welcome and get reviewed before they land in a release:

1. **Fork** this repo (`Yeti-Trix/pi-sylo`) and create a branch for your change.
2. Make the change and verify it with `full-build-run-sylo.cmd` (or `npm run dev`) — confirm the
   app builds and the affected feature works.
3. **Open a Pull Request** against `Yeti-Trix/pi-sylo` with:
   - what the change does and why,
   - how you tested it,
   - which package(s)/area it touches.
4. **Bug reports:** open a GitHub Issue with steps to reproduce, expected vs actual
   behavior, and your OS + Node version. Logs from `full-build-run-sylo.cmd` are helpful.

The maintainer reviews PRs and folds accepted changes into the next Sylo release. Larger
features should start as an Issue for discussion first.
## Work coordination — check the issue board FIRST

Before starting ANY feature, fix, or refactor in this repo (any tool, any session):
**check open issues/PRs and claim an issue first** — no unclaimed, untracked work.
This prevents agent sessions from colliding in the same files. Full process:
[docs/WORKFLOW.md](docs/WORKFLOW.md).
