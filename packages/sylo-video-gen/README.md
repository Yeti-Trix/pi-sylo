# sylo-video-gen

Local-first video generation for Sylo — the **sylo-image-gen twin**: agent tools, a per-workspace
**video library**, and the **Videos** sidebar route — powered entirely by a local **ComfyUI** install.
All-local: no cloud providers, no provider keys, no Python on Sylo's side (ComfyUI does the GPU work;
the package talks to it over HTTP, detects it, never spawns it).

**Status: feature-complete agent-side (§8.1–§8.9 all landed, final gates green)** — the five v1
tools (generate / list / get / organize / doctor) are live against the shared catalog + client +
store, the `videogen:*` IPC + fan/replay plumbing serves the route, and the **Videos** dashboard
(Generate · Library · Settings + detail drawer) with its canvas dock is built. What remains is
**operator-side (§8.9 handoff)**: relaunch Sylo, run the doctor-guided Wan weight downloads
(≈84 GB one-direction QA set / ≈115 GB full set — the weights are not on disk yet), and run the
first manual QA renders, which anchor the open VERIFY rows (mp4/codec choice confirmed at render,
20-min timeout calibration, VACE strength mapping). Until then nothing generates videos
end-to-end — the tools and the route both preflight and say so plainly.

## Modes (plan §1 — thin slice, deliberately shallow)

1. **clip** — t2v and i2v shot clips, ~5 s: draft `wan22-ti2v-5b` (720p@24), final `wan22-a14b`
   (480p/720p@16, lightx2v 4-step LoRA two-stage high/low-noise sampling).
2. **loop** — living-photo / cinemagraph: one still + subtle cyclical motion; first==last-frame
   conditioning (`WanFirstLastFrameToVideo`) as the mode's core mechanic; the duplicated final frame
   is trimmed in-graph (pixel-exact 80-frame loops at 5 s@16 — no ImageSelector, absent in 0.39.2);
   optional native frame interpolation (off until the `frame_interpolation` pack is installed).
3. **restyle** — whole-clip V2V via `wan21-vace-14b` with a strength knob (masks / object
   replacement v2).

Out of scope (operator decisions): audio/beat sync, timeline/assembly (operator stitches in DaVinci
Resolve), cloud providers, bundled ffmpeg (detect-not-bundle), SQLite/FTS, MiniMax-H3 / CogVideoX /
Sora (license- or proprietary-excluded). Catalog v1 models are Apache-2.0, commercial-ok, Comfy-Org
repacks; opt-in extras (`ltx-2.5`, `hunyuanvideo-1.5`) are present-but-unwired and badged
NON-COMMERCIAL — the builders reject them until a wiring round lands.

## The model catalog (§2.2) — what's verified

| id | role | modes | fps | disk (decimal GB, HF-verified) | min VRAM | license |
|----|------|-------|-----|------|----|---------|
| `wan22-ti2v-5b` | draft | clip (t2v/i2v) | 24 | ≈18.2 (DiT 10.0 + umt5 6.7 + VAE 1.4) | ≈16 | Apache-2.0 · commercial OK |
| `wan22-a14b` | final | clip (t2v/i2v) + loop | 16/24 | ≈38.1 per clip direction (DiT pair 28.6 + umt5-fp8 TE 6.7 + VAE 0.25 + LoRAs 2.5); both directions ≈69 | ≈24 | Apache-2.0 · commercial OK |
| `wan21-vace-14b` | restyle | restyle (v2v) | 16 | ≈41.7 (fp16 DiT 34.7 cast to fp8 at load + TE 6.7 + VAE 0.25) | ≈24 | Apache-2.0 · commercial OK |

Download targets are doctor-guided HuggingFace repacks (`Comfy-Org/Wan_2.2_ComfyUI_Repackaged`,
`Comfy-Org/Wan_2.1_ComfyUI_repackaged`) — exact `split_files/...` paths live in the catalog
(`repo_files`). Excluded with reasons (see `EXCLUDED_VIDEO_MODELS`): MiniMax-H3 (license excludes
US/EU), CogVideoX (commercial requires permission), Sora/anything proprietary.

