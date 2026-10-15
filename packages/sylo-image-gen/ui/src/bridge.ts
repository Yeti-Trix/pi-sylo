/**
 * skill-route bridge for the Images route (plan §5.6). postMessage RPC to the
 * host — the host validates nonce/source, dispatches the op in its
 * handleSkillRouteBridge (speech/tts + tasks precedent), and replies with
 * `sylo-skill-bridge-reply`. Data ops (imageGen*) are answered by host main via
 * the imagegen:* IPC (main/imagegen-host.ts), which composes the SAME shared
 * modules the agent tools use; route prefs (last filters, composer draft) use
 * the generic readSkillData/writeSkillData ops, NOT imagegen ops (plan §5.6
 * note). The localFileUrl helper mirrors the Speech route's sylo-file:// use.
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
  return Promise.reject(new Error('Images route requires the Sylo desktop host'))
}

// ── Wire shapes (mirror of shared/types.ts subsets — kept local so the
// renderer never imports the package's node:crypto-dependent shared code) ───

export type ImagePreset = 'draft' | 'final'

export type AspectRatio = '1:1' | '16:9' | '9:16' | '3:2' | '2:3' | '4:3' | '3:4'

/** Catalog subset the composer dropdown + Settings model table need (§2.2). */
export type ImagegenCatalogEntry = {
  id: string
  label: string
  family: string
  license: string
  commercial_ok: boolean
  role: 'draft' | 'final' | 'both'
  approx_size_gb?: number
  min_vram_gb?: number
  strengths?: string
  download?: {
    huggingface_url: string
    targets: string[]
    comfyui_subfolders: string[]
  }
}

export type ImagegenConfig = {
  comfyui_url: string
  draft_model: string
  final_model: string
  default_aspect: AspectRatio
  auto_tag_preset: boolean
  image_format: 'png'
  upscale_model: string
  caption_backend: 'off'
  comfyui_exe_path: string
}

export type ImagegenHealth = {
  ok: boolean
  url: string
  error?: string
  version?: string
  device_name?: string
  vram_total_bytes?: number
  vram_free_bytes?: number
  queue_depth?: number
}

export type ImagegenProbeModel = {
  id: string
  detected: boolean
  missing_nodes: string[]
}

export type ImagegenProbe = {
  known_node_count: number
  models: ImagegenProbeModel[]
}

export type ImagegenLibraryStats = {
  count: number
  favorites: number
  bytes: number
  gen_ms: number
  models: Record<string, number>
}

export type ImagegenStatus = {
  config: ImagegenConfig
  workspace_root: string | null
  library_root: string | null
  library_stats: ImagegenLibraryStats | null
  health: ImagegenHealth
  models?: ImagegenProbe
  catalog: ImagegenCatalogEntry[]
}

export type ImagegenJobOutput = {
  id: string
  path: string
  width: number
  height: number
  seed: number
  bytes: number
  gen_ms?: number
}

export type ImagegenJob = {
  id: string
  created_at: string
  prompt: string
  model: string
  preset: ImagePreset
  count: number
  status: 'queued' | 'running' | 'done' | 'error'
  error?: string
  comfy_prompt_id?: string
  started_at: number
  elapsed_ms: number
  parent_id?: string
  outputs: ImagegenJobOutput[]
}

export type ImagegenLibraryItem = {
  id: string
  path: string
  prompt: string
  model: string
  preset: ImagePreset
  tags: string[]
  favorite: boolean
  created_at: string
  width: number
  height: number
  gen_ms: number
}

export type ImagegenLibraryListResult = {
  library_root: string | null
  items: ImagegenLibraryItem[]
  total: number
  stats: ImagegenLibraryStats
  warning?: string
}

export type ImagegenRecord = {
  id: string
  created_at: string
  file_rel: string
  width: number
  height: number
  bytes: number
  model: string
  backend: string
  preset: ImagePreset
  prompt: string
  negative_prompt?: string
  params: { steps: number; guidance: number; seed: number; sampler?: string; aspect?: AspectRatio }
  gen_ms: number
  parent_id?: string
  origin: 'agent' | 'route'
  tags: string[]
  favorite: boolean
  album?: string
  caption?: string
  comfy_prompt_id?: string
}

