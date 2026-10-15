/**
 * ComfyUI HTTP client (plan §2.3) — pure TS over global `fetch`, no Python.
 * ALL-LOCAL ONLY (§2.6): talks to one ComfyUI instance (default 127.0.0.1:8188);
 * there are no remote-generation endpoints, keys, or auth anywhere in here.
 *
 * v1 endpoint contract (verified against ComfyUI core API shape; §6 manual QA
 * re-verifies against the operator's live install):
 *   health        GET  {base}/system_stats          → version/device/VRAM
 *   queue depth   GET  {base}/queue                 → running+pending length
 *   node catalog  GET  {base}/object_info           → class → inputs (model detection)
 *   submit        POST {base}/prompt                 → body {prompt: graph, client_id} → {prompt_id}
 *   result        GET  {base}/history/{prompt_id}   → outputs → status/messages
 *   fetch bytes   GET  {base}/view?filename=&subfolder=&type=output → PNG bytes
 *   interrupt     POST {base}/interrupt              → cancel (route-owned jobs; v2 UI)
 *
 * `client_id` is a stable-per-process UUID (crypto.randomUUID) so ComfyUI-side
 * progress/cancel tracking can attribute our jobs (plan §2.3). Per-request
 * timeouts via AbortSignal.timeout; every failure is a typed, actionable
 * ComfyUIError — never a raw/network stack error, matching how the repo's
 * shared modules throw (tasks-store precedent: tools catch and render text).
 */
import { randomUUID } from 'node:crypto'
import type { BackendHealth, GenOutput, GenProgress, GenRequest, GenResult, ModelCatalogEntry } from '../types.ts'
import { findModelEntry, IMAGE_MODEL_CATALOG, IMAGE_MODEL_IDS } from '../models.ts'
import { buildWorkflowForModel, samplingFor, type ComfyApiGraph } from './workflows.ts'

export const COMFYUI_DEFAULT_URL = 'http://127.0.0.1:8188'
/** Per-job hard cap (plan §2.3). */
export const JOB_TIMEOUT_MS = 10 * 60 * 1000
/** Health probes stay short — doctor must feel responsive. */
export const HEALTH_TIMEOUT_MS = 5_000
/** System stats/object_info/prompt/view/history requests get this ceiling. */
export const PER_REQUEST_TIMEOUT_MS = 30_000
/** Sleep between history polls; test-overridable (see __setPollIntervalForTests). */
export const POLL_INTERVAL_MS = 1_000

let pollIntervalMs = POLL_INTERVAL_MS

/** Stable-per-process ComfyUI client id — cancel/progress attribution (plan §2.3). */
export const COMFYUI_CLIENT_ID = randomUUID()

export type ComfyUIErrorCode =
  | 'not_reachable'
  | 'timeout'
  | 'bad_status'
  | 'submit_rejected'
  | 'validation_failed'
  | 'execution_failed'
  | 'no_outputs'
  | 'unknown_model'

/** Typed, actionable ComfyUI backend error — tools/route surface `message` as text. */
export class ComfyUIError extends Error {
  readonly code: ComfyUIErrorCode
  readonly httpStatus?: number
  constructor(code: ComfyUIErrorCode, message: string, httpStatus?: number) {
    super(message)
    this.name = 'ComfyUIError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface ComfyViewRef {
  filename: string
  subfolder: string
  type: string
}

export interface ComfyPollResult {
  /** Always true on return — terminal failure states throw a typed error instead. */
  done: boolean
  viewUrls: ComfyViewRef[]
}

/** Accepts ''/missing as the default URL; strips trailing slashes. */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl ?? '').trim()
  return (trimmed || COMFYUI_DEFAULT_URL).replace(/\/+$/, '')
}

