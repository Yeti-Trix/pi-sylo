---
name: sylo-skill-author
description: Meta-skill to scaffold a new Pi Agent Skill with Sylo-friendly frontmatter and optional widget or route surfaces.
metadata:
  sylo:
    category: authoring
    icon: edit
---

# Skill author (Sylo)

When invoked:

1. **Interview (required)** — Before creating files:
   - **Mid-turn chat UI:** Does the operator need a button, confirm strip, or report **in the chat transcript** after a tool runs?
     - **Sylo-first (`@sylo/*`):** implement **inline host React** in the assistant bubble (detect tool name/args in telemetry). **Do not** use `show_widget`.
     - **Third-party / cross-host:** Discussion #317 transient widget via `show_widget`.
   - **Persistent sidebar dashboard:** Does the operator open a **domain UI from the nav** any time?
     - **Sylo-first:** scaffold **`packages/<name>/ui/`** — TypeScript + React + Vite → `routes/<id>/` (see LogicForge, sylo-health). **Not** plain HTML dashboards.
     - **Brownfield / simple attach:** portable HTML route + `sylo-surface.css`.
   - If **route**, which **`nav_section`**: `domain`, `tools`, `library`, or `dev`? (Default: `domain`.)

2. **Copy templates — do not hand-roll from memory**

   Canonical scaffolds live in `@sylo/skill-builder`:

   | Surface | Template path | When |
   |---------|----------------|------|
   | Widget (third-party / ecosystem) | Copy `templates/widgets/starter/` → **`assets/widgets/<widget-id>/`** | Cross-host Discussion #317 skill — **not** default for `@sylo/*` |
   | Route (React dashboard) | Copy **`packages/sylo-health/ui/`** or **`packages/sylo-logicforge/ui/`** pattern — `ui/` Vite React app → `routes/<route-id>/` | **Default for Sylo optional packages** |
   | Route (plain HTML) | Copy `templates/routes/starter/` → **`routes/<route-id>/`** | Brownfield attach, smoke, third-party only |

   After copy: rename **`starter`** placeholders — set `manifest.json` **`id`** to the real widget/route id (must match folder + frontmatter).

3. Write **`SKILL.md`** under `~/.pi/agent/skills/<skill-name>/` (or project `.pi/skills/`) including YAML frontmatter:
   - `name`, `description`, optional `metadata.sylo` (`category`, `icon`, …).
   - If using a widget: top-level **`widgets:`** listing each widget folder id + **`widget_protocol_version: 1`**.
   - If using a route: top-level **`routes:`** (each item has `id`, `title`, **`nav_section`** as chosen, **`entry`**, **`fallback`**, **`required_capabilities`** as needed) + **`route_protocol_version: 0`**.

   Every widget directory **must** keep **`fallback.md`**; every route directory **must** keep **`fallback.md`** (Sylo refusal rule).

4. Offer **`params.schema.json`** / **`metadata.sylo.paramsSchema`** only when the skill needs operator-editable configuration (unchanged convention).

5. **Surface styling:** Use classes from `@sylo/skill-builder` **`assets/sylo-surface.css`** (`sylo-surface-lead`, `sylo-surface-btn`, …). Sylo injects this CSS into iframes; starter templates already use it.

6. **Companion-ready UI (phone):** Sylo can expose skill routes on a phone via the desktop **Companion** server (Settings → Companion). Skill route HTML should:
   - Include `<meta name="viewport" content="width=device-width, initial-scale=1" />` (starter templates do).
   - Use responsive layout (stack on narrow widths, touch-friendly controls).
   - Test at ~390px width, not only desktop sidebar width.
   - Reuse one HTML surface for desktop iframe + phone iframe unless the operator explicitly needs a separate mobile layout.

After writing, remind the operator to **`/reload`** (and restart the host when route discovery caches apply).

For **brownfield** attach (operator already has a folder / HTML UI), prefer **`/skill:sylo-attach-ui`** instead of this skill.
