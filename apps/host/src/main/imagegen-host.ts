/**
 * sylo-image-gen — host main-process bridge for the sidebar Images route
 * (plan §5.6, §8 step 5). The route runs as a package-owned Vite iframe; it
 * cannot reach ComfyUI's HTTP API directly (bridge ops only, §5 header), so it
 * talks to the host via the skill-route bridge (postMessage → renderer dispatch →
 * `window.sylo.imagegen.*` → `imagegen:*` IPC → this module).
 *
 * Doctor parity (§3 note 1): this module composes the SAME shared modules the
 * agent tools use — `comfyHealth`/`comfyDoctorProbe` (§2.3 client),
 * `resolveGenRequest` (§2.2 models), `getRecord`/`createRecord`/`queryLibrary`/
 * `organizeRecords`/`loadLibrary` (§4 library store). Route ops call the same
 * store APIs with an EXPLICIT `workspaceCwd` (main has no SYLO_PI_CWD — it is
 * frozen into the broker child only; tasks-db.ts parity); no file scans anywhere
 * (§3 note 3); library mutations keep the store's atomic read-modify-write
 * semantics (§3 note 3 / §4.2 two-writers stance).
 *
 * Route-side job map: this module owns jobId → job bookkeeping for jobs the
 * ROUTE submits (records origin:'route'). Agent jobs submitted via
 * sylo_image_gen_generate are NOT tracked here (v1 shows ComfyUI queue depth
 * only — the Queue screen is v2, §5.4). The map is in-memory; a Sylo restart
 * clears it, which is acceptable because ComfyUI owns the actual jobs
 * server-side.
 *
 * Rerun-as-final / remix inheritance (§3 note 2): `imagegenGenerate` builds the
 * same GenRequestInput the agent tool builds (extensions/tools/generate.ts) —
 * steps/guidance are NEVER copied from the parent record; they come from the
 * freshly resolved catalog entry (`resolveGenRequest`), so a draft→final rerun
 * onto another model cannot inherit the draft model's step count.
 */
import { randomUUID } from 'node:crypto'

import {
  organizeRecords,
  queryLibrary,
  createRecord,
  getRecord,
  imageFileAbs,
  loadLibrary,
  resolveLibraryRoot,
} from '../../../../packages/sylo-image-gen/shared/library-store.js'
import {
  comfyDoctorProbe,
  comfyGenerate,
  comfyHealth,
  ComfyUIError,
  type ComfyDoctorProbe,
  type GenProgress,
} from '../../../../packages/sylo-image-gen/shared/comfyui/client.js'
import { resolveGenRequest, IMAGE_MODEL_CATALOG, type GenRequestInput } from '../../../../packages/sylo-image-gen/shared/models.js'
import type {
  BackendHealth,
  GenRequest,
  ImagePreset,
  ImageRecord,
} from '../../../../packages/sylo-image-gen/shared/types.js'
import { readImagegenConfig } from './imagegen-config.js'

// ── Payload helpers (ipcMain passes raw unknowns — coerce defensively) ──────

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── Route-side job map (§5.1 job card; Queue screen is v2, §5.4) ────────────

export interface ImagegenJobOutput {
  id: string
  path: string
  width: number
  height: number
  seed: number
  bytes: number
  gen_ms?: number
}

