# Changelog

All notable changes to Sylo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Turn timer pauses while an agent waits on your answer:** the live "Turn ·" / reply elapsed timers now count agent run time, not wall-clock — when a turn parks on an ask-question, the timer freezes at the pause start (and stops pulsing, with a "paused — waiting for your answer" tooltip), and when you answer (here or from the companion) it resumes from the frozen value because every paused interval is subtracted. Multiple questions in one turn bank separate waits; a turn boundary resets the accounting so the next turn counts from zero. The host stamps each question's open time, so even a desktop reload mid-wait re-anchors the pause correctly.

### Added

- **Plan goals bar close button:** an ✕ at the top-right of the plan-goals bar above the composer hides that chat's plan on demand. It patches the same frontmatter `hidden` flag the finished-plan path uses — nothing is deleted, ticks and the Reviewed badge keep their meaning, and saying "continue" in that chat puts the plan back with its goals intact. While a subagent run is active the hide is refused (the orchestrator still needs its goal dispatch) and the ✕'s tooltip explains that for a few seconds.

### Fixed

- **A question pending in one chat no longer freezes sends in every other chat:** a turn parked on an unanswered question counted as a busy slot, so outside concurrent turns mode every other chat's message queued behind it indefinitely — looking exactly like a dead send, with no explanation anywhere. Questions now hold only their own chat: while the primary broker waits for your answer, other chats' turns start on a temporary overflow broker (the same lifecycle concurrent mode already uses) and the app returns to its normal concurrency rules once you answer. Queued turns also flush as soon as the only remaining in-flight turn is question-parked.

### Added

- **Companion app shows the "answer needed" state too:** the phone chat list now shows the same pulsing **?** badge + glowing chat title when an agent is paused on a question (parity with the desktop). It also survives a PWA reload and reconnects — the desktop host serves the live unanswered-question payloads on the conversations endpoint, and the phone (and a reloaded desktop) reseed their question store from it.

- **Chat list shows when an agent needs an answer:** a chat whose agent paused on a question now shows a pulsing **?** badge in the chat list instead of the running spinner, and its title gently fades and glows until you answer — visible from anywhere in the app, not just while that chat is open. The badge clears the moment you submit the answer (or when the turn ends / a new turn starts), so it never sticks on a dead turn.

- **Compact now — chat footer button:** a **Compact now** button next to the context token counter (both chat layouts) runs Pi's manual compaction on the active chat on demand — like Claude's `/compact`. It summarizes older turns into a compact note and frees context space immediately; the same compaction-notice card as auto-compaction appears in the timeline (labeled "manual"), and the footer token count drops. Disabled while the chat's turn is streaming (the host re-checks too, so a stale click can never abort an in-flight turn), with inline errors for "nothing to compact", "already compacted", or a busy broker.

- **Per-model compaction trigger — choose when context is summarized:** Settings ▸ Model (Pi) now has a **Compaction** section. Pi's default (compact when the context window fills to `window − 16,384` reserved tokens, ≈91.8% on a 200k model) is shown for the selected model, and you can override the trigger as a % of that model's context window. Overrides are stored per model (switching models and back keeps each model's trigger), a **Restore default** button returns to Pi's built-in behavior, and saves apply to live sessions immediately — no broker restart. Host→broker plumbing carries the resolved reserve on every session init/switch, so each conversation's model always gets its own trigger.

- **Manage providers — configure every provider from one place:** Settings ▸ Model (Pi) ▸ **Manage providers** opens a modal listing all six providers (Ollama, ChatGPT OAuth, OpenAI, Anthropic, Groq, OpenRouter) with live status — key saved + masked preview, ChatGPT sign-in state, Ollama reachability — and inline actions to save/replace/remove API keys or sign in/out, all independent of the active chat model. Saving refreshes the chat and subagent model pickers immediately, and a broker-restart shortcut applies new credentials to live sessions.

- **Docs — free models for low-stakes subagent work:** guidance in docs/GETTING_STARTED.md + AGENTS.md on pinning a free model (e.g. Nemotron 3 Ultra on OpenRouter) to scout by agent name so high-volume, low-intelligence subagent tasks (websearch, doc reading, recon) run free instead of burning paid tokens.

- **Queued follow-ups — inline edit:** every queued message chip now has an ✎ edit action. Enter saves, Shift+Enter adds a line, Esc cancels. The attachment paths attached to the queued message are preserved verbatim while you edit the prose; emptying the text removes the item (unless it carries attachments).

- **Chat concurrency — configurable max in-flight turns:** the "Allow concurrent agent turns across conversations" setting now lets you pick how many turns may run at once (1–16, default 4) instead of a hardcoded 4. New "Max concurrent turns" number field in Settings ▸ Chat concurrency; each in-flight turn beyond the first still uses its own Pi broker process.

- **Schedules — per-schedule chat mode:** every schedule can now choose between **"New chat each run"** (previous, still the default) and **"Continue in same chat"** — each fire appends the prompt turn into one persistent conversation. Selectable in the Schedules form for both new and existing schedules. Self-healing: if the target chat is missing (first run), deleted, or archived, the next fire creates a fresh chat and continues there. "Run now" and startup-catchup follow the same rule.

### Changed

- **Queued follow-ups survive chat switches:** the queue strip is now remembered per conversation (in-memory, same lifetime as composer drafts). Queue a message in one chat, switch to another (or to a non-chat tab), come back — the queued message is still there instead of silently disappearing. It still auto-sends when its turn finishes while you watch that chat; if you were elsewhere when the turn finished, it waits for you (Send-now ✦ or the next finished turn) rather than firing unannounced.

- **Drop files anywhere in the chat transcript:** the whole chat area now accepts file drops and hands them to the composer. Previously only the small composer box accepted drops — anywhere else silently did nothing (the shell-level drop handler relied on `File.path`, which Electron 32+ removed).

### Fixed

- **Side chat (canvas ▸ Apps ▸ Side chat) no longer fails silently:** the send flow had five silent no-op paths — including a `sending` flag that was never reset when the parent chat changed, `createSide` failures that vanished, and ignored "deferred" turns (with concurrent turns off — the default — a side-chat send while the main chat is mid-turn is queued behind it, which looked exactly like a dead send). Every failure now shows an inline status line in the pane; a deferred send shows "Queued — it starts when the current turn in another chat finishes"; a failed send restores the typed text and resets the composer. Host side: a 5 s sweep now retries deferred turns while a broker slot is free, so a queued turn can no longer sit stuck forever if the event-driven flush loses a race.

- **Dropped files are visible immediately:** dropped files/images now show placeholder chips the instant they land ("reading…" while each file resolves), instead of appearing only after per-file processing. And a sent message with attachments now appears in the timeline right away — an optimistic user bubble renders from the moment you press Send and is replaced by the real message when the host finishes preparing the turn (image encode + broker start used to leave seconds where the just-sent files were visible nowhere).

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
