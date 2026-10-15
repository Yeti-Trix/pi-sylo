/**
 * ComfyUI HTTP client for video generation (plan §2.3) — twin of the
 * sylo-image-gen client over the same endpoint contract, with video semantics:
 * `SaveVideo` history entries (UI PreviewVideo serializes to `images`, source
 * of truth comfy_api/latest/_ui.py → `{"images": [...], "animated": [true]}`),
 * a container-agnostic `/view` fetch (video containers included — no PNG IHDR
 * specialization), and multipart `/upload/image` for feeding local stills AND
 * local control clips (LoadImage/LoadVideo read ComfyUI's input dir; the
 * upload endpoint stores arbitrary bytes, verified 0.39.2 server.py:400-461).
 *
 * Endpoint contract (verified against the operator's ComfyUI 0.39.2):
 *   health        GET  {base}/system_stats                → version/device/VRAM/RAM
 *   queue state   GET  {base}/queue                       → running+pending (depth + our position)
 *   node catalog  GET  {base}/object_info                 → class → inputs (detection + validation)
 *   submit        POST {base}/prompt                       → body {prompt: graph, client_id} → {prompt_id}
 *   delete queued POST {base}/queue {"delete":[id]}        → cancel a pending job
 *   interrupt     POST {base}/interrupt                    → stop the running job (best-effort)
 *   result        GET  {base}/history/{prompt_id}         → outputs → status/messages
 *   fetch bytes   GET  {base}/view?filename=&subfolder=&type=output → any output bytes
 *   upload file   POST {base}/upload/image                 → multipart (image, overwrite, subfolder, type) → {name, subfolder}
 *
 * `client_id` is a stable-per-process UUID so ComfyUI-side progress/cancel can
 * attribute our jobs. Per-request timeouts via AbortSignal.timeout; every
 * failure is a typed, actionable ComfyUIError. 400-shape errors are SURFACED
 * with the response body — never swallowed (the §0 silent-400 risk on dynamic
 * combos: a wrong SaveVideo format/codec shape must name itself).
 *
 * ALL-LOCAL ONLY (§2.6): one ComfyUI instance (default 127.0.0.1:8188), no
 * remote endpoints, no keys.
 */
import { randomUUID } from 'node:crypto'
import type { BackendHealth, VideoGenProgress, VideoGenRequest, VideoFormat } from '../types.ts'
import { DEFAULT_VIDEO_FORMAT, findVideoModelEntry, resolutionPxFor, VIDEO_MODEL_CATALOG, VIDEO_MODEL_IDS, workflowVariantFor, type VideoModelCatalogEntry, type WorkflowVariant } from '../catalog.ts'
import { buildWorkflowForRequest, videoSamplingFor } from './workflows.ts'

export const COMFYUI_DEFAULT_URL = 'http://127.0.0.1:8188'
/**
 * Per-job hard cap (§2.3): video finals exceed image-gen's 10-min cap; the
 * 20-min default is the plan's calibration estimate (VERIFY item — the first
 * real rendered final re-anchors). Configurable per call (options.timeoutMs)
 * or via SYLO_VIDEOGEN_JOB_TIMEOUT_MS env (minutes, 1–240); validated lazily,
 * never at import.
 */
export const JOB_TIMEOUT_MS = 20 * 60 * 1000
/** Health probes stay short — doctor must feel responsive. */
export const HEALTH_TIMEOUT_MS = 5_000
/** system_stats/object_info/prompt/view/history/upload get this ceiling. */
export const PER_REQUEST_TIMEOUT_MS = 30_000
/** Sleep between history polls; test-overridable. Polls are cheap — don't hammer a busy GPU. */
export const POLL_INTERVAL_MS = 2_000

let pollIntervalMs = POLL_INTERVAL_MS

/** Effective per-job timeout for THIS call: option → env (minutes) → 20-min default. */
export function effectiveJobTimeoutMs(optionsTimeoutMs?: number): number {
  if (optionsTimeoutMs !== undefined && Number.isFinite(optionsTimeoutMs) && optionsTimeoutMs > 0) return optionsTimeoutMs
  const envRaw = (globalThis.process?.env?.SYLO_VIDEOGEN_JOB_TIMEOUT_MS ?? '').trim()
  const env = envRaw ? Number(envRaw) : NaN
  if (Number.isFinite(env) && env > 0 && env <= 240) return Math.round(env * 60_000)
  return JOB_TIMEOUT_MS
}

/** Stable-per-process ComfyUI client id — cancel/progress attribution (§2.3). */
export const COMFYUI_CLIENT_ID = randomUUID()

export type ComfyUIErrorCode =
  | 'not_reachable'
  | 'timeout'
  | 'bad_status'
  | 'submit_rejected'
  | 'validation_failed'
  | 'execution_failed'
  | 'no_outputs'
  | 'video_output_missing'
  | 'unknown_model'

/** Typed, actionable ComfyUI backend error — tools/route surface `message` as text. */
export class ComfyUIError extends Error {
  readonly code: ComfyUIErrorCode
  readonly httpStatus?: number
  /** Trimmed response body when a non-2xx carries one — 400 bodies are NEVER swallowed. */
  readonly detail?: string
  constructor(code: ComfyUIErrorCode, message: string, httpStatus?: number, detail?: string) {
    super(message)
    this.name = 'ComfyUIError'
    this.code = code
    this.httpStatus = httpStatus
    this.detail = detail
  }
}