// Loopback ports a local ComfyUI Desktop instance may bind. When the configured
// port refuses, the sibling instance port is probed before giving up: operators
// restart Desktop and land on :8189 more often than anything else (found live
// 2026-10-13 — engine on :8189, both sylo configs pinning :8188, "ComfyUI is
// running but everything says not reachable"). Non-default (custom host/port)
// configs are respected exactly as written — no probing of other hosts/ports.
const COMFYUI_FALLBACK_PORTS = [8188, 8189]

/** Configured URL resolved against a live engine: the configured URL wins when
 *  it answers; when it is a known loopback port that refuses and the sibling
 *  port answers, the sibling is returned. Never throws — the ORIGINAL configured
 *  URL is returned when nothing answers so downstream error text still names it.
 *  The health of the RETURNED url comes back too so callers that already
 *  consume raw stats do not re-fetch /system_stats (§3 note 5 dedupe kept). */
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

function fmtTimeout(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`
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
        'Wait, or run sylo_image_gen_doctor to check GPU/VRAM state.',
    )
  }
  return new ComfyUIError(
    'not_reachable',
    `ComfyUI not reachable at ${shorten(url)} — start ComfyUI (Desktop's default API is ${COMFYUI_DEFAULT_URL}) ` +
      'or fix the URL in sylo-image-gen Settings; you can ask the agent to run sylo_image_gen_doctor. ' +
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
      ' — if the URL is right but the server complains, run sylo_image_gen_doctor to re-check it.',
    res.status,
  )
}

