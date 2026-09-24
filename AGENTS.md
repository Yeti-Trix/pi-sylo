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
| `make-installer.cmd` (Windows) | Builds the distributable installer: `dist\installer\Sylo-Setup-<version>.exe`. Only needed when cutting a release for other people — not for working on Sylo. See "Building the installer" below. |
| `npm start` | Cross-platform equivalent of the start flow. |
| `npm run dev` | Dev mode (renderer + main hot reload) on any OS. |

Day-to-day use is the Start Menu shortcut (compiled build, no dev server). Use
`full-build-run-sylo.cmd` / `npm run dev` when you are actively editing Sylo and want
hot reload. Only one Sylo instance can run at a time; launching again focuses the
existing window.

Crashes and unhandled errors are appended to `%APPDATA%\@sylo\host\logs\crash.log`
(rotated at 2 MB). Include it in bug reports — the `logs\sylo-dev*.log` files in the
repo are truncated on every launch.

Note: `build-sylo.cmd`, `full-build-run-sylo.cmd`, and `run-sylo.cmd` **never force-kill a
running Sylo** — they check first and **refuse to run with `Sylo is already running`** when an
instance from this repo is up. Close the Sylo window, then re-run. If `npm install` fails with
EPERM/EBUSY around `better-sqlite3`, the same fix applies: close the running Sylo first.

## Agents: never restart Sylo yourself — ask the operator

If you are a Pi session hosted by Sylo, a restart kills your own host mid-turn and destroys
your session — this has actually happened. Rules:

- **Never restart, kill, or relaunch Sylo as part of implementing or testing a change** —
  not via `Stop-Process`/`taskkill`, not via the launcher scripts, not via the supervisor.
- Safe verification that does not touch a running app: typecheck, unit tests, and
  `npm run build -w apps/host`.
- When a change needs a relaunch to take effect (main-process/preload code, deps, skill
  surfaces), **tell the operator to relaunch Sylo and stop there**. Verify afterward in the
  fresh session the operator started.
- The only sanctioned automated kill/restart is the operator-triggered sylo-supervisor
  channel (ntfy control topic `restart` / `rebuild`), which snapshots uncommitted work first.

## Building the installer

`make-installer.cmd` (or `npm run dist:win`) produces a single per-user NSIS setup
in `dist\installer`. It installs to `%LOCALAPPDATA%\Programs\Sylo` with no UAC prompt,
and running a newer setup over an existing install upgrades in place.

Copy `Sylo-Setup-<version>.exe` to the machine that should run Sylo and launch it
there. Do not run the setup on the machine that built it unless you want a second
install beside the repo checkout — Cancel is the right button on the build PC.

**Nothing a user has saved is touched by an upgrade or even an uninstall.** All durable
state lives outside the program directory: `%APPDATA%\@sylo\host` (the SQLite database
with every chat and preference, checkpoints, attachments), `%USERPROFILE%\.pi\agent`
(Pi credentials, models, session transcripts, skills), `%USERPROFILE%\.sylo`, and the
workspace folders under `Documents\GitHub`. Keep it that way — if you add persistent
state, put it in one of those, never beside the app.

How the payload is produced, and why:

1. `scripts/stage-package.mjs` builds `dist/stage`, a mirror of the repo layout
   (`apps/host/out`, `apps/host/src`, `packages/`, `scripts/`, and the production
   dependency closure from `npm ls --omit=dev`). The app resolves `SYLO_REPO_ROOT`
   four levels up from `out/main/index.js` and loads Pi extensions as live
   TypeScript, so reproducing the layout is what lets the runtime path code work
   unchanged once installed. Files are hard-linked, not copied.
2. `electron-builder` (see `electron-builder.yml`) wraps that into the setup exe with
   **asar disabled** — the broker child runs under `ELECTRON_RUN_AS_NODE`, which has no
   asar filesystem shim, and it is the process that loads every `.ts` extension.
3. `scripts/verify-installer-payload.mjs` asserts the packaged tree still contains
   every file Sylo ships and the paths the main process resolves at startup. Do not
   add `files` exclusions to `electron-builder.yml` to slim the build: Markdown is
   *content* here (every skill is a `SKILL.md`), and a blanket `!**/*.md` silently
   deleted every skill from an otherwise healthy-looking build.

Installed builds have no `npm run prepare:dev`, so the app installs its bundled skills
into `~/.pi/agent` itself on first launch after an install or upgrade
(`apps/host/src/main/packaged-runtime.ts`). That file also pins the userData directory,
which must stay `@sylo/host` regardless of what the packaged app manifest is named.

Set `SYLO_USER_DATA_DIR` to run an isolated instance against throwaway data — useful for
smoke-testing an installer build without touching your real chat history.

## Repo layout

- `apps/host/` — the Electron app (main process, renderer, companion server)
- `packages/sylo-*` — capability packages: skills, extensions, tools (TTS, tasks, web access, spreadsheets, workflows, …)
- `docs/` — user-facing docs (`GETTING_STARTED.md`, `COMPANION_PHONE_INSTALL.md`)
- `scripts/` — bootstrap, sync, and verify helpers

## Making changes

- **Never create a branch unless the operator specifically asks for one.** Work on the branch
  that is already checked out (or leave changes in the working tree) and let the operator decide
  when to branch, PR, and merge. Agent-created branches linger and confuse the repo — this has
  happened repeatedly. This overrides the branch/PR steps in docs/WORKFLOW.md for agent sessions
  in this repo; the issue-claiming and `Fixes #N` rules still apply whenever a PR is used.
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
This prevents agent sessions from colliding in the same files. Reference the issue
from your PR (`Fixes #N`) — the board automation depends on that text.
Full process: [docs/WORKFLOW.md](docs/WORKFLOW.md).
