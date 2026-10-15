/**
 * sylo-video-gen — host main-process bridge for the sidebar Videos route
 * (plan §5.2, §8 step 7). Twin of main/imagegen-host.ts over the video shared
 * core: the route runs as a package-owned Vite iframe and cannot reach
 * ComfyUI's HTTP API directly, so it talks to the host via the skill-route
 * bridge (postMessage → renderer dispatch → `window.sylo.videogen.*` →
 * `videogen:*` IPC → this module).
 *
 * Doctor parity (§3.3, imagegen-host header twin): this module composes the
 * SAME shared modules the agent tools use — `comfyHealth`/`comfyDoctorProbe`
 * (§2.3 client), `resolveVideoGenRequest` (§2.2 catalog), `getRecord`/
 * `createRecord`/`queryLibrary`/`organizeRecords` (§4 video library store),
 * and the §4.3 durable `jobs.json` ledger (`createJob`/`updateJob`/`getJob`/
 * `listJobs` — video-library-store's sibling). Route ops call the same store
 * APIs with an EXPLICIT `workspaceCwd` (main has no SYLO_PI_CWD — tasks-db.ts
 * parity); no file scans; library/ledger mutations keep the store's atomic
 * read-modify-write semantics (§4.2 two-writers stance).
 *
 * THE DELIBERATE DIVERGENCE FROM IMAGE-GEN (§4.3: durable jobs, not a Map):
 * imagegen-host.ts keeps its route jobs in an in-memory `Map` (JOB_MAP_MAX = 60)
 * because image renders are seconds-long and ComfyUI owns the jobs server-side.
 * Video renders are minutes-long — a Sylo restart mid-render must NOT orphan
 * them invisibly, so every route job is persisted in `jobs.json` and THIS
 * module keeps only a SMALL runtime map (JOB_MAP_MAX parity, 60) for the
 * ACTIVE-jobs view: jobs the ROUTE submitted in this process (driving runs).
 * jobGet/jobsList fall back to the durable ledger for everything else
 * (agent-tool jobs, rows from a previous process) and hydrate output paths, so
 * job cards show honest elapsed time across restarts. §4.3 REPLAY (the §8.5
 * residual recorded on issue #34): after a Sylo relaunch — on app start
 * (main/index.ts sweeps known workspaces) AND on demand (`videogen:jobsReplay`)
 * — the host re-polls ComfyUI `/history/{prompt_id}` for ledger rows stuck in
 * queued/running with a comfy_prompt_id, recovers finished outputs into the
 * library via `createRecord`, and marks genuinely-dead rows error. Replay is
 * READ-ONLY against ComfyUI (`/system_stats` + `/queue` + `/history/{id}` +
 * `/view` GETs only): it NEVER resubmits a workflow — a queued row without a
 * prompt id cannot be replayed at all and is left with a plain-language note.
 * ComfyUI-down is a skip, never a mutation: rows are untouched and retried on
 * the next app start / replay call.
 *
 * Route-side generate (§5.2): `videogenGenerate` builds the same request
 * shaping the agent tool uses (extensions/tools/generate.ts): same
 * from_video_id inheritance (prompt/seed/resolution/duration — never inherited
 * when the request says otherwise) and the same restyle-source resolution, but
 * the cross-package still link (from_image_id, §3.5) resolves through a STATIC
 * import of sylo-image-gen's library-store — in the bundled host main the
 * shared/image-link.ts guarded dynamic-import seam cannot resolve (its
 * runtime `import.meta.url` specifier points outside the bundle), while host
 * main bundles BOTH optional packages' shared code statically (imagegen-host.ts
 * precedent), so the §3.5 contract is kept at the call site instead: READ-ONLY
 * getRecord + same workspace root + soft-fail plain-language reasons + NEVER a
 * back-write into the image library.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  organizeRecords,
  queryLibrary,
  createRecord,
  getRecord,
  loadLibrary,
  resolveLibraryRoot,
  videoFileAbs,
} from '../../../../packages/sylo-video-gen/shared/video-library-store.js'
import {
  createJob,
  updateJob,
  getJob,
  listJobs,
  loadJobs,
} from '../../../../packages/sylo-video-gen/shared/video-jobs-store.js'
import {
  comfyDoctorProbe,
  comfyFetchOutputBytes,
  comfyGenerateVideo,
  comfyHealth,
  comfyModelsDetected,
  comfyQueuePosition,
  comfyUploadFile,
  effectiveJobTimeoutMs,
  historyFor,
  ComfyUIError,
  type ComfyDoctorProbe,
  type ComfyOutputRef,
  type ComfyHistorySnapshot,
} from '../../../../packages/sylo-video-gen/shared/comfyui/client.js'
import {
  findVideoModelEntry,
  resolutionPxFor,
  resolveVideoGenRequest,
  VIDEO_DURATIONS_SECONDS,
  VIDEO_MODEL_CATALOG,
  type VideoGenRequestInput,
} from '../../../../packages/sylo-video-gen/shared/catalog.js'
import {
  coerceVideoGenRequest,
  type BackendHealth,
  type JobRecord,
  type VideoGenRequest,
  type VideoMode,
  type VideoRecord,
} from '../../../../packages/sylo-video-gen/shared/types.js'
// §3.5 cross-package still link — STATIC import of the sibling store's READER
// only (module doc above): read-only getRecord + root/abs helpers; no
// createRecord/organizeRecords edge, no image-library back-writes.
import {
  getRecord as imagegenGetRecord,
  resolveLibraryRoot as imagegenResolveLibraryRoot,
  imageFileAbs as imagegenImageFileAbs,
} from '../../../../packages/sylo-image-gen/shared/library-store.js'
import { readVideogenConfig } from './videogen-config.js'

// ── Payload helpers (ipcMain passes raw unknowns — coerce defensively) ──────

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function cutErrorText(err: unknown, max = 600): string {
  const text = errText(err)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const GIB = 1024 ** 3

function formatBytes(n: number): string {
  if (n >= GIB) return `${(n / GIB).toFixed(1)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${n} B`
}

// ── Job snapshots (durable ledger row + hydrated display outputs) ───────────

export interface VideogenJobOutput {
  id: string
  path: string
  poster_path?: string
  width: number
  height: number
  framerate: number
  duration_seconds: number
  seed: number
  bytes: number
  render_ms?: number
}

export interface VideogenJobSnapshot {
  id: string
  /** The RESOLVED request the job runs (ledger row verbatim). */
  request: VideoGenRequest
  status: 'queued' | 'running' | 'done' | 'error'
  error?: string
  comfy_prompt_id?: string
  created_at: string
  started_at?: string
  finished_at?: string
  /** Running rows: honest wall-clock elapsed (§4.3 — survives process swaps). */
  elapsed_ms?: number
  output_record_ids: string[]
  /** Hydrated display outputs (records resolved read-only; route cards). */
  outputs: VideogenJobOutput[]
  /** Where the row came from: this process's runtime map (route-submitted) or
   *  the durable ledger (agent-tool jobs + pre-restart rows). Display hint. */
  source: 'route' | 'ledger'
}