async function fetchJson(
  url: string,
  init: { method?: 'GET' | 'POST'; body?: string; timeoutMs: number },
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { method: init.method ?? 'GET', body: init.body, signal: AbortSignal.timeout(init.timeoutMs) })
  } catch (err) {
    throw asNetworkError(url, err, Math.round(init.timeoutMs / 1000))
  }
  throwUnlessOk(res, url)
  try {
    return await res.json()
  } catch {
    throw new ComfyUIError(
      'bad_status',
      `ComfyUI returned non-JSON for ${shorten(url)} (HTTP ${res.status}) — is that endpoint really a ComfyUI HTTP server? Check the URL in sylo-image-gen Settings.`,
      res.status,
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** BackendHealth + the raw /system_stats echo — doctor reuses the single stats
 *  fetch instead of re-probing (§3 note 5 dedupe); additive subtype. */
export interface BackendHealthWithStats extends BackendHealth {
  /** Raw /system_stats body. Present when ok (fetched inside comfyHealth). */
  stats?: ComfySystemStatsRaw
}

/** GET /system_stats (+ /queue for depth) → BackendHealth. Never throws: a dead ComfyUI is ok:false. */
export async function comfyHealth(baseUrl: string): Promise<BackendHealthWithStats> {
  const u = normalizeBaseUrl(baseUrl)
  try {
    const stats = (await fetchJson(`${u}/system_stats`, { timeoutMs: HEALTH_TIMEOUT_MS })) as Record<string, unknown> | undefined
    const queue = (await fetchJson(`${u}/queue`, { timeoutMs: HEALTH_TIMEOUT_MS })) as Record<string, unknown> | undefined
    const system = stats?.system as Record<string, unknown> | undefined
    const device = ((stats?.devices as unknown[] | undefined)?.[0] ?? stats?.device) as Record<string, unknown> | undefined
    const num = (v: unknown): number | undefined => {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    return {
      ok: true,
      url: u,
      version: typeof system?.comfyui_version === 'string' ? system.comfyui_version : undefined,
      device_name: typeof device?.name === 'string' ? device.name : undefined,
      vram_total_bytes: num(device?.vram_total),
      vram_free_bytes: num(device?.vram_free),
      queue_depth: (Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0) +
        (Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0),
      // §3 note 5 dedupe: pass the raw stats through so the doctor does not
      // fetch /system_stats a second time (§2.3/§3.3).
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

function fileNamesIn(
  objectInfo: unknown,
  classType: string,
  inputKeys: string[],
): string[] {
  const inputs = (objectInfo as Record<string, { inputs?: Record<string, unknown> } | undefined>)?.[classType]?.inputs
  if (!inputs) return []
  const out: string[] = []
  for (const key of inputKeys) {
    const v = inputs[key]
    if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'))
  }
  return out
}

/** Model-dir-relative names may include subfolders ('flux/klein/x.safetensors') — match on basename. */
function listHas(names: Iterable<string>, fileName: string): boolean {
  const want = fileName.toLowerCase()
  for (const item of names) {
    const low = item.toLowerCase()
    if (low === want || low.endsWith(`/${want}`)) return true
  }
  return false
}

/**
 * GET /object_info → which catalog models are actually installed. Detection
 * matches the catalog's comfy wiring file names against what the loaders expose
 * (UNETLoader + CheckpointLoaderSimple for DiTs, CLIPLoader/DualCLIPLoader for
 * TEs, VAELoader) — detect, never trust (plan §2.2).
 */
export async function comfyModelsDetected(
  baseUrl: string,
  catalog: ModelCatalogEntry[] = IMAGE_MODEL_CATALOG,
): Promise<Record<string, boolean>> {
  const u = normalizeBaseUrl(baseUrl)
  const objectInfo = await fetchJson(`${u}/object_info`, { timeoutMs: PER_REQUEST_TIMEOUT_MS })
  return detectCatalogModels(objectInfo, catalog)
}

/** Pure part of the detection above, reused by the doctor's single-pull probe. */
function detectCatalogModels(objectInfo: unknown, catalog: ModelCatalogEntry[]): Record<string, boolean> {
  const unet = new Set(fileNamesIn(objectInfo, 'UNETLoader', ['unet_name']))
  for (const n of fileNamesIn(objectInfo, 'CheckpointLoaderSimple', ['ckpt_name'])) unet.add(n)
  const clips = new Set([
    ...fileNamesIn(objectInfo, 'CLIPLoader', ['clip_name']),
    ...fileNamesIn(objectInfo, 'DualCLIPLoader', ['clip_name1', 'clip_name2', 'clip_name3']),
  ])
  const vae = new Set(fileNamesIn(objectInfo, 'VAELoader', ['vae_name']))

  const detected: Record<string, boolean> = {}
  for (const entry of catalog) {
    const c = entry.comfy
    detected[entry.id] =
      !!c &&
      listHas(unet, c.diffusion_model) &&
      c.text_encoders.every((te) => listHas(clips, te)) &&
      listHas(vae, c.vae)
  }
  return detected
}

/** POST /prompt ({prompt, client_id}) → {prompt_id}. Throws submit_rejected with ComfyUI's own errors. */
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
    try {
      const bodyJson = (await res.json()) as {
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
        '. Run sylo_image_gen_doctor to re-validate nodes against this ComfyUI build.',
      res.status,
    )
  }
  const data = (await res.json().catch(() => undefined)) as { prompt_id?: unknown; node_errors?: unknown } | undefined
  const promptId = data?.prompt_id
  if (typeof promptId !== 'string' || !promptId)
    throw new ComfyUIError(
      'submit_rejected',
      `ComfyUI accepted the connection but returned no prompt_id for ${shorten(`${u}/prompt`)}` +
        (data && 'node_errors' in data && data.node_errors ? ` (node_errors: ${JSON.stringify(data.node_errors)})` : '') +
        '. Run sylo_image_gen_doctor to re-validate nodes against this ComfyUI build.',
    )
  return promptId
}

interface HistoryEntry {
  outputs?: Record<string, { images?: unknown[] } | undefined>
  status?: {
    status_str?: string
    completed?: boolean
    messages?: unknown[]
  }
}

function viewRefForEntry(entry: HistoryEntry): ComfyViewRef[] {
  const refs: ComfyViewRef[] = []
  for (const nodeOutput of Object.values(entry.outputs ?? {})) {
    for (const image of Array.isArray(nodeOutput?.images) ? nodeOutput.images : []) {
      const r = image as Partial<ComfyViewRef>
      if (typeof r?.filename === 'string' && typeof r?.type === 'string' && r.type === 'output') {
        refs.push({ filename: r.filename, subfolder: typeof r.subfolder === 'string' ? r.subfolder : '', type: r.type })
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
    return `ComfyUI execution failed on node ${where}: ${text} — the run was not saved; check the ComfyUI console for the embedded workflow, or run sylo_image_gen_doctor to re-validate nodes.`
  }
  return undefined
}

/**
 * Poll GET /history/{prompt_id} until outputs are ready (plan §2.3 — poll-based
 * v1; WebSocket progress is v2). Terminal failures throw typed errors:
 * execution_failed (node error / interrupted), timeout (per-job hard cap),
 * no_outputs (completed but zero saved images). Success returns every
 * type:'output' view ref, sorted by save order (branch seeds are ascending).
 */
export async function comfyPollResult(
  baseUrl: string,
  promptId: string,
  timeoutMs = JOB_TIMEOUT_MS,
  hooks?: { onProgress?: (p: GenProgress) => void },
): Promise<{ done: boolean; viewUrls: ComfyViewRef[] }> {
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
      const viewUrls = viewRefForEntry(entry)
      if (viewUrls.length > 0) return { done: true, viewUrls }
      if (entry.status?.completed)
        throw new ComfyUIError(
          'no_outputs',
          `ComfyUI completed job ${promptId} but reported no saved output images — the graph's SaveImage may be disabled in this ComfyUI build. Run sylo_image_gen_doctor.`,
        )
    }
    hooks?.onProgress?.({ comfy_prompt_id: promptId, elapsed_ms: Date.now() - started })
    if (Date.now() >= deadline) {
      throw new ComfyUIError(
        'timeout',
        `ComfyUI job ${promptId} did not finish within ${fmtTimeout(timeoutMs / 1000)} — check the ComfyUI console for a stuck job or VRAM pressure, then run sylo_image_gen_doctor.`,
      )
    }
    await sleep(pollIntervalMs)
  }
}

/** GET /view?filename=&subfolder=&type=output → raw bytes (png for v1). */
export async function comfyFetchImageBytes(
  baseUrl: string,
  filename: string,
  subfolder: string,
  type = 'output',
): Promise<Uint8Array> {
  const u = normalizeBaseUrl(baseUrl)
  const url = `${u}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) })
  } catch (err) {
    throw asNetworkError(url, err, Math.round(PER_REQUEST_TIMEOUT_MS / 1000))
  }
  throwUnlessOk(res, url, `fetching ${type}/${subfolder}/${filename}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length === 0)
    throw new ComfyUIError(
      'no_outputs',
      `ComfyUI returned an empty file for ${type}/${subfolder}/${filename} — it may have been cleaned up from output/. Try generating again, or run sylo_image_gen_doctor.`,
    )
  return bytes
}

/** POST /interrupt — route-owned jobs only (v2 queue screen); safe no-op call otherwise. */
export async function comfyInterrupt(baseUrl: string): Promise<void> {
  const u = normalizeBaseUrl(baseUrl)
  let res: Response
  try {
    res = await fetch(`${u}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) })
  } catch (err) {
    throw asNetworkError(`${u}/interrupt`, err, Math.round(PER_REQUEST_TIMEOUT_MS / 1000))
  }
  throwUnlessOk(res, `${u}/interrupt`)
}

/**
 * Doctor's guard (plan §2.4): every node class the builder emits must exist in
 * /object_info before the first submit — guards against ComfyUI version drift;
 * the error names the missing nodes.
 */
export async function comfyValidateWorkflowNodes(baseUrl: string, workflow: unknown): Promise<void> {
  const u = normalizeBaseUrl(baseUrl)
  const objectInfo = await fetchJson(`${u}/object_info`, { timeoutMs: PER_REQUEST_TIMEOUT_MS })
  const known = new Set(Object.keys((objectInfo ?? {}) as Record<string, unknown>))
  const classes = new Set<string>()
  for (const value of Object.values((workflow ?? {}) as Record<string, { class_type?: unknown }>)) {
    if (typeof value?.class_type === 'string' && value.class_type) classes.add(value.class_type)
  }
  const missing = [...classes].filter((c) => !known.has(c)).sort()
  if (missing.length > 0)
    throw new ComfyUIError(
      'validation_failed',
      `ComfyUI at ${u} does not have these required workflow nodes: ${missing.join(', ')} — ` +
        'this ComfyUI build may be too old or unusually packaged. Update ComfyUI; run sylo_image_gen_doctor for the full report.',
    )
}

/** PNG IHDR dims (v1 outputs are PNG; ComfyUI embeds workflow metadata in tEXt). */
export function pngDimensions(buffer: Uint8Array): { width: number; height: number } | undefined {
  if (buffer.length < 24) return undefined
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < sig.length; i++) if (buffer[i] !== sig[i]) return undefined
  // First chunk must be IHDR (8-byte signature + 4-byte length + 'IHDR'), dims at 16/20 BE.
  if (!(buffer[12] === 0x49 && buffer[13] === 0x48 && buffer[14] === 0x44 && buffer[15] === 0x52)) return undefined
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

/** Override the poll cadence in tests only (repo pattern: __resetHostPluginsForTests). */
export function __setPollIntervalForTests(ms: number): void {
  pollIntervalMs = ms
}

// ── Doctor support (§3.3) — additive; BackendHealth stays the normalized contract ──

/** Raw /system_stats echo. Field names vary across ComfyUI builds — doctor (§3.3)
 *  reads these defensively and prints what is missing. VERIFY §6: exact names on
 *  the operator's live install (pytorch_version vs torch_version; cuda fields). */
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

/** GET {base}/system_stats → raw echo. Throws typed ComfyUIError on failure
 *  (doctor catches and renders text). */
export async function comfySystemStats(baseUrl: string): Promise<ComfySystemStatsRaw> {
  const u = normalizeBaseUrl(baseUrl)
  const raw = await fetchJson(`${u}/system_stats`, { timeoutMs: HEALTH_TIMEOUT_MS })
  if (!raw || typeof raw !== 'object')
    throw new ComfyUIError(
      'bad_status',
      `ComfyUI returned an unexpected /system_stats body at ${u} — is that endpoint really a ComfyUI server? Check the URL in sylo-image-gen Settings.`,
    )
  return raw as ComfySystemStatsRaw
}

export interface ComfyDoctorProbeEntry {
  id: string
  /** Files of this entry's comfy wiring present in the loader lists. */
  detected: boolean
  /** Missing-node validation (§2.4): classes a built graph needs that /object_info lacks. */
  missing_nodes: string[]
}

export interface ComfyDoctorProbe {
  /** Number of node classes ComfyUI exposes. */
  known_node_count: number
  models: ComfyDoctorProbeEntry[]
}

/**
 * Doctor's one-pull /object_info probe (plan §2.4 + §3.3): model detection AND
 * per-model workflow-node validation from a single fetch (object_info is huge —
 * one pull keeps the doctor responsive). Node validation builds each catalog
 * model's real graph shape and lists any class the live ComfyUI lacks.
 */
export async function comfyDoctorProbe(
  baseUrl: string,
  catalog: ModelCatalogEntry[] = IMAGE_MODEL_CATALOG,
): Promise<ComfyDoctorProbe> {
  const u = normalizeBaseUrl(baseUrl)
  const objectInfo = await fetchJson(`${u}/object_info`, { timeoutMs: PER_REQUEST_TIMEOUT_MS })
  const known = new Set(Object.keys((objectInfo ?? {}) as Record<string, unknown>))
  const detected = detectCatalogModels(objectInfo, catalog)
  const models: ComfyDoctorProbeEntry[] = []
  for (const entry of catalog) {
    let missingNodes: string[] = []
    try {
      const workflow = buildWorkflowForModel(entry.id, {
        prompt: 'sylo-image-gen doctor node probe',
        model: entry.id,
        preset: entry.role === 'draft' ? 'draft' : 'final',
        width: entry.default_size.width,
        height: entry.default_size.height,
        steps: entry.steps,
        guidance: entry.guidance,
        seed: 0,
        count: 1,
        save: false,
      })
      const classes = new Set<string>()
      for (const value of Object.values((workflow ?? {}) as Record<string, { class_type?: unknown }>)) {
        if (typeof value?.class_type === 'string' && value.class_type) classes.add(value.class_type)
      }
      missingNodes = [...classes].filter((c) => !known.has(c)).sort()
    } catch {
      missingNodes = ['(workflow build failed — see doctor report)']
    }
    models.push({ id: entry.id, detected: detected[entry.id] === true, missing_nodes: missingNodes })
  }
  return { known_node_count: known.size, models }
}

export interface ComfyGenerateOptions {
  timeoutMs?: number
  onProgress?: (p: GenProgress) => void
}

/**
 * One-shot backend call (plan §2.1 ImageBackend.generate equivalent): build the
 * API-format graph for the catalog model, fail fast on missing nodes when
 * ComfyUI is reachable, submit, poll to completion, and fetch every output as
 * bytes. `req` should come from models.resolveGenRequest; seeds spread as
 * base + branch index (N KSampler nodes in one submit — plan §2.4).
 */
export async function comfyGenerate(
  baseUrl: string,
  req: GenRequest,
  options: ComfyGenerateOptions = {},
): Promise<GenResult> {
  const u = normalizeBaseUrl(baseUrl)
  const entry = findModelEntry(req.model)
  if (!entry)
    throw new ComfyUIError(
      'unknown_model',
      `Unknown image model "${req.model}" — sylo-image-gen catalog: ${IMAGE_MODEL_IDS.join(', ')}.`,
    )

  let workflow: Record<string, unknown>
  try {
    workflow = buildWorkflowForModel(entry.id, req)
  } catch (err) {
    throw err instanceof ComfyUIError
      ? err
      : new ComfyUIError('validation_failed', `The ${entry.family} workflow is invalid: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Runtime node-name validation when reachable (plan §2.4): a validation_failed
  // error is fatal before submitting; the node catalog being unreachable is not
  // fatal here — submit will produce the honest not_reachable error instead.
  try {
    await comfyValidateWorkflowNodes(u, workflow)
  } catch (err) {
    if (err instanceof ComfyUIError && err.code === 'validation_failed') throw err
  }

  const started = Date.now()
  const promptId = await comfySubmitWorkflow(u, workflow)
  options.onProgress?.({ comfy_prompt_id: promptId, elapsed_ms: 0 })
  const { viewUrls } = await comfyPollResult(u, promptId, options.timeoutMs ?? JOB_TIMEOUT_MS, {
    onProgress: options.onProgress,
  })

  const sampling = samplingFor(entry, req)
  const outputs: GenOutput[] = []
  for (let i = 0; i < viewUrls.length; i++) {
    const ref = viewUrls[i]
    const buffer = await comfyFetchImageBytes(u, ref.filename, ref.subfolder, ref.type)
    const dims = pngDimensions(buffer) ?? { width: req.width, height: req.height }
    outputs.push({
      buffer,
      width: dims.width,
      height: dims.height,
      meta: {
        model: entry.id,
        preset: req.preset,
        steps: sampling.steps,
        guidance: sampling.fluxGuidance ?? sampling.guidance,
        seed: (req.seed ?? 0) + i,
        sampler: sampling.sampler,
        comfy_prompt_id: promptId,
        gen_ms: Date.now() - started,
      },
    })
  }
  return { outputs }
}

export type { BackendHealth, GenProgress, GenRequest, ComfyApiGraph }