export interface ComfyViewRef {
  filename: string
  subfolder: string
  type: string
}

/** History output ref + which output kind it is (SaveVideo video vs poster PNG). */
export interface ComfyOutputRef extends ComfyViewRef {
  kind: 'video' | 'poster' | 'other'
  ext: string
}

export interface ComfyHistorySnapshot {
  statusStr?: string
  completed?: boolean
  outputs: ComfyOutputRef[]
  error?: string
}

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi'])
const POSTER_EXTS = new Set(['png', 'jpg', 'jpeg'])

function extOf(filename: string): string {
  const dot = filename.toLowerCase().lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1) : ''
}

function classifyRef(ref: ComfyViewRef): ComfyOutputRef {
  const ext = extOf(ref.filename)
  return { ...ref, ext, kind: VIDEO_EXTS.has(ext) ? 'video' : POSTER_EXTS.has(ext) ? 'poster' : 'other' }
}

/** Accepts ''/missing as the default URL; strips trailing slashes. */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl ?? '').trim()
  return (trimmed || COMFYUI_DEFAULT_URL).replace(/\/+$/, '')
}

function fmtTimeout(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`
}

// Loopback ports a local ComfyUI Desktop instance may bind. Mirrors the
// sylo-image-gen client helper (found live 2026-10-13: engine on :8189, both
// sylo configs pinning :8188 — "ComfyUI is running but everything not
// reachable"). Non-default configs are respected as written.
const COMFYUI_FALLBACK_PORTS = [8188, 8189]

/** Configured URL resolved against a live engine: the configured URL wins when
 *  it answers; when it is a known loopback port that refuses and the sibling
 *  port answers, the sibling is returned. Never throws — the ORIGINAL configured
 *  URL is returned when nothing answers so downstream error text still names it.
 *  The health of the RETURNED url comes back too so callers that already
 *  consume raw stats do not re-fetch /system_stats (§3.3 dedupe kept). */
export async function resolveComfyEndpoint(configuredUrl: string): Promise<{
  url: string
  health: BackendHealthWithStats
}> {
  const configured = normalizeBaseUrl(configuredUrl)
  const candidates = [configured]
  try {
    const u = new URL(configured)
    const port = Number(u.port)
    if (COMFYUI_FALLBACK_PORTS.includes(port)) {
      for (const alt of COMFYUI_FALLBACK_PORTS) {
        if (alt !== port && !candidates.some((c) => c.endsWith(`:${alt}`))) {
          candidates.push(`${u.protocol}//${u.hostname}:${alt}`)
        }
      }
    }
  } catch {
    // Malformed configured URL — return it as-is; downstream error text explains.
  }
  let lastHealth = await comfyHealth(configured)
  for (const candidate of candidates) {
    if (candidate !== configured) lastHealth = await comfyHealth(candidate)
    if (lastHealth.ok) return { url: candidate, health: lastHealth }
  }
  return { url: configured, health: lastHealth }
}

function isTimeoutError(err: unknown): boolean {
  const candidates: unknown[] = [err, (err as { cause?: unknown } | undefined)?.cause]
  return candidates.some(
    (e) =>
      !!e &&
      typeof e === 'object' &&
      ((e as { name?: string }).name === 'TimeoutError' || (e as { name?: string }).name === 'AbortError'),
  )
}

function describeCause(err: unknown): string {
  const cause = (err as { cause?: unknown; message?: unknown }) ?? {}
  const causeText = typeof cause.cause === 'object' && cause.cause !== null ? JSON.stringify(cause.cause) : String(cause.cause ?? '')
  const text = typeof err === 'object' && err !== null && 'message' in err ? String((err as Error).message) : String(err)
  return causeText ? `${text} (${causeText})` : text
}

function asNetworkError(url: string, err: unknown, seconds: number): ComfyUIError {
  if (isTimeoutError(err)) {
    return new ComfyUIError(
      'timeout',
      `ComfyUI did not answer ${shorten(url)} within ${fmtTimeout(seconds)} — the server may be busy rendering or VRAM-starved. ` +
        'Wait, or run sylo_video_gen_doctor to check GPU/VRAM state.',
    )
  }
  return new ComfyUIError(
    'not_reachable',
    `ComfyUI not reachable at ${shorten(url)} — start ComfyUI (the default API is ${COMFYUI_DEFAULT_URL}) ` +
      'or fix the URL in sylo-video-gen Settings; you can ask the agent to run sylo_video_gen_doctor. ' +
      `Underlying problem: ${describeCause(err)}`,
  )
}

function shorten(url: string): string {
  return url.replace(/\?.*$/, '').replace(/\/history\/[^/]+$/, '/history/<prompt_id>')
}

function throwUnlessOk(res: Response, url: string, context?: string): void {
  if (res.ok) return
  throw new ComfyUIError(
    'bad_status',
    `ComfyUI answered HTTP ${res.status} ${res.statusText} for ${shorten(url)}` +
      (context ? ` (${context})` : '') +
      ' — if the URL is right but the server complains, run sylo_video_gen_doctor to re-check it.',
    res.status,
  )
}