/** Route-side runtime map of jobs THIS process submitted (driving runs). */
interface VideogenActiveJob {
  /** The ledger row snapshot this module last wrote for the job. */
  row: JobRecord
  /** Hydrated outputs as createRecord settles (route card display rows). */
  outputs: VideogenJobOutput[]
  startedAtMs: number
}

const JOB_MAP_MAX = 60

/** Active route jobs map (jobId → driving state) — imagegen-host's JOB_MAP_MAX
 *  = 60 parity; the DURABLE ledger is the source of truth, this map only tracks
 *  in-process runs (a longer-lived map would lie after a restart). */
const activeJobs = new Map<string, VideogenActiveJob>()

function pruneJobs(): void {
  if (activeJobs.size <= JOB_MAP_MAX) return
  for (const [id, job] of activeJobs) {
    if (activeJobs.size <= JOB_MAP_MAX) break
    if (job.row.status === 'done' || job.row.status === 'error') activeJobs.delete(id)
  }
}

/** Job output display row from a library record; abs paths when a root resolves. */
function recordToOutput(rec: VideoRecord, libraryRoot: string | null): VideogenJobOutput {
  const path = libraryRoot ? videoFileAbs(libraryRoot, rec.file_rel) : rec.file_rel
  return {
    id: rec.id,
    path,
    ...(rec.poster_rel ? { poster_path: libraryRoot ? safeVideoFileAbs(libraryRoot, rec.poster_rel) : rec.poster_rel } : {}),
    width: rec.resolution.width,
    height: rec.resolution.height,
    framerate: rec.framerate,
    duration_seconds: rec.duration_seconds,
    seed: rec.seed,
    bytes: rec.bytes,
    ...(rec.render_ms ? { render_ms: rec.render_ms } : {}),
  }
}

/** Never throws on a tampered rel (videoFileAbs does that); falls back to the rel. */
function safeVideoFileAbs(libraryRoot: string, fileRel: string): string {
  try {
    return videoFileAbs(libraryRoot, fileRel)
  } catch {
    return fileRel
  }
}

/** Hydrate a ledger row into the display snapshot (outputs → records, abs paths). */
async function snapshotFromLedgerRow(
  row: JobRecord,
  workspaceCwd: string | undefined,
): Promise<VideogenJobSnapshot> {
  const libraryRoot = resolveLibraryRoot({ workspaceCwd })
  const hydrated: VideogenJobOutput[] = []
  for (const id of row.output_record_ids ?? []) {
    const rec = await getRecord({ video_id: id, workspaceCwd })
    if (rec) hydrated.push(recordToOutput(rec, libraryRoot))
  }
  return {
    id: row.id,
    request: row.request,
    status: row.status,
    error: row.error,
    comfy_prompt_id: row.comfy_prompt_id,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    ...(row.status === 'running' && row.started_at && Number.isFinite(Date.parse(row.started_at)) ?
        { elapsed_ms: Date.now() - Date.parse(row.started_at) }
      : {}),
    output_record_ids: [...(row.output_record_ids ?? [])],
    outputs: hydrated,
    source: 'ledger',
  }
}

function snapshotFromActiveJob(job: VideogenActiveJob): VideogenJobSnapshot {
  const row = job.row
  return {
    id: row.id,
    request: row.request,
    status: row.status,
    error: row.error,
    comfy_prompt_id: row.comfy_prompt_id,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    ...(row.status === 'queued' || row.status === 'running' ? { elapsed_ms: Date.now() - job.startedAtMs } : {}),
    output_record_ids: [...(row.output_record_ids ?? [])],
    outputs: [...job.outputs],
    source: 'route',
  }
}

// ── §5.2 generate — route job start (tool-shaped resolution + ledger) ───────

/** Reverse map: parent record px → its catalog resolution/orientation (from_video_id inheritance). */
function resolutionFromRecordPx(
  parent: Pick<VideoRecord, 'model' | 'resolution'>,
): { resolution: '480p' | '720p'; orientation: 'landscape' | 'portrait' } | undefined {
  const entry = findVideoModelEntry(parent.model)
  if (!entry) return undefined
  for (const resolution of entry.resolutions) {
    const rows = entry.resolution_px[resolution]
    if (!rows) continue
    for (const orientation of ['landscape', 'portrait'] as const) {
      const pair = rows[orientation]
      if (pair && pair.width === parent.resolution.width && pair.height === parent.resolution.height)
        return { resolution, orientation }
    }
  }
  return undefined
}

/** Read a source file for upload with a plain-language failure (tool parity). */
function readSourceBytes(path: string, what: string): Uint8Array {
  try {
    const bytes = readFileSync(path)
    if (bytes.byteLength === 0) throw new Error('the file is empty')
    return new Uint8Array(bytes)
  } catch (err) {
    throw new Error(
      `The ${what} "${path}" could not be read (${err instanceof Error ? err.message : String(err)}) — ` +
        'pass an existing local path, or a library id that resolves to an existing file instead.',
    )
  }
}

/** ComfyUI-input upload name: prefixed + call-unique so concurrent calls never clobber (tool parity). */
function uploadNameFor(sourcePath: string): string {
  const short = randomUUID().slice(0, 8)
  return `sylo-video-${short}-${basename(sourcePath).replace(/[^A-Za-z0-9._-]+/g, '_')}`
}

export interface VideogenGenerateArgs extends Record<string, unknown> {
  /** Host-resolved workspace cwd (parity with the tasks ops injection). */
  workspaceCwd?: string
  /** app.getPath('userData') — host config home. */
  userDataPath: string
  /** The route request: mode/preset/resolution/duration/seed/tags (+ from_video_id / from_image_id). */
  request: Record<string, unknown>
}

export interface VideogenGenerateResult {
  ok: true
  job: VideogenJobSnapshot
  /** Plain-language notes (shaping coercions + the §3.5 soft-fail link note). */
  notes: string[]
}

/**
 * videogenGenerate: resolve the route request like the agent tool does, append
 * a DURABLE queued ledger row (§4.3), then drive the render in the background
 * (the composer polls `videogen:jobGet`). Preflight failures land as honest
 * ledger error rows (the row is created BEFORE preflight — every attempt is
 * ledgered, the agent-tool discipline). Resolution errors surface as plain op
 * errors and ledger NOTHING (the request never became a resolvable render —
 * the agent tool's exact order).
 */
