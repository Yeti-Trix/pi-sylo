/**
 * skill-route bridge for the Videos route (plan §5.4/§5.6). postMessage RPC to
 * the host — twin of sylo-image-gen's ui/src/bridge.ts: the host validates
 * nonce/source, dispatches the op in its handleSkillRouteBridge (the §8.7
 * videoGen* arm), and replies with `sylo-skill-bridge-reply`. The DATA ops
 * (videoGen*) are answered by host main via the `videogen:*` IPC
 * (main/videogen-host.ts), which composes the SAME shared modules the agent
 * tools use with an explicit workspaceCwd; route prefs (last tab, composer
 * draft, filters, recents) use the generic readSkillData/writeSkillData ops —
 * they are namespaced per skill folder host-side, so imagegen's keys cannot
 * collide (§5.4 note). The renderer never imports the package's
 * node-dependent shared code — wire shapes below are locally-mirrored subsets
 * of shared/types.ts + shared/catalog.ts + main/videogen-host.ts snapshots
 * (imagegen parity).
 */

function hasDesktopNonce(): boolean {
  const nonce = (window as unknown as { __SYLO_NONCE__?: string }).__SYLO_NONCE__
  return typeof nonce === 'string' && nonce.length > 0
}

function rpcViaPostMessage<T>(op: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const reqId = `r-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as {
        kind?: string
        reqId?: string
        ok?: boolean
        result?: T
        error?: string
      }
      if (!d || d.kind !== 'sylo-skill-bridge-reply' || d.reqId !== reqId) return
      window.removeEventListener('message', onMsg)
      if (d.ok) resolve(d.result as T)
      else reject(new Error(d.error || 'bridge_error'))
    }
    window.addEventListener('message', onMsg)
    window.parent.postMessage(
      {
        v: 1,
        kind: 'sylo-skill-bridge',
        nonce: (window as unknown as { __SYLO_NONCE__?: string }).__SYLO_NONCE__,
        reqId,
        op,
        payload: payload ?? {},
      },
      '*',
    )
  })
}

function rpc<T>(op: string, payload?: unknown): Promise<T> {
  if (hasDesktopNonce()) return rpcViaPostMessage<T>(op, payload)
  return Promise.reject(new Error('Videos route requires the Sylo desktop host'))
}

// ── Wire shapes (locally-mirrored subsets — the renderer never imports the
// node-dependent shared code) ────────────────────────────────────────────────

export type VideoMode = 'clip' | 'loop' | 'restyle'
export type VideoPreset = 'draft' | 'final'
export type VideoResolution = '480p' | '720p'
export type VideoOrientation = 'landscape' | 'portrait'
export type VideoFormat = 'mp4' | 'webm' | 'mkv' | 'mov'

/** Catalog entry subset the composer dropdown + Settings model table need (§2.2). */
export type VideogenCatalogEntry = {
  id: string
  label: string
  family: string
  license: string
  license_badge: string
  commercial_ok: boolean
  backend: string
  role: 'draft' | 'final' | 'restyle'
  mode_roles: VideoMode[]
  approx_size_gb: number
  min_vram_gb: number
  default_framerate: number
  framerates: number[]
  resolutions: VideoResolution[]
  durations_seconds: number[]
  max_duration_seconds: number
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  strengths?: string
  resolution_px?: Partial<Record<VideoResolution, Partial<Record<VideoOrientation, { width: number; height: number }>>>>
  download?: { huggingface_url: string; targets: string[]; repo_files: string[] }
  notes?: string
  verify?: string
}

export type VideogenConfig = {
  comfyui_url: string
  draft_model: string
  final_model: string
  restyle_model: string
  default_resolution: VideoResolution
  default_orientation: VideoOrientation
  default_duration_seconds: number
  default_framerate: number
  loop_motion_strength: number
  auto_tag_preset: boolean
  comfyui_exe_path: string
}

export type VideogenHealth = {
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

/** Doctor probe subset (Settings model table — single /object_info pull). */
export type VideogenProbeModel = {
  id: string
  detected: boolean
  missing_nodes: string[]
}

export type VideogenProbe = {
  known_node_count: number
  models: VideogenProbeModel[]
  frame_interpolation: { available: boolean; models: string[] }
}

export type VideogenLibraryStats = {
  count: number
  favorites: number
  bytes: number
  render_ms: number
  models: Record<string, number>
}

/** §4.3 durable render-ledger health (Settings storage card). */
export type VideogenJobsHealth = {
  total: number
  queued: number
  running: number
  done: number
  error: number
}

/** §3.4/§3.5 lineage block (source stills/clips + remix parents). */
export type VideoLineage = {
  source_image_id?: string
  source_image_path?: string
  source_video_path?: string
  parent_video_id?: string
}

/** §2.1 VideoGenRequest — the RESOLVED request the host runs (job snapshots echo it). */
export type VideoGenRequest = {
  mode: VideoMode
  prompt: string
  negative_prompt?: string
  model: string
  preset: VideoPreset
  resolution: VideoResolution
  orientation: VideoOrientation
  duration_seconds: number
  framerate: number
  frame_count: number
  seed: number
  loop_motion_strength?: number
  restyle_strength?: number
  count: number
  save: boolean
  tags?: string[]
  source_image_id?: string
  source_image_path?: string
  source_video_id?: string
  source_video_path?: string
  from_image_id?: string
  from_video_id?: string
}

/** §2.1 VideoRecord — the library row (detail drawer). */
export type VideoRecord = {
  id: string
  created_at: string
  prompt: string
  negative_prompt?: string
  model: string
  mode: VideoMode
  preset: VideoPreset
  resolution: { width: number; height: number }
  framerate: number
  duration_seconds: number
  frame_count: number
  seed: number
  motion_strength?: number
  file_rel: string
  poster_rel?: string
  bytes: number
  video_format: VideoFormat
  render_ms: number
  comfy_prompt_id?: string
  lineage: VideoLineage
  tags: string[]
  favorite: boolean
}

/** Job output display row (videogen-host.ts VideogenJobOutput). */
export type VideogenJobOutput = {
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

/**
 * Job snapshot (videogen-host.ts VideogenJobSnapshot): the durable ledger row +
 * hydrated outputs. `source: 'route'` = this process's route-submitted run;
 * 'ledger' = agent-tool jobs + pre-restart rows (§4.3 — honest elapsed both).
 */
export type VideogenJobSnapshot = {
  id: string
  request: VideoGenRequest
  status: 'queued' | 'running' | 'done' | 'error'
  error?: string
  comfy_prompt_id?: string
  created_at: string
  started_at?: string
  finished_at?: string
  elapsed_ms?: number
  output_record_ids: string[]
  outputs: VideogenJobOutput[]
  source: 'route' | 'ledger'
}

/** queryLibrary compact item (§3.2) — poster path for grid cards (§5.6). */
export type VideogenLibraryItem = {
  id: string
  path: string
  poster_path?: string
  prompt: string
  model: string
  mode: VideoMode
  preset: VideoPreset
  tags: string[]
  favorite: boolean
  created_at: string
  width: number
  height: number
  framerate: number
  duration_seconds: number
  frame_count: number
  render_ms: number
}

export type VideogenLibraryListResult = {
  library_root: string | null
  items: VideogenLibraryItem[]
  total: number
  stats: VideogenLibraryStats
  warning?: string
}

export type VideogenJobsListResult = {
  ok: true
  jobs: VideogenJobSnapshot[]
  total: number
}

export type VideogenQueueListResult = {
  ok: true
  health: VideogenHealth
  jobs: VideogenJobSnapshot[]
}

/** §4.3 replay entry + result (read-only ComfyUI /history re-poll). */
export type VideogenReplayEntry = {
  job_id: string
  status: 'recovered' | 'error' | 'still_rendering' | 'unreadable'
  note: string
  output_record_ids?: string[]
}

export type VideogenReplayResult = {
  ok: true
  health: VideogenHealth
  workspace_root: string | null
  skipped: boolean
  note: string
  entries: VideogenReplayEntry[]
}

export type VideogenStatus = {
  config: VideogenConfig
  workspace_root: string | null
  library_root: string | null
  library_stats: VideogenLibraryStats | null
  jobs: VideogenJobsHealth | null
  health: VideogenHealth
  models?: VideogenProbe
  catalog: VideogenCatalogEntry[]
}

/** Raw request the composer sends — the host builds the tool's request input
 *  from it (resolveVideoGenRequest catalog defaults host-side, §5.2 tool parity). */
export type VideogenComposeRequest = {
  /** ''/absent is VALID host-side: from_video_id inheritance fills it (§5.2
   *  tool parity; a source-less loop throws plainly). */
  prompt?: string
  mode: VideoMode
  preset?: VideoPreset | string
  negative_prompt?: string
  model?: string
  resolution?: VideoResolution | string
  orientation?: VideoOrientation | string
  duration_seconds?: number
  framerate?: number
  seed?: number
  loop_motion_strength?: number
  restyle_strength?: number
  count?: number
  source_image_id?: string
  source_image_path?: string
  source_video_id?: string
  source_video_path?: string
  from_video_id?: string
}

export const MODE_LABELS: Record<VideoMode, string> = {
  clip: 'Clip',
  loop: 'Living photo',
  restyle: 'Restyle',
}

export const bridge = {
  // ── 14 videogen ops (§5.2/§5.4, videogen:* IPC behind them; doctor + the
  //    durable-ledger job reads are §4.3's video-specific additions) ─────────
  status: (payload: { with_models?: boolean }) => rpc<VideogenStatus>('videoGenStatus', payload),
  doctor: () => rpc<VideogenStatus>('videoGenDoctor', {}),
  configGet: () => rpc<{ ok: true; config: VideogenConfig } | { ok: false; error: string }>('videoGenConfigGet', {}),
  configSave: (values: Partial<VideogenConfig>) =>
    rpc<{ ok: true; restartNote?: string } | { ok: false; error: string }>('videoGenConfigSave', values),
  generate: (request: VideogenComposeRequest) => rpc<VideogenJobSnapshot>('videoGenGenerate', { request }),
  jobGet: (jobId: string) => rpc<VideogenJobSnapshot | null>('videoGenJobGet', { job_id: jobId }),
  queueList: () => rpc<VideogenQueueListResult>('videoGenQueueList', {}),
  jobsList: (payload: { status?: 'queued' | 'running' | 'done' | 'error'; limit?: number; offset?: number } = {}) =>
    rpc<VideogenJobsListResult>('videoGenJobsList', payload),
  jobsReplay: () => rpc<VideogenReplayResult>('videoGenJobsReplay', {}),
  libraryList: (payload: {
    query?: string
    favorite?: boolean
    model?: string
    mode?: VideoMode
    since?: string
    until?: string
    limit?: number
    offset?: number
  }) => rpc<VideogenLibraryListResult>('videoGenLibraryList', payload),
  videoGet: (videoId: string) =>
    rpc<{ ok: true; record: VideoRecord; path: string; poster_path?: string }>('videoGenVideoGet', { video_id: videoId }),
  videoUpdate: (payload: { video_id: string; add_tags?: string[]; remove_tags?: string[]; favorite?: boolean }) =>
    rpc<{ ok: true; record: VideoRecord | null }>('videoGenVideoUpdate', payload),
  videoDelete: (videoId: string) => rpc<{ ok: true; deleted: string[] }>('videoGenVideoDelete', { video_id: videoId }),
  revealFile: (videoId: string, kind?: 'clip' | 'poster') =>
    rpc<{ ok: true; path: string }>('videoGenRevealFile', { video_id: videoId, ...(kind ? { kind } : {}) }),
  // ── generic ops (workspace resolution + prefs + chat hand-off) ───────────
  workspaceCwd: () => rpc<string>('workspaceResolvedPiCwd', {}),
  readSkillData: (key: string) => rpc<unknown>('readSkillData', { key }),
  writeSkillData: (key: string, value: unknown) => rpc<{ written: boolean }>('writeSkillData', { key, value }),
  sendToAgent: (payload: Record<string, unknown>) => rpc<{ queued: boolean }>('sendToAgent', payload),
  openExternalUrl: (url: string) => rpc<{ ok: boolean }>('openExternalUrl', { url }),
}

/** Host → route push (iframe-host postMessage, §5.5 change-fan clone):
 *  the broker child notified main (`sylo-video-gen:changed`), main fanned
 *  `videogen:library-changed` to the renderer, the renderer forwards it into
 *  this route iframe as a `libraryChanged` skill-bridge event tagged
 *  `source: 'videogen'`; the route refetches the library/ledger. Both routes
 *  tolerate the other's nudge (a refetch is cheap — no filtering, imagegen
 *  shape parity). Returns an unsubscribe fn. */
export function onLibraryChanged(cb: () => void): () => void {
  const onMsg = (ev: MessageEvent) => {
    const d = ev.data as { kind?: string; event?: string }
    if (!d || d.kind !== 'sylo-skill-bridge-event' || d.event !== 'libraryChanged') return
    cb()
  }
  window.addEventListener('message', onMsg)
  return () => window.removeEventListener('message', onMsg)
}

/** Full-file local preview URL — Speech/imagegen-route precedent (`sylo-file://preview`).
 *  Serves clips + poster PNGs: `.mp4`/`.webm`/`.mov` are inside the
 *  LOCAL_MEDIA_EXTENSIONS gate (§5.4/§5.5, landed in §8.7). */
export function localFileUrl(absPath: string): string {
  const p = absPath.trim()
  if (!p) return ''
  return `sylo-file://preview?path=${encodeURIComponent(p)}`
}

/** file:// href for open-externally (detail drawer's click-through). */
export function pathToFileHref(absPath: string): string {
  const norm = absPath.trim().replace(/\\/g, '/')
  const parts = norm.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
  return `file:///${parts.join('/')}`
}

export function fmtBytes(n: number | undefined): string {
  if (n === undefined || n < 0 || !Number.isFinite(n)) return '?'
  const gib = 1024 ** 3
  if (n >= gib) return `${(n / gib).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} kB`
  return `${n} B`
}

/** "total render time H:MM" for the library footer ledger (§5.6 — honest GPU-time accounting). */
export function fmtHMM(totalMs: number): string {
  const totalSec = Math.floor((Number.isFinite(totalMs) ? totalMs : 0) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

export function fmtElapsed(ms: number | undefined): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? (ms ?? 0) : 0) / 1000))
  if (total < 120) return `${total}s`
  return `${Math.floor(total / 60)}m ${total % 60}s`
}

export function fmtDateTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

export function fmtTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleTimeString()
}

/**
 * Hover-preview helpers (§5.6): grid/result-strip hover flips the native
 * `<video>`'s preload to auto and plays muted (no audio in v1 — §0); leave
 * rewinds to frame 0 and drops back to metadata loading. No autoplay on
 * scroll, never without a hover.
 */
export function hoverPreviewStart(el: HTMLVideoElement | null): void {
  if (!el) return
  el.preload = 'auto'
  el.volume = 0
  void el.play().catch(() => {
    /* hover preview is best-effort — the poster stays until it starts */
  })
}

export function hoverPreviewStop(el: HTMLVideoElement | null): void {
  if (!el) return
  el.pause()
  try {
    el.currentTime = 0
  } catch {
    /* not loaded yet */
  }
  el.preload = 'metadata'
}