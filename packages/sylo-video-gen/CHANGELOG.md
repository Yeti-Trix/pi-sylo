# Changelog

All notable changes to the sylo-video-gen package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Package-level
mirror in the style of the root `CHANGELOG.md` and the sylo-image-gen package changelog (the
sylo-image-gen twin keeps one too, starting at v1).

## [Unreleased]

- **A ComfyUI port flip no longer bricks video generation (found live 2026-10-13, mirror of the sylo-image-gen fix):** the operator restarted ComfyUI Desktop and the engine bound :8189 while the config pinned :8188 — preflight refused every call. `shared/comfyui/client.ts` gained `resolveComfyEndpoint(configuredUrl)` (configured wins; loopback sibling 8188/8189 probed on refusal; original returned when dead so error text still names it). The generate tool resolves ONCE and preflight/uploads/object-info-detection/submit all talk to the SAME resolved endpoint; the doctor consumes the returned health (§3.3 stats dedupe kept) and prints a FALLBACK-probe note with an update-hint. Tests mirror the image-gen coverage (down-fallback / up-wins / dead-returns-original / custom-URLs).

- **The Videos dashboard now shows renders in flight — "In progress" cards with elapsed time, ETA and a % bar (operator-requested live 2026-10-13):** the ledger already tracked queued/running rows but the route surfaced nothing until the render returned. LibraryScreen gained a ledger-polled strip (new `ui/src/screens/JobProgress.tsx`, styled in styles.css §5.6b): 5 s unfiltered jobsList poll (zero RPC when idle; double-purpose completion fan fires ONE library refresh the moment a job lands — the new clip appears without a manual refresh). Per job: In progress/Queued badge, mode+model+frames, live-ticked elapsed, ms-per-frame ETA from same-model library history (first render of a model honestly shows "estimating from first render…"), % of estimate capped at 96 (never claims 100 before bytes are on disk), thin progress bar, prompt line.

### Fixed

- **Weights detection works against real ComfyUI — the gate/doctor no longer report every model MISSING
  forever (found live, 2026-10-13):** `shared/comfyui/client.ts` `fileNamesIn()` read node schemas as
  `{ key: […choices] }` on the node object, while a real ComfyUI /object_info nests them as
  `{ input: { required: { key: [[…choices], {tooltip?}] } } }` (verified against a live 0.39.2 build with
  files on disk). `comfyModelsDetected` therefore returned `false` for every catalog model on any live
  server — `sylo_video_gen_generate` refused to submit with a doctor-guided download loop even when the
  operator had already downloaded the files, and the doctor's model table stayed MISSING indefinitely.
  The parser now reads the real shape (`input.required` / `input.optional`, unwraps `[choices, opts]`,
  dedupes across containers) and still tolerates the legacy `{ inputs: { … } }` shape so older installs
  keep detecting. The package test fixtures stopped encoding the wrong API: the detection suite pins the
  real shape (tooltip-wrapped choices + missing-leg case) plus a legacy-shape tolerance case; `test:client`
  27 pass. Corollary: the §8.9 QA-readiness row below (“all 16 catalog file rows missing”) was itself
  computed by these same means against a live server with files present — the ti2v-5B DiT, umt5-fp8 TE and
  wan2.2_vae were already on disk under the Comfy-Desktop **Shared models root** at that time; the QA row
  likely probed a different models dir than `instance-model-paths/…ComfyUI-Shared/models`. Re-run the
  doctor after this fix for an accurate table.

### Added