export async function videogenGenerate(args: VideogenGenerateArgs): Promise<VideogenGenerateResult> {
  const config = readVideogenConfig(args.userDataPath)
  const raw = (args.request && typeof args.request === 'object' ? args.request : {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

  // One-source prevalidation (tool parity — ambiguous requests fail plainly
  // instead of last-write-wins).
  if (str(raw.source_image_path) && (str(raw.source_image_id) || str(raw.from_image_id))) {
    throw new Error(
      'Give ONE image source: source_image_id / from_image_id (an IMAGES-library still) or source_image_path (a local file) — not both.',
    )
  }
  if (str(raw.source_video_path) && str(raw.source_video_id)) {
    throw new Error('Give ONE restyle source: source_video_id (a VIDEO-library clip) or source_video_path (a local file) — not both.')
  }

  // ── from_video_id remix inheritance (§3.1 tool parity) ───────────────────
  const fromVideoId = str(raw.from_video_id) || undefined
  let parent: VideoRecord | undefined
  if (fromVideoId) {
    parent = (await getRecord({ video_id: fromVideoId, workspaceCwd: args.workspaceCwd })) ?? undefined
    if (!parent)
      throw new Error(
        `No library clip with id "${fromVideoId}" — refresh the Library tab for current ids (records disappear when deleted).`,
      )
  }

  // ── §3.5 from_image_id cross-package still link (READ-ONLY, soft-fail) ───
  const fromImageId = str(raw.source_image_id) || str(raw.from_image_id) || undefined
  let imageLinkNote: string | undefined
  let imageLinkPath: string | undefined
  if (fromImageId) {
    const imageRoot = imagegenResolveLibraryRoot({ workspaceCwd: args.workspaceCwd })
    const still = imageRoot ? await imagegenGetRecord({ image_id: fromImageId, workspaceCwd: args.workspaceCwd }) : null
    if (still && typeof still.file_rel === 'string' && still.file_rel.trim()) {
      try {
        imageLinkPath = imagegenImageFileAbs(imageRoot!, still.file_rel)
      } catch (err) {
        imageLinkNote = `the IMAGES-library still "${fromImageId}" has no resolvable file (${errText(err)}) — pass source_image_path instead.`
      }
    } else if (!still) {
      imageLinkNote = `No image with id "${fromImageId}" in the sylo-image-gen library — search the Images tab for current ids, or pass source_image_path (a local still).`
    } else {
      imageLinkNote = `The image record "${fromImageId}" carries no resolvable file — pick a different still or pass source_image_path.`
    }
  }

  // Request shaping: raw fields win; from_video_id parent fills the ABSENT
  // ones (prompt/seed/resolution/duration — tool parity); an unresolved still
  // is stripped BEFORE catalog resolution so a stale source_image_id cannot
  // flip a prompted render onto the i2v variant (§3.5 tool parity).
  const parentResolution = parent && num(raw.resolution) === undefined && !str(raw.orientation) ? resolutionFromRecordPx(parent) : undefined
  const parentSeed = parent && Number.isFinite(parent.seed) && parent.seed >= 0 ? parent.seed : undefined
  const parentDuration =
    parent && (VIDEO_DURATIONS_SECONDS as readonly number[]).includes(parent.duration_seconds)
      ? parent.duration_seconds
      : undefined
  const rawSeed = num(raw.seed)
  const rawDuration = num(raw.duration_seconds)
  const shaped: VideoGenRequestInput = {
    prompt: str(raw.prompt) || parent?.prompt || '',
    negative_prompt: str(raw.negative_prompt) || undefined,
    mode: str(raw.mode) || undefined,
    preset: str(raw.preset) || undefined,
    model: str(raw.model) || undefined,
    resolution: str(raw.resolution) || parentResolution?.resolution,
    orientation: str(raw.orientation) || parentResolution?.orientation,
    duration_seconds: rawDuration !== undefined ? Math.floor(rawDuration) : parentDuration,
    framerate: num(raw.framerate) !== undefined ? Math.floor(num(raw.framerate)!) : undefined,
    seed: rawSeed !== undefined ? Math.floor(rawSeed) : parentSeed,
    loop_motion_strength: num(raw.loop_motion_strength),
    restyle_strength: num(raw.restyle_strength),
    count: num(raw.count),
    save: raw.save === undefined ? undefined : Boolean(raw.save),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)).filter(Boolean) : undefined,
    source_image_path: str(raw.source_image_path) || imageLinkPath || undefined, // §3.5: a linked IMAGES still IS the source path (tool parity)
    source_video_path: str(raw.source_video_path) || undefined,
    source_video_id: str(raw.source_video_id) || undefined,
    // §3.5: the link is also recorded as the lineage alias — a soft-failed
    // link strips the id (never leaves a stale alias in the request).
    ...(imageLinkPath ? { source_image_id: fromImageId } : {}),
    from_video_id: fromVideoId,
  }
  // Shape-normalize FIRST (coerceVideoGenRequest never throws; the notes ride
  // back to the route), then catalog-resolve (plain-language throws, §3.1).
  const coerced = coerceVideoGenRequest(shaped as unknown as Record<string, unknown>, config)
  const input = coerced.request as unknown as VideoGenRequestInput

  // Restyle source: explicit video-library id → resolve via the video store
  // (video→video tie-in, §3.1); from_video_id doubles as the restyle source.
  if (input.mode === 'restyle') {
    if (parent && !input.source_video_path && !input.source_video_id) {
      const root = resolveLibraryRoot({ workspaceCwd: args.workspaceCwd })
      if (root) input.source_video_path = videoFileAbs(root, parent.file_rel)
    } else if (input.source_video_id) {
      const root = resolveLibraryRoot({ workspaceCwd: args.workspaceCwd })
      const clip = root ? await getRecord({ video_id: input.source_video_id, workspaceCwd: args.workspaceCwd }) : null
      if (!clip || !root)
        throw new Error(
          `No library clip with id "${input.source_video_id}" — refresh the Library tab for current ids to use as the restyle source.`,
        )
      input.source_video_path = videoFileAbs(root, clip.file_rel)
    }
  }

  let req: VideoGenRequest
  try {
    req = resolveVideoGenRequest(input, {
      draft_model: config.draft_model,
      final_model: config.final_model,
      restyle_model: config.restyle_model,
      default_resolution: config.default_resolution,
      default_orientation: config.default_orientation,
      default_duration_seconds: config.default_duration_seconds,
      default_framerate: config.default_framerate,
      loop_motion_strength: config.loop_motion_strength,
    })
  } catch (err) {
    const message = errText(err).replace(/\.$/, '')
    const suffix = imageLinkNote ? ` (also: ${imageLinkNote})` : ''
    throw new Error(`${message}${suffix}. Fix the request parameters, or check Settings → health.`)
  }
  // §3.5 clip-t2v soft-fallback parity: a PROMPTED clip whose still link
  // failed proceeds as text→video carrying the note; everything else
  // (loop / unprompted) already threw above with the link note appended.
  if (imageLinkNote && !req.source_image_id) imageLinkNote = `${imageLinkNote} (rendering text→video instead)`

  // Operator + auto tags (tool parity: mode + preset when auto_tag_preset).
  const tags: string[] = []
  const seenTags = new Set<string>()
  for (const tag of [...(req.tags ?? []), ...(config.auto_tag_preset ? [req.mode, req.preset] : [])]
    .map((t) => t.trim())
    .filter(Boolean)) {
    const key = tag.toLowerCase()
    if (!seenTags.has(key)) {
      seenTags.add(key)
      tags.push(tag)
    }
  }

  // Durable row BEFORE preflight (§4.3 — every attempt is ledgered).
  const row = await createJob({ request: req, workspaceCwd: args.workspaceCwd })
  const active: VideogenActiveJob = { row, outputs: [], startedAtMs: Date.now() }
  activeJobs.set(active.row.id, active)
  pruneJobs()
  // Fire-and-forget run: the composer polls videogen:jobGet for progress/status.
  // Lineage rides the RESOLVED request (source_image_id folded by the resolver;
  // source paths resolved/readable) — tool parity.
  void driveJob(active, config.comfyui_url, tags, {
    workspaceCwd: args.workspaceCwd,
    lineage: {
      source_image_id: req.source_image_id,
      source_image_path: req.source_image_path,
      source_video_path: req.source_video_path,
      parent_video_id: parent?.id,
    },
  })
  return { ok: true, job: snapshotFromActiveJob(active), notes: [...coerced.notes, ...(imageLinkNote ? [imageLinkNote] : [])] }
}