async function fetchJson(
  url: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; body?: string; headers?: Record<string, string>; timeoutMs: number },
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: init.headers,
      signal: AbortSignal.timeout(init.timeoutMs),
    })
  } catch (err) {
    throw asNetworkError(url, err, Math.round(init.timeoutMs / 1000))
  }
  throwUnlessOk(res, url)
  try {
    return await res.json()
  } catch {
    throw new ComfyUIError(
      'bad_status',
      `ComfyUI returned non-JSON for ${shorten(url)} (HTTP ${res.status}) — is that endpoint really a ComfyUI HTTP server? Check the URL in sylo-video-gen Settings.`,
      res.status,
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** BackendHealth + the raw /system_stats echo — doctor reuses one stats fetch (§3.3 dedupe). */
export interface BackendHealthWithStats extends BackendHealth {
  /** Raw /system_stats body. Present when ok (fetched inside comfyHealth). */
  stats?: ComfySystemStatsRaw
}

/** GET /system_stats (+ /queue) → BackendHealth. Never throws: a dead ComfyUI is ok:false. */
export async function comfyHealth(baseUrl: string): Promise<BackendHealthWithStats> {
  const u = normalizeBaseUrl(baseUrl)
  try {
    const stats = (await fetchJson(`${u}/system_stats`, { timeoutMs: HEALTH_TIMEOUT_MS })) as Record<string, unknown> | undefined
    const queue = (await fetchJson(`${u}/queue`, { timeoutMs: HEALTH_TIMEOUT_MS })) as Record<string, unknown> | undefined
    const system = (stats?.system ?? {}) as Record<string, unknown>
    const device = ((stats?.devices as unknown[] | undefined)?.[0] ?? stats?.device) as Record<string, unknown> | undefined
    const num = (v: unknown): number | undefined => {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    const queueRunning = Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0
    const queuePending = Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0
    return {
      ok: true,
      url: u,
      version: typeof system.comfyui_version === 'string' ? system.comfyui_version : undefined,
      device_name: typeof device?.name === 'string' ? device.name : undefined,
      vram_total_bytes: num(device?.vram_total),
      vram_free_bytes: num(device?.vram_free),
      ram_total_bytes: num(system?.ram_total),
      ram_free_bytes: num(system?.ram_free),
      queue_running: queueRunning,
      queue_pending: queuePending,
      queue_depth: queueRunning + queuePending,
      stats: stats as ComfySystemStatsRaw,
    }
  } catch (err) {
    return {
      ok: false,
      url: u,
      error: err instanceof ComfyUIError ? err.message : `${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** One /object_info node schema entry (real ComfyUI ≥0.39 + legacy shapes tolerated). */
interface ObjectInfoNodeSchema {
  /** Real shape: input.required / input.optional hold { key: [[...choices], {tooltip?}] }. */
  input?: {
    required?: Record<string, unknown>
    optional?: Record<string, unknown>
  }
  /** Legacy shape some older builds/tests used: { key: [...choices] }. */
  inputs?: Record<string, unknown>
}

/**
 * Choice-string lists for the given input keys, across the real (input.required /
 * input.optional) and legacy (inputs) container shapes — detect, never trust (§2.2).
 * Choice values may be the choices array itself or [choicesArray, {tooltip}] —
 * unwrap one level when the first element is an array. Dedupes across containers.
 */
function fileNamesIn(objectInfo: unknown, classType: string, inputKeys: string[]): string[] {
  const node = (objectInfo as Record<string, ObjectInfoNodeSchema | undefined> | undefined)?.[classType]
  if (!node || typeof node !== 'object') return []
  const out: string[] = []
  const pushed = new Set<string>()
  const containers = [node.input?.required, node.input?.optional, node.inputs]
  for (const bucket of containers) {
    if (!bucket || typeof bucket !== 'object') continue
    for (const key of inputKeys) {
      const entry = bucket[key]
      const choices = Array.isArray(entry) && Array.isArray(entry[0]) ? entry[0] : entry
      if (!Array.isArray(choices)) continue
      for (const item of choices) {
        if (typeof item !== 'string' || pushed.has(item)) continue
        pushed.add(item)
        out.push(item)
      }
    }
  }
  return out
}

/** Model-dir-relative names may include subfolders ('wan/x.safetensors') — match on basename. */
function listHas(names: Iterable<string>, fileName: string): boolean {
  const want = fileName.toLowerCase()
  for (const item of names) {
    const low = item.toLowerCase()
    if (low === want || low.endsWith(`/${want}`)) return true
  }
  return false
}

/**
 * GET /object_info → which catalog models are actually installed. Each file the
 * wiring names must appear in its loader's enum (UNETLoader for DiTs, CLIPLoader
 * for umt5, VAELoader, LoraLoaderModelOnly for the lightx2v LoRAs) — detect,
 * never trust (§2.2). Opt-in entries with no wiring are never detected.
 */
export async function comfyModelsDetected(
  baseUrl: string,
  catalog: VideoModelCatalogEntry[] = VIDEO_MODEL_CATALOG,
): Promise<Record<string, boolean>> {
  const u = normalizeBaseUrl(baseUrl)
  const objectInfo = await fetchJson(`${u}/object_info`, { timeoutMs: PER_REQUEST_TIMEOUT_MS })
  return detectCatalogModels(objectInfo, catalog)
}

/** Pure part of the detection (single /object_info pull; the doctor composes on this). */
export function detectCatalogModels(objectInfo: unknown, catalog: VideoModelCatalogEntry[]): Record<string, boolean> {
  const unets = new Set([...fileNamesIn(objectInfo, 'UNETLoader', ['unet_name']), ...fileNamesIn(objectInfo, 'CheckpointLoaderSimple', ['ckpt_name'])])
  const clips = new Set(fileNamesIn(objectInfo, 'CLIPLoader', ['clip_name']))
  const vaes = new Set(fileNamesIn(objectInfo, 'VAELoader', ['vae_name']))
  const loras = new Set(fileNamesIn(objectInfo, 'LoraLoaderModelOnly', ['lora_name']))

  const detected: Record<string, boolean> = {}
  for (const entry of catalog) {
    const variants = Object.values(entry.comfy.variants ?? {}) as (typeof entry.comfy.variants)[WorkflowVariant][]
    if (!entry.comfy || variants.length === 0) {
      detected[entry.id] = false
      continue
    }
    detected[entry.id] = entry.comfy.text_encoders.every((te) => listHas(clips, te)) &&
      variants.every((v) => {
        if (!v) return false
        return (
          v.diffusion_models.every((d) => listHas(unets, d.file)) &&
          listHas(vaes, v.vae) &&
          (v.loras ?? []).every((l) => listHas(loras, l))
        )
      })
  }
  return detected
}

/**
 * POST /prompt ({prompt, client_id}) → {prompt_id}. 400 bodies are surfaced
 * with their error + node_errors verbatim — dynamic-combo shape mistakes name
 * themselves (§0 silent-400 guard), never swallowed into a generic message.
 */
export async function comfySubmitWorkflow(baseUrl: string, workflow: unknown): Promise<string> {
  const u = normalizeBaseUrl(baseUrl)
  const res = await (async () => {
    try {
      return await fetch(`${u}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: COMFYUI_CLIENT_ID }),
        signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      throw asNetworkError(`${u}/prompt`, err, Math.round(PER_REQUEST_TIMEOUT_MS / 1000))
    }
  })()
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    let nodeSummaries: string[] = []
    let bodyText = ''
    try {
      const rawBody = await res.text()
      bodyText = rawBody.length > 800 ? `${rawBody.slice(0, 800)}…` : rawBody
      const bodyJson = JSON.parse(rawBody) as {
        error?: { type?: string; message?: string; details?: string }
        node_errors?: Record<string, { class_type?: string; errors?: { message?: string; details?: string }[] }>
      }
      if (bodyJson?.error?.message || bodyJson?.error?.type)
        detail = `${bodyJson.error.type ?? 'error'}: ${bodyJson.error.message ?? ''}${bodyJson.error.details ? ` — ${bodyJson.error.details}` : ''}`.trim()
      nodeSummaries = Object.entries(bodyJson?.node_errors ?? {}).map(
        ([nodeId, ne]) =>
          `node ${nodeId}${ne?.class_type ? ` (${ne.class_type})` : ''}: ${ne?.errors?.map((e) => e.details ?? e.message).filter(Boolean).join('; ') || 'invalid'}`,
      )
    } catch {
      /* body wasn't JSON — keep the status text */
    }
    throw new ComfyUIError(
      'submit_rejected',
      `ComfyUI rejected the workflow at ${shorten(`${u}/prompt`)} — HTTP ${detail}` +
        (nodeSummaries.length ? ` Node problems: ${nodeSummaries.join(' | ')}` : '') +
        (bodyText && nodeSummaries.length === 0 && !detail.includes('error:') ? ` Body: ${bodyText}` : '') +
        '. Run sylo_video_gen_doctor to re-validate nodes against this ComfyUI build.',
      res.status,
      bodyText || undefined,
    )
  }
  const data = (await res.json().catch(() => undefined)) as { prompt_id?: unknown; node_errors?: unknown } | undefined
  const promptId = data?.prompt_id
  if (typeof promptId !== 'string' || !promptId)
    throw new ComfyUIError(
      'submit_rejected',
      `ComfyUI accepted the connection but returned no prompt_id for ${shorten(`${u}/prompt`)}` +
        (data && 'node_errors' in data && data.node_errors ? ` (node_errors: ${JSON.stringify(data.node_errors)})` : '') +
        '. Run sylo_video_gen_doctor to re-validate nodes against this ComfyUI build.',
    )
  return promptId
}