export interface ImagegenJobSnapshot {
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

interface ImagegenJob {
  id: string
  createdAt: string
  prompt: string
  model: string
  preset: ImagePreset
  count: number
  status: 'queued' | 'running' | 'done' | 'error'
  startedAt: number
  /** Resolved request (the route sends an input; this is the GenRequest actually submitted). */
  request: GenRequest
  /** Final tag list written with the records (preset auto-tag resolved here). */
  tags: string[]
  parentId?: string
  comfyPromptId?: string
  genMs?: number
  errorText?: string
  outputs: ImagegenJobOutput[]
}

const JOB_MAP_MAX = 60

/** Route-side job map (jobId → request/status/progress/resultIds) — §5.6. */
const jobs = new Map<string, ImagegenJob>()

function pruneJobs(): void {
  if (jobs.size <= JOB_MAP_MAX) return
  for (const [id, job] of jobs) {
    if (jobs.size <= JOB_MAP_MAX) break
    if (job.status === 'done' || job.status === 'error') jobs.delete(id)
  }
}

function jobSnapshot(job: ImagegenJob): ImagegenJobSnapshot {
  return {
    id: job.id,
    created_at: job.createdAt,
    prompt: job.prompt,
    model: job.model,
    preset: job.preset,
    count: job.count,
    status: job.status,
    error: job.errorText,
    comfy_prompt_id: job.comfyPromptId,
    started_at: job.startedAt,
    elapsed_ms: Date.now() - job.startedAt,
    parent_id: job.parentId,
    // Result strip consumes local paths as-is — no preview duplication (§3 note 4).
    outputs: [...job.outputs],
  }
}

function findJobOrThrow(jobId: unknown): ImagegenJob {
  const id = typeof jobId === 'string' ? jobId.trim() : ''
  const job = id ? jobs.get(id) : undefined
  if (!job)
    throw new Error(
      'Unknown image-generation job id — the route keeps only recent jobs in memory ' +
        '(after a Sylo restart old job ids are gone, while generation continues server-side in ComfyUI). ' +
        'Check the Library tab instead, or run the generation again.',
    )
  return job
}

async function runJob(job: ImagegenJob, comfyuiUrl: string, workspaceCwd?: string): Promise<void> {
  try {
    const genStarted = Date.now()
    const gen = await comfyGenerate(comfyuiUrl, job.request, {
      onProgress: (p: GenProgress) => {
        if (p.comfy_prompt_id) job.comfyPromptId = p.comfy_prompt_id
      },
    })
    job.genMs = Date.now() - genStarted

    // SAME store APIs the agent tool uses (§3 notes 1/3): one synchronized
    // createRecord batch per job (each enqueues its fully-synchronous
    // read-modify-atomic-write mutation → one contiguous serialized batch).
    // allSettled keeps the truthful partial picture. Records carry origin
    // 'route' so the library can distinguish dashboard saves from agent saves.
    const settled = await Promise.allSettled(
      gen.outputs.map((out) =>
        createRecord({
          data: out.buffer,
          width: out.width,
          height: out.height,
          prompt: job.request.prompt,
          negative_prompt: job.request.negative_prompt,
          model: out.meta.model,
          preset: out.meta.preset,
          steps: out.meta.steps,
          guidance: out.meta.guidance,
          seed: out.meta.seed,
          sampler: out.meta.sampler,
          gen_ms: out.meta.gen_ms,
          aspect: job.request.aspect,
          tags: job.tags,
          parent_id: job.parentId,
          origin: 'route',
          comfy_prompt_id: out.meta.comfy_prompt_id,
          workspaceCwd,
        }),
      ),
    )
    settled.forEach((res, i) => {
      if (res.status !== 'fulfilled') return
      const out = gen.outputs[i]!
      job.outputs.push({
        id: res.value.record.id,
        path: res.value.file_abs,
        width: res.value.record.width,
        height: res.value.record.height,
        seed: out.meta.seed,
        bytes: res.value.record.bytes,
        gen_ms: out.meta.gen_ms,
      })
    })
    const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    if (rejected) job.errorText = errText(rejected.reason)
    job.status = job.outputs.length > 0 ? 'done' : 'error'
  } catch (err) {
    job.status = 'error'
    job.errorText =
      err instanceof ComfyUIError
        ? err.message
        : `Generation failed: ${errText(err)} — run sylo_image_gen_doctor or check Settings → Connect/health.`
  }
}

// ── §5.1 generate — resolve like the agent tool, then run a route-side job ──

/**
 * Build the tool's GenRequestInput from a raw route request (§3 note 2): same
 * from_image_id inheritance as extensions/tools/generate.ts — prompt/negative/
 * size/seed inherit from the parent when not explicitly set; preset inherits as
 * the parent's catalog model id, while an explicit `preset:'final'` upgrades a
 * draft to the CONFIGURED final model. Steps/guidance are never copied from the
 * parent — `resolveGenRequest` takes them from the resolved catalog entry.
 */
function buildToolShapedInput(
  input: Record<string, unknown>,
  parent: ImageRecord | undefined,
): GenRequestInput {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  const aspectGiven = str(input.aspect) !== '' || num(input.width) !== undefined || num(input.height) !== undefined

  return {
    prompt: str(input.prompt) || parent?.prompt || '',
    // Preset inherits as the parent's catalog model; explicit draft/final/model-id wins.
    preset: str(input.preset) || parent?.model || undefined,
    negative_prompt: str(input.negative_prompt) || parent?.negative_prompt || undefined,
    // Size: explicit dims win, then explicit aspect, then the parent's px.
    width:
      num(input.width) !== undefined
        ? num(input.width)
        : !aspectGiven && parent && parent.width > 0
          ? parent.width
          : undefined,
    height:
      num(input.height) !== undefined
        ? num(input.height)
        : !aspectGiven && parent && parent.height > 0
          ? parent.height
          : undefined,
    // Steps/guidance intentionally NOT inherited (§3 note 2) — the resolved
    // catalog entry supplies them.
    steps: num(input.steps),
    guidance: num(input.guidance),
    // Seed inherits for stable lineage (rerun keeps composition).
    seed:
      num(input.seed) ??
      (parent && Number.isFinite(parent.params.seed) && parent.params.seed > 0
        ? parent.params.seed
        : undefined),
    count: num(input.count) ?? 1,
    save: true,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t)).filter(Boolean) : undefined,
    from_record: str(input.from_image_id) || str(input.from_record) || undefined,
  }
}