interface DriveLineage {
  source_image_id?: string
  source_image_path?: string
  source_video_path?: string
  parent_video_id?: string
}

/**
 * Background run for a route job: preflight (health / queue-busy / free VRAM /
 * weights detection — the §3.1 tool's exact refusals), status running, uploads,
 * comfyGenerateVideo (ONE submit; count 1–2 branch fan; 20-min cap), per-output
 * createRecord pair batch (§4.2 write-queue discipline, tool parity), ledger
 * done/error — every transition mirrored into the runtime map for jobGet.
 */
async function driveJob(
  active: VideogenActiveJob,
  comfyuiUrl: string,
  tags: string[],
  ctx: { workspaceCwd?: string; lineage: DriveLineage },
): Promise<void> {
  const { workspaceCwd } = ctx
  const req = active.row.request
  const syncRow = (next: JobRecord): void => {
    active.row = next
  }
  try {
    // ── Preflight (§3.1 parity — refusals land as ledger error rows) ──
    const entry = findVideoModelEntry(req.model)
    const health = await comfyHealth(comfyuiUrl)
    if (!health.ok) {
      throw new Error(
        `ComfyUI is not reachable at ${comfyuiUrl} — start ComfyUI (the default API is http://127.0.0.1:8188) ` +
          `or fix comfyui_url in sylo-video-gen Settings, then re-run. Underlying problem: ${health.error ?? 'no details'}.`,
      )
    }
    if ((health.queue_depth ?? 0) > 0) {
      throw new Error(
        `ComfyUI at ${health.url} is busy — ${health.queue_depth} job(s) already running/pending; a video render (minutes, not seconds) ` +
          'would queue behind them. Wait for the queue to drain, then re-run. The Settings card shows the current queue.',
      )
    }
    if (entry && health.vram_free_bytes !== undefined && entry.min_vram_gb > 0 && health.vram_free_bytes < entry.min_vram_gb * 1e9) {
      throw new Error(
        `ComfyUI reports ${formatBytes(health.vram_free_bytes)} (≈ ${(health.vram_free_bytes / GIB).toFixed(1)} GiB) free VRAM but ` +
          `${req.model} wants about ${entry.min_vram_gb} GB — free more VRAM (let TTS go idle; avoid image and video finals at the same ` +
          'time) or pick a smaller model. sylo_video_gen_doctor prints the full preflight table.',
      )
    }
    // Weights detection (read-only /object_info GET; a probe fetch failure is
    // fall-through — only a REAL not-installed answer produces the refusal).
    let detected: Record<string, boolean> | undefined
    try {
      detected = await comfyModelsDetected(comfyuiUrl)
    } catch {
      /* probe fetch failure → the client's submit-time validation + 400 surfacing is the fallback */
    }
    if (detected && entry && detected[entry.id] === false) {
      const dl = entry.download
      throw new Error(
        `Model weights for ${req.model} were not detected on this ComfyUI install — the graph would fail at submit. ` +
          (dl
            ? `Download the listed files into the named ComfyUI model folders, then re-check in Settings → health:\n` +
              `  download: ${dl.huggingface_url}\n  model dirs: ${dl.targets.join(' · ')}\n  files: ${dl.repo_files.join(', ')}`
            : 'This model has no download targets in the catalog — run sylo_video_gen_doctor for the full report.'),
      )
    }

    syncRow(await updateJob({ job_id: active.row.id, status: 'running', started_at: new Date().toISOString(), workspaceCwd }))

    // First progress event carries comfy_prompt_id → into the ledger (the
    // restart-replay input, §4.3) and into the runtime row.
    let promptIdLogged = false
    const onProgress = (p: { comfy_prompt_id: string }): void => {
      if (promptIdLogged || !p.comfy_prompt_id) return
      promptIdLogged = true
      active.row = { ...active.row, comfy_prompt_id: p.comfy_prompt_id }
      void updateJob({ job_id: active.row.id, comfy_prompt_id: p.comfy_prompt_id, workspaceCwd }).catch(() => {})
    }

    // ── Source uploads (multipart /upload/image → LoadImage stills, LoadVideo control clips) ──
    const context: { sourceImageRef?: string; sourceVideoRef?: string } = {}
    if (req.source_image_path) {
      const up = await comfyUploadFile(
        comfyuiUrl,
        readSourceBytes(req.source_image_path, 'source still'),
        uploadNameFor(req.source_image_path),
      )
      context.sourceImageRef = up.ref
    }
    if (req.source_video_path) {
      const up = await comfyUploadFile(
        comfyuiUrl,
        readSourceBytes(req.source_video_path, 'source clip'),
        uploadNameFor(req.source_video_path),
      )
      context.sourceVideoRef = up.ref
    }

    // ── Submit + poll + fetch (ONE submit; count 1–2 fans branches — §2.4) ──
    const gen = await comfyGenerateVideo(comfyuiUrl, req, context, { onProgress })

    // ── Library save: one contiguous createRecord pair-batch (§4.2, tool parity) ──
    const settled = await Promise.allSettled(
      gen.outputs.map((out) =>
        createRecord({
          data: out.video,
          poster_data: out.poster,
          prompt: req.prompt,
          negative_prompt: req.negative_prompt,
          model: out.meta.model,
          mode: req.mode,
          preset: out.meta.preset,
          resolution: { width: out.meta.width, height: out.meta.height },
          framerate: out.meta.framerate,
          duration_seconds: req.duration_seconds,
          frame_count: out.meta.frame_count,
          seed: out.meta.seed,
          motion_strength: req.loop_motion_strength ?? req.restyle_strength,
          video_format: out.meta.video_format,
          render_ms: out.meta.gen_ms,
          comfy_prompt_id: out.meta.comfy_prompt_id,
          lineage: { ...ctx.lineage },
          tags,
          workspaceCwd,
        }),
      ),
    )
    settled.forEach((res, i) => {
      if (res.status !== 'fulfilled') return
      const resValue = res.value
      active.outputs.push({
        id: resValue.record.id,
        path: resValue.file_abs,
        ...(resValue.poster_abs ? { poster_path: resValue.poster_abs } : {}),
        width: resValue.record.resolution.width,
        height: resValue.record.resolution.height,
        framerate: resValue.record.framerate,
        duration_seconds: resValue.record.duration_seconds,
        seed: resValue.record.seed,
        bytes: resValue.record.bytes,
        ...(resValue.record.render_ms ? { render_ms: resValue.record.render_ms } : {}),
      })
    })
    const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    if (rejected) {
      try {
        syncRow(
          await updateJob({
            job_id: active.row.id,
            status: 'error',
            finished_at: new Date().toISOString(),
            error: `Generation succeeded but saving to the library failed: ${cutErrorText(rejected.reason, 400)}`,
            workspaceCwd,
          }),
        )
      } catch {
        active.row = {
          ...active.row,
          status: 'error',
          finished_at: new Date().toISOString(),
          error: `Generation succeeded but saving to the library failed: ${cutErrorText(rejected.reason, 400)}`,
        }
      }
      return
    }
    const savedIds = active.outputs.map((o) => o.id)
    try {
      syncRow(
        await updateJob({
          job_id: active.row.id,
          status: 'done',
          finished_at: new Date().toISOString(),
          ...(savedIds.length ? { output_record_ids: savedIds } : {}),
          workspaceCwd,
        }),
      )
    } catch {
      active.row = { ...active.row, status: 'done', finished_at: new Date().toISOString(), output_record_ids: savedIds }
    }
  } catch (err) {
    // Ledger keeps the failure honest (§4.3) — never masks the plain error.
    const errorText = err instanceof ComfyUIError ? err.message : cutErrorText(err)
    try {
      syncRow(
        await updateJob({
          job_id: active.row.id,
          status: 'error',
          finished_at: new Date().toISOString(),
          error: errorText,
          workspaceCwd,
        }),
      )
    } catch {
      active.row = { ...active.row, status: 'error', finished_at: new Date().toISOString(), error: errorText }
    }
  }
}