interface HistoryEntry {
  outputs?: Record<string, unknown>
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
}

/** History output refs — SaveVideo serializes into `images` (ui.PreviewVideo), like SaveImage. */
function outputRefsForEntry(entry: HistoryEntry): ComfyOutputRef[] {
  const refs: ComfyOutputRef[] = []
  for (const nodeOutput of Object.values(entry.outputs ?? {})) {
    const o = nodeOutput as { images?: unknown[] }
    for (const image of Array.isArray(o?.images) ? o.images : []) {
      const r = image as Partial<ComfyViewRef>
      if (typeof r?.filename === 'string' && typeof r?.type === 'string' && r.type === 'output') {
        refs.push(classifyRef({ filename: r.filename, subfolder: typeof r.subfolder === 'string' ? r.subfolder : '', type: r.type }))
      }
    }
  }
  refs.sort((a, b) => a.subfolder.localeCompare(b.subfolder) || a.filename.localeCompare(b.filename))
  return refs
}

function executionErrorForEntry(entry: HistoryEntry): string | undefined {
  for (const message of Array.isArray(entry.status?.messages) ? entry.status.messages : []) {
    if (!Array.isArray(message) || message.length < 2) continue
    const kind = message[0]
    if (kind !== 'execution_error' && kind !== 'execution_interrupted') continue
    const d = message[1] as { node_id?: unknown; node_type?: unknown; exception_message?: unknown } | undefined
    const where = `${d?.node_id ?? '?'}${d?.node_type ? ` (${d.node_type})` : ''}`
    const text = d?.exception_message ?? (kind === 'execution_interrupted' ? 'job was interrupted' : 'execution error')
    return `ComfyUI execution failed on node ${where}: ${text} — the run was not saved; check the ComfyUI console for the embedded workflow, or run sylo_video_gen_doctor to re-validate nodes.`
  }
  return undefined
}