## The four workflow graphs (§2.4) — one builder per mode

Builders compose ONLY from the catalog's wiring (no path literals), validate the 4n+1 latent rule
(`d×fps+1` — verified table 65/81/129@16, 97/121/193@24), and every graph saves a first-frame PNG
poster in-graph (`sylo-video/poster`) — **no ffmpeg in v1**.

- **clip t2v/i2v** — draft: `Wan22ImageToVideoLatent` (start_image optional → t2v passes none),
  KSampler 20/cfg 5/uni_pc + ModelSamplingSD3 shift 8. final: TWO fp8 DiTs
  (high→low noise) behind lightx2v 4-step LoRAs + ModelSamplingSD3 shift 5, two-stage
  `KSamplerAdvanced` split 2/4; latent = `EmptyHunyuanLatentVideo` (t2v) / `WanImageToVideo` (i2v).
- **loop** — `WanFirstLastFrameToVideo` with the SAME still at first+last; the duplicated final
  frame is cut post-decode by `ImageFromBatch(batch_index 0, length frames−1)` (image-level,
  duration-exact — latent-level trimming quantizes in 4-frame steps and misses the exact 4/5/8 s
  outputs; documented decision). `FrameInterpolate` rides between trim and encode when enabled.
- **restyle** — `LoadVideo` → `GetVideoComponents` → `WanVaceToVideo`(control_video, strength =
  `0.2 + 0.8 × strength` — documented curve, first-render calibration pending); KSampler
  20/cfg 6/uni_pc; fp16 file loaded with fp8 cast (no official fp8 repack exists).

The official Wan negative prompt ships verbatim as the builder default.

## ComfyUI client (§2.3)

`shared/comfyui/client.ts` — health `/system_stats`+`/queue` → `BackendHealth`; submit `POST /prompt`
(400 bodies surfaced verbatim — dynamic-combo shape mistakes name themselves); poll `/history/{id}`
(`SaveVideo` outputs arrive under the `images` key; video/poster classified by extension);
`/view` fetches any output bytes; `POST /upload/image` feeds local stills AND control clips into
LoadImage/LoadVideo; queue-position read + best-effort cancel (delete-queued + interrupt — never
touches anything it didn't create). Job timeout **20 min default** (configurable via
`SYLO_VIDEOGEN_JOB_TIMEOUT_MS` env, minutes 1–240, or per call; the 20-min figure is a calibration
estimate — VERIFY at the first real final render). Poll cadence 2 s.

The SaveVideo container/codec inputs (`format`, `codec`) are `COMFY_DYNAMICCOMBO_V3` dynamic
combos — the `/prompt` API format was **live-probed and locked to flat string keys**
(`format: 'mp4'`, `codec: 'h264'`; output confirmed `.mp4`); builders + tests assert the flat
shape.

## Tools (§3 — live as of §8.6)

| Tool | Purpose |
|------|---------|
| `sylo_video_gen_generate` | 1–2 clips per call — mode clip/loop/restyle, draft→final presets, from_image_id/from_video_id lineage, VRAM + queue + weights preflight, durable job ledger rows, poster-preview result blocks |
| `sylo_video_gen_list` | Search the library — text / tags-AND / favorite / model / mode / date range, paginated compact records |
| `sylo_video_gen_get` | Full record + lineage + absolute clip/poster paths; video bytes only when explicitly requested (multi-MB) |
| `sylo_video_gen_organize` | Tag add/remove (case-insensitive dedupe), favorite, delete-with-confirm (clip + poster + record) |
| `sylo_video_gen_doctor` | Setup copilot — config echo, ComfyUI health, model detection + per-variant node checks, download links + license badges, VRAM preflight table, render-ledger health, library stats |

