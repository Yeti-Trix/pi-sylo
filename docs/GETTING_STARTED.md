# Getting started with Sylo

Sylo is a **local-first desktop app** for **[Pi](https://pi.dev/)**: chat, workspaces, optional **sidebar apps** built from skills, and a **Capability manager** for installing and enabling skills, extensions, and packages.

This guide is for **you** running Sylo on your own machine — not for internal project planning docs.

**Install Sylo:** [README.md](../README.md) (Node, Pi CLI, `npm install`, `npm start` or `full-build-run-sylo.cmd`).

**Launchers at the repo root:**

- **`full-build-run-sylo.cmd`** — the full-build launcher: `npm install` → Electron binary check → Pi dependency check → `prepare:dev` (broker/companion/skill-UI builds) → `electron-vite dev` in the **foreground with a visible console**, **pause on error**. Use it for the first run, after `git pull`, and whenever you change dependencies, broker/companion code, or skill surfaces. It always rebuilds, so the app is never stale.
- **`run-sylo.cmd`** — quiet launch: starts Sylo **detached with no terminal window**, so only the GUI appears. Skips install/prepare, so run `full-build-run-sylo.cmd` once after pulling or changing skill surfaces/broker/companion. This is the one to put in the Windows Startup folder for boot-time launch. (Both repos ship this pair.)

---

## Quick map

| Topic | Section |
|-------|---------|
| First launch | [Install and open Sylo](#install-and-open-sylo) |
| Where things are in the app | [Main screen](#main-screen) |
| Phone / tablet on your network | [Companion](#companion-phone-or-tablet) |
| Install community packages | [Packages](#install-packages) |
| Built-in Sylo extensions (subagents, widgets, …) | [Built-in Sylo extensions](#built-in-sylo-extensions) |
| Subagent delegation (inline in chat) | [Subagent delegation](#subagent-delegation) |
| Sylo optional packages (bundled, off by default) | [Sylo optional packages](#sylo-optional-packages) |
| Create or attach a skill | [Skills](#skills) |
| Add tools (extensions) | [Extensions](#extensions) |
| Sidebar HTML app | [Sidebar UI (routes)](#sidebar-ui-routes) |
| Share on npm / pi.dev | [Publish a Pi package](#publish-a-pi-package) |
| Something broken | [Troubleshooting](#troubleshooting) |

---

## Install and open Sylo

1. Follow [README.md](../README.md) to install dependencies and start the app.
2. Open **Developer → Settings** and set your **model** if Pi does not already have a default you use. This is the **global default** — new chats start with it. You can override the model **per chat** from the selector at the bottom of each chat (and on the companion phone app); the choice is saved with that chat. When the chat's main model is text-only, a second selector for the **image (fallback) model** appears, defaulted to the global image model from Settings.
3. Open **Developer → Capability manager** to install skills/extensions or enable what you need.
4. If you **cloned the Sylo source repository** and use bundled first-party tools, run once from that folder:

   ```bash
   npm run bootstrap-pi
   ```

   Then use **Restart broker** in the app. You do not need this on a machine that only uses `pi install` packages.

After you add or change skills on disk, use **Restart broker** (or restart Sylo). Starting Sylo refreshes sidebar HTML from your skill folders automatically.

---

## Main screen

| Area | Where | What it does |
|------|--------|----------------|
| **Domain routes** | Sidebar | Sidebar apps from skills (`routes/` in `SKILL.md`) |
| **Workspaces** | Sidebar | Project folders Pi works in; per-workspace enable/disable. The **primary** workspace (starts as **Sylo-user**; rename it anytime — renaming it in the modal also renames its folder on disk and keeps the global pointer file wired; restart Sylo afterwards) is your user profile workspace — all user config data lives here (workflows, tool config parameters, global AI instructions, profile). Rename it per machine (e.g. `sylo-user-work` at work) so separate installs don't combine. **Dev sylo** (dev builds from the GitHub clone) points Pi at the repo where trackers and `full-build-run-sylo.cmd` live. |
| **Conversations** | Sidebar | Chat threads. Status: spinner = running, blue = unread, gray = read. New chats get a title from the first message; right-click to rename. Chats with no activity for **30 days** are removed on launch (right-click → **Export Markdown** to keep a thread). |
| **Chat** | Center | Talk to Pi; tool calls show in the thread. Pi slash commands work here (e.g. `/reload`). While the agent runs: **Stop**, **Queue** messages, or **send now** (Ctrl+Enter). **Settings → Chat concurrency** can run several chats at once (separate conversations). File paths in replies are clickable (**Open** / **Folder**). |
| **Developer** | Sidebar | **Testing**, **Capability manager**, **Settings**, **Restart broker** |
| **Tools** | Sidebar | Skill tool routes (e.g. **Web access**) plus built-in **Schedules** |

**Tips**

- Right-click a dashboard → pin, hide, or **Open in new window**.
- Right-click a conversation → **Branch**, **Export Markdown**, **Rename**, **Delete**.
- While subagents run, the chat header shows a **subagents running** strip with **Show in chat** and **Stop all**. Each **subagent** tool row expands to live output, results, and **Stop run**.
- **Schedules** (sidebar **Tools**): workspace-scoped prompt timers (once, daily, weekly, monthly). Each fire starts a **new chat** with your prompt. **Catch up once on startup** (per schedule) runs the most recent missed interval when Sylo was closed. The agent can manage schedules with `schedule_list`, `schedule_create`, `schedule_update`, and `schedule_delete` (built-in `@sylo/sylo-scheduler`). Sylo must be running for schedules to fire.
- **Workspaces** (sidebar pencil icon): enable **GitHub backup** per workspace to sync the Pi project folder (not chats). Paste your repo URL, **Save changes**, then **Push** or **Push all backed-up**. Sylo **pulls on startup** when backup is enabled. Folders that are already git repos link without re-initializing. On a **fresh install**, Sylo asks once at first load to name the user-data workspace (e.g. `sylo-user-work` on a work machine) — do this before wiring any backup, so a pull can never land the wrong repo's content on the machine. Choosing **Keep sylo-user** dismisses the prompt for good.
- **Global AI instructions** (**Developer → Settings**): your standing instructions for the AI in every chat and every workspace. The source of truth lives in the universal workspace (default `sylo-user`, renamable — e.g. `sylo-work` on a work machine) at `agent/AGENTS.md`; Sylo deploys it to the global Pi directory (`~/.pi/agent/AGENTS.md`) at startup and on save. On a fresh install, any existing global file is adopted as the source (never overwritten). To share instructions between computers, sync the universal workspace (git) or copy that one file manually. Edits made directly to the deployed file are overwritten on the next startup or save.

---

## Companion (phone or tablet)

Use Sylo from a phone browser while **Pi and your data stay on the PC**.

1. **Developer → Settings → Companion**
2. Set **Username** and **Password** → **Save login**
3. Enable **Enable companion server**
4. On the same Wi‑Fi (or Tailscale): set **Network bind** to **Phone on same Wi‑Fi / Tailscale**, copy **URL (LAN)**, allow Windows Firewall on port **9241** if needed
5. On the phone: open the URL and log in
6. In a chat, tap the **paperclip** to attach photos (camera or gallery) or files, then **Send**. While the agent is running, the primary button becomes **Send now** (interrupts after the current tool, like Ctrl+Enter on desktop), **Queue** waits until the turn finishes, and the **Stop** button in the header aborts the turn. In the chat list, each chat shows a status dot like the desktop: a **spinning ring** while the agent works, a **solid dot** for a reply you haven't opened yet, and a faint dot once read. Tap **✎** to rename a chat and **×** to delete it (asks to confirm).

7. The footer has **Chat** and **System** tabs by default. An installed plugin package can add its own tabs between them (rendered from the package's companion manifest) — e.g. a health bundle can add **Nutrition / Workout / Vitals** tabs with a live workout tracker, and surface today's workout on the Chat landing screen. Plugin tabs appear only when the package that declares them is installed.

8. The **System** tab lets you restart Sylo from your phone. **Rebuild & restart** runs the build (`npm install` + `prepare:dev`) so code edits to the companion, broker, or skill surfaces are applied — use this after the agent edits code. **Restart Sylo (no rebuild)** is a fast restart of the current build for when Sylo is hung. Both have a 5-minute health check: if Sylo doesn't come back, your recent changes are auto-reverted (saved to a git stash) and you get an ntfy notification with the error. (Requires the one-time `install-sylo-supervisor.ps1` watchdog setup — dev-machine infrastructure, not included in the public repo.)

**On a Tailscale tailnet (recommended):** when your PC is on Tailscale, Sylo auto-provisions a Tailscale Let's Encrypt certificate the first time you enable the companion with **Network bind** set to Tailscale. The phone URL becomes `https://<your‑node>.<your‑tailnet>.ts.net:9241` — a real, publicly‑trusted cert, so **no root‑CA install is needed on the phone**. Requires the **HTTPS certificates** feature enabled in your Tailscale admin console. (If it isn't enabled, Sylo silently falls back to the self‑signed CA path below.)

Full HTTPS and “Add to Home Screen” steps: **[COMPANION_PHONE_INSTALL.md](COMPANION_PHONE_INSTALL.md)**

Use a strong password on home Wi‑Fi; prefer Tailscale over opening your router to the internet. Turn companion **off** on untrusted networks.

---

## Install packages

Community skills and extensions are **Pi packages** — same as on [pi.dev/packages](https://pi.dev/docs/latest/packages).

**In Sylo**

1. **Developer → Capability manager**
2. Browse the catalog or paste a spec (`npm:…`, `git:…`) → **Install**
3. **Restart broker**

**On the command line**

```bash
pi install npm:package-name
```

Then **Restart broker** in Sylo so new capabilities load.

Sylo does not ship a fixed list of packages you must install — pick what you need and review package source before installing (Pi treats packages as trusted code).

---

## Built-in Sylo extensions

Sylo ships a small set of **first-party extensions** with the app (not from the pi.dev catalog and not under **Sylo optional packages**). They load from the Sylo repo when you run a dev build; no `pi install` step.

| Extension | What it adds | Default |
|-----------|----------------|---------|
| **sylo-subagents** | `subagent` tool (scout/planner/worker/reviewer), bundled orchestration skill, inline subagent runs in chat | **On** |
| **sylo-skill-surface** | `show_widget` for **third-party / ecosystem** agent widgets (Sylo-first packages use inline chat instead) | **On** |
| **sylo-builtin-tools-guard** | Enforces **Pi built-in tools** toggles at execution time | **On** |

**Where to see them:** **Developer → Capability manager → Extensions** (expand the section). Each row is tagged **built-in (Sylo)**. Use **Enable** to turn one off for the AI; that writes `~/.sylo/disabled.json` — it does not uninstall files.

**Skills bundled with an extension** (e.g. **sylo-subagents** orchestration skill) appear under **Skills** after **Restart broker** when the extension is enabled. You do not install them separately.

**Different from optional packages:** **Sylo optional packages** (schematic reader, manual creator, machine expert, …) are separate repo packages, **off by default**, enabled under **Capability manager → Sylo optional packages**.

---

## Subagent delegation

Sylo includes **sylo-subagents** (built-in extension, on by default). The primary agent can call the **`subagent`** tool to run focused child sessions (scout, planner, worker, reviewer) in isolated Pi subprocesses.

**Watch runs**

1. When the agent calls **subagent**, an inline block appears under that tool row in chat.
2. Expand it for live output, last tool activity, result text, and usage.
3. **Stop run** cancels one child; the chat header strip offers **Stop all** when multiple are live.
4. **Copy subagent JSON** copies a spec for re-run — it does not start a new run by itself; call `subagent` again in chat (or ask the agent to) to spawn again.

**Ask the agent to delegate**

Examples:

- “Use **scout** to map where auth is handled in this repo.”
- “Run **planner** then **worker** in a chain to add Redis caching.”
- “Run two scouts in parallel: one on `models/`, one on `providers/`.”

The bundled **sylo-subagents** orchestration skill (under **Skills** after **Restart broker**) tells the agent when and how to delegate. Child agents get a **context packet**, not your full chat history.

**Custom agents**

| Location | Scope |
|----------|--------|
| `~/.pi/agent/agents/*.md` | Global personas (always available when sylo-subagents is on) |
| `<workspace>/.pi/agents/*.md` | Project personas (opt-in — see below) |

Bundled personas ship with Sylo; override or extend them by adding markdown files in the global folder. Open the global agents folder from **Developer → Settings → Global Pi directory** (see **Subagents** section).

**Project agents (trusted repos only)**

By default only global and bundled agents load. To allow `.pi/agents/*.md` in the workspace project folder:

1. **Developer → Settings → Subagents**
2. Enable **Allow project agents**
3. Confirm prompts when the agent first uses a project-local persona

**Orphaned tasks:** if Sylo or the broker restarts during a run, stale rows are marked **orphaned**. Clear them from **Developer → Settings → Subagents → Diagnostics** (**Clear orphaned**), or check counts there.

**Marketplace alternative:** [pi-subagents](https://pi.dev/packages/pi-subagents) on pi.dev is optional for Pi CLI users. Sylo recommends the built-in **sylo-subagents** path for inline chat observability.

---

## Sylo optional packages

Sylo ships extra **sylo-*** Pi packages in the repo (extension + skill + helper scripts). They are **off by default** so the agent tool list stays small. The **sylo-** name is branding; some packages use Sylo sidebar UI later, others work in chat only.

**Enable one**

1. **Developer → Capability manager → Sylo optional packages**
2. Turn **On** for the package you need — Sylo runs **`pip install`** for its requirements automatically
3. **Restart broker**

**Python (required for packages that use pip):** Sylo prefers **Python 3.12** for optional-package installs — some pinned native deps (e.g. crawl4ai's `lxml~=5.3`) have **no cp314 wheels**, and 3.14 forces a source build that fails. On Windows, Sylo auto-detects the **python.org 3.12** build (short install path) via standard dirs and the `py` launcher, so you usually don't need to set anything. Override with **`SYLO_PYTHON`** (point it at a specific `python.exe`) if detection picks the wrong interpreter. Supported range: **3.11–3.14**, but **3.12 is recommended**. **Avoid the Microsoft Store Python build** for pip packages — its site-packages live under a deep sandboxed path that breaks heavy packages (e.g. crawl4ai's litellm) with long-path errors; install the **python.org** build instead. If only the Store build is present, the **Capability manager → Sylo optional packages** section shows a warning telling you to install the python.org 3.12 build. Sylo does not create a venv — activate one before `full-build-run-sylo.cmd` if you prefer isolation. Restart Sylo after changing Python.

One-time from the Sylo repo (skills only):

```powershell
npm run bootstrap-pi
```

**PDF reader:** enable **PDF reader** → restart broker → in chat, use the **pdf-reader** skill: search PDF text first, one full-page render to locate the sheet, then **region crop + OCR** for wire numbers (enable **Supports vision** on your model in Settings). Previews appear as **PDF page preview** or **PDF region preview** (from your uploaded PDF), not web article images. Region OCR needs **Tesseract** installed on the PC (Windows installer or `choco install tesseract`).

**Spreadsheet:** enable **Spreadsheet** to read **`.xlsx`** and **`.ods`** via **`read_spreadsheet`** (`spreadsheet` skill). Returns sheet names, headers, and rows (default 200 data rows). Use Pi **`read`** for **`.csv`**. Write/export is not available yet.

**DOCX:** enable **DOCX** for Word **`.docx`** read and write (`docx` skill). **`read_docx`** returns title, headings outline, and paragraphs in order with `[image: ...]` markers; **`extract_docx_images`** saves embedded pictures with caption/context anchors. **`render_docx`** converts markdown to a styled `.docx` via Pandoc (install Pandoc: `winget install --id JohnMacFarlane.Pandoc`). Read tools never edit your source file; re-render with `overwrite: true` to replace an output you created.



**Operator tool bundles:** some packages are **operator-installed Pi packages** rather than bundled optional packages — they install via `~/.pi/agent/settings.json` `packages` (local path or `pi install git:…`), the same way community Pi packages install. Their skills appear in **Capability manager → Skills** like any other package, and their routes appear in the sidebar. The public repo ships none of them by default; see the Pi packages docs for authoring your own.

**Chat vs widgets:** Sylo-first packages put **buttons and mini-reports inline in the chat bubble** (host React), not `show_widget` iframe panels. Sidebar dashboards use **TypeScript + React** builds under each package's `ui/` folder. Discussion #317 widgets remain for third-party skills only.

**Web access:** enable **Web access** for privacy-first search/fetch (`web-access` skill). Sylo runs **`pip install`** for Crawl4AI, ddgs, and **youtube-transcript-api** when you turn the package on (headless browser for JS-heavy pages). After `npm run bootstrap-pi`, the skill appears under **Capability manager → Skills**. Restart broker → use `sylo_web_search`, `sylo_web_fetch`, and **`sylo_youtube_transcript`** (YouTube captions — not web_fetch on watch URLs) in chat. With a **vision-capable** model, results can include source link citations plus optional preview images (F1) or viewport screenshots after headless fetch (F2). **Ollama** only accepts **PNG/JPEG** in tool results — WebP/AVIF previews are skipped automatically. Open the **Web access** sidebar tab (under **Tools**) for history, stats, and settings — including **rank/rewrite model dropdowns** (same Ollama server as **Settings → Model**; pick a smaller model for rewrite to speed up search).

**Think Tank:** enable **Think Tank** (`think-tank` skill) for multi-model debate (`sylo_think_tank_run`, min 2 / max 10 cycles, three final reports; the **Moderator** report is the decision brief — no winner pick needed). Open the **Think Tank** sidebar tab (Dashboards section) → **Settings** to assign each seat a **Pi provider + model** (same options as **Settings → Model (Pi)** — Ollama dropdown from your server, or OpenAI/Anthropic/Groq model ids). Leave provider empty to use Pi defaults for that seat. Trigger from chat: `Think Tank: …` or `send to think tank …`. Config file: `%AppData%\@sylo\host\sylo-think-tank\config.json` (Windows).

**News / Reddit:** these ship as an example **operator tool bundle** (installed via `packages` in `~/.pi/agent/settings.json`), not as bundled optional packages — the same install pattern any community Pi package uses.

**Coder:** enable **Coder** (`sylo-coder` skill) for better code editing. Adds **`smart_edit`** — a fuzzy/whitespace-tolerant replacement for Pi `edit` that still applies when indentation has drifted; on multiple matches it returns candidate line ranges so you add context and retry, and on no match it surfaces the closest region so the agent can `read` and retry. The skill also adds a plan→edit→verify discipline and a researcher→planner→implementer→reviewer subagent chain (via **`sylo-subagents`**) for multi-file refactors. No diff-review UI. No Python deps. Restart broker after enabling. Phase 2 will add local codebase semantic search (Ollama embeddings).

**Research mining:** workspace skill in **Agentic Engineering** (`.pi/skills/research-mining/`). Weekly sweep mines r/LocalLLaMA + r/aiagents (+ web) for ideas that could improve Sylo, grades each candidate 0-10 against sylo-dev trackers, writes 8+ survivors to `proposals/`. Orchestrates **`sylo_reddit_***` (Reddit enabled) and **`sylo_web_***` (Web access enabled). Cadence: **Schedules** tab in that workspace (weekly). Manual trigger: `do research-mining`. Nothing becomes a feature tracker until you accept it.

Later you can `npm publish` the same packages and install with `pi install npm:sylo-pdf-reader` on any Pi host.

---

## Skills

A **skill** is a folder with `SKILL.md` — instructions for the agent, and optionally a sidebar UI or scripts.

**Ways to add one**

| Method | How |
|--------|-----|
| In chat | Describe what you want; Pi creates or updates files |
| Capability manager | **+ New skill** → guided authoring in chat |
| Attach existing UI | **Attach UI to Sylo…** → pick a project folder |
| By hand | Copy a folder to `~/.pi/agent/skills/<name>/` (Windows: `%USERPROFILE%\.pi\agent\skills\`) |
| Per project | `<your-project>/.pi/skills/<name>/` for workspace-only skills |

**Settings shortcuts:** **Open global skills folder** / **Open workspace project skills folder**.

**Capability manager → Skills**

- Expand a skill name to read or edit `SKILL.md`
- **Enable** — agent may use it (does not delete files)
- **Remove** — deletes a standalone skill folder (not package skills; use **Uninstall** under Downloaded packages for those)

Core authoring helpers (`sylo-skill-author`, `sylo-extension-author`) ask for extra confirmation before saving.

---

## Extensions

**Extensions** add typed **tools** the model can call (TypeScript, `registerTool`). Install with `pi install` or author via **+ New skill** / extension flows in Capability manager.

For Python or shell workflows, a **skill** plus scripts is often enough without an extension.

**Capability manager → Pi built-in tools:** master switch and per-tool toggles for Pi’s native read/write/bash tools. **Save & restart broker** applies changes.

---

## Sidebar UI (routes)

A **route** is an HTML page in your skill folder, listed in `SKILL.md`, shown as a tab under **Dashboards** (or **Tools** / **Library** when `nav_section` says so).

### Folder layout

```text
my-app/
├── SKILL.md
└── routes/
    └── main/
        ├── index.html      ← sidebar page
        └── fallback.md     ← chat-only instructions if the UI cannot load
```

### `SKILL.md` (minimal example)

```yaml
---
name: my-app
description: Short description for the agent and Capability manager.
route_protocol_version: 0
routes:
  - id: main
    title: My app
    icon: layout
    nav_section: domain
    entry: routes/main/index.html
    fallback: routes/main/fallback.md
    required_capabilities: []
metadata:
  sylo:
    category: productivity
    icon: layout
---

# My app

## For the agent

- Prefer the **My app** sidebar tab when the operator works on this workflow.
- If the route is unavailable, use **only** `routes/main/fallback.md` in this skill.
```

Paths in `entry` and `fallback` are **relative to the skill folder**. `nav_section: domain` lists the tab under **Dashboards**; `tools` under **Tools**; `library` under **Library routes**.

### `index.html`

Use plain HTML/CSS/JS first. Open the file in a normal browser to check layout; Sylo loads the same file in a sidebar iframe.

Optional: build with React/Vite, then copy the **built** `index.html` and assets into `routes/main/` (Sylo does not run your dev server in production).

### `fallback.md`

Short instructions for the agent when the sidebar cannot load — see the example in the layout section above.

### Attach and verify

1. Put the folder in `~/.pi/agent/skills/my-app/` **or** use **Attach UI to Sylo…** and follow the chat steps.
2. **Restart broker** (or restart Sylo).
3. Checklist:
   - [ ] **Dashboards** shows your tab title
   - [ ] Tab opens your page
   - [ ] Skill appears under **Capability manager → Skills**
   - [ ] Skill is **Enabled** if you test chat tools

**Route tab missing?**

| Problem | Fix |
|---------|-----|
| Folder not in Pi skills path | Copy to `~/.pi/agent/skills/<name>/` |
| No `routes:` in `SKILL.md` | Fix frontmatter |
| Stale capabilities | **Restart broker** or restart Sylo |
| Skill disabled | **Enable** in Capability manager |

### Widgets (optional)

For a small popup panel from a **third-party** skill, use a **widget** under `assets/widgets/` and `show_widget`. Sylo-owned optional packages should use a **sidebar React route** (`ui/` build) and **inline chat actions** — not widgets.

---

## Publish a Pi package

To share with `pi install npm:your-package` (and appear on [pi.dev/packages](https://pi.dev/docs/latest/packages) when you use the `pi-package` keyword):

**Layout example**

```text
pi-my-skill/
├── package.json
├── extensions/
│   └── my-tools.ts           # optional
└── skills/
    └── my-app/
        ├── SKILL.md
        └── routes/main/
            ├── index.html
            └── fallback.md
```

**`package.json` essentials**

```json
{
  "name": "pi-my-skill",
  "version": "0.1.0",
  "keywords": ["pi-package"],
  "type": "module",
  "pi": {
    "extensions": ["./extensions/my-tools.ts"],
    "skills": ["./skills/my-app"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

Omit `"extensions"` until you add tools. See [Pi package docs](https://pi.dev/docs/latest/packages) for gallery images and full rules.

**Publish**

1. `npm publish --access public` (with `"keywords": ["pi-package"]`)
2. Others install: `pi install npm:pi-my-skill` or Sylo Capability manager
3. **Restart broker**; open the sidebar tab to confirm routes

**Without npm:** `pi install git:github.com/you/pi-my-skill@v0.1.0`

**Before publish**

- [ ] Every route has `fallback.md`
- [ ] `index.html` works in a browser
- [ ] README includes `pi install npm:…`

---

## Troubleshooting

| Symptom | Try |
|---------|-----|
| Optional package pip / `lxml` build failed | Sylo prefers **Python 3.12**. Avoid **Python 3.14** (crawl4ai pins `lxml~=5.3`, which has no cp314 wheel — pip tries to build from source and fails) and the **Microsoft Store Python build** (deep sandbox path breaks heavy packages with long-path errors). Install the **python.org 3.12** build from [python.org](https://www.python.org/downloads/windows/) (check "Add to PATH"), or set **`SYLO_PYTHON`** to that `python.exe`, restart Sylo, enable again |
| No model reply | Check Ollama or your provider; **Settings**; **Restart broker** |
| Images ignored | **Settings → Model** — enable **Supports vision** on the main model, or pick an **Image model (fallback)** vision model when the main model is text-only; **Restart broker** |
| Sidebar route missing | [Route checklist](#attach-and-verify); **Restart broker**; restart Sylo |
| Database / native module error | From the Sylo install folder: `npm run rebuild:native`, then restart (needs C++ build tools on Windows) |
| Safe Mode banner | **Restart broker** or use the banner control |

---

## More help

| Doc | Use |
|-----|-----|
| [README.md](../README.md) | Install and run |
| [COMPANION_PHONE_INSTALL.md](COMPANION_PHONE_INSTALL.md) | Phone HTTPS and home-screen install |
| [CHANGELOG.md](../CHANGELOG.md) | What changed each release |
| [Pi documentation](https://pi.dev/docs/latest/) | Skills, extensions, packages |