// ── Job reads (§4.3: the durable ledger is the source of truth) ─────────────

export interface VideogenJobsListResult {
  ok: true
  jobs: VideogenJobSnapshot[]
  total: number
}

/** videogenJobsList — ledger query (newest first, §4.3; the v1 Queue view data). */
export async function videogenJobsList(args: {
  workspaceCwd?: string
  status?: unknown
  limit?: unknown
  offset?: unknown
}): Promise<VideogenJobsListResult> {
  const status = typeof args.status === 'string' ? args.status : undefined
  const result = await listJobs({
    workspaceCwd: args.workspaceCwd,
    ...(status === 'queued' || status === 'running' || status === 'done' || status === 'error' ? { status } : {}),
    ...(typeof args.limit === 'number' && Number.isFinite(args.limit) ? { limit: Math.max(0, Math.floor(args.limit)) } : {}),
    ...(typeof args.offset === 'number' && Number.isFinite(args.offset) ? { offset: Math.max(0, Math.floor(args.offset)) } : {}),
  })
  const jobs: VideogenJobSnapshot[] = []
  for (const row of result.jobs) {
    // In-process route jobs prefer the LIVE snapshot (fresher mid-run); the
    // ledger row wins for everything else (agent-tool + previous-process rows).
    const active = activeJobs.get(row.id)
    jobs.push(active ? snapshotFromActiveJob(active) : await snapshotFromLedgerRow(row, args.workspaceCwd))
  }
  return { ok: true, jobs, total: result.total }
}

/**
 * videogenJobGet — poll ONE job for the composer's card. Route-submitted
 * in-process jobs read from the runtime map; everything else reads the durable
 * ledger (agent-tool jobs, pre-restart rows) with hydrated output paths.
 * Unknown id → ok:true with job:null (NOT an error — after a corrupt-ledger
 * reset old ids legitimately vanish).
 */
export async function videogenJobGet(args: {
  job_id?: unknown
  workspaceCwd?: string
}): Promise<{ ok: true; job: VideogenJobSnapshot | null }> {
  const id = typeof args.job_id === 'string' ? args.job_id.trim() : ''
  const active = id ? activeJobs.get(id) : undefined
  if (active) return { ok: true, job: snapshotFromActiveJob(active) }
  if (!id) return { ok: true, job: null }
  const row = await getJob({ job_id: id, workspaceCwd: args.workspaceCwd })
  if (!row) return { ok: true, job: null }
  return { ok: true, job: await snapshotFromLedgerRow(row, args.workspaceCwd) }
}

/** videogenQueueList — ComfyUI health + the recent LEDGER (v1 ships the data; Queue screen is v2). */
export async function videogenQueueList(args: { workspaceCwd?: string; userDataPath: string }): Promise<{
  ok: true
  health: BackendHealth
  jobs: VideogenJobSnapshot[]
}> {
  const config = readVideogenConfig(args.userDataPath)
  const health = await comfyHealth(config.comfyui_url)
  const recent = await videogenJobsList({ workspaceCwd: args.workspaceCwd, limit: 50 })
  return { ok: true, health, jobs: recent.jobs }
}

// ── §4.3 REPLAY (the §8.5 residual) — read-only re-poll of ComfyUI /history ─

export interface VideogenReplayEntry {
  job_id: string
  status: 'recovered' | 'error' | 'still_rendering' | 'unreadable'
  note: string
  output_record_ids?: string[]
}

export interface VideogenReplayResult {
  ok: true
  health: BackendHealth
  workspace_root: string | null
  /** ComfyUI unreachable — nothing was touched; plain-language (§4.3 guard). */
  skipped: boolean
  note: string
  entries: VideogenReplayEntry[]
}

/**
 * §4.3 jobs.json REPLAY (the §8.5 residual — issue #34): re-poll ComfyUI
 * `/history/{prompt_id}` for ledger rows stuck in queued/running, recover
 * finished outputs into the library via `createRecord`, and close
 * genuinely-dead rows as an honest error. READ-ONLY against ComfyUI
 * (/history + /queue + /view GETs ONLY) and it NEVER resubmits. ComfyUI-down
 * → skip (rows untouched, retried on the next app start / replay call).
 */
