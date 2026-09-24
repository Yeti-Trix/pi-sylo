# Changelog

All notable changes to Sylo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Schedules — per-schedule chat mode:** every schedule can now choose between **"New chat each run"** (previous, still the default) and **"Continue in same chat"** — each fire appends the prompt turn into one persistent conversation. Selectable in the Schedules form for both new and existing schedules. Self-healing: if the target chat is missing (first run), deleted, or archived, the next fire creates a fresh chat and continues there. "Run now" and startup-catchup follow the same rule.

## [0.4.0] - 2026-09-10

### Added

- **Sylo optional packages:** **DOCX** (`sylo-docx`) — read Word files (`read_docx`, `extract_docx_images` with text↔image anchors) and write from markdown (`render_docx` via Pandoc + shipped `reference.docx`).
- **Capability manager → Personal packages:** one card per installed package (e.g. `sylo-allen-bradley`, `sylo-ignition`) instead of one card per bundle — per-package skills/extensions chips and "part of <bundle>" hints.
- **Capability manager:** the old read-only "Personal packages" card is removed; the former "Downloaded packages" card moves up and is now the **Personal packages** section (per-package cards, catalog-driven installs, Uninstall).
- **Capability manager:** "Sylo optional packages" renamed to **"Sylo built-in packages"** (labels only — internal ids unchanged).
- **Update checker:** Sylo periodically checks the public GitHub repo for a newer release — dismissible banner at the top of the app, Help ▸ Check for Updates…, remembered dismiss per version. Informs only; never auto-updates. Automatic checks are skipped on the operator's dev clone (`revisions/` marker); Help ▸ Check for Updates… works everywhere.
- **sylo-tools-controls split:** `sylo-allen-bradley` is now three packages — `sylo-logicforge` (L5X parse/IO-scaffold, Parse Rules UI, bundled backend, canonical download allowlist), `sylo-allen-bradley` (Logix Designer SDK wrapper only, SDK not bundled), `sylo-plc-comms` (CIP + OPC UA tag tools). Tool names renamed to match homes (`allen_bradley_sdk_*`, `plc_comms_cip_*`, `plc_comms_opcua_*`); `logicforge_*` parse tools keep their prefix. Host io-review/templates handlers now resolve the logicforge package through tools-bundles (external-bundle aware).
- **Per-package independence for tools bundles:** local-path monorepo packages (e.g. `sylo-tools-controls`) now expand into one `packages[]` entry per sub-package at broker start — each sub-package gets its own Capability manager card with independent Enable / Update / Uninstall (uninstall removes only the settings entry; files stay on disk). Single-package bundles (`sylo-tools-personal`, `sylo-tools-onenote`) are unaffected; tools-bundles resolves the bundle root from sub-package entries for the LogicForge host handlers.
- **Canvas draw mode → agent is pull-based:** removed the draw panel's "Send to agent" chat box. The sketch now mirrors to the host as you draw (debounced), and a new `canvas_sketch` broker tool returns the current drawing-area image from normal chat — just ask "look at my sketch". Empty drawing area returns a text notice; the mirror resets at app start (sketches don't survive restarts).

### Changed

- **Sylo optional packages:** **DOCX reader** renamed to **DOCX** (`sylo-docx-reader` → `sylo-docx`); re-enable in Capability manager after pull.
- **Manual creator:** `manual_extract_docx_images` removed — pull source-`.docx` pictures with **DOCX** `extract_docx_images` (set `output_dir` to the project `inputs/`). Write path (inject, PDF render, HMI) unchanged.
- **Settings → Model:** optional **Image model (fallback)** — when the main chat model is text-only, Sylo can describe pasted images via a separate Ollama vision model and inject that text into the turn.

### Fixed

- **Capability manager → Configure modal:** schema config forms with many fields (e.g. web-access, which includes the Brave Search API key) overflowed the viewport and the **Save** button was unreachable because the modal neither constrained its height nor scrolled. The modal now caps its height at `100dvh`, scrolls the field region, and pins the title + Save/Cancel actions so they stay visible. The web-access schema also self-heals missing canonical properties (notably `brave_api_key`) on open, so the Brave API key entry always appears — even for installs that enabled web-access before the field was added.
- **Capability manager → Uninstall:** clicking **Uninstall** twice in quick succession showed a false "Uninstall failed" alert (settings write raced the list refresh); the failure message now also makes clear when a package was already removed.

## [0.2.0] - 2026-06-04

## [0.1.1] - 2026-05-25

### Added

- Capability Manager opt-in config forms: skill **Edit params** (`params.schema.json` → `params.local.json`) and extension **Configure** (`extensions-config/*.schema.json` from `syloConfig`).
- Richer skill-surface lint rows (widget/route title, nav section, required capabilities, fallback status).

## [0.1.0] - 2026-05-23

MVP operator sign-off per `.prd/MVP_TEST_CHECKLIST.md`.

### Added

- Electron + React host with isolated Pi agent-broker child process and streaming chat.
- SQLite persistence (conversations, messages, workspaces, preferences).
- Per-chat Pi session files, workspace-scoped cwd, session fork.
- Capability Manager: skills, extensions (with tools), downloaded packages, pi.dev catalog, Pi built-in tool toggles, per-skill/extension/tool enablement.
- Skill UI surfaces: `show_widget`, persistent routes, iframe bridge, skill data store, modular sidebar.
- Workspaces with per-workspace capability exclusions and workspace-scoped skill policy (available / always-apply).
- Native image attachment path to Pi `images` channel.
- Bundled package skill discovery (`additionalSkillPaths` for npm/git package skills).
- First-party packages: `@sylo/protected-paths`, `@sylo/git-checkpoint`, `@sylo/pi-helpers`, `@sylo/skill-surface-extension`, `@sylo/skill-builder`, `@sylo/extension-builder`.
- Default Ollama model **`qwen3.6:35b`** (Sylo pref fallback).
- `scripts/bootstrap-pi.mjs` for local Pi extension/skill sync.

### Removed

- `@sylo/research` — use community research packages via `pi install`.
- `@sylo/task-overlay` and Tasks panel — sub-agents via `pi-subagents` in chat only.
- `workout-planner` demo skill (external repo for attach testing).

### Changed

- Host renderer migrated to Tailwind v4 for shell, chat, settings, diagnostics, and capability manager.
