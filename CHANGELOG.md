# Changelog

All notable changes to Sylo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Sylo optional packages:** **DOCX** (`sylo-docx`) — read Word files (`read_docx`, `extract_docx_images` with text↔image anchors) and write from markdown (`render_docx` via Pandoc + shipped `reference.docx`).

### Changed

- **Sylo optional packages:** **DOCX reader** renamed to **DOCX** (`sylo-docx-reader` → `sylo-docx`); re-enable in Capability manager after pull.
- **Manual creator:** `manual_extract_docx_images` removed — pull source-`.docx` pictures with **DOCX** `extract_docx_images` (set `output_dir` to the project `inputs/`). Write path (inject, PDF render, HMI) unchanged.

- **Settings → Model:** optional **Image model (fallback)** — when the main chat model is text-only, Sylo can describe pasted images via a separate Ollama vision model and inject that text into the turn.

### Fixed

- **Capability manager → Configure modal:** schema config forms with many fields (e.g. web-access, which includes the Brave Search API key) overflowed the viewport and the **Save** button was unreachable because the modal neither constrained its height nor scrolled. The modal now caps its height at `100dvh`, scrolls the field region, and pins the title + Save/Cancel actions so they stay visible. The web-access schema also self-heals missing canonical properties (notably `brave_api_key`) on open, so the Brave API key entry always appears — even for installs that enabled web-access before the field was added.

## [Unreleased]

### Added

## [0.2.0] - 2026-06-04

## [Unreleased]

### Added

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