Five v2 names are **reserved with full schemas + disclosure-clause executes** (§3.6,
`extensions/tools/v2-scaffold.ts`): `sylo_video_gen_upscale` (SeedVR2/Real-ESRGAN/RIFE in-graph),
`sylo_video_gen_restyle` (deep VACE: masks, object replacement, ref2v),
`sylo_video_gen_shot_manifest`, `sylo_video_gen_open_on_canvas`, `sylo_video_gen_poster`
(arbitrary-timestamp extraction, external ffmpeg).

### Images → Videos lineage (§3.5)

`from_image_id` seeds i2v/loop renders with a still from the IMAGES library via
`shared/image-link.ts` — a **guarded dynamic `import()`** of sylo-image-gen's library-store,
**read-only** (getRecord only, same workspace root), **soft-failing** with a plain-language note
(`sylo-image-gen not available — pass source_image_path or enable Images`) when the package is
uninstalled/disabled/missing, and **never a back-write** into the image library (one-way
lineage; the video record stores `lineage.source_image_id` + the resolvable path). sylo-image-gen
can be uninstalled entirely without breaking this package. Video→video ties (restyle sources,
`from_video_id` remix lineage) stay inside the video store.

### Render ledger (§4.3)

Every generate call persists a `jobs.json` row (durable, atomic tmp+rename writes behind a
single-flight queue): the resolved request → queued → running (+ comfy_prompt_id, captured from
the first progress event) → done (output record ids) / error (the plain-language failure).
Minutes-long renders survive Sylo restarts: the §8.7 host job ops (`videogen:jobGet`/
`jobsList`/`queueList` over main/videogen-host.ts) read this ledger as the source of truth (only
route-submitted in-process runs additionally live in a small JOB_MAP_MAX=60 runtime map), and the
**replay** (app-start sweep + `videogen:jobsReplay`) re-polls ComfyUI `/history/{prompt_id}` for
queued/running rows, recovering finished outputs into the library — read-only GETs, never a
resubmit, and a plain skip while ComfyUI is down.

### Chat-inline results (§3.4)

Generate returns a ≤512 px JPEG preview of the **in-graph poster** per clip with the caption
`Generated video — model · mode · W×H@fps · len s · seed N` (grouped under the renderer's
“Generated videos” heading since §8.7 — `GENERATED_VIDEO_CAPTION_RE` keeps local media out of the
untrusted class) and a compact JSON summary (record ids/paths/params/jobs + lineage). The clip
itself is never inlined in chat — the route/detail player owns playback.

## Setup

1. **Enable** — Capability manager → **Video studio** (sylo-video-gen).
2. **ComfyUI** — external dependency (never bundled): default API `http://127.0.0.1:8188`
   (configurable via the extension config / `<userData>/sylo-video-gen/config.json`).
3. **Models** — Wan 2.2/2.1 weights download as Comfy-Org repacks (≈18–42 GB per model; byte-verified
   set totals ≈ 84 GB with one A14B direction, ≈ 115 GB with both clip directions — decimal GB);
   the doctor guides the downloads and reports free VRAM vs per-model minimums before big runs.
4. **Diagnostics** — ask the agent to run **`sylo_video_gen_doctor`** (§8.6, live): config echo,
   reachability, GPU/VRAM (+ the explicit-units preflight table), installed models with HF links
   + license badges, per-variant workflow-node checks, `frame_interpolation` availability
   (RIFE/FILM is download-or-downgrade), durable-job health (§4.3), library stats. The generate
   tool preflights (health/queue/VRAM/weights) before every submit and refuses in plain language.

## Video library