export async function videogenJobsReplay(args: {
  workspaceCwd?: string
  userDataPath: string
}): Promise<VideogenReplayResult> {
  const config = readVideogenConfig(args.userDataPath)
  const health = await comfyHealth(config.comfyui_url)
  if (!health.ok) {
    return {
      ok: true,
      health,
      workspace_root: null,
      skipped: true,
      note:
        `ComfyUI is not reachable at ${config.comfyui_url} — replay skipped; pending jobs are untouched in the render ledger and recover ` +
        `when ComfyUI is back (then re-run this from the Videos route, or restart Sylo once). ${health.error ?? ''}`.trim(),
      entries: [],
    }
  }
  const workspaceRoot = args.workspaceCwd?.trim() || null
  const pending = (await listJobs({ workspaceCwd: args.workspaceCwd, limit: 200 })).jobs.filter(
    (j) => j.status === 'queued' || j.status === 'running',
  )
  if (pending.length === 0) {
    return {
      ok: true,
      health,
      workspace_root: workspaceRoot,
      skipped: false,
      note: 'No queued or running render-ledger rows to replay.',
      entries: [],
    }
  }

  const entries: VideogenReplayEntry[] = []
  const timeoutMs = effectiveJobTimeoutMs()
  // §8.9 race guard (§7-audit defect 2): a row currently driven by THIS process's
  // route dispatcher (`driveJob`, tracked in `activeJobs`) must never be replayed —
  // the driver owns its poll/save; a replay that caught a terminal /history
  // mid-render would recover the same outputs under a fresh record id (duplicate
  // clip + a second done row). Honest skip below; the app-start sweep is
  // unaffected because `activeJobs` is empty at boot (nothing drives at whenReady).
  // NOTE: not unit-tested — videogen-host ships with no host test by parity
  // (imagegen-host precedent) and exercising this branch needs a stubbed ComfyUI
  // HTTP server; the store-level replay/recovery behaviors keep their
  // video-jobs-store.test.mjs coverage.
  for (const row of pending) {
    if (activeJobs.has(row.id)) {
      entries.push({
        job_id: row.id,
        status: 'still_rendering',
        note:
          'This job is being rendered by a live route/agent dispatcher in this Sylo session — replay skips it to avoid racing the poll/save path; its job card settles when the render finishes.',
      })
      continue
    }
    if (!row.comfy_prompt_id) {
      // A row that never reached the poll stage has no server-side identity to
      // adopt — replay NEVER resubmits workflows (§4.3), so it stays pending.
      entries.push({
        job_id: row.id,
        status: 'unreadable',
        note:
          'queued/running row without a recorded comfy_prompt_id (the render never reached the poll stage) — replay adopts only jobs it can ' +
          'recognize server-side and never resubmits workflows; re-generate, or check ComfyUI\u2019s own queue for the run.',
      })
      continue
    }
    try {
      const snapshot = await historyFor(config.comfyui_url, row.comfy_prompt_id)
      const recovery = await recoverRowFromHistory({ row, snapshot, comfyuiUrl: config.comfyui_url, workspaceCwd: args.workspaceCwd })
      if (recovery) {
        entries.push(recovery)
        continue
      }
      // No terminal history yet: is ComfyUI still working on it? (GET /queue — read-only.)
      let position: number | undefined
      try {
        position = await comfyQueuePosition(config.comfyui_url, row.comfy_prompt_id)
      } catch {
        position = undefined
      }
      if (position !== undefined && position >= 0) {
        entries.push({
          job_id: row.id,
          status: 'still_rendering',
          note:
            position === 0
              ? `ComfyUI is still rendering job ${row.comfy_prompt_id} — the render survives the Sylo restart; check back later.`
              : `Job ${row.comfy_prompt_id} is queued on ComfyUI (position ${position}) — check back later.`,
        })
        continue
      }
      const ageMs = Date.now() - (Date.parse(row.created_at) || 0)
      if (ageMs > timeoutMs) {
        const errorText =
          `Replay closed this job: ComfyUI has no finished history for ${row.comfy_prompt_id} and it is no longer in the queue — after its ` +
          `${Math.round(timeoutMs / 60000)}-minute cap this render is considered lost (ComfyUI may have been restarted mid-render; its ` +
          'console keeps the evidence). Nothing was resubmitted — re-generate if you still want this clip.'
        await updateJob({
          job_id: row.id,
          status: 'error',
          finished_at: new Date().toISOString(),
          error: errorText,
          workspaceCwd: args.workspaceCwd,
        }).catch(() => undefined)
        entries.push({ job_id: row.id, status: 'error', note: errorText })
      } else {
        entries.push({
          job_id: row.id,
          status: 'still_rendering',
          note: `No finished history for ${row.comfy_prompt_id} yet and it is not in the queue — left as-is (within its ${Math.round(timeoutMs / 60000)}-min cap; run replay again later).`,
        })
      }
    } catch (err) {
      entries.push({
        job_id: row.id,
        status: 'unreadable',
        note: `ComfyUI /history read failed for ${row.comfy_prompt_id}: ${errText(err)} — row left as-is.`,
      })
    }
  }
  return { ok: true, health, workspace_root: workspaceRoot, skipped: false, note: `${entries.length} pending row(s) replayed.`, entries }
}

/**
 * One history snapshot → library records for a replayed row (§4.3), or null
 * when the history holds nothing terminal yet. Mirrors the tool's save flow:
 * fetch video + poster bytes via /view (GET only), createRecord pair batch
 * (§4.2 write-queue discipline), ledger done with output ids. Execution
 * errors / completed-without-video close the row as an honest error.
 */
