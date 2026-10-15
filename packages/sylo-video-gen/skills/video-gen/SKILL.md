---
name: video-gen
description: Generate local videos via the sylo_video_gen tools (ComfyUI) and curate the workspace video library.
metadata:
  sylo:
    category: media
    icon: film
routes:
  - id: videos
    title: Videos
    icon: film
    nav_section: domain
    entry: routes/videos/index.html
    fallback: routes/videos/fallback.md
route_protocol_version: 0
---

# Video studio

Local video generation with a per-workspace video library — the sylo-image-gen twin. **All-local**:
no cloud services, no provider keys — your own **ComfyUI** install does the GPU work; the package
talks to it over HTTP. Three v1 modes as preset ComfyUI graphs: **clip** (t2v/i2v, draft
`wan22-ti2v-5b` → final `wan22-a14b`), **living-photo loop** (one still + subtle cyclical motion,
first==last-frame conditioning), and **restyle** (whole-clip V2V via `wan21-vace-14b`).

## Agent discipline (v1 tools — plan §3/§8.6)

**Economics — clips cost GPU minutes, not seconds.** Explore at `preset: 'draft'` with
`count: 2` (the hard cap per call); commit **one `final` at a time**, then stop — the clips,
not render loops, are the deliverable. Final renders on A14B are minutes-long; never fire
several in parallel.

**Library-first.** Before generating, run `sylo_video_gen_list` (query/tags/mode/filter + paging
via `offset`) — the render you're about to spend three GPU-minutes on may already exist. After
success, stop: results are in the library.

**Auto-tags + curation.** Every generate result is auto-tagged with its mode + preset
(`clip`/`loop`/`restyle` + `draft`/`final` when `auto_tag_preset` is on) plus any requested tags.
Curate with `sylo_video_gen_organize` (add/remove tags — case-insensitive, favorite, delete).
**Deletes are permanent** (clip + poster + record) — confirm with the operator first, every time.

**Doctor on any failure.** Every failure text ends with a pointer to `sylo_video_gen_doctor` —
run it and read the report before retrying: ComfyUI reachability, GPU/VRAM, per-variant
workflow-node checks, model detection with download links, the durable render ledger, and
library stats. Preflight refusals (queue busy, VRAM below the model's minimum, weights not
detected) are intentional: wait, download, or pick a smaller model — and render finals while
TTS is idle (the GPU is shared).

**Loop prompt guidance (living photos).** Cyclical, subtle, **one movement at a time**: hair
sway, light pulse, drifting cloud layer, slow orbit. `loop_motion_strength` 0–1 scales the
intensity (default 0.5). A loop needs a source still — `from_image_id` (an Images-library
keyframe; the signature combo: keyframes born in Images animate in Videos) or
`source_image_path`.

**Restyle rights note.** Restyling footage grants **no rights to the source material** — verify
the clip's licensing before publishing a restyle; the tool takes what the operator hands it.

**License badges at every selectable surface.** Catalog v1 models are Apache-2.0 (commercial
OK); opt-ins (`ltx-2.5`, `hunyuanvideo-1.5`) bear NON-COMMERCIAL badges and are not wired in v1
(passing their ids fails with a plain rejection); MiniMax-H3 / CogVideoX / Sora are excluded
entirely.

## Tools

| Tool | Purpose |
|------|---------|
| `sylo_video_gen_generate` | 1–2 clips per call (clip / loop / restyle, draft/final, 4n+1 frame rule, VRAM preflight, durable job ledger) |
| `sylo_video_gen_list` | Search the library — text/tags/mode/favorites/model/date range, paginated |
| `sylo_video_gen_get` | Full record + lineage + clip/poster paths (video bytes only when explicitly requested) |
| `sylo_video_gen_organize` | Tag / favorite / delete (confirm before delete) |
| `sylo_video_gen_doctor` | Setup copilot — reachability, GPU/VRAM, model + node checks, ledger health, library stats |

v2 name reservations (scaffold executes, plan §3.6): `sylo_video_gen_upscale`,
`sylo_video_gen_restyle` (deep VACE), `sylo_video_gen_shot_manifest`,
`sylo_video_gen_open_on_canvas`, `sylo_video_gen_poster`.