export interface ImagegenGenerateArgs extends Record<string, unknown> {
  /** Host-resolved workspace cwd (parity with the tasks ops injection). */
  workspaceCwd?: string
  /** app.getPath('userData') — host config home. */
  userDataPath: string
  /** The route request: prompt/preset/aspect/seed/count/tags (+ from_image_id). */
  request: Record<string, unknown>
}

/** imageGenGenerate: start a route job (background run; snapshot returned now). */
export async function imagegenGenerate(args: ImagegenGenerateArgs): Promise<{
  ok: true
  job: ImagegenJobSnapshot
}> {
  const config = readImagegenConfig(args.userDataPath)
  const input = args.request && typeof args.request === 'object' ? args.request : {}

  const fromImageId = typeof input.from_image_id === 'string' ? input.from_image_id.trim() : ''
  const parent = fromImageId
    ? ((await getRecord({ image_id: fromImageId, workspaceCwd: args.workspaceCwd })) ?? undefined)
    : undefined
  if (fromImageId && !parent)
    throw new Error(`No library image with id "${fromImageId}" — search the Library tab for current ids.`)

  const toolShaped = buildToolShapedInput(input, parent)
  // resolveGenRequest throws plain actionable Errors (count bounds, unknown
  // preset/model ids, bad aspects) — the ipc layer surfaces them as op errors.
  const req = resolveGenRequest(toolShaped, {
    draft_model: config.draft_model,
    final_model: config.final_model,
  })

  // Operator + auto-preset tags (§3.5, mirrored from the agent tool).
  const tags = [...(req.tags ?? [])]
  if (config.auto_tag_preset) tags.push(req.preset)

  const job: ImagegenJob = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    prompt: req.prompt,
    model: req.model,
    preset: req.preset,
    count: req.count,
    status: 'queued',
    startedAt: Date.now(),
    request: req,
    tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
    parentId: parent?.id,
    outputs: [],
  }
  jobs.set(job.id, job)
  pruneJobs()
  // Fire-and-forget run: the composer polls imagegenJobGet for progress/status.
  void runJob(job, config.comfyui_url, args.workspaceCwd)
  return { ok: true, job: jobSnapshot(job) }
}

/** imageGenJobGet: poll a route job for the composer's job card. */
export function imagegenJobGet(args: { job_id?: unknown }): { ok: true; job: ImagegenJobSnapshot } {
  const job = findJobOrThrow(args.job_id)
  return { ok: true, job: jobSnapshot(job) }
}