async function recoverRowFromHistory(args: {
  row: JobRecord
  snapshot: ComfyHistorySnapshot
  comfyuiUrl: string
  workspaceCwd?: string
}): Promise<VideogenReplayEntry | null> {
  const { row, snapshot, comfyuiUrl, workspaceCwd } = args
  const req = row.request

  if (snapshot.error) {
    // ComfyUI recorded the failure (execution error / interrupted) — close honestly.
    const errorText = `Recovered from ComfyUI history: ${snapshot.error}`
    await updateJob({
      job_id: row.id,
      status: 'error',
      finished_at: new Date().toISOString(),
      error: errorText,
      workspaceCwd,
    }).catch(() => undefined)
    return { job_id: row.id, status: 'error', note: errorText }
  }

  const videoRefs = snapshot.outputs.filter((r: ComfyOutputRef) => r.kind === 'video')
  const posterRefs = snapshot.outputs.filter((r: ComfyOutputRef) => r.kind === 'poster')
  if (videoRefs.length === 0) {
    if (snapshot.completed) {
      const errorText =
        `Replay found ComfyUI history for ${row.comfy_prompt_id} completed with NO video file saved${posterRefs.length ? ' (only posters)' : ''} — ` +
        'the graph\u2019s SaveVideo may be mis-wired. Nothing was resubmitted.'
      await updateJob({
        job_id: row.id,
        status: 'error',
        finished_at: new Date().toISOString(),
        error: errorText,
        workspaceCwd,
      }).catch(() => undefined)
      return { job_id: row.id, status: 'error', note: errorText }
    }
    return null // not terminal yet — the caller checks the ComfyUI queue
  }

  // Recover: fetch bytes (GET /view) → createRecord pairs → ledger done.
  const entry = findVideoModelEntry(req.model)
  const px = entry ? resolutionPxFor(entry, req.resolution, req.orientation) : { width: 0, height: 0 }
  const tags: string[] = []
  const seenTags = new Set<string>()
  for (const tag of [...(req.tags ?? []), ...(req.mode ? [req.mode] : []), ...(req.preset ? [req.preset] : [])]
    .map((t) => String(t).trim())
    .filter(Boolean)) {
    const key = tag.toLowerCase()
    if (!seenTags.has(key)) {
      seenTags.add(key)
      tags.push(tag)
    }
  }

  const savedIds: string[] = []
  const saveErrors: string[] = []
  for (let i = 0; i < videoRefs.length; i++) {
    const videoRef = videoRefs[i]!
    try {
      const video = await comfyFetchOutputBytes(comfyuiUrl, videoRef)
      let poster: Uint8Array | undefined
      if (posterRefs[i]) poster = await comfyFetchOutputBytes(comfyuiUrl, posterRefs[i]!)
      const rec = await createRecord({
        data: video,
        poster_data: poster,
        prompt: req.prompt,
        negative_prompt: req.negative_prompt,
        model: req.model,
        mode: req.mode,
        preset: req.preset,
        resolution: px,
        framerate: req.framerate,
        duration_seconds: req.duration_seconds,
        frame_count: req.frame_count,
        seed: req.seed >= 0 ? req.seed + i : req.seed,
        motion_strength: req.loop_motion_strength ?? req.restyle_strength,
        // Container from the recovered file's extension (records lock mp4 in
        // v1 graphs; a recovered row may carry whatever ComfyUI actually saved).
        video_format: videoExtFormat(videoRef.filename),
        render_ms: 0,
        comfy_prompt_id: row.comfy_prompt_id,
        lineage: {
          source_image_id: req.source_image_id,
          source_image_path: req.source_image_path,
          source_video_path: req.source_video_path,
          parent_video_id: req.from_video_id,
        },
        tags,
        workspaceCwd,
      })
      savedIds.push(rec.record.id)
    } catch (err) {
      saveErrors.push(`${videoRef.filename}: ${errText(err)}`)
    }
  }
  if (savedIds.length === 0) {
    // Byte fetch/record failure — DO NOT close as an error; leave the row
    // pending (outputs usually still live in ComfyUI output/, a later replay
    // or a restarted ComfyUI can still serve them).
    return {
      job_id: row.id,
      status: 'unreadable',
      note: `History holds finished output(s) for ${row.comfy_prompt_id} but recovery failed: ${saveErrors.join(' | ')} — row left pending; run replay again.`,
    }
  }
  const partial = savedIds.length < videoRefs.length
  await updateJob({
    job_id: row.id,
    status: 'done',
    finished_at: new Date().toISOString(),
    output_record_ids: savedIds,
    ...(saveErrors.length ? { error: `partially recovered: ${saveErrors.join(' | ')}` } : {}),
    workspaceCwd,
  }).catch(() => undefined)
  const note = partial
    ? `Recovered ${savedIds.length}/${videoRefs.length} output(s) into the library from ComfyUI history (post-restart) — partial: ${saveErrors.join(' | ')}.`
    : `Recovered ${savedIds.length} clip(s) into the library from ComfyUI history (post-restart).`
  return { job_id: row.id, status: 'recovered', note, output_record_ids: savedIds }
}

function videoExtFormat(filename: string): 'mp4' | 'webm' | 'mkv' | 'mov' {
  const dot = filename.toLowerCase().lastIndexOf('.')
  const ext = dot >= 0 ? filename.slice(dot + 1) : ''
  return ext === 'webm' || ext === 'mkv' || ext === 'mov' ? ext : 'mp4'
}

/**
 * App-start replay sweep helper (main/index.ts, whenReady): does a workspace
 * carry any render-ledger rows? index.ts only calls the (ComfyUI-touching)
 * replay for workspaces that actually carry one — cheap existsSync-free read.
 */
export function videogenWorkspaceHasLedger(workspaceCwd: string | undefined): boolean {
  const root = resolveLibraryRoot({ workspaceCwd })
  if (!root) return false
  try {
    return loadJobs(root).jobs.length > 0
  } catch {
    return false
  }
}

// ── §5.2/§5.3 library ops — the same store modules the agent tools use ──────

export interface VideogenLibraryStats {
  count: number
  favorites: number
  bytes: number
  /** Total recorded render time (§5.6 ledger footer — honest GPU-time accounting). */
  render_ms: number
  /** Per-model counts — Library model chips derive from real records, not the catalog. */
  models: Record<string, number>
}

const EMPTY_STATS: VideogenLibraryStats = { count: 0, favorites: 0, bytes: 0, render_ms: 0, models: {} }

/** Ledger/stats straight from loadLibrary records (§5.2 footer; §3.3 parity). */
export function videogenLibraryStatsFor(args: { workspaceCwd?: string }): { root: string; stats: VideogenLibraryStats } | null {
  const root = resolveLibraryRoot(args)
  if (!root) return null
  const videos = loadLibrary(root).videos
  const models: Record<string, number> = {}
  for (const v of videos) models[v.model] = (models[v.model] ?? 0) + 1
  return {
    root,
    stats: {
      count: videos.length,
      favorites: videos.filter((v) => v.favorite).length,
      bytes: videos.reduce((sum, v) => sum + v.bytes, 0),
      render_ms: videos.reduce((sum, v) => sum + v.render_ms, 0),
      models,
    },
  }
}

export interface VideogenLibraryResult {
  ok: true
  library_root: string | null
  items: Awaited<ReturnType<typeof queryLibrary>>['items']
  total: number
  stats: VideogenLibraryStats
  warning?: string
}

interface LibraryListArgs extends Record<string, unknown> {
  workspaceCwd?: string
}