Videos land in `<workspace>/.sylo/videos/` — `library.json` (metadata index), `jobs.json` (durable
render ledger — minutes-long renders survive a Sylo relaunch, image-gen's in-memory jobs would not;
landed at §8.6 (`shared/video-jobs-store.ts`; the host job ops + restart replay ride it at §8.7), and `files/<yyyy>/<mm>/<id>.mp4` + `<id>.poster.png`
(in-graph first frame — no ffmpeg in v1). Per-workspace by design. Tip: gitignore
`.sylo/videos/files/` (multi-MB per clip), keep the two JSONs.

The store (`shared/video-library-store.ts`, §8.5) is the image-gen library-store twin: atomic
tmp+rename index writes behind a single-flight in-flight write queue, corrupt-index recovery
(`library.json.corrupt-<ts>` + rebuild from `files/` with poster-PNG IHDR dims + `recovered` tags),
query filters (text / tags-AND / favorite / model / mode / date-range + pagination), organize
(tags + favorite; delete removes clip + poster + row), and the §4.5 change fan
(`sylo-video-gen:changed` `{workspaceKey, reason}` — guarded `process.send`, routed to the Videos
route at §8.7). `from_image_id` lineage (§3.5) is persisted one-way — the store
never touches the image-gen library.

## Config (§2.7)

Snake_case keys shared by extension + host: `comfyui_url`, `draft_model`, `final_model`,
`restyle_model`, `default_resolution`, `default_orientation`, `default_duration_seconds`,
`default_framerate` (0 = model default), `loop_motion_strength`, `auto_tag_preset`,
`comfyui_exe_path`. Defaults + coercion live in `shared/types.ts` (single source of truth with host
main) and invalid values fall back with plain-language notes the doctor echoes.

## Host plumbing (§5, §8.7)

The host serves the package the way it serves Images — `apps/host/src/main/videogen-host.ts`
(the imagegen-host twin) composes the same shared modules the agent tools use behind the
`videogen:*` IPC surface: `configGet`/`configSave` (host-owned `<userData>/sylo-video-gen/
config.json` + schema sidecar), `status` (health + roots + library stats + ledger counts + the
optional doctor probe + catalog), `generate` (a DURABLE-LEDGER route job: resolve → queued →
preflight → uploads → one submit → library pair-batch → done/error), `jobGet`/`jobsList`/
`queueList` (ledger-backed; job cards survive restarts), library `libraryList`/`videoGet`/
`videoUpdate`/`videoDelete`, `jobsReplay` (§4.3), and `revealFile` (clip or poster —
record-resolved only). The change fan (`sylo-video-gen:changed` → `videogen:library-changed`)
is a CLONE of the image-gen fan (plan §5.5, tagged `source: 'videogen'`; both routes tolerate
the other's nudge), `LOCAL_MEDIA_EXTENSIONS` gained `.mp4`/`.webm`/`.mov` for the
`sylo-file://` video srcs, and the broker child reads the host config via `SYLO_VIDEOGEN_CONFIG`.

## Videos route + canvas (§5.6/§6 — landed at §8.8)

The route is a package-owned Vite React app whose production build ships IN the package
(`skills/video-gen/routes/videos/{index.html, assets/}` — hashed assets + `fallback.md` via the
postbuild twin); the host sandbox serves it as a persistent skill-route with real bridge RPC and
degrades to the fallback chat-first doc without the desktop host. Same look/feel as Images (the
dark Sylo tokens + component styles, `--vg-*` prefixed).

- **Generate** — the mode segmented control (Clip · Living photo · Restyle) above the composer;
  preset chips (draft/final, clip only — loop/restyle run on the final model §2.2), count 1–2,
  mode-aware model dropdown (mode_roles ∩ detected) with license badges, per-mode source fields
  (still for clip-i2v/loop — an Images-library id `source_image_id` or a local path;
  clip for restyle — `source_video_id` or path, ids auto-sent as the right field), duration /
  resolution / orientation chips + model-default framerate, motion/restyle strength sliders, seed
  + lock, negative prompt; job card with honest elapsed + 1.5 s poll + lineage hints; result strip
  of in-graph-poster-backed `<video preload="metadata">` thumbs with hover-play; and the §4.3
  **render-ledger card** (recent durable rows + live ComfyUI queue status + the read-only
  Replay) — the v1 queue/jobs surface while the full Queue screen stays v2. Draft strip picks
  carry ↻final (`from_video_id` lineage rerun); the generate-stays-mounted-when-hidden tweak keeps
  minutes-long job cards alive across tab switches.
- **Library** — 16:9 grid of poster-backed native videos (hover plays muted, preload drops back
  to metadata), duration + mode badges, search-as-you-type, mode/model/favorite/date filters,
  delete-with-confirm cards, Load-more paging (24/page), and the footer ledger
  “N clips · M favorites · X GB · total render H:MM”.
- **Detail drawer** — native `<video controls>` player (click-through opens the OS player), full
  params (format/frames/render time/seed/ledger id), the §3.5 lineage block (Images-source still,
  source paths with copy, remix parent — openable), Remix / “Restyle this clip” composer prefills,
  favorite, Send to agent, Copy path, Reveal clip / Reveal poster, two-step delete.
- **Settings** — ComfyUI health card (GPU/VRAM in GiB + decimal GB, version, queue), the guided
  model table (detected/missing, per-variant node checks, sizes, min-VRAM, license badges, model
  dirs, HF card + per-entry repo file list), the frame_interpolation pack state + VRAM notes
  (§7), preset defaults (models/resolution/orientation/duration/framerate/loop strength/auto-tag
  → configSave), and the storage card (library root + bytes + `.sylo/videos/files/` gitignore
  guidance + §4.3 ledger counts + replay hint).
- **Agent-side library mutations** fan live: `libraryChanged` (tagged `source: 'videogen'`)
  re-queries the library/ledger inside an already-open route — no manual refresh (§5.5).

**Canvas (§6 v1):** the route docks as a canvas tab through the GENERIC skill-route machinery
(`canvasTypes.ts` 'skill-route' + `useCanvasTabs.openSkillRouteTab` + WidgetPane's route branch,
which threads the videogen fan + per-route bridge) — the full-area route header's “Dock in
canvas” button now mirrors Images (the `isDockableImagesRoute` predicate widened deliberately
for `video-gen/videos`, per §6's plan-locked v1 scope). **No new canvas kind** — canvasTypes is
unchanged by design.

**v2/v3 disposition (§6, reservations only in v1):** the v2 list — Queue SCREEN (durable ledger +
cancel via `/interrupt`, route-owned jobs only; the ledger card above is the v1 stance), deep
restyle UX (VACE mask draw / object replacement / ref2v), `sylo_video_gen_upscale`,
`sylo_video_gen_open_on_canvas` (a host canvas snapshot kind 'video' — poster + native player;
the smallest-change host note is captured on the v2 scaffold), `sylo_video_gen_poster`
(external ffmpeg, detect-not-bundle), `sylo_video_gen_shot_manifest`, change-fan polish — is
RESERVED: the five tool names ship as disclosure-clause scaffold executes
(`extensions/tools/v2-scaffold.ts`, §8.6) and nothing was added to the host. v3 stays exploratory
(individually cuttable): FramePack long-form I2V, style-reference presets, S2V audio-driven clips,
batch/CSV, hover-scrub filmstrips — documented here, no code.

## Package tests

`npm run test:catalog` (§2.2 defaults + fields + download shapes + frame tables + the §8.6 seed
sentinel fix), `npm run test:client` (stubbed-`fetch` HTTP contract incl. 400-body propagation +
upload/queue/cancel), `npm run test:workflows` (the four builders + 4n+1 tables + the locked flat
dynamic-combo shape), `npm run test:store` (§8.5 — index round-trips, full filter matrix,
organize semantics, corrupt-index recovery + rebuild, single-flight write-queue stress,
change-fan + lineage discipline), `npm run test:jobs` (§8.6 — the §4.3 durable render ledger:
lifecycle, filters + replay read, corrupt-ledger evidence keeping, single-flight stress,
no-workspace fail-fast), and `npm run test:tools` (§8.6 — tool-name fixedness + schema
roundtrips for all ten registrations, coerce-interplay between the shared request coerce and the
catalog resolver, §3.5 image-link soft-fail/stub/real-store interplay with no-back-write file
assertions, §3.4 preview-codec smoke). All offline — no ComfyUI required.