/** imageGenQueueList: ComfyUI queue depth + recent route jobs (§5.4 Queue screen is v2 — v1 ships the data only). */
export async function imagegenQueueList(args: { workspaceCwd?: string; userDataPath: string }): Promise<{
  ok: true
  health: BackendHealth
  jobs: ImagegenJobSnapshot[]
}> {
  const config = readImagegenConfig(args.userDataPath)
  const health = await comfyHealth(config.comfyui_url)
  const recent = [...jobs.values()].slice(-50).reverse().map(jobSnapshot)
  return { ok: true, health, jobs: recent }
}

// ── §5.2/§5.3 library ops — the same store modules the agent tools use ──────

export interface ImagegenLibraryStats {
  count: number
  favorites: number
  bytes: number
  gen_ms: number
  /** Per-model counts — Library model chips derive from real records, not the catalog. */
  models: Record<string, number>
}

const EMPTY_STATS: ImagegenLibraryStats = { count: 0, favorites: 0, bytes: 0, gen_ms: 0, models: {} }

/** Ledger/stats straight from loadLibrary records (§5.2 footer; §3 note 3). */
export function libraryStatsFor(args: { workspaceCwd?: string }): { root: string; stats: ImagegenLibraryStats } | null {
  const root = resolveLibraryRoot(args)
  if (!root) return null
  const images = loadLibrary(root).images
  const models: Record<string, number> = {}
  for (const im of images) models[im.model] = (models[im.model] ?? 0) + 1
  return {
    root,
    stats: {
      count: images.length,
      favorites: images.filter((im) => im.favorite).length,
      bytes: images.reduce((sum, im) => sum + im.bytes, 0),
      gen_ms: images.reduce((sum, im) => sum + im.gen_ms, 0),
      models,
    },
  }
}

export interface ImagegenLibraryResult {
  ok: true
  library_root: string | null
  items: Awaited<ReturnType<typeof queryLibrary>>['items']
  total: number
  stats: ImagegenLibraryStats
  warning?: string
}

interface LibraryListArgs extends Record<string, unknown> {
  workspaceCwd?: string
}

/** imageGenLibraryList — queryLibrary + footer stats in one round trip. */
export async function imagegenLibraryList(args: LibraryListArgs): Promise<ImagegenLibraryResult> {
  const stats = libraryStatsFor(args)
  if (!stats) {
    return {
      ok: true,
      library_root: null,
      items: [],
      total: 0,
      stats: EMPTY_STATS,
      warning:
        'No workspace selected in the Sylo sidebar — the image library is per-workspace. Pick a workspace and reopen this tab.',
    }
  }
  const result = await queryLibrary({
    workspaceCwd: args.workspaceCwd,
    query: typeof args.query === 'string' ? args.query : undefined,
    tags: Array.isArray(args.tags) ? args.tags.map((t) => String(t)) : undefined,
    favorite: typeof args.favorite === 'boolean' ? args.favorite : undefined,
    model: typeof args.model === 'string' ? args.model : undefined,
    since: typeof args.since === 'string' ? args.since : undefined,
    limit: typeof args.limit === 'number' ? Math.min(100, Math.max(1, Math.floor(args.limit))) : 60,
    offset: typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0,
  })
  return { ok: true, library_root: stats.root, items: result.items, total: result.total, stats: stats.stats }
}

/** imageGenImageGet — full record + absolute path (detail drawer / copy path / reveal). */
export async function imagegenImageGet(args: { image_id?: unknown; workspaceCwd?: string }): Promise<{
  ok: true
  record: ImageRecord
  path: string
} | null> {
  const id = typeof args.image_id === 'string' ? args.image_id.trim() : ''
  if (!id) throw new Error('image_id is required.')
  const record = await getRecord({ image_id: id, workspaceCwd: args.workspaceCwd })
  if (!record) return null
  const root = resolveLibraryRoot(args)
  const path = root ? imageFileAbs(root, record.file_rel) : ''
  return { ok: true, record, path }
}

