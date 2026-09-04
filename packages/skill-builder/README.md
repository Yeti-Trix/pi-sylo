# `@sylo/skill-builder`

Starter trees for Discussion #317 **widgets** and Sylo **routes** (see `.prd/SKILL_AND_EXTENSION_MANAGEMENT.md`, section 13).

## Widget

Copy `templates/widgets/starter/` to `<your-skill>/assets/widgets/<id>/`:

- `manifest.json`, `widget.html`, `fallback.md`, `schemas/input.json`, `schemas/output.json`
- Add `widgets: [ '<id>' ]` and `widget_protocol_version: 1` at the top level of SKILL.md frontmatter.

## Route

Copy `templates/routes/starter/` to `<your-skill>/routes/<id>/`:

- `index.html`, `fallback.md`, optional `manifest.json`, `schemas/input.json`, `schemas/output.json`
- Add a `routes:` array item with `nav_section` (`domain` | `tools` | `library` | `dev`), `entry`, `fallback`, and `route_protocol_version: 0` in SKILL.md.

## Skill surface CSS

Shared iframe styling lives in **`assets/sylo-surface.css`**. Sylo injects it automatically into widget/route iframes (with theme vars). Starter templates use classes like `sylo-surface-lead`, `sylo-surface-btn`, `sylo-surface-pre`. Copy the file into your skill only if you ship HTML outside Sylo.

## Meta-skills

| Skill | Use when |
|-------|----------|
| `skills/sylo-skill-author/` | Create a **new** skill from scratch (widget and/or route). |
| `skills/sylo-attach-ui/` | **Brownfield:** operator already has code + HTML and wants it in Sylo’s sidebar or chat widgets. |

Install or bootstrap copies meta-skills into `~/.pi/agent/skills/`. Third-party skills with routes/widgets: drop under `~/.pi/agent/skills/<name>/` or `packages/skills/<name>/`, then `npm run sync-skill-surfaces` (runs automatically on `npm start` via host `prestart`).