/** videogenLibraryList — queryLibrary + footer stats in one round trip. */
export async function videogenLibraryList(args: LibraryListArgs): Promise<VideogenLibraryResult> {
  const stats = videogenLibraryStatsFor(args)
  if (!stats) {
    return {
      ok: true,
      library_root: null,
      items: [],
      total: 0,
      stats: EMPTY_STATS,
      warning:
        'No workspace selected in the Sylo sidebar — the video library is per-workspace. Pick a workspace and reopen this tab.',
    }
  }
  const result = await queryLibrary({
    workspaceCwd: args.workspaceCwd,
    query: typeof args.query === 'string' ? args.query : undefined,
    tags: Array.isArray(args.tags) ? args.tags.map((t) => String(t)) : undefined,
    favorite: typeof args.favorite === 'boolean' ? args.favorite : undefined,
    model: typeof args.model === 'string' ? args.model : undefined,
    // queryLibrary re-validates the mode against VIDEO_MODES internally — the
    // cast is display-side only (an unknown value degrades to "no filter").
    mode: typeof args.mode === 'string' ? (args.mode as VideoMode) : undefined,
    since: typeof args.since === 'string' ? args.since : undefined,
    until: typeof args.until === 'string' ? args.until : undefined,
    limit: typeof args.limit === 'number' ? Math.min(100, Math.max(1, Math.floor(args.limit))) : 60,
    offset: typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0,
  })
  return { ok: true, library_root: stats.root, items: result.items, total: result.total, stats: stats.stats }
}

/** videogenVideoGet — full record + lineage + absolute clip/poster paths (detail drawer). */
export async function videogenVideoGet(args: { video_id?: unknown; workspaceCwd?: string }): Promise<{
  ok: true
  record: VideoRecord
  path: string
  poster_path?: string
} | null> {
  const id = typeof args.video_id === 'string' ? args.video_id.trim() : ''
  if (!id) throw new Error('video_id is required.')
  const record = await getRecord({ video_id: id, workspaceCwd: args.workspaceCwd })
  if (!record) return null
  const root = resolveLibraryRoot(args)
  const path = root ? videoFileAbs(root, record.file_rel) : ''
  const poster_path = record.poster_rel && root ? videoFileAbs(root, record.poster_rel) : undefined
  return { ok: true, record, path, ...(poster_path ? { poster_path } : {}) }
}

/** videogenVideoUpdate — tags/favorite via organizeRecords (the organize tool's store op). */
export async function videogenVideoUpdate(args: Record<string, unknown> & { video_id?: unknown; workspaceCwd?: string }): Promise<{
  ok: true
  record: VideoRecord | null
}> {
  const id = typeof args.video_id === 'string' ? args.video_id.trim() : ''
  if (!id) throw new Error('video_id is required.')
  const res = await organizeRecords({
    workspaceCwd: args.workspaceCwd,
    video_ids: [id],
    add_tags: Array.isArray(args.add_tags) ? args.add_tags.map((t) => String(t)) : undefined,
    remove_tags: Array.isArray(args.remove_tags) ? args.remove_tags.map((t) => String(t)) : undefined,
    favorite: typeof args.favorite === 'boolean' ? args.favorite : undefined,
  })
  if (res.deleted.length > 0) throw new Error('Record was deleted — refresh the library.')
  return { ok: true, record: res.updated[0] ?? null }
}

/** videogenVideoDelete — clip + poster + row via organizeRecords delete (§3.3 GC parity). */
export async function videogenVideoDelete(args: { video_id?: unknown; workspaceCwd?: string }): Promise<{
  ok: true
  deleted: string[]
}> {
  const id = typeof args.video_id === 'string' ? args.video_id.trim() : ''
  if (!id) throw new Error('video_id is required.')
  const res = await organizeRecords({ video_ids: [id], delete: true, workspaceCwd: args.workspaceCwd })
  return { ok: true, deleted: res.deleted }
}

/**
 * videogenRevealFile — resolved via the record (never a raw caller path), so
 * the shell op can only ever open library files. `kind` picks the clip
 * (default) or the in-graph poster (§5.1: reveal on clip/poster). main/index.ts
 * performs the actual showItemInFolder; this module only resolves/validates.
 */
export async function videogenRevealFile(args: { video_id?: unknown; kind?: unknown; workspaceCwd?: string }): Promise<{
  ok: true
  path: string
}> {
  const id = typeof args.video_id === 'string' ? args.video_id.trim() : ''
  if (!id) throw new Error('video_id is required.')
  const record = await getRecord({ video_id: id, workspaceCwd: args.workspaceCwd })
  if (!record) throw new Error(`No library clip with id "${id}".`)
  const root = resolveLibraryRoot(args)
  if (!root) throw new Error('No workspace resolved — cannot locate the video file.')
  const wantPoster = args.kind === 'poster' && record.poster_rel
  return { ok: true, path: videoFileAbs(root, wantPoster ? record.poster_rel! : record.file_rel) }
}

// ── §5.5 status — Connect/health + model table from the SAME probes as doctor ─┐

export interface VideogenStatusResult {
  ok: true
  config: ReturnType<typeof readVideogenConfig>
  workspace_root: string | null
  library_root: string | null
  library_stats: VideogenLibraryStats | null
  /** §4.3 durable render ledger health (Settings storage card). */
  jobs: { total: number; queued: number; running: number; done: number; error: number } | null
  health: BackendHealth
  /** comfyDoctorProbe result (detection + per-model node validation) when requested. */
  models?: ComfyDoctorProbe
  /** §2.2 catalog (static data — model dropdown ∩ detected, license badges). */
  catalog: typeof VIDEO_MODEL_CATALOG
}

/**
 * videogenStatus — Settings Connect/health card + composer catalog data. Health
 * comes from `comfyHealth` (/system_stats + /queue — the doctor's exact probe,
 * §3.3 parity); the model table comes from `comfyDoctorProbe` (a single
 * /object_info pull) when the caller opts in (it is heavy on slow links).
 */
export async function videogenStatus(args: {
  with_models?: unknown
  workspaceCwd?: string
  userDataPath: string
}): Promise<VideogenStatusResult> {
  const config = readVideogenConfig(args.userDataPath)
  const stats = videogenLibraryStatsFor(args)
  const health = await comfyHealth(config.comfyui_url)
  const jobsRoot = resolveLibraryRoot(args)
  const jobRows = jobsRoot ? loadJobs(jobsRoot).jobs : []
  const jobs = jobsRoot
    ? {
        total: jobRows.length,
        queued: jobRows.filter((j) => j.status === 'queued').length,
        running: jobRows.filter((j) => j.status === 'running').length,
        done: jobRows.filter((j) => j.status === 'done').length,
        error: jobRows.filter((j) => j.status === 'error').length,
      }
    : null
  let models: ComfyDoctorProbe | undefined
  if (args.with_models === true && health.ok) {
    // Detection is best-effort: on error Settings shows the health error text.
    models = await comfyDoctorProbe(config.comfyui_url).catch(() => undefined)
  }
  const workspaceRoot = typeof args.workspaceCwd === 'string' && args.workspaceCwd.trim() ? args.workspaceCwd.trim() : null
  return {
    ok: true,
    config,
    workspace_root: workspaceRoot,
    library_root: stats?.root ?? null,
    library_stats: stats?.stats ?? null,
    jobs,
    health,
    catalog: VIDEO_MODEL_CATALOG,
    ...(models !== undefined ? { models } : {}),
  }
}