/** GET /history/{id} one-shot — the §4.3 job-replay primitive (no polling). */
export async function historyFor(baseUrl: string, promptId: string): Promise<ComfyHistorySnapshot> {
  const u = normalizeBaseUrl(baseUrl)
  const url = `${u}/history/${encodeURIComponent(promptId)}`
  const data = await fetchJson(url, { timeoutMs: PER_REQUEST_TIMEOUT_MS })
  const entry = (data as Record<string, HistoryEntry | undefined>)?.[promptId]
  if (!entry) return { outputs: [] }
  const failure = executionErrorForEntry(entry)
  if (failure)
    return { statusStr: 'error', completed: false, outputs: [], error: failure }
  return {
    statusStr: entry.status?.status_str,
    completed: entry.status?.completed === true,
    outputs: outputRefsForEntry(entry),
  }
}

/**
 * Poll GET /history/{prompt_id} until the SaveVideo outputs are ready (§2.3 —
 * poll-based v1; WebSocket progress is v2). Terminal failures throw typed
 * errors: execution_failed, timeout (per-job cap), video_output_missing
 * (completed but no saved video file). Success returns EVERY type:'output' ref
 * classified video/poster by extension, sorted by save order (branch seeds ascend).
 */
export async function comfyPollResult(
  baseUrl: string,
  promptId: string,
  timeoutMs = effectiveJobTimeoutMs(),
  hooks?: { onProgress?: (p: VideoGenProgress) => void },
): Promise<{ done: boolean; outputs: ComfyOutputRef[] }> {
  const u = normalizeBaseUrl(baseUrl)
  const url = `${u}/history/${encodeURIComponent(promptId)}`
  const deadline = Date.now() + timeoutMs
  const started = Date.now()
  for (;;) {
    const data = await fetchJson(url, { timeoutMs: PER_REQUEST_TIMEOUT_MS })
    const entry = (data as Record<string, HistoryEntry | undefined>)?.[promptId]
    if (entry) {
      const failure = executionErrorForEntry(entry)
      if (failure) throw new ComfyUIError('execution_failed', failure)
      const outputs = outputRefsForEntry(entry)
      const videoOutputs = outputs.filter((r) => r.kind === 'video')
      if (videoOutputs.length > 0) return { done: true, outputs }
      if (entry.status?.completed)
        throw new ComfyUIError(
          'video_output_missing',
          `ComfyUI completed job ${promptId} but no video file was saved` +
            (outputs.length ? ` (only ${outputs.map((o) => `${o.kind}:${o.filename}`).join(', ')})` : '') +
            " — the graph's SaveVideo may be disabled or mis-wired in this ComfyUI build. Run sylo_video_gen_doctor.",
        )
    }
    hooks?.onProgress?.({ comfy_prompt_id: promptId, elapsed_ms: Date.now() - started })
    if (Date.now() >= deadline) {
      throw new ComfyUIError(
        'timeout',
        `ComfyUI job ${promptId} did not finish within ${fmtTimeout(timeoutMs / 1000)} — long finals can exceed the cap; check the ComfyUI console for a stuck job or VRAM pressure, then run sylo_video_gen_doctor. (Cap tunable via SYLO_VIDEOGEN_JOB_TIMEOUT_MS.)`,
      )
    }
    await sleep(pollIntervalMs)
  }
}

/** GET /view?filename=&subfolder=&type=output → raw bytes, container-agnostic (video + posters). */
export async function comfyFetchOutputBytes(
  baseUrl: string,
  ref: { filename: string; subfolder: string; type?: string },
): Promise<Uint8Array> {
  const u = normalizeBaseUrl(baseUrl)
  const type = ref.type || 'output'
  const url = `${u}/view?filename=${encodeURIComponent(ref.filename)}&subfolder=${encodeURIComponent(ref.subfolder)}&type=${encodeURIComponent(type)}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) })
  } catch (err) {
    throw asNetworkError(url, err, Math.round(PER_REQUEST_TIMEOUT_MS / 1000))
  }
  throwUnlessOk(res, url, `fetching ${type}/${ref.subfolder}/${ref.filename}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length === 0)
    throw new ComfyUIError(
      'no_outputs',
      `ComfyUI returned an empty file for ${type}/${ref.subfolder}/${ref.filename} — it may have been cleaned up from output/. Try generating again, or run sylo_video_gen_doctor.`,
    )
  return bytes
}

