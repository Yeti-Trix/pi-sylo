---
name: sylo-attach-ui
description: Wire an existing Pi skill or folder (code + HTML UI) into Sylo's sidebar or chat widgets — brownfield attach workflow.
metadata:
  sylo:
    category: authoring
    icon: link
---

# Attach UI to Sylo

Use when the operator **already has** a workflow (scripts, extension, or skill folder) and wants it to **show up in Sylo's GUI** — sidebar tab or chat actions — without reading `.prd`.

**Sylo-first guidance:** New `@sylo/*` work should use **inline host React for chat buttons/reports** and a **`ui/` TypeScript + React** build for sidebar dashboards. Use this attach skill mainly for **brownfield HTML** or third-party folders.

Sylo does **not** mount arbitrary React source in skill surfaces. It mounts **built static files** (or dev-server URLs for experiments) declared on a **skill**, or **host React** for inline chat.

**Stack split:**

| Surface | Stack |
|---------|--------|
| Sylo host (sidebar chrome, chat, inline tool actions) | **TypeScript + React + Tailwind** — see `.cursor/skills/ui-design/SKILL.md` |
| `@sylo/*` sidebar dashboards | Package **`ui/`** — **TypeScript + React + Vite** → `routes/<id>/` (LogicForge, sylo-health) |
| Third-party widgets / plain HTML routes (iframe) | **HTML + CSS** + host `--color-*` vars — ecosystem / brownfield only |

**Companion (phone):** Route HTML should be responsive (viewport meta, narrow-width layout) so one surface works in the desktop sidebar and on the phone companion. See `sylo-skill-author` step 6.

Operators may build route UI with React locally, but ship **static `index.html`** output (or dev URL) into the skill folder.

Use **`sylo-surface-*`** CSS classes from `@sylo/skill-builder/assets/sylo-surface.css` in widget/route HTML — Sylo injects the stylesheet into iframes automatically.

## Step 0 — Inspect what they have

The operator may pick a folder via **Capability manager → Attach UI to Sylo…** (native folder dialog). Use that path as the attach target.

Ask or infer:

| They have | Action |
|-----------|--------|
| Only `.tsx` / `.jsx` source | Run `npm run build` (or similar) first; attach the **`index.html` output**, or use a **`http://localhost:…`** URL only for local dev. |
| A folder with `SKILL.md` already | Patch that skill in place. |
| A loose folder (no skill yet) | Create `SKILL.md` + choose scope (`~/.pi/agent/skills/<name>/` global default, or `<cwd>/.pi/skills/<name>/` project). |
| Pi **extension** `.ts` only (tools, no HTML) | Keep the extension; add or extend a **skill** beside it for UI. Extensions register tools; **skills own HTML surfaces**. |

Confirm: **sidebar anytime** vs **agent pops UI mid-chat**.

## Step 1 — Pick surface

| Operator intent | Surface | Where it appears |
|-----------------|---------|------------------|
| "I open this like an app" (planner, calendar, dashboard) | **Route** | Sylo sidebar; operator can **Open in new window** (host feature — no extra author code). |
| "Agent shows this during a turn" | **Inline chat action** (Sylo-first) or **Widget** (third-party) | Host React card/button after tool (preferred); or chat widget panel via `show_widget` for ecosystem skills. |

**`nav_section`** for routes (sidebar group): `domain` (default — everyday apps), `tools`, `library`, `dev`.

## Step 2 — Copy templates (do not hand-roll from memory)

Canonical starters live in `@sylo/skill-builder`:

| Surface | Copy from | Into skill folder |
|---------|-----------|-------------------|
| Route | `templates/routes/starter/` | `routes/<route-id>/` |
| Widget | `templates/widgets/starter/` | `assets/widgets/<widget-id>/` |

After copy: set `manifest.json` **`id`** if present; ensure **`fallback.md`** exists (Sylo refuses routes/widgets without it).

## Step 3 — Patch `SKILL.md` frontmatter

**Route** — top-level YAML (not under `metadata.sylo`):

```yaml
routes:
  - id: planner
    title: My app
    icon: layout
    nav_section: domain
    entry: routes/planner/index.html
    fallback: routes/planner/fallback.md
route_protocol_version: 0
```

**Widget** — top-level:

```yaml
widgets:
  - smoke
widget_protocol_version: 1
```

Add procedural body text: what the skill does, when the agent should call `show_widget`, and pointer to `fallback.md` when the host lacks UI.

## Step 4 — Sync HTML into the Sylo app bundle (repo dev only)

When the skill lives **inside the Sylo monorepo** under `packages/skills/<name>/`, run:

```bash
npm run sync-skill-surfaces
```

That mirrors route/widget assets to `apps/host/test-fixtures/skill-surface/` so Vite serves them at `/skill-surface/routes/<skill-folder>/…`.

Third-party skills installed only under `~/.pi/agent/skills/` need the **host** to serve their assets (future: skill-asset resolution from skill dir). For MVP, document: copy route HTML into fixtures **or** use `show_widget` with an `https://` dev URL.

## Step 5 — Install and reload

1. Copy skill tree to `~/.pi/agent/skills/<folder-name>/` **or** drag folder onto Sylo **or** `pi install` if packaged.
2. Operator runs **`/reload`** (or Sylo **Restart broker**).
3. For routes: open the new sidebar tab. For widgets: agent calls `show_widget` with `path` under `/skill-surface/…`.

**No per-app Sylo extension required.** `@sylo/skill-surface-extension` is host infrastructure (registers `show_widget`).

## Step 6 — Verify

Tell the operator what to expect:

- **Route:** sidebar entry under the chosen `nav_section`; optional **Open in new window** from route menu.
- **Widget:** panel after `show_widget`; test bridge with `sendToAgent` if using starter template.
- **Diagnostics:** skill surface summary shows `supports_route` / `supports_widget`.

If lint fails on enable (missing `fallback.md`), fix files and reload.

## When attaching an existing extension package

1. Leave the extension TS as-is (tools stay registered).
2. Add a **sibling skill folder** or merge UI files into the package's skill entry if the package already ships `SKILL.md`.
3. Do **not** require the operator to install `@sylo/skill-surface-extension` — Sylo injects it when running the Electron host.