- **§8.9 — closing sweep: §7-audit defect fixes, docs polish, QA-readiness, operator handoff
  (2026-10-13; agent-side only — relaunch/downloads/QA renders stay operator-side):**
  - **§7-audit defects fixed (the sweep's real-code changes):** (1) `shared/catalog.ts` —
    `wan22-a14b` `approx_size_gb` 43 → **38.1** (byte-verified per-direction sum: DiT pair
    2×14.29 + lightx2v LoRAs 2×1.23 + umt5-fp8 TE 6.74 + wan_2.1_vae 0.25; the entry comment now
    spells the fp8-TE math — the plan's "~42 GB" carried the umt5-fp16 figures — and the
    BOTH-directions ≈69 GB claim stands; the `verify` note + README model table updated to match;
    the catalog test never pinned 43 — it asserts `approx_size_gb > 0`, unchanged). (2)
    `apps/host/src/main/videogen-host.ts` — the on-demand `videogenJobsReplay` loop now skips
    ledger rows driven by THIS process (`activeJobs` guard) with an honest `still_rendering` note
    instead of racing the live driver's poll/save path (previously a replay click mid-route-render
    with a terminal /history could recover the same outputs under a fresh record id — one duplicate
    clip; the app-start sweep is unaffected: `activeJobs` is empty at boot). Not unit-tested by
    parity (imagegen-host ships no host test; exercising the branch needs a stubbed ComfyUI
    server) — the guard is commented in place, and the store-level replay/recovery behaviors keep
    their `test:jobs` coverage. (3) The §7 audit matrix folds into the tracker's §8.9 record with
    the audit-review corrections (GET-only rebound to the replay path specifically, drifted
    citations refreshed, boundary-window note appended).
  - **Docs** — root `CHANGELOG.md` gained the dedicated Video studio feature entry (imagegen
    mirror); package README status rewritten to feature-complete-agent-side + operator handoff;
    the §7-audit-drifted disk figures (≈43) corrected in the README model table + setup section.
  - **QA-readiness (read-only: one `comfyHealth` GET + disk-path checks — no `submit`)**:
    ComfyUI 0.39.2 healthy at `http://127.0.0.1:8188` (RTX 5090, queue idle). Wan weights
    **ABSENT-on-disk** exactly per the doctor-guides-downloads stance: all 16 catalog file rows (13 unique files — deduped across the three entries' lists)
    missing (3 ti2v-5B + 10 A14B + 3 VACE entries, umt5/`wan_2.1_vae` shared); `loras/` and
    `frame_interpolation/` empty. Download order + byte-verified totals recorded in the tracker
    §8.9 row + issue #34 (plan-era "~70 GB" scope estimate pre-dates byte verification — real
    totals ≈ 84 GB one-A14B-direction QA set / ≈ 115 GB full set, decimal GB).
  - **Operator handoff (§8.9 checklist)** — verbatim in the tracker §8.9 row + the issue #34
    final comment: relaunch → doctor-guided downloads → first QA renders (clip draft → i2v from
    an Images still → loop living-photo → restyle; mp4 plays, poster shows, counts 4n+1-exact) →
    canvas confirm (Videos tab dock, library fan refresh). The open VERIFY rows
    (20-min timeout calibration, VACE curve, container-CHOICE lock) anchor on those first renders.

