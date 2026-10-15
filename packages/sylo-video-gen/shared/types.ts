/**
 * Core types for sylo-video-gen. Single source of truth shared by the agent
 * extension and host main — same import pattern as main/tasks-db.ts →
 * packages/sylo-tasks/shared (main has no SYLO_PI_CWD: explicit workspace cwd
 * at call time) and main/imagegen-config.ts → packages/sylo-image-gen/shared
 * (imagegen twin precedent).
 *
 * §8 step 1 ships ONLY the config subset (VideogenConfig + defaults + coerce)
 * — apps/host/src/main/videogen-config.ts (imagegen-config.ts twin) must
 * import the same coerce, and extensions/config.ts (the SYLO_VIDEOGEN_CONFIG
 * env → extensions-config/sylo-video-gen.json → defaults load chain) is
 * planned for §8 step 6, so the coerce lives here until §8.6 moves the load
 * chain beside the tools (built-for-buildability deviation, documented in the
 * issue + tracker; §8.6 keeps this file as the shape contract either way).
 * §8 step 2 extends this file with the full §2.1/§2.3/§4.3 contract:
 * VideoMode/VideoGenRequest/VideoLineage/VideoRecord/JobRecord/BackendHealth
 * + their plain-language coercers. The structural catalog types live in
 * ./catalog.ts (type-only import edges from here — no runtime cycle); the
 * config coerce's valid-id list is CATALOG VIDEO_MODEL_IDS (§8 step 2 note).
 *
 * Plan: .sylo/plans/2cd6e56d-eee7-4523-8a46-94151f7dd348.md — ALL-LOCAL ONLY
 * (§2.6, operator decision 2026-10-11): ComfyUI is the only backend; no remote
 * generation endpoints, no provider keys, nothing cloud-shaped; the package
 * detects, never spawns.
 */
import { VIDEO_MODEL_IDS } from './catalog.ts'

/** §2.7 — snake_case config keys shared by the extension, the host config
 *  file (`<userData>/sylo-video-gen/config.json`), and the Videos route. */
export interface VideogenConfig {
  /** ComfyUI API base URL (default http://127.0.0.1:8188). */
  comfyui_url: string
  /** Catalog model id for the draft (clip) preset — §2.2 `wan22-ti2v-5b`. */
  draft_model: string
  /** Catalog model id for the final (clip) preset — §2.2 `wan22-a14b`. */
  final_model: string
  /** Catalog model id for restyle — §2.2 `wan21-vace-14b`. */
  restyle_model: string
  /** Composer default resolution — px per catalog (§2.1: 480p/720p × orientation). */
  default_resolution: '480p' | '720p'
  /** Composer default orientation. */
  default_orientation: 'landscape' | 'portrait'
  /** Default clip duration: 4 | 5 | 8 s (§2.1; loop frame tables §2.5). */
  default_duration_seconds: number
  /** 0 = "model default" (§2.2: ti2v-5B 24 fps, A14B 16 fps) — else a catalog fps. */
  default_framerate: number
  /** Living-photo loop motion intensity 0–1 (§2.5 prompt+shift scaling). */
  loop_motion_strength: number
  /** Auto-tag generated records with their preset-derived mode tag. */
  auto_tag_preset: boolean
  /** Path to a ComfyUI executable for a future launch button (empty = detect only). */
  comfyui_exe_path: string
}

export type VideoMode = 'clip' | 'loop' | 'restyle'
export type VideoPreset = 'draft' | 'final'
export type VideoResolution = '480p' | '720p'
export type VideoOrientation = 'landscape' | 'portrait'
/** Whatever the graph actually outputs (§2.1 VERIFY) — SaveVideo mp4+h264 is the locked v1 value. */
export type VideoFormat = 'mp4' | 'webm' | 'mkv' | 'mov'

/**
 * §2.1 request contract (full). Mode is the composer's three-mode union
 * ('clip' | 'loop' | 'restyle', §1/§5.6); the underlying t2v vs i2v split is
 * derived from source-image presence (catalog.workflowVariantFor) — the plan
 * draft's four-value union ('t2v' | 'i2v' | …) predates that reconciliation and
 * is recorded in the tracker.
 */