/**
 * POST /upload/image (multipart) — feeds a local file into ComfyUI's input dir
 * so LoadImage (stills for i2v/loop) and LoadVideo (restyle control clips) can
 * read it. Stores ANY bytes (the endpoint is not content-type-restricted —
 * server.py image_upload verified 2026-10-12; "image" is ComfyUI's field name).
 * overwrite '1' keeps re-uploads deterministic (the loop re-feeds the SAME
 * still at start AND end — one upload either way).
 */
export async function comfyUploadFile(
  baseUrl: string,
  bytes: Uint8Array,
  filename: string,
  options: { subfolder?: string; overwrite?: boolean } = {},
): Promise<{ ref: string; name: string; subfolder: string }> {
  const u = normalizeBaseUrl(baseUrl)
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), filename)
  form.append('overwrite', options.overwrite === false ? 'false' : '1')
  if (options.subfolder) form.append('subfolder', options.subfolder)
  form.append('type', 'input')
  let res: Response
  try {
    res = await fetch(`${u}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) })
  } catch (err) {
    throw asNetworkError(`${u}/upload/image`, err, Math.round(PER_REQUEST_TIMEOUT_MS / 1000))
  }
  throwUnlessOk(res, `${u}/upload/image`, `uploading ${filename}`)
  const data = (await res.json().catch(() => undefined)) as { name?: unknown; subfolder?: unknown } | undefined
  const name = typeof data?.name === 'string' ? data.name : undefined
  if (!name)
    throw new ComfyUIError(
      'bad_status',
      `ComfyUI accepted the upload of ${filename} but returned no name — the file reference for the workflow cannot be built. Run sylo_video_gen_doctor.`,
      res.status,
    )
  const subfolder = typeof data?.subfolder === 'string' ? data.subfolder : (options.subfolder ?? '')
  // LoadImage/LoadVideo enum values are <subfolder>/<basename> when a subfolder is set.
  const ref = subfolder ? `${subfolder}/${name}` : name
  return { ref, name, subfolder }
}

/**
 * Queue-position helper (§2.3): 0 for "currently running", N+1-based pending
 * position for queued jobs (first pending = running.length … well, pending
 * index + running count, 1-based), or -1 when unknown. Cheap GET /queue read
 * for job cards.
 */
export async function comfyQueuePosition(baseUrl: string, promptId: string): Promise<number> {
  const u = normalizeBaseUrl(baseUrl)
  const queue = (await fetchJson(`${u}/queue`, { timeoutMs: HEALTH_TIMEOUT_MS })) as Record<string, unknown> | undefined
  const running = Array.isArray(queue?.queue_running) ? queue.queue_running : []
  const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : []
  const contains = (entry: unknown): boolean => JSON.stringify(entry)?.includes(promptId) === true
  if (running.some(contains)) return 0
  const pendingIndex = pending.findIndex(contains)
  if (pendingIndex >= 0) return pendingIndex + 1
  return -1
}

/**
 * Cancel — best-effort (§2.3): delete the queued entry via POST /queue
 * {"delete":[prompt_id]} and interrupt the running job. Returns what happened
 * so tools can render it; network-level failures stay typed.
 */
export async function comfyCancelJob(
  baseUrl: string,
  promptId: string,
): Promise<{ deletedQueued: boolean; interrupted: boolean; notes: string[] }> {
  const u = normalizeBaseUrl(baseUrl)
  const notes: string[] = []
  const result = { deletedQueued: false, interrupted: false, notes }
  try {
    const res = await fetch(`${u}/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
      signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
    })
    result.deletedQueued = res.ok
    if (!res.ok) notes.push(`ComfyUI queue delete answered ${res.status} for ${promptId}`)
  } catch (err) {
    if (err instanceof ComfyUIError) throw err
    notes.push(`queue delete failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const res = await fetch(`${u}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) })
    result.interrupted = res.ok
  } catch (err) {
    if (err instanceof ComfyUIError) throw err
    notes.push(`interrupt failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return result
}

/**
 * Doctor's guard (§2.4): every node class the builder emits must exist in
 * /object_info before the first submit — guards against ComfyUI version churn;
 * returns the missing classes (caller decides fatal vs downgrade).
 */
export async function comfyValidateWorkflowNodes(baseUrl: string, workflow: unknown): Promise<string[]> {
  const u = normalizeBaseUrl(baseUrl)
  const objectInfo = await fetchJson(`${u}/object_info`, { timeoutMs: PER_REQUEST_TIMEOUT_MS })
  const known = new Set(Object.keys((objectInfo ?? {}) as Record<string, unknown>))
  return missingNodeClasses(workflow, known)
}

export function missingNodeClasses(workflow: unknown, known: Set<string>): string[] {
  const classes = new Set<string>()
  for (const value of Object.values((workflow ?? {}) as Record<string, { class_type?: unknown }>)) {
    if (typeof value?.class_type === 'string' && value.class_type) classes.add(value.class_type)
  }
  return [...classes].filter((c) => !known.has(c)).sort()
}

/** Override the poll cadence in tests only (repo pattern: __resetHostPluginsForTests). */
export function __setPollIntervalForTests(ms: number): void {
  pollIntervalMs = ms
}

// ── Doctor support (§3.3) — additive; BackendHealth stays the normalized contract ──

/** Raw /system_stats echo. Field names vary across ComfyUI builds — doctor reads defensively. */
export interface ComfySystemStatsRaw {
  system?: {
    os?: string
    ram_total?: number
    ram_free?: number
    comfyui_version?: string
    python_version?: string
    pytorch_version?: string
    torch_version?: string
    [key: string]: unknown
  }
  devices?: {
    name?: string
    type?: string
    index?: number
    vram_total?: number
    vram_free?: number
    [key: string]: unknown
  }[]
}

/** GET {base}/system_stats → raw echo (typed failure; doctor renders text). */
export async function comfySystemStats(baseUrl: string): Promise<ComfySystemStatsRaw> {
  const u = normalizeBaseUrl(baseUrl)
  const raw = await fetchJson(`${u}/system_stats`, { timeoutMs: HEALTH_TIMEOUT_MS })
  if (!raw || typeof raw !== 'object')
    throw new ComfyUIError(
      'bad_status',
      `ComfyUI returned an unexpected /system_stats body at ${u} — is that endpoint really a ComfyUI server? Check the URL in sylo-video-gen Settings.`,
    )
  return raw as ComfySystemStatsRaw
}

export interface ComfyDoctorProbeEntry {
  id: string
  /** Files of this entry's comfy wiring present in the loader lists. */
  detected: boolean
  /** Classes a built graph needs that /object_info lacks (opt-ins report not-wired). */
  missing_nodes: string[]
}

export interface ComfyDoctorProbe {
  /** Number of node classes ComfyUI exposes. */
  known_node_count: number
  models: ComfyDoctorProbeEntry[]
  /** frame_interpolation pack state (loop upgrade/downgrade note — tracker VERIFY). */
  frame_interpolation: { available: boolean; models: string[] }
}

/**
 * Doctor's one-pull /object_info probe (§2.4 + §3.3): model detection AND
 * per-model workflow-node validation from a single fetch (object_info is huge).
 * Every WIRED variant builds its real graph shape against sentinel refs —
 * nothing is uploaded here. Opt-in entries (no wiring) are reported, not built.
 */
export async function comfyDoctorProbe(
  baseUrl: string,
  catalog: VideoModelCatalogEntry[] = VIDEO_MODEL_CATALOG,
): Promise<ComfyDoctorProbe> {
  const u = normalizeBaseUrl(baseUrl)
  const objectInfo = await fetchJson(`${u}/object_info`, { timeoutMs: PER_REQUEST_TIMEOUT_MS })
  const known = new Set(Object.keys((objectInfo ?? {}) as Record<string, unknown>))
  const detected = detectCatalogModels(objectInfo, catalog)
  const models: ComfyDoctorProbeEntry[] = []
  for (const entry of catalog) {
    const wired = (Object.values(entry.comfy.variants ?? {}) as unknown[]).filter((v) => !!v) as NonNullable<
      VideoModelCatalogEntry['comfy']['variants'][WorkflowVariant]
    >[]
    let missingNodes: string[] = []
    if (!entry.comfy || wired.length === 0) {
      missingNodes = ['(opt-in model — not wired in v1)']
    } else {
      try {
        const req: VideoGenRequest = {
          mode: entry.mode_roles.includes('restyle') ? 'restyle' : entry.mode_roles.includes('loop') && !entry.mode_roles.includes('clip') ? 'loop' : 'clip',
          prompt: 'sylo-video-gen doctor node probe',
          model: entry.id,
          preset: entry.role === 'draft' ? 'draft' : 'final',
          resolution: entry.resolutions[0] ?? '720p',
          orientation: 'landscape',
          duration_seconds: Math.min(4, entry.max_duration_seconds),
          framerate: entry.default_framerate,
          frame_count: 97,
          seed: 0,
          count: 1,
          save: false,
          source_image_path: 'sylo-probe-still.png',
          source_video_path: 'sylo-probe-clip.mp4',
        }
        const workflow = buildWorkflowForRequest(req, { sourceImageRef: 'sylo-probe-still.png', sourceVideoRef: 'sylo-probe-clip.mp4' }, entry)
        missingNodes = missingNodeClasses(workflow, known)
      } catch {
        missingNodes = ['(workflow build failed — see doctor report)']
      }
    }
    models.push({ id: entry.id, detected: detected[entry.id] === true, missing_nodes: missingNodes })
  }
  const interpModels = fileNamesIn(objectInfo, 'FrameInterpolationModelLoader', ['model_name'])
  return {
    known_node_count: known.size,
    models,
    frame_interpolation: { available: interpModels.length > 0, models: interpModels },
  }
}

// ── Output composition (§2.3: fetch outputs → metadata for the §4.3 ledger) ──

export interface ComfyVideoMeta {
  model: string
  mode: VideoGenRequest['mode']
  preset: VideoGenRequest['preset']
  variant: WorkflowVariant
  seed: number
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  sampling_shift: number
  framerate: number
  width: number
  height: number
  frame_count: number
  video_format: VideoFormat
  comfy_prompt_id: string
  gen_ms: number
}

/** One rendered clip + its poster, as fetched bytes (the store writes the library row, §4). */
export interface ComfyVideoOutput {
  video: Uint8Array
  poster?: Uint8Array
  videoRef: ComfyOutputRef
  posterRef?: ComfyOutputRef
  meta: ComfyVideoMeta
}

export interface ComfyVideoGenerateOptions {
  timeoutMs?: number
  onProgress?: (p: VideoGenProgress) => void
  /** Loop frame-interpolation override (OFF by default — VERIFY: RIFE/FILM download-not-present). */
  interpolation?: { model_name: string; multiplier?: number }
}

/**
 * One-shot backend composition (§2.3): build the API-format graph for the
 * request (source refs must already be UPLOADED — the caller runs
 * comfyUploadFile first), fail fast on missing nodes when ComfyUI is
 * reachable, submit, poll to completion, and fetch the video + poster bytes.
 * The §8.6 tool and §8.7 route compose on this; the store layer owns library
 * writes. count>1 fans branches in ONE submit (seeds ascend with save order).
 */
export async function comfyGenerateVideo(
  baseUrl: string,
  req: VideoGenRequest,
  context: { sourceImageRef?: string; sourceVideoRef?: string; interpolation?: { model_name: string; multiplier?: number } },
  options: ComfyVideoGenerateOptions = {},
): Promise<{ promptId: string; outputs: ComfyVideoOutput[] }> {
  const u = normalizeBaseUrl(baseUrl)
  const entry = findVideoModelEntry(req.model)
  if (!entry)
    throw new ComfyUIError(
      'unknown_model',
      `Unknown video model "${req.model}" — sylo-video-gen catalog: ${VIDEO_MODEL_IDS.join(', ')}.`,
    )

  let workflow: Record<string, unknown>
  try {
    workflow = buildWorkflowForRequest(req, context, entry)
  } catch (err) {
    throw err instanceof ComfyUIError
      ? err
      : new ComfyUIError(
          'validation_failed',
          `The ${entry.family} ${req.mode} workflow is invalid: ${err instanceof Error ? err.message : String(err)}`,
        )
  }

  // Runtime node-name validation when reachable (§2.4): a missing-nodes
  // failure is fatal before submitting; object_info being unreachable is not —
  // submit then produces the honest not_reachable error instead.
  try {
    const missing = await comfyValidateWorkflowNodes(u, workflow)
    if (missing.length > 0)
      throw new ComfyUIError(
        'validation_failed',
        `ComfyUI at ${u} does not have these required workflow nodes: ${missing.join(', ')} — ` +
          'this ComfyUI build may be too old or unusually packaged. Update ComfyUI; run sylo_video_gen_doctor for the full report.',
      )
  } catch (err) {
    if (err instanceof ComfyUIError && err.code === 'validation_failed') throw err
  }

  const started = Date.now()
  const promptId = await comfySubmitWorkflow(u, workflow)
  options.onProgress?.({ comfy_prompt_id: promptId, elapsed_ms: 0 })
  const { outputs } = await comfyPollResult(u, promptId, effectiveJobTimeoutMs(options.timeoutMs), { onProgress: options.onProgress })

  const videoRefs = outputs.filter((r) => r.kind === 'video')
  const posterRefs = outputs.filter((r) => r.kind === 'poster')
  if (videoRefs.length === 0)
    throw new ComfyUIError(
      'video_output_missing',
      `Job ${promptId} finished without a video output ref (${outputs.length} refs) — SaveVideo may be mis-wired. Run sylo_video_gen_doctor.`,
    )

  const variant = workflowVariantFor({ mode: req.mode, source_image: req.source_image_id ? req.source_image_id : req.source_image_path ? req.source_image_path : '' })
  const sampling = videoSamplingFor(entry, variant, { loop_motion_strength: req.loop_motion_strength })
  const px = resolutionPxFor(entry, req.resolution, req.orientation)

  const rendered: ComfyVideoOutput[] = []
  for (let i = 0; i < videoRefs.length; i++) {
    const videoRef = videoRefs[i]
    const buffer = await comfyFetchOutputBytes(u, videoRef)
    let poster: Uint8Array | undefined
    let posterRef: ComfyOutputRef | undefined
    // count>1 = 2× (video, poster) pairs — posterRefs ascend with videoRefs.
    if (posterRefs[i]) {
      posterRef = posterRefs[i]
      poster = await comfyFetchOutputBytes(u, posterRef)
    }
    rendered.push({
      video: buffer,
      poster,
      videoRef,
      posterRef,
      meta: {
        model: entry.id,
        mode: req.mode,
        preset: req.preset,
        variant,
        seed: req.seed + i,
        steps: sampling.steps,
        cfg: sampling.cfg,
        sampler: sampling.sampler,
        scheduler: sampling.scheduler,
        sampling_shift: sampling.shift,
        framerate: req.framerate,
        width: px.width,
        height: px.height,
        frame_count: req.frame_count,
        video_format: DEFAULT_VIDEO_FORMAT,
        comfy_prompt_id: promptId,
        gen_ms: Date.now() - started,
      },
    })
  }
  return { promptId, outputs: rendered }
}

export type { BackendHealth, VideoGenProgress, VideoGenRequest } from '../types.ts'
export type { ComfyApiGraph, ComfyApiNode } from './workflows.ts'