- **§8.8/§6 — the Videos route UI + the canvas dock (2026-10-13):** the dashboard screens are
  built (`ui/src/screens/{GenerateScreen,LibraryScreen,SettingsScreen,DetailDrawer}.tsx` — the
  imagegen twins over `shared/types.ts` subsets mirrored in `ui/src/bridge.ts`; the renderer
  never imports the node-dependent shared code). "Generate": the mode segmented control (Clip ·
  Living photo · Restyle) above the composer, preset chips (clip only — loop/restyle run on the
  final model per §2.2), count 1–2, mode-aware model dropdown (mode_roles ∩ detected + license
  badges), per-mode source fields (source_image_id / source_image_path for loop+i2v — an
  Images-library id or a local path; source_video_id / source_video_path for restyle),
  resolution/orientation/duration chips + model-default framerate, motion/restyle strength
  sliders, seed + lock, negative prompt; the job card (honest elapsed, 1.5 s poll, lineage
  hints — a failed Images-link still is surfaced as a t2v fallback note); a result strip of
  poster-backed `<video preload="metadata">` thumbs with hover-play (muted — v1 clips carry no
  audio); and the §4.3 RENDER-LEDGER card (recent durable jobs.json rows + live ComfyUI queue
  status + the read-only Replay button — the v1 queue/jobs card; the full Queue screen stays
  v2/§6). "Library": 16:9 poster-card grid (hover plays muted; preload drops back to metadata),
  duration/mode badges, search-as-you-type, mode/model/favorite/date filters, delete-with-
  confirm, Load-more paging, and the footer ledger with total render time. "Detail drawer":
  native player + full params + the §3.5 lineage block (source stills/paths + openable remix
  parent) + Remix / "Restyle this clip" prefills + favorite / send-to-agent / copy path / reveal
  (clip or poster) + two-step delete. "Settings": ComfyUI health card + the guided model table
  (detected/missing, per-variant node checks, sizes + min-VRAM, license badges, HF links,
  per-entry repo file lists) + frame_interpolation state + VRAM notes + §2.7 preset defaults +
  the storage card (library bytes + gitignore guidance + §4.3 ledger counts). Canvas (§6): the
  route docks through the GENERIC skill-route machinery — no new canvas kind, canvasTypes
  unchanged — with the full-area header's "Dock in canvas" button now mirroring Images
  (App.tsx's dock predicate widened deliberately for video-gen/videos). Change fan: the route
  consumes `libraryChanged` (source-tagged 'videogen') for live re-queries of library/ledger.
  Route prefs (tab/draft/filters/recents) ride the generic per-skill-namespaced
  readSkillData/writeSkillData. Deviation: destructive actions avoid window.confirm (sandboxed
  route iframes silently block dialogs — inline two-step confirms instead); Generate stays
  mounted (hidden) across tab switches so minutes-long job cards + polls survive (a
  minutes-long-jobs deviation from imagegen's unmount, §4.3/§7's UX reasoning). build:ui
  refreshed the committed route assets (hashed) + fallback twin; skill-surface sync re-run
  (AGENTS.md:124 — the sync-skill-surfaces script scans packages/sylo-*/skills and mirrored
  routes/video-gen into apps/host/test-fixtures). v2/v3 per §6: reservations only — the five v2
  tool scaffolds already registered (§8.6); no new v2/v3 surface code.
- **§8.7 — host plumbing + IPC surface (2026-10-13):** the host now serves the package. New
  `apps/host/src/main/videogen-host.ts` (the imagegen-host.ts twin over the video shared core —
  `videogen:*` IPC composing the same shared modules the agent tools use, doctor parity): config
  get/save (host JSON + schema sidecar), status (health + workspace/library roots + library stats
  + §4.3 ledger counts + optional single-pull doctor probe + the §2.2 catalog), generate
  (tool-shaped resolution → DURABLE queued ledger row → preflight → uploads → ONE submit →
  createRecord pair batch → done/error — every attempt is ledgered), job reads (jobGet/jobsList/
  queueList — the durable ledger is the source of truth; a small JOB_MAP_MAX=60 runtime map tracks
  only this process's route-submitted active jobs), library ops (list/get/organize/delete/reveal
  — reveal resolves clip or poster via the record, never a caller path). §4.3 REPLAY (the §8.5
  residual, issue #34): `videogen:jobsReplay` + an app-start sweep (`videogenWorkspaceHasLedger`
  gate) re-poll ComfyUI `/history/{prompt_id}` for queued/running ledger rows — GETs only
  (/system_stats, /queue, /history, /view), NEVER resubmits; finished outputs recover into the
  library via `createRecord`; dead rows close with honest no-results notes; a ComfyUI-down replay
  is a skip, never a mutation. Renderer: `window.sylo.videogen` preload block + global.d.ts twin,
  the `videoGen*` bridge-op block (incl. doctor + jobs list/replay), the §3.4
  `GENERATED_VIDEO_CAPTION_RE` poster-caption class ('generated-video' → "Generated videos"
  gallery heading), and the §5.5 change-fan CLONE (main's `sylo-video-gen:changed` consumer →
  `videogen:library-changed` → renderer state → sandbox push twin tagged `source: 'videogen'`;
  sibling props `skillRouteVideoLibraryFan` / `videogenLibraryChangedFan` — no generalization of
  the imagegen fan). `LOCAL_MEDIA_EXTENSIONS` gains `.mp4`/`.webm`/`.mov` (§5.4 — without the
  gate extension every route `<video>` sylo-file src 404s). Broker env injection (the §8.1
  residual): `videogenConfigPath` → `SYLO_VIDEOGEN_CONFIG` via `videogenConfigEnvPath()`.
  **Operator relaunch required** (main/preload/renderer changed). Route UI screens stay §8.8.
- **§8.6 — the agent tool surface (2026-10-13):** five v1 tools + five v2 name reservations,
  all registered live in `extensions/index.ts` (the §8 inert scaffold swapped for the real
  register — loads clean in vanilla Pi):
  - `extensions/config.ts` (§2.7 load chain: `SYLO_VIDEOGEN_CONFIG` env →
    `<agentDir>/extensions-config/sylo-video-gen.json` → defaults — the shared coerce in
    `shared/types.ts` stays the single source of truth).
  - **`sylo_video_gen_generate`** (`extensions/tools/generate.ts`, §3.1): catalog-resolution →
    durable `jobs.json` row (§4.3 queued) → PREFLIGHT (health probe, queue-busy refusal, free-VRAM
    vs the catalog's per-model minimum, model-weights detection via `/object_info` with
    doctor-guided download pointers) → running (+ `comfy_prompt_id` captured from the first
    progress event, the §8.7 restart-replay input) → source uploads (multipart — library stills
    for i2v/loop, control clips for restyle) → `comfyGenerateVideo` (ONE submit, count 1–2 fans
    branches, 20-min cap) → per-output `createRecord` clip+poster pair batch (one contiguous
    block on the store's write queue, §4.2) → done/error ledger rows. Returns §3.4 blocks:
    caption `Generated video — model · mode · W×H@fps · len s · seed N` + ≤512 px JPEG
    poster preview + `_localPath` + compact JSON summary (record refs, lineage echo, job id).
    `from_video_id` inherits prompt/seed/resolution(+orientation via a catalog px reverse-map)/
    duration and records `parent_video_id`; in restyle mode with no other source the parent clip
    IS the source. **§3.5 residual — `shared/image-link.ts`** (the §8.5 carve-out):
    `resolveVideoStillLink(from_image_id)` = guarded dynamic `import()` of sylo-image-gen's
    library-store — READ-ONLY (getRecord + its own path helpers only), same workspace root,
    SOFT-FAIL with the canonical plain-language note ("sylo-image-gen not available — pass
    source_image_path or enable Images..."), never a hard error, never a back-write; a loop/
    source-less render surfaces the note as its dependency error, a prompted clip t2v render
    proceeds without the still and carries `image_link_note` in the summary.
  - **`sylo_video_gen_list` / `sylo_video_gen_get`** (§3.2): store twins of the image queries
    (text/tags-AND/favorite/model + the **mode** and **since/until** video additions, limit
    20–100 + offset, newest-first, compact items with clip+poster paths); get = full record +
    lineage + absolute paths, video bytes only behind an explicit `include_video_data` opt-in
    (§3.4: multi-MB b64 in chat is the anti-pattern) + `include_poster_data` for the small first
    frame.
  - **`sylo_video_gen_organize`** (§3.3): tag add/remove (case-insensitive identity, add after
    remove), favorite, delete:true (clip + poster + record — the store's delete policy);
    confirm-first discipline lives in SKILL.md.
  - **`sylo_video_gen_doctor`** (§3.3): config echo + coercion notes, ComfyUI health (GPU/VRAM in
    explicit GiB+GB units, torch/ComUDA echoes), queue depth, the model-catalog table with per-FILE
    detection + per-variant workflow-node class checks (all four graphs; opt-ins reported
    not-wired; missing `frame_interpolation` pack = downgrade-not-blocker), download links +
    license badges, the VRAM PREFLIGHT TABLE vs currently-free VRAM, §4.3 render-ledger health
    (counts by status + stale pending rows flagged for the §8.7 replay), library + disk stats
    (+ recovered rows), and the excluded-models section; read-only GETs only.
  - **§3.6 v2 reservations** (`extensions/tools/v2-scaffold.ts`): `sylo_video_gen_upscale` /
    `_restyle` (deep VACE) / `_shot_manifest` / `_open_on_canvas` / `_poster` — full typebox
    schemas + disclosure-clause executes, zero implementation (names fixed at build time).
  - **`shared/video-jobs-store.ts`** — the §4.3 durable render ledger (`jobs.json`):
    createJob/updateJob/getJob/listJobs (status/since filter = the replay read) + corrupt-ledger
    evidence-keeping (restart empty; the library has the rebuild path, the ledger does not —
    outputs live in the library). The §8.5 row's deferred "job replay" test portion landed here.
  - **`extensions/tools/preview-image.ts`** — the §3.4 poster-preview codec (verbatim clone of
    the tested sylo-image-gen twin; PNG decode → box downscale → baseline JPEG, ≤512 px).
  - **Tests** — `test:tools` (14: name-fixedness + schema roundtrips ×10, coerce interplay
    count/-seed/from_image_id folding, generate param mapping + from_video_id inheritance,
    image-link soft-fail/stub/REAL-store interplay with library.json byte-untouched assertions)
    and `test:jobs` (6: ledger lifecycle, filters, corrupt evidence keeping, single-flight
    stress, no-workspace fail-fast) — both scripts join the package family (esbuild-bundle +
    node --test; test:tools pre-bundles the REAL sylo-image-gen store as a fixture).
  - **§8.2 interplay fixes (found by the new coerce-interplay tests, both latent):**
    (1) `resolveVideoGenRequest` now maps the shared coerce's `-1` absent-seed sentinel to a
    fresh random (it previously threw "between 0 and 4294967295" on every unseeded coerced
    request the §8.7 route would feed it); explicit out-of-range seeds still fail. The landed
    catalog test line updated (-1 now resolves; -2 still throws) — strictly-more-correct per
    §2.1 `seed?`. (2) The same for the `-0`-framerate "model default" sentinel: the coerce emits
    `framerate: 0` when the config default is 0 — the resolver now maps 0 to the model default
    instead of throwing "between 1 and 60".

- **§8.5 — per-workspace video library store (2026-10-12):** `shared/video-library-store.ts` +
  `shared/video-library-store.test.mjs` + the real `test:store` script (retargeted from the §8.1
  stub) — the image-gen library-store twin with video semantics. Layout
  `<workspace>/.sylo/videos/{library.json, files/<yyyy>/<mm>/<id>.<ext> + <id>.poster.png}` (files
  are truth for bytes; the index is operator-readable metadata). Record = the §8.2 `VideoRecord`
  contract verbatim via the shared `coerceVideoRecord` (nothing added to the record shape).
  Atomic tmp+rename index mutations + single-flight in-flight write queue (image-store parity);
  corrupt-index recovery (`library.json.corrupt-<ts>` kept as evidence, rebuild scanning
  `files/` — container-ext-only clips, poster-PNG IHDR dims, mtime created_at, `recovered` tags);
  query filters (text / tags-AND / favorite / model / **mode** / **date-range** — the video
  additions — plus limit/offset pagination, newest-first, compact items with poster paths);
  organize (tags add/remove, favorite; delete removes clip + poster + index row); `from_image_id`
  lineage persisted ONE-WAY (§3.5 — the store never touches the image-gen library); and the §4.5
  change fan `{type: 'sylo-video-gen:changed', workspaceKey, reason}` via guarded `process.send`,
  byte-identical to image-gen's (host routing lands at §8.7). test:store 21 tests, all offline.
  The §8.5 row's other halves — the durable `jobs.json` render ledger (§4.3) and
  `shared/image-link.ts` (§3.5) — ship with their consumers at §8.6/§8.7.

- **§2 review-round fixes (2026-10-12 — three test/provenance defects, all small):
  (1) `shared/catalog.test.mjs` error-message regexes moved into `assert.throws(fn, regex)`'s
  second argument (they had been passed into the called functions' dead arg slots — decorative;
  the fix also exposed two genuinely-wrong message expectations, now matching the resolver's real
  texts). (2) `coerceVideoGenRequest` in `shared/types.ts` emits a plain-language note when `count`
  is clamped into 1–2 (was silent; mirrors the `clamp01` note helper; the catalog resolver's
  out-of-range throw is unchanged). (3) `DEFAULT_WAN_NEGATIVE_PROMPT` in
  `shared/comfyui/workflows.ts` is now the byte-verbatim negative prompt the official ComfyUI
  workflow templates actually ship (the common string — identical in the Wan2.2 5B-ti2v / 14B-i2v /
  14B-flf2v templates; the t2v template adds the "，裸露，NSFW" tail), replacing a shorter
  Wan-2.1-era string that matched no shipped template; code comment + test provenance updated.

- **§2 ComfyUI video backend (§8.2–§8.4, 2026-10-12):**
  - **Types (`shared/types.ts`)** — the full §2.1/§2.3/§4.3 contract: `VideoGenRequest`
    (mode `clip | loop | restyle`; model + preset; resolution/orientation/duration/framerate;
    `loop_motion_strength`/`restyle_strength`; `from_image_id`/`from_video_id` lineage-type fields
    for the §3.5 cross-package tie-in), `VideoRecord` (library row: file_rel + poster_rel +
    video_format + lineage + tags), `JobRecord` (durable render-ledger row, §4.3), `BackendHealth`,
    and plain-language coercers for each (never throw). The VideogenConfig coerce (§8.1) now reads
    the catalog's id list.
  - **Catalog (`shared/catalog.ts`)** — three v1 models (`wan22-ti2v-5b` draft /
    `wan22-a14b` final / `wan21-vace-14b` restyle) with template-verified per-variant ComfyUI
    wiring (t2v/i2v/flf2v/v2v — official 0.11.78 basenames; umt5 + type 'wan'; wan2.2_vae vs
    wan_2.1_vae; lightx2v 4-step LoRA pairs; VACE fp16 file + fp8 load cast — the plan's "~20 GB
    fp8" repack does not exist, corrected to 34.7 GB fp16 + cast), honest decimal-GB sizes from the
    live HF trees, doctor-guided download targets, mode_roles/resolution px/duration limits, opt-in
    `ltx-2.5`/`hunyuanvideo-1.5` (unwired + badged), and `EXCLUDED_VIDEO_MODELS` with reasons
    (MiniMax-H3: US/EU-barring license; CogVideoX: commercial-use permission; Sora: proprietary).
    §2.5 frame tables implemented — d×fps+1 verified (65/81/129@16, 97/121/193@24).
  - **Client (`shared/comfyui/client.ts`)** — ComfyUI video client: health, detected-models,
    submit (400 bodies surfaced verbatim — the dynamic-combo silent-400 guard), poll (SaveVideo
    outputs classified video/poster by extension, container-agnostic), one-shot
    `historyFor` (durable-job replay), `/view` byte fetch, multipart `/upload/image` for feeding
    stills AND control clips, queue-position read, best-effort cancel (delete + interrupt),
    `/object_info` node validation + doctor probe, and the `comfyGenerateVideo` composition.
    20-min default job timeout (env `SYLO_VIDEOGEN_JOB_TIMEOUT_MS`), 2 s poll cadence, typed
    errors incl. `video_output_missing`.
  - **Workflow builders (`shared/comfyui/workflows.ts`)** — one graph per mode: clip t2v/i2v (5B
    draft single-stage · A14B final two-stage high/low + lightx2v), loop living-photo
    (`WanFirstLastFrameToVideo`, same still first+last, pixel-exact in-graph trim of the
    duplicated final frame — no ImageSelector, absent in 0.39.2), restyle (VACE v2v via
    `WanVaceToVideo` with the documented strength curve); every graph saves an in-graph poster PNG
    alongside the video — no ffmpeg in v1. SaveVideo format/codec dynamic-combo shape
    **live-probed and locked to flat string keys (mp4 + h264)** on ComfyUI 0.39.2.
  - **Tests** — `test:catalog` 12, `test:client` 26, `test:workflows` 18 — all offline-green
    (stubbed fetch; esbuild-bundle + node --test).

- **§8.1 scaffold (2026-10-12):** package twin of sylo-image-gen — `package.json`
  (`pi.extensions` / `pi.skills: ['video-gen']`, `build:ui`, `test:*` esbuild-bundle + `node --test`
  scripts for the package tests landing at §8.2–§8.5), inert `extensions/index.ts` (zero tools;
  the five v1 tools + v2 reservations wire at §8.6), `shared/types.ts` config subset
  (`VideogenConfig` §2.7 keys + `DEFAULT_VIDEOGEN_CONFIG` + `coerceVideogenConfig` with
  plain-language invalid-value notes — single source of truth imported by host
  `apps/host/src/main/videogen-config.ts`), `skills/video-gen/SKILL.md` (Videos route frontmatter
  + v0 discipline note), `ui/` Vite React skeleton (Sylo dark tokens, bridge RPC stub, minimal
  placeholder shell), `scripts/postbuild-ui.mjs` (fallback-copy twin), README + CHANGELOG stubs,
  and the host registry entry (id `sylo-video-gen`, title **Video studio**, `requiresSyloUi: true`).
  Host config JSON-schema sidecar into `extensions-config/`. Tool surface, host IPC, and route
  screens: §8.6 / §8.7 / §8.8.