export interface VideoGenRequest {
  mode: VideoMode
  prompt: string
  negative_prompt?: string
  /** Catalog model id (preset/config-pairing-derived when unresolved; catalog.ts resolver fills this). */
  model: string
  preset: VideoPreset
  resolution: VideoResolution
  orientation: VideoOrientation
  /** 4 | 5 | 8 s (§2.1) — loop/restyle clamp via the model's durations_seconds. */
  duration_seconds: number
  /** Model default when config default_framerate is 0 (§2.2: ti2v-5B 24, A14B/VACE 16). */
  framerate: number
  /** d×fps+1 — always 4n+1 (§2.5 table 65/81/129/97/121/193). */
  frame_count: number
  seed: number
  /** Living-photo loop intensity 0–1 (loop mode) — prompt + sampling-shift scaling (§2.5). */
  loop_motion_strength?: number
  /** Restyle VACE strength 0–1 → WanVaceToVideo.strength via the catalog's documented curve. */
  restyle_strength?: number
  /** 1–2 (MAX_VIDEOS_PER_CALL — clips cost minutes, not seconds). */
  count: number
  /** Write results to the workspace video library (default true). */
  save: boolean
  tags?: string[]
  /** Image-gen library still (image seed — cross-package, §3.5). */
  source_image_id?: string
  /** Arbitrary local still (path on this machine). */
  source_image_path?: string
  /** Video-gen library clip id (restyle/remix input, v1 accepts the id the route resolved to a path). */
  source_video_id?: string
  /** Arbitrary local clip. */
  source_video_path?: string
  /** Cross-package lineage alias (§3.5): resolved into source_image_id. TYPE LANDS NOW (§8.2);
   *  the guarded dynamic import of sylo-image-gen's library-store happens at §3/§8.5 tool level. */
  from_image_id?: string
  /** Remix lineage: inherit prompt/seed/resolution/duration from a library clip (records parent_video_id). */
  from_video_id?: string
}

/** §2.1 lineage block — one-way, no back-writes into the image library. */
export interface VideoLineage {
  source_image_id?: string
  source_image_path?: string
  source_video_path?: string
  parent_video_id?: string
}

/** §2.1/§4.3 — the workspace library row. Files on disk are truth for bytes; index truth for metadata. */
export interface VideoRecord {
  id: string
  created_at: string
  prompt: string
  /** Additive beyond the §2.1 list — restyled/regenerated rows want the negative echoed in the drawer. */
  negative_prompt?: string
  model: string
  mode: VideoMode
  preset: VideoPreset
  resolution: { width: number; height: number }
  framerate: number
  duration_seconds: number
  frame_count: number
  seed: number
  /** loop/restyle strength as resolved (undefined on plain clips). */
  motion_strength?: number
  /** Relative to the library root: files/<yyyy>/<mm>/<id>.<ext> (§4.1). */
  file_rel: string
  /** <id>.poster.png — saved in-graph (§2.4), optional only so recovery (§4.4) tolerates missing. */
  poster_rel?: string
  bytes: number
  /** 'mp4' | 'webm' — whatever the graph outputs (§2.1 VERIFY; locked mp4+@catalog §2). */
  video_format: VideoFormat
  render_ms: number
  comfy_prompt_id?: string
  lineage: VideoLineage
  tags: string[]
  favorite: boolean
}

/** §4.3 durable job statuses (deliberate divergence from image-gen's in-memory Map). */
export type VideoJobStatus = 'queued' | 'running' | 'done' | 'error'

/** §2.3 — poll-based progress callback payload (elapsed + prompt id; WebSocket events are v2). */
export interface VideoGenProgress {
  comfy_prompt_id: string
  elapsed_ms: number
  queue_position?: number
}

/** §4.3 — durable render-ledger row (jobs.json): a minutes-long render survives a Sylo relaunch. */
export interface JobRecord {
  id: string
  request: VideoGenRequest
  status: VideoJobStatus
  comfy_prompt_id?: string
  created_at: string
  started_at?: string
  finished_at?: string
  error?: string
  output_record_ids?: string[]
}

/**
 * §2.3 — normalized health snapshot from ComfyUI /system_stats + /queue.
 * VRAM fields ride the device block; ram fields are additive for the doctor's
 * preflight table (§3.3).
 */
export interface BackendHealth {
  ok: boolean
  url: string
  error?: string
  version?: string
  device_name?: string
  vram_total_bytes?: number
  vram_free_bytes?: number
  ram_total_bytes?: number
  ram_free_bytes?: number
  queue_running?: number
  queue_pending?: number
  queue_depth?: number
}