/** Raw request the composer sends — the host builds the tool's GenRequestInput
 *  from it (resolveGenRequest catalog defaults on preset change, §3 note 2). */
export type ImagegenComposeRequest = {
  prompt: string
  preset?: ImagePreset | string
  negative_prompt?: string
  aspect?: string
  seed?: number
  count?: number
  tags?: string[]
  from_image_id?: string
  steps?: number
  guidance?: number
  width?: number
  height?: number
}

export const bridge = {
  // ── 11 imagegen ops (§5.6 verbatim, imagegen:* IPC behind them) ──────────
  status: (payload: { with_models?: boolean }) => rpc<ImagegenStatus>('imageGenStatus', payload),
  configGet: () => rpc<{ ok: true; config: ImagegenConfig } | { ok: false; error: string }>('imageGenConfigGet', {}),
  configSave: (values: Partial<ImagegenConfig>) =>
    rpc<{ ok: true; restartNote?: string } | { ok: false; error: string }>('imageGenConfigSave', values),
  generate: (request: ImagegenComposeRequest) => rpc<ImagegenJob>('imageGenGenerate', { request }),
  jobGet: (jobId: string) => rpc<ImagegenJob>('imageGenJobGet', { job_id: jobId }),
  queueList: () => rpc<{ ok: true; health: ImagegenHealth; jobs: ImagegenJob[] }>('imageGenQueueList', {}),
  libraryList: (payload: {
    query?: string
    favorite?: boolean
    model?: string
    limit?: number
    offset?: number
  }) => rpc<ImagegenLibraryListResult>('imageGenLibraryList', payload),
  imageGet: (imageId: string) => rpc<null | { ok: true; record: ImagegenRecord; path: string }>('imageGenImageGet', { image_id: imageId }),
  imageUpdate: (payload: { image_id: string; add_tags?: string[]; remove_tags?: string[]; favorite?: boolean }) =>
    rpc<{ ok: true; record: ImagegenRecord | null }>('imageGenImageUpdate', payload),
  imageDelete: (imageId: string) => rpc<{ ok: true; deleted: string[] }>('imageGenImageDelete', { image_id: imageId }),
  revealFile: (imageId: string) => rpc<{ ok: true; path: string }>('imageGenRevealFile', { image_id: imageId }),
  // ── generic ops (workspace resolution + prefs + chat hand-off) ───────────
  workspaceCwd: () => rpc<string>('workspaceResolvedPiCwd', {}),
  readSkillData: (key: string) => rpc<unknown>('readSkillData', { key }),
  writeSkillData: (key: string, value: unknown) => rpc<{ written: boolean }>('writeSkillData', { key, value }),
  sendToAgent: (payload: Record<string, unknown>) => rpc<{ queued: boolean }>('sendToAgent', payload),
  openExternalUrl: (url: string) => rpc<{ ok: boolean }>('openExternalUrl', { url }),
}

/** Host → route push (iframe-host postMessage, plan §8 step 7 change fan):
 *  the broker child notified main (`sylo-image-gen:changed`), main fanned
 *  `imagegen:library-changed` to the renderer, the renderer forwards it into
 *  this route iframe as a `libraryChanged` skill-bridge event; the route
 *  refetches the library/ledger. Returns an unsubscribe fn. */
export function onLibraryChanged(cb: () => void): () => void {
  const onMsg = (ev: MessageEvent) => {
    const d = ev.data as { kind?: string; event?: string }
    if (!d || d.kind !== 'sylo-skill-bridge-event' || d.event !== 'libraryChanged') return
    cb()
  }
  window.addEventListener('message', onMsg)
  return () => window.removeEventListener('message', onMsg)
}

/** Full-file local preview URL — Speech route precedent (`sylo-file://preview`). */
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

/** "total generation time H:MM" for the library footer ledger (§5.2). */
export function fmtHMM(totalMs: number): string {
  const totalSec = Math.floor((Number.isFinite(totalMs) ? totalMs : 0) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 120) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}