---
name: image-gen
description: Generate local images via sylo_image_gen_generate (ComfyUI) and curate the workspace image library.
metadata:
  sylo:
    category: media
    icon: image
routes:
  - id: images
    title: Images
    icon: image
    nav_section: domain
    entry: routes/images/index.html
    fallback: routes/images/fallback.md
route_protocol_version: 0
---

# Image studio

Local image generation with a per-workspace image library. **All-local**: no cloud services, no
provider keys — your own **ComfyUI** install does the GPU work; the package talks to it over HTTP.
Defaults are Apache-2.0 models (draft `z-image-turbo`, final `qwen-image-2`); FLUX dev models are
quality upgrades with **non-commercial** output licenses — say so when the use looks commercial.

## Tools

| Tool | Use |
|------|-----|
| **sylo_image_gen_generate** | Generate 1–4 images; `preset:'draft'` → fast exploration, `preset:'final'` → commit |
| sylo_image_gen_list | Search the library (text/tags/favorites/model/date) |
| sylo_image_gen_get | Full params + lineage for one image |
| sylo_image_gen_organize | Tag / favorite / album / delete (confirm deletes) |
| **sylo_image_gen_doctor** | Setup diagnostics — run this on any backend failure |

## Discipline

### When to generate

Generate only on an explicit ask, or when the operator's doc/site clearly needs an image and they've
indicated they want one. Don't pre-generate on speculation — generation costs GPU-minutes and the
library fills with junk.

### Draft → final loop

1. **Explore with `preset:'draft'` and count 2–4** — drafts are seconds, low-res, free-ish. Compare
   seeds side by side instead of serializing single shots.
2. **Commit the pick with `preset:'final'`** — or, better, pass `from_image_id` + `preset:'final'`
   on the winning draft: it keeps the seed (stable composition), records `parent_id` lineage, and
   renders at the configured final model's full quality.
3. Finals cost minutes — render **1** final at a time; rerun with a new seed only when asked.
4. After success, **stop** — the images are the deliverable. Don't narrate, don't re-describe them,
   don't generate "one more for comparison" unless asked.

### Before regenerating anything, check the library

Run **sylo_image_gen_list** (query/tags/favorite/model filters) before generating something similar —
"another red bike draft" may already exist. `sylo_image_gen_get` gives the full record (params +
`parent_id`) when a remix needs exact values.

### Tag conventions

- Records are auto-tagged `draft` / `final` from the preset when `auto_tag_preset` is on (default).
- Add the operator's **topical tags** — short, lowercase, hyphenated (`red-bike`, `logo-acme`,
  `hero-banner`) — at generate time via `tags`, or afterwards via **sylo_image_gen_organize**
  (`add_tags` / `remove_tags`), which also handles favorites and albums.
- A request like "organize the library into concept albums" / "tag everything with the blue chair"
  is list → organize work — no regeneration.
- **Never delete without asking** — `sylo_image_gen_organize` with `delete: true` removes the file
  AND the record, permanently. Confirm with the operator first and list exactly what you'll delete.

### When things fail

Any backend failure (unreachable ComfyUI, rejected workflow, VRAM errors, no output) → run
**sylo_image_gen_doctor** and act on its report (config echo, GPU/VRAM, node validation, model
download links, library stats). Don't retry blindly.

**Before large finals (esp. flux1-dev/flux2-dev) when VRAM is shared or tight, run
sylo_image_gen_doctor first** — it reports free VRAM and queue depth so you don't spend minutes on
a run that ends in an out-of-memory kill (ComfyUI + other local packages may share one GPU).

### License reminder

Defaults are Apache-2.0 (`z-image-turbo`, `qwen-image-2`, `flux2-klein`). **FLUX dev** models
(`flux1-dev`, `flux2-dev`) produce **non-commercial** outputs — surface that reminder whenever the
operator's use looks commercial (client work, paid marketing, product imagery).