/** imageGenImageUpdate — tags/favorite/album via organizeRecords (the organize tool's store op). */
export async function imagegenImageUpdate(args: Record<string, unknown> & { image_id?: unknown; workspaceCwd?: string }): Promise<{
  ok: true
  record: ImageRecord | null
}> {
  const id = typeof args.image_id === 'string' ? args.image_id.trim() : ''
  if (!id) throw new Error('image_id is required.')
  const res = await organizeRecords({
    workspaceCwd: args.workspaceCwd,
    image_ids: [id],
    add_tags: Array.isArray(args.add_tags) ? args.add_tags.map((t) => String(t)) : undefined,
    remove_tags: Array.isArray(args.remove_tags) ? args.remove_tags.map((t) => String(t)) : undefined,
    favorite: typeof args.favorite === 'boolean' ? args.favorite : undefined,
  })
  if (res.deleted.length > 0) throw new Error('Record was deleted — refresh the library.')
  return { ok: true, record: res.updated[0] ?? null }
}

/** imageGenImageDelete — file + record via organizeRecords delete (identical write semantics, §3 note 3). */
export async function imagegenImageDelete(args: { image_id?: unknown; workspaceCwd?: string }): Promise<{
  ok: true
  deleted: string[]
}> {
  const id = typeof args.image_id === 'string' ? args.image_id.trim() : ''
  if (!id) throw new Error('image_id is required.')
  const res = await organizeRecords({ image_ids: [id], delete: true, workspaceCwd: args.workspaceCwd })
  return { ok: true, deleted: res.deleted }
}

/**
 * imageGenRevealFile — resolved via the record (never a raw caller path), so
 * the shell op can only ever open library files. main/index.ts performs the
 * actual showItemInFolder; this module only resolves/validates the path.
 */
export async function imagegenRevealFile(args: { image_id?: unknown; workspaceCwd?: string }): Promise<{
  ok: true
  path: string
}> {
  const id = typeof args.image_id === 'string' ? args.image_id.trim() : ''
  if (!id) throw new Error('image_id is required.')
  const record = await getRecord({ image_id: id, workspaceCwd: args.workspaceCwd })
  if (!record) throw new Error(`No library image with id "${id}".`)
  const root = resolveLibraryRoot(args)
  if (!root) throw new Error('No workspace resolved — cannot locate the image file.')
  return { ok: true, path: imageFileAbs(root, record.file_rel) }
}

// ── §5.5 status — Connect/health + model table from the SAME probes as doctor ─┐

export interface ImagegenStatusResult {
  ok: true
  config: ReturnType<typeof readImagegenConfig>
  workspace_root: string | null
  library_root: string | null
  library_stats: ImagegenLibraryStats | null
  health: BackendHealth
  /** comfyDoctorProbe result (detection + per-model node validation) when requested. */
  models?: ComfyDoctorProbe
  /** §2.2 catalog (static data — model dropdown ∩ detected, license badges). */
  catalog: typeof IMAGE_MODEL_CATALOG
}

/**
 * imageGenStatus — Settings Connect/health card + composer catalog data. Health
 * comes from `comfyHealth` (/system_stats + /queue — the doctor's exact probe,
 * §3.3 parity); the model table comes from `comfyDoctorProbe` (a single
 * /object_info pull) when the caller opts in (it is heavy on slow links).
 */
export async function imagegenStatus(args: { with_models?: unknown; workspaceCwd?: string; userDataPath: string }): Promise<ImagegenStatusResult> {
  const config = readImagegenConfig(args.userDataPath)
  const stats = libraryStatsFor(args)
  const health = await comfyHealth(config.comfyui_url)
  let models: ComfyDoctorProbe | undefined
  if (args.with_models === true && health.ok) {
    // Detection is best-effort: on error Settings shows the health error text.
    models = await comfyDoctorProbe(config.comfyui_url).catch(() => undefined)
  }
  const workspaceRoot =
    typeof args.workspaceCwd === 'string' && args.workspaceCwd.trim() ? args.workspaceCwd.trim() : null
  return {
    ok: true,
    config,
    workspace_root: workspaceRoot,
    library_root: stats?.root ?? null,
    library_stats: stats?.stats ?? null,
    health,
    catalog: IMAGE_MODEL_CATALOG,
    ...(models !== undefined ? { models } : {}),
  }
}