// ── Plain-language coercers (types land now; store/layers consume at §8.5+) ──

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function numIn(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Route/bridge-side request coercion (§2.1): unknown JSON → filled
 * VideoGenRequest with plain-language notes for every coerced value. Full
 * model/resolution/frames resolution still goes through catalog
 * resolveVideoGenRequest — this only normalizes shapes and never throws.
 */
export function coerceVideoGenRequest(
  raw: Record<string, unknown>,
  defaults?: Partial<VideogenConfig>,
): { request: VideoGenRequest; notes: string[] } {
  const notes: string[] = []
  const note = (m: string): void => {
    notes.push(m)
  }
  const cfg = { ...DEFAULT_VIDEOGEN_CONFIG, ...(defaults ?? {}) } as VideogenConfig
  const modeRaw = str(raw.mode).trim().toLowerCase()
  const mode: VideoMode = modeRaw === 'clip' || modeRaw === 'loop' || modeRaw === 'restyle' ? modeRaw : 'clip'
  if (modeRaw && modeRaw !== mode) note(`mode "${raw.mode}" is not one of clip | loop | restyle — using "clip".`)
  const presetRaw = str(raw.preset).trim().toLowerCase()
  const preset: VideoPreset = presetRaw === 'draft' || presetRaw === 'final' ? presetRaw : mode === 'clip' ? 'draft' : 'final'
  if (presetRaw && presetRaw !== preset) note(`preset "${raw.preset}" is not one of draft | final — using "${preset}".`)
  const resRaw = str(raw.resolution).trim().toLowerCase()
  const resolution: VideoResolution = resRaw === '480p' || resRaw === '720p' ? resRaw : cfg.default_resolution
  if (resRaw && resRaw !== resolution) note(`resolution "${raw.resolution}" is not one of 480p | 720p — using "${resolution}".`)
  const orientRaw = str(raw.orientation).trim().toLowerCase()
  const orientation: VideoOrientation = orientRaw === 'landscape' || orientRaw === 'portrait' ? orientRaw : cfg.default_orientation
  if (orientRaw && orientRaw !== orientation) note(`orientation "${raw.orientation}" is not one of landscape | portrait — using "${orientation}".`)
  const durationRaw = numIn(raw.duration_seconds)
  const duration = durationRaw !== undefined && [4, 5, 8].includes(durationRaw) ? durationRaw : cfg.default_duration_seconds
  if (durationRaw !== undefined && durationRaw !== duration)
    note(`duration_seconds ${JSON.stringify(raw.duration_seconds)} is not one of 4 | 5 | 8 — using ${duration}.`)
  const framerateRaw = numIn(raw.framerate)
  const framerate = framerateRaw !== undefined && [16, 24].includes(framerateRaw) ? framerateRaw : cfg.default_framerate > 0 ? cfg.default_framerate : 0
  if (framerateRaw !== undefined && framerateRaw !== framerate)
    note(`framerate ${JSON.stringify(raw.framerate)} is not a catalog fps (16 | 24) — using ${framerate}.`)
  const clamp01 = (v: unknown, name: string, fallback: number): number | undefined => {
    const n = numIn(v)
    if (n === undefined) return undefined
    if (n < 0 || n > 1) {
      const c = Math.min(1, Math.max(0, n))
      note(`${name} ${n} is outside 0–1 — clamped to ${c}.`)
      return c
    }
    return n
  }
  const source_image_id = str(raw.source_image_id).trim() || undefined
  const from_image_id = str(raw.from_image_id).trim() || undefined
  // §2 review round: the 1–2 clamping used to be silent — mirror the clamp01 helper and
  // say so (MAX_VIDEOS_PER_CALL = 2 — clips cost minutes). The catalog resolver keeps its
  // own out-of-range throw for callers that bypass this coerce.
  const countRaw = numIn(raw.count)
  const count = Math.min(2, Math.max(1, Math.floor(countRaw ?? 1)))
  if (countRaw !== undefined && (countRaw < 1 || countRaw > 2))
    note(`count ${JSON.stringify(raw.count)} is outside 1–2 (MAX_VIDEOS_PER_CALL) — clamped to ${count}.`)
  return {
    request: {
      mode,
      prompt: str(raw.prompt),
      negative_prompt: str(raw.negative_prompt).trim() || undefined,
      model: str(raw.model).trim() || '',
      preset,
      resolution,
      orientation,
      duration_seconds: duration,
      framerate,
      frame_count: 0, // derived — resolveVideoGenRequest fills it from the catalog
      seed: numIn(raw.seed) !== undefined ? Math.max(0, Math.floor(numIn(raw.seed)!)) : -1,
      loop_motion_strength: mode === 'loop' ? clamp01(raw.loop_motion_strength, 'loop_motion_strength', cfg.loop_motion_strength) : undefined,
      restyle_strength: mode === 'restyle' ? clamp01(raw.restyle_strength, 'restyle_strength', 0.5) : undefined,
      count,
      save: raw.save === undefined ? true : Boolean(raw.save),
      tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : undefined,
      source_image_id: from_image_id ?? source_image_id,
      source_image_path: str(raw.source_image_path).trim() || undefined,
      source_video_id: str(raw.source_video_id).trim() || undefined,
      source_video_path: str(raw.source_video_path).trim() || undefined,
      from_image_id,
      from_video_id: str(raw.from_video_id).trim() || undefined,
    },
    notes,
  }
}

/**
 * Library-row read-back (§4.2/§4.4): unknown JSON → VideoRecord with
 * plain-language notes; every missing/violating field falls back to an honest
 * placeholder value instead of throwing (a corrupt row must load, visibly).
 */
export function coerceVideoRecord(raw: Record<string, unknown>): { record: VideoRecord; notes: string[] } {
  const notes: string[] = []
  const note = (m: string): void => {
    notes.push(m)
  }
  const modeRaw = str(raw.mode).trim().toLowerCase()
  const mode: VideoMode = modeRaw === 'clip' || modeRaw === 'loop' || modeRaw === 'restyle' ? modeRaw : 'clip'
  if (modeRaw && modeRaw !== mode) note(`record ${str(raw.id, '?')}: mode "${raw.mode}" invalid — rebuilt as "clip" (recovered row).`)
  const presetRaw = str(raw.preset).trim().toLowerCase()
  const preset: VideoPreset = presetRaw === 'draft' || presetRaw === 'final' ? presetRaw : 'draft'
  const formatRaw = str(raw.video_format).trim().toLowerCase()
  const video_format: VideoFormat = formatRaw === 'mp4' || formatRaw === 'webm' || formatRaw === 'mkv' || formatRaw === 'mov' ? formatRaw : 'mp4'
  const numOr = (v: unknown, fallback: number, what: string, min = 0): number => {
    const n = numIn(v)
    if (n === undefined || n < min) {
      note(`record ${str(raw.id, '?')}: ${what} unreadable (${JSON.stringify(v)}) — placeholder ${fallback}.`)
      return fallback
    }
    return n
  }
  const lineageRaw = asRecord(raw.lineage)
  return {
    record: {
      id: str(raw.id).trim() || 'unknown',
      created_at: str(raw.created_at) || '',
      prompt: str(raw.prompt),
      negative_prompt: str(raw.negative_prompt).trim() || undefined,
      model: str(raw.model),
      mode,
      preset,
      resolution: {
        width: numOr(asRecord(raw.resolution).width, 0, 'resolution.width'),
        height: numOr(asRecord(raw.resolution).height, 0, 'resolution.height'),
      },
      framerate: numOr(raw.framerate, 0, 'framerate'),
      duration_seconds: numOr(raw.duration_seconds, 0, 'duration_seconds'),
      frame_count: numOr(raw.frame_count, 0, 'frame_count'),
      seed: numOr(raw.seed, -1, 'seed', -1),
      motion_strength: raw.motion_strength === undefined ? undefined : clampOne(raw.motion_strength, note, str(raw.id, '?')),
      file_rel: str(raw.file_rel),
      poster_rel: str(raw.poster_rel).trim() || undefined,
      bytes: numOr(raw.bytes, 0, 'bytes'),
      video_format,
      render_ms: numOr(raw.render_ms, 0, 'render_ms'),
      comfy_prompt_id: str(raw.comfy_prompt_id).trim() || undefined,
      lineage: {
        source_image_id: str(lineageRaw.source_image_id).trim() || undefined,
        source_image_path: str(lineageRaw.source_image_path).trim() || undefined,
        source_video_path: str(lineageRaw.source_video_path).trim() || undefined,
        parent_video_id: str(lineageRaw.parent_video_id).trim() || undefined,
      },
      tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      favorite: Boolean(raw.favorite),
    },
    notes,
  }
}

function clampOne(v: unknown, note: (m: string) => void, id: string): number | undefined {
  const n = numIn(v)
  if (n === undefined) return undefined
  if (n < 0 || n > 1) {
    note(`record ${id}: motion_strength ${n} outside 0–1 — clamped.`)
    return Math.min(1, Math.max(0, n))
  }
  return n
}

/** jobs.json read-back (§4.3): unknown JSON → JobRecord with honest fallbacks; never throws. */
export function coerceJobRecord(raw: Record<string, unknown>): { record: JobRecord; notes: string[] } {
  const requestRaw = asRecord(raw.request)
  const { request, notes: requestNotes } = coerceVideoGenRequest(requestRaw)
  const statusRaw = str(raw.status).trim().toLowerCase()
  const status: VideoJobStatus = statusRaw === 'queued' || statusRaw === 'running' || statusRaw === 'done' || statusRaw === 'error' ? statusRaw : 'error'
  const notes: string[] = [...requestNotes]
  if (statusRaw && statusRaw !== status)
    notes.push(`job ${str(raw.id, '?')}: status "${raw.status}" is not one of queued | running | done | error — rebuilt as "error".`)
  if (!str(raw.id).trim()) notes.push('job row missing id — rebuilt as "unknown".')
  return {
    record: {
      id: str(raw.id).trim() || 'unknown',
      request,
      status,
      comfy_prompt_id: str(raw.comfy_prompt_id).trim() || undefined,
      created_at: str(raw.created_at) || '',
      started_at: str(raw.started_at).trim() || undefined,
      finished_at: str(raw.finished_at).trim() || undefined,
      error: str(raw.error).trim() || undefined,
      output_record_ids: Array.isArray(raw.output_record_ids) ? raw.output_record_ids.map((t) => String(t)) : undefined,
    },
    notes,
  }
}

/** Defensive unknown → BackendHealth (host IPC replay / route display). */
export function coerceBackendHealth(raw: unknown): BackendHealth {
  const r = asRecord(raw)
  const numOrU = (v: unknown): number | undefined => {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    ok: Boolean(r.ok),
    url: str(r.url),
    error: str(r.error).trim() || undefined,
    version: str(r.version).trim() || undefined,
    device_name: str(r.device_name).trim() || undefined,
    vram_total_bytes: numOrU(r.vram_total_bytes),
    vram_free_bytes: numOrU(r.vram_free_bytes),
    ram_total_bytes: numOrU(r.ram_total_bytes),
    ram_free_bytes: numOrU(r.ram_free_bytes),
    queue_running: numOrU(r.queue_running),
    queue_pending: numOrU(r.queue_pending),
    queue_depth: numOrU(r.queue_depth),
  }
}

/** §2.7 defaults — the coerce falls back to these with plain-language notes. */
export const DEFAULT_VIDEOGEN_CONFIG: VideogenConfig = {
  comfyui_url: 'http://127.0.0.1:8188',
  draft_model: 'wan22-ti2v-5b',
  final_model: 'wan22-a14b',
  restyle_model: 'wan21-vace-14b',
  default_resolution: '720p',
  default_orientation: 'landscape',
  default_duration_seconds: 5,
  default_framerate: 0,
  loop_motion_strength: 0.5,
  auto_tag_preset: true,
  comfyui_exe_path: '',
}

function coerceString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw.trim() : fallback
}

function coerceBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return fallback
}

function baseUrlCoerced(raw: unknown, note: (m: string) => void): string {
  const url = coerceString(raw, DEFAULT_VIDEOGEN_CONFIG.comfyui_url)
  if (!url) return DEFAULT_VIDEOGEN_CONFIG.comfyui_url
  if (!/^https?:\/\//i.test(url)) {
    note(`comfyui_url "${url}" does not start with http:// or https:// — using "${DEFAULT_VIDEOGEN_CONFIG.comfyui_url}".`)
    return DEFAULT_VIDEOGEN_CONFIG.comfyui_url
  }
  return url
}

function modelCoerced(
  raw: unknown,
  key: 'draft_model' | 'final_model' | 'restyle_model',
  note: (m: string) => void,
): string {
  const fallback = DEFAULT_VIDEOGEN_CONFIG[key]
  const value = coerceString(raw, fallback)
  if (typeof raw !== 'string' || !value) return fallback
  if (!(VIDEO_MODEL_IDS as readonly string[]).includes(value)) {
    note(
      `${key} "${raw}" is not in the video-model catalog — using "${fallback}". ` +
        `Valid ids: ${VIDEO_MODEL_IDS.join(', ')} (§2.2; ltx-2.5 / hunyuanvideo-1.5 are opt-in).`,
    )
    return fallback
  }
  return value
}

function resolutionCoerced(raw: unknown, note: (m: string) => void): VideogenConfig['default_resolution'] {
  const value = coerceString(raw, DEFAULT_VIDEOGEN_CONFIG.default_resolution)
  if (typeof raw !== 'string' || !value) return DEFAULT_VIDEOGEN_CONFIG.default_resolution
  if (value !== '480p' && value !== '720p') {
    note(`default_resolution "${raw}" is not one of 480p | 720p — using "${DEFAULT_VIDEOGEN_CONFIG.default_resolution}".`)
    return DEFAULT_VIDEOGEN_CONFIG.default_resolution
  }
  return value
}

function orientationCoerced(raw: unknown, note: (m: string) => void): VideogenConfig['default_orientation'] {
  const value = coerceString(raw, DEFAULT_VIDEOGEN_CONFIG.default_orientation)
  if (typeof raw !== 'string' || !value) return DEFAULT_VIDEOGEN_CONFIG.default_orientation
  if (value !== 'landscape' && value !== 'portrait') {
    note(`default_orientation "${raw}" is not one of landscape | portrait — using "${DEFAULT_VIDEOGEN_CONFIG.default_orientation}".`)
    return DEFAULT_VIDEOGEN_CONFIG.default_orientation
  }
  return value
}

function durationCoerced(raw: unknown, note: (m: string) => void): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || ![4, 5, 8].includes(raw)) {
    if (raw !== undefined && raw !== null && raw !== '') {
      note(`default_duration_seconds ${JSON.stringify(raw)} is not one of 4 | 5 | 8 seconds — using ${DEFAULT_VIDEOGEN_CONFIG.default_duration_seconds}.`)
    }
    return DEFAULT_VIDEOGEN_CONFIG.default_duration_seconds
  }
  return raw
}

function framerateCoerced(raw: unknown, note: (m: string) => void): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || ![0, 16, 24].includes(raw)) {
    if (raw !== undefined && raw !== null && raw !== '') {
      note(`default_framerate ${JSON.stringify(raw)} is not 0 (model default) or a catalog fps (16 | 24) — using 0.`)
    }
    return DEFAULT_VIDEOGEN_CONFIG.default_framerate
  }
  return raw
}

function motionStrengthCoerced(raw: unknown, note: (m: string) => void): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    if (raw !== undefined && raw !== null && raw !== '') {
      note(`loop_motion_strength ${JSON.stringify(raw)} is not a number — using ${DEFAULT_VIDEOGEN_CONFIG.loop_motion_strength}.`)
    }
    return DEFAULT_VIDEOGEN_CONFIG.loop_motion_strength
  }
  if (raw < 0 || raw > 1) {
    const clamped = Math.min(1, Math.max(0, raw))
    note(`loop_motion_strength ${raw} is outside 0–1 — clamped to ${clamped}.`)
    return clamped
  }
  return raw
}

/**
 * Read + coerce one config object (§2.7 shape). Returns the effective config
 * and a list of plain-language notes for any coerced/ignored value — the
 * doctor echoes these verbatim (§3.3). Unknown keys are ignored silently;
 * missing keys fall back to their defaults. Never throws.
 */
export function coerceVideogenConfig(raw: Record<string, unknown>): { config: VideogenConfig; notes: string[] } {
  const notes: string[] = []
  const note = (m: string): void => {
    notes.push(m)
  }
  const config: VideogenConfig = {
    comfyui_url: baseUrlCoerced(raw.comfyui_url, note),
    draft_model: modelCoerced(raw.draft_model, 'draft_model', note),
    final_model: modelCoerced(raw.final_model, 'final_model', note),
    restyle_model: modelCoerced(raw.restyle_model, 'restyle_model', note),
    default_resolution: resolutionCoerced(raw.default_resolution, note),
    default_orientation: orientationCoerced(raw.default_orientation, note),
    default_duration_seconds: durationCoerced(raw.default_duration_seconds, note),
    default_framerate: framerateCoerced(raw.default_framerate, note),
    loop_motion_strength: motionStrengthCoerced(raw.loop_motion_strength, note),
    auto_tag_preset: coerceBoolean(raw.auto_tag_preset, DEFAULT_VIDEOGEN_CONFIG.auto_tag_preset),
    comfyui_exe_path: coerceString(raw.comfyui_exe_path, ''),
  }
  return { config, notes }
}