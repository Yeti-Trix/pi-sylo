/**
 * Per-workspace image library store (plan §4.2 — implemented at §8 step 3).
 * Layout: `<workspace>/.sylo/images/{library.json, files/<yyyy>/<mm>/<id>.png}`.
 * Files are truth for pixels; the index (library.json) is truth for metadata,
 * operator-readable JSON (sylo-tasks store parity).
 *
 * ── Atomicity ───────────────────────────────────────────────────────────────
 * Every index mutation is read-modify-write with the write done as temp file +
 * `renameSync` (tasks-store.ts save() pattern, lines 73-74): readers never see
 * a half-written index, and a crash between the PNG byte save and the index
 * write leaves only an orphan PNG — recoverable, never corruption.
 *
 * ── Concurrency ─────────────────────────────────────────────────────────────
 * Store entry points are async and every mutation runs inside a module-level
 * in-flight write queue (`enqueueWrite`): concurrent calls within one process
 * are fully serialized, each op re-reads the index fresh before modifying, and
 * all fs work inside an op is synchronous, so ops cannot interleave mid-flight
 * even if a future op gains an internal await (thumbnailing, mtime probes…).
 * Reads (getRecord/queryLibrary) are not queued — `renameSync` gives them a
 * consistent snapshot for free.
 *
 * ── Multi-writer eventual consistency (accepted risk, sylo-tasks stance) ────
 * Two processes can hold this store open at once: the broker extension child
 * (agent tool ops) and host main (sidebar route ops, §5.6). As in sylo-tasks,
 * each process serializes its own ops and writes via atomic rename; the worst
 * case across processes is a rare lost *update* (read-modify-write between
 * processes), never a corrupt or half-written index. Escalation path if ever
 * observed: route UI mutations via broker IPC (the sylo-tasks `apply-edit`
 * precedent) so a single writer owns the file. SQLite is explicitly out of
 * scope for v1 (§4.3).
 *
 * ── Malformed-index recovery ────────────────────────────────────────────────
 * A corrupt or shape-invalid `library.json` is renamed to
 * `library.json.corrupt-<timestamp>` (evidence kept, never deleted) and a new
 * index is rebuilt by scanning `files/**` — every `<id>.png` filename carries
 * at minimum the record id. Rebuilt records carry only on-disk truth: id,
 * file_rel, width/height (PNG IHDR), byte size, and created_at from file mtime.
 * Prompt/model/preset/params are unknowable from the filesystem — they are
 * written as documented placeholders and each rebuilt record is tagged
 * `recovered` (RECOVERY_TAG) so the loss is visible in-band. The ComfyUI
 * workflow embedded in the PNG's tEXt chunks is the future backfill path (v2
 * re-import, §4.1).
 *
 * ── Change fan-out ──────────────────────────────────────────────────────────
 * Successful mutations send `{ type: 'sylo-image-gen:changed', workspaceKey,
 * reason }` to host main via `process.send` (guarded no-op outside the broker,
 * tasks-store sendToHost pattern). Host fans it on to the route (§8 step 7 —
 * not wired in this section).
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { pngDimensions } from './comfyui/client.ts'
import { ASPECT_RATIOS } from './models.ts'
import type {
  AspectRatio,
  ImagePreset,
  ImageRecord,
  LibraryQuery,
  LibraryStore,
  OrganizeRequest,
} from './types.ts'

// ── Layout constants (§4.1) ────────────────────────────────────────────────

export const LIBRARY_INDEX_FILE = 'library.json'
export const LIBRARY_FILES_DIR = 'files'
export const IMAGE_FORMAT = 'png' as const

/** gitignore guidance surfaced by the skill/README (§4.1): binaries out, index in. */
export const LIBRARY_GITIGNORE_LINE = '.sylo/images/files/'

/** Tag applied to records rebuilt from disk after corrupt-index recovery — marks in-band that metadata was lost. */
export const RECOVERY_TAG = 'recovered'

// ── Path resolution (SYLO_PI_CWD mirror of tasks-store.ts:37-39, fail-fast) ─

/** Options accepted by every store entry point. `libraryRoot` (explicit,
 *  tests/host convenience) wins over `workspaceCwd`, which wins over
 *  `process.env.SYLO_PI_CWD` (broker supervisor injects it). */
export interface StoreOptions {
  workspaceCwd?: string
  libraryRoot?: string
}

/** Broker children get SYLO_PI_CWD injected (sylo-tasks parity); absent ⇒ no workspace store. */
export function resolveWorkspaceRoot(workspaceCwd?: string): string | undefined {
  const cwd = workspaceCwd?.trim() || process.env.SYLO_PI_CWD?.trim()
  return cwd || undefined
}

/** Stable workspace key for change-notification binding (tasks-store parity). */
export function resolveWorkspaceKey(workspaceCwd?: string): string | null {
  return resolveWorkspaceRoot(workspaceCwd) ?? null
}

/** Library root for a workspace root: `<workspace>/.sylo/images` (pure join). */
export function libraryRootForWorkspace(workspaceRoot: string): string {
  return join(workspaceRoot, '.sylo', 'images')
}

/** Resolve the per-workspace library index path from SYLO_PI_CWD. Returns
 *  null when not running inside a Sylo broker (no SYLO_PI_CWD) — mirror of
 *  tasks-store `resolveTasksPath` (tasks-store.ts:37-39). */
export function resolveLibraryPath(workspaceCwd?: string): string | null {
  const cwd = workspaceCwd?.trim() || process.env.SYLO_PI_CWD?.trim()
  if (!cwd) return null
  return join(libraryRootForWorkspace(cwd), LIBRARY_INDEX_FILE)
}

/** Library root for an options set; null when no explicit root and no workspace. */
export function resolveLibraryRoot(opts: StoreOptions = {}): string | null {
  const explicit = opts.libraryRoot?.trim()
  if (explicit) return resolve(explicit)
  const cwd = resolveWorkspaceRoot(opts.workspaceCwd)
  return cwd ? libraryRootForWorkspace(cwd) : null
}

/** Fail-fast variant for mutations (tasks-store save() parity): no workspace,
 *  no store. Callers (agent tools / route ops) catch and render text. */
export function requireLibraryRoot(opts: StoreOptions = {}): string {
  const root = resolveLibraryRoot(opts)
  if (!root)
    throw new Error(
      'SYLO_PI_CWD is not set and no workspace/libraryRoot was given — the image library needs a ' +
        'workspace. Run inside the Sylo broker with sylo-image-gen enabled, or pass libraryRoot/workspaceCwd.',
    )
  return root
}

export function resolveLibraryIndexPath(libraryRoot: string): string {
  return join(libraryRoot, LIBRARY_INDEX_FILE)
}

/** `files/<yyyy>/<mm>/<id>.png` — relative to the library root, forward slashes. */
export function fileRelForRecord(imageId: string, createdAtIso: string): string {
  const d = new Date(createdAtIso)
  const yyyy = Number.isNaN(d.getTime()) ? '1970' : String(d.getFullYear())
  const mm = Number.isNaN(d.getTime()) ? '01' : String(d.getMonth() + 1).padStart(2, '0')
  return join(LIBRARY_FILES_DIR, yyyy, mm, `${imageId}.${IMAGE_FORMAT}`).replace(/\\/g, '/')
}

/** Absolute path of a record's PNG inside the library root; rejects rel paths
 *  that escape the root (defense against a tampered index / bad caller input). */
export function imageFileAbs(libraryRoot: string, fileRel: string): string {
  const abs = resolve(libraryRoot, fileRel.trim().replace(/\\/g, '/'))
  const check = relative(resolve(libraryRoot), abs)
  if (!check || check.startsWith('..') || isAbsolute(check))
    throw new Error(`file_rel escapes the image library root: "${fileRel}".`)
  return abs
}

// ── In-flight write queue (single-process serialization) ───────────────────

let writeChain: Promise<unknown> = Promise.resolve()

/** Serialize work through the module-level write queue. Mutations wrap their
 *  whole read-modify-write here; async callers that batch multi-step sequences
 *  (e.g. §8 step 4: several createRecord calls) can also route through this
 *  primitive directly. Errors propagate to the awaiting caller without
 *  breaking the chain. */
export function enqueueWrite<T>(op: () => T): Promise<T> {
  const run = writeChain.then(op, op)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run as Promise<T>
}

/** Test-only: drain in-flight queued writes and reset the chain
 *  (repo pattern: client.ts `__setPollIntervalForTests`). */
export async function __resetLibraryStoreForTests(): Promise<void> {
  await writeChain.catch(() => {})
  writeChain = Promise.resolve()
}

// ── Change fan-out to host main (tasks-store sendToHost pattern) ───────────

/** Send a message to the host main process. No-op when not running under the
 *  broker (`process.send` undefined — unit tests, vanilla Pi). */
function sendToHost(msg: unknown): void {
  const snd = process.send?.bind(process) as ((m: unknown) => boolean) | undefined
  if (!snd) return
  snd(msg)
}

export type LibraryChangeReason = 'create' | 'organize' | 'delete'

/** Broker → main: the image library changed for this workspace. Host looks up
 *  the bound workspaceKey and fans `imagegen:library-changed` to the route
 *  (§8 step 7 — this section only emits the broker-side message). */
function notifyLibraryChanged(workspaceCwd: string | undefined, reason: LibraryChangeReason): void {
  const workspaceKey = resolveWorkspaceKey(workspaceCwd)
  if (!workspaceKey) return
  sendToHost({ type: 'sylo-image-gen:changed', workspaceKey, reason })
}

// ── Index: load / validate-coerce / atomic save / corrupt recovery ─────────

function emptyStore(): LibraryStore {
  return { version: 1, images: [] }
}

function isImagePreset(v: unknown): v is ImagePreset {
  return v === 'draft' || v === 'final'
}

/** load-validate-coerce like tasks-store: keep only well-formed records, drop
 *  junk entries instead of throwing (a single bad line must not brick the
 *  library). Normalizes to the ImageRecord shape; unknown extras are dropped. */
function coerceRecord(raw: unknown): ImageRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  const fileRel = typeof r.file_rel === 'string' ? r.file_rel.trim() : ''
  if (!id || !fileRel) return null
  if (fileRel.split('\\').join('/').split('/').includes('..') || isAbsolute(fileRel)) return null

  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const createdAt = str(r.created_at)
  if (!createdAt) return null // records without created_at are dropped (it is the sort key)

  const paramsRaw = r.params && typeof r.params === 'object' ? (r.params as Record<string, unknown>) : {}
  const tags = Array.isArray(r.tags)
    ? ((): string[] => {
        const out: string[] = []
        const seen = new Set<string>()
        for (const t of r.tags) {
          if (typeof t !== 'string') continue
          const trimmed = t.trim()
          const key = trimmed.toLowerCase()
          if (!trimmed || seen.has(key)) continue
          seen.add(key)
          out.push(trimmed)
        }
        return out
      })()
    : []

  const record: ImageRecord = {
    id,
    created_at: createdAt,
    file_rel: fileRel,
    width: num(r.width),
    height: num(r.height),
    bytes: num(r.bytes),
    model: str(r.model) ?? 'unknown',
    backend: str(r.backend) ?? 'comfyui',
    preset: isImagePreset(r.preset) ? r.preset : 'final',
    prompt: typeof r.prompt === 'string' ? r.prompt : '',
    params: {
      steps: num(paramsRaw.steps),
      guidance: num(paramsRaw.guidance),
      seed: num(paramsRaw.seed),
    },
    gen_ms: num(r.gen_ms),
    origin: r.origin === 'route' ? 'route' : 'agent',
    tags,
    favorite: r.favorite === true,
  }
  const negative = str(r.negative_prompt)
  if (negative !== undefined) record.negative_prompt = negative
  const sampler = str(paramsRaw.sampler)
  if (sampler !== undefined) record.params.sampler = sampler
  const aspect = str(paramsRaw.aspect)
  if (aspect !== undefined && (ASPECT_RATIOS as readonly string[]).includes(aspect))
    record.params.aspect = aspect as AspectRatio
  const parentId = str(r.parent_id)
  if (parentId !== undefined) record.parent_id = parentId
  const album = str(r.album)
  if (album !== undefined) record.album = album
  const caption = str(r.caption)
  if (caption !== undefined) record.caption = caption
  const comfyPromptId = str(r.comfy_prompt_id)
  if (comfyPromptId !== undefined) record.comfy_prompt_id = comfyPromptId
  return record
}

/** Raw index read (validate-coerce, corrupt-recovery on demand). Graceful when
 *  missing → fresh. Exposed for §3.3 doctor library stats + tests; the higher-
 *  level entry points (getRecord/queryLibrary) wrap it. */
export function loadLibrary(libraryRoot: string): LibraryStore {
  const fp = resolveLibraryIndexPath(libraryRoot)
  if (!existsSync(fp)) return emptyStore()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(fp, 'utf8'))
  } catch {
    return recoverFromCorruptIndex(libraryRoot, fp)
  }
  const images =
    raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as LibraryStore).images)
      ? ((raw as LibraryStore).images as unknown[])
      : null
  if (!images) return recoverFromCorruptIndex(libraryRoot, fp)
  return { version: 1, images: images.map(coerceRecord).filter((im): im is ImageRecord => im !== null) }
}

/** Atomic index write: temp file + renameSync (tasks-store.ts:73-74 pattern). */
function saveLibrary(store: LibraryStore, libraryRoot: string): void {
  const fp = resolveLibraryIndexPath(libraryRoot)
  mkdirSync(dirname(fp), { recursive: true })
  const tmp = `${fp}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  renameSync(tmp, fp)
}

/** Corrupt/invalid index → keep the evidence under `library.json.corrupt-<ts>`
 *  and rebuild a fresh index from the files/ tree. Every rebuilt record is
 *  tagged RECOVERY_TAG: filename carries only the id, so prompt/model/preset/
 *  params are documented placeholders (see module doc). */
function recoverFromCorruptIndex(libraryRoot: string, indexPath: string): LibraryStore {
  try {
    renameSync(indexPath, `${indexPath}.corrupt-${Date.now()}`)
  } catch {
    // Rename is best-effort evidence keeping (e.g. Windows AV lock); recovery proceeds.
  }
  const rebuilt = rebuildIndexFromFiles(libraryRoot)
  saveLibrary(rebuilt, libraryRoot)
  return rebuilt
}

function listImageFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) listImageFiles(abs, out)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(`.${IMAGE_FORMAT}`)) out.push(abs)
  }
  return out.sort()
}

/** Only the PNG header matters (IHDR carries w/h, first 24 bytes) — never
 *  re-reads whole images just to rebuild the index. */
function pngHeaderDims(abs: string): { width: number; height: number } {
  const fd = openSync(abs, 'r')
  try {
    const header = Buffer.alloc(24)
    readSync(fd, header, 0, 24, 0)
    return pngDimensions(new Uint8Array(header.buffer, 0, header.byteLength)) ?? { width: 0, height: 0 }
  } finally {
    closeSync(fd)
  }
}

function rebuildIndexFromFiles(libraryRoot: string): LibraryStore {
  const images: ImageRecord[] = []
  for (const abs of listImageFiles(join(libraryRoot, LIBRARY_FILES_DIR))) {
    const name = basename(abs)
    const id = name.slice(0, name.length - IMAGE_FORMAT.length - 1)
    if (!id) continue
    const fileRel = relative(resolve(libraryRoot), abs).split(/\\|\//).join('/')
    let bytes = 0
    let created_at = ''
    let width = 0
    let height = 0
    try {
      const fd = openSync(abs, 'r')
      try {
        const st = fstatSync(fd)
        bytes = st.size
        created_at = new Date(st.mtimeMs).toISOString()
      } finally {
        closeSync(fd)
      }
      const dims = pngHeaderDims(abs)
      width = dims.width
      height = dims.height
    } catch {
      // Unreadable file: still index it (id/path survive), dims/bytes unknown.
    }
    const rec = coerceRecord({
      id,
      file_rel: fileRel,
      created_at: created_at || new Date(0).toISOString(),
        bytes,
        width,
        height,
        // Unknowable from disk — documented placeholders, loss marked via RECOVERY_TAG:
        model: 'unknown',
        backend: 'comfyui',
        preset: 'final',
        prompt: '',
        params: { steps: 0, guidance: 0, seed: 0 },
        gen_ms: 0,
        origin: 'agent',
        tags: [RECOVERY_TAG],
        favorite: false,
      })
    if (rec) images.push(rec)
  }
  return { version: 1, images }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Input for createRecord: everything §3 generation knows about an output.
 *  id/created_at/file_rel/bytes are derived (overrides exist for tests/imports). */
export interface CreateRecordInput extends StoreOptions {
  prompt: string
  negative_prompt?: string
  model: string
  preset: 'draft' | 'final'
  width: number
  height: number
  /** PNG bytes — saved first ("after byte save"), then index append via atomic write. */
  data: Uint8Array
  aspect?: string
  steps?: number
  guidance?: number
  seed?: number
  sampler?: string
  gen_ms?: number
  tags?: string[]
  favorite?: boolean
  album?: string
  parent_id?: string
  origin?: 'agent' | 'route'
  caption?: string
  comfy_prompt_id?: string
  /** All-local v1: always 'comfyui' (§2.6); the field exists for a second local backend later. */
  backend?: string
  /** ISO created_at (tests/import); default now. */
  created_at?: string
  /** Pinned id (tests/import); default randomUUID. */
  id?: string
  /** file_rel override (tests/import); default fileRelForRecord(id, created_at). */
  file_rel?: string
}

export interface CreateRecordResult {
  record: ImageRecord
  /** Absolute path of the written PNG — tools use it for `_localPath` (§3.1). */
  file_abs: string
  library_root: string
  index_path: string
}

/**
 * Byte save → index append (atomic rename) → change notify, fully serialized
 * through the write queue. The index is read (and, when corrupt, recovered)
 * BEFORE the byte save so a recovery rebuild never sees this mutation's own
 * new file; replace-by-id on append makes a re-created id idempotent (e.g. an
 * orphan-recovered copy of the same PNG). Throws (fail-fast) when no workspace
 * is resolvable.
 */
export async function createRecord(input: CreateRecordInput): Promise<CreateRecordResult> {
  const libraryRoot = requireLibraryRoot(input)
  const workspaceCwd = input.workspaceCwd?.trim() ? input.workspaceCwd : undefined
  return enqueueWrite(() => {
    if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0)
      throw new Error('createRecord requires non-empty image bytes (PNG).')
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (!prompt) throw new Error('createRecord requires a non-empty prompt.')
    const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : 'unknown'
    if (!isImagePreset(input.preset))
      throw new Error(`preset must be 'draft' or 'final' — got "${String(input.preset)}".`)
    const width = Number(input.width)
    const height = Number(input.height)
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)
      throw new Error(`createRecord requires positive width/height (got ${input.width}×${input.height}).`)
    const aspect = input.aspect?.trim()
    if (aspect !== undefined && aspect !== '' && !(ASPECT_RATIOS as readonly string[]).includes(aspect))
      throw new Error(
        `aspect must be one of ${ASPECT_RATIOS.join(' | ')} — got "${aspect}". (Omit for unknown aspects.)`,
      )

    const id = input.id?.trim() || randomUUID()
    const created_at = input.created_at?.trim() || new Date().toISOString()
    const fileRel = input.file_rel?.trim() || fileRelForRecord(id, created_at)
    const fileAbs = imageFileAbs(libraryRoot, fileRel)

    // 1) Index load first (corrupt recovery scans only pre-existing files),
    //    then byte save — a crash here leaves a recoverable orphan PNG, no index entry.
    const store = loadLibrary(libraryRoot)
    mkdirSync(dirname(fileAbs), { recursive: true })
    writeFileSync(fileAbs, input.data)
    // 2) Coerce → replace-by-id append → atomic index write (full re-read per
    //    mutation is the multi-writer stance; the queue serializes within this process).
    const record = coerceRecord({
      id,
      file_rel: fileRel,
      created_at,
      bytes: input.data.byteLength,
      width,
      height,
      model,
      backend: input.backend?.trim() || 'comfyui',
      preset: input.preset,
      prompt,
      negative_prompt: input.negative_prompt?.trim() || undefined,
      params: {
        steps: Number.isFinite(Number(input.steps)) ? Math.max(0, Number(input.steps)) : 0,
        guidance: Number.isFinite(Number(input.guidance)) ? Number(input.guidance) : 0,
        seed: Number.isFinite(Number(input.seed)) ? Number(input.seed) : 0,
        sampler: input.sampler?.trim() || undefined,
        aspect: aspect || undefined,
      },
      gen_ms: Number.isFinite(Number(input.gen_ms)) ? Math.max(0, Number(input.gen_ms)) : 0,
      parent_id: input.parent_id?.trim() || undefined,
      origin: input.origin === 'route' ? 'route' : 'agent',
      tags: input.tags,
      favorite: input.favorite === true,
      album: input.album?.trim() || undefined,
      caption: input.caption?.trim() || undefined,
      comfy_prompt_id: input.comfy_prompt_id?.trim() || undefined,
    })
    if (!record) throw new Error('createRecord produced an invalid record (internal error).')
    // Replace-by-id: if an earlier attempt left an orphan-recovered copy of this
    // same image (same id), the metadata-complete record wins.
    store.images = store.images.filter((im) => im.id !== record.id)
    store.images.push(record)
    saveLibrary(store, libraryRoot)
    notifyLibraryChanged(workspaceCwd, 'create')
    return {
      record,
      file_abs: fileAbs,
      library_root: libraryRoot,
      index_path: resolveLibraryIndexPath(libraryRoot),
    } satisfies CreateRecordResult
  })
}

/** Full record by id (§3.2 `sylo_image_gen_get`), including params + lineage.
 *  Reads are not queued; graceful null on missing id. */
export async function getRecord(args: { image_id: string } & StoreOptions): Promise<ImageRecord | null> {
  const libraryRoot = resolveLibraryRoot(args)
  if (!libraryRoot) return null
  const id = args.image_id?.trim()
  if (!id) return null
  return loadLibrary(libraryRoot).images.find((im) => im.id === id) ?? null
}

export interface LibraryListItem {
  /** §3.2 compact list contract fields. */
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

export interface LibraryQueryResult {
  items: LibraryListItem[]
  /** Full match count before offset/limit — pagination totals for the route UI. */
  total: number
}

const DEFAULT_QUERY_LIMIT = 20
const MAX_QUERY_LIMIT = 100
/** §3.2 list contract: prompt truncated to ≤120 chars. */
const PROMPT_CUTOFF = 120

/**
 * `sylo_image_gen_list` query (§3.2): substring case-insensitive over
 * prompt/tags/caption + all-match tags + favorite + model (case-insensitive
 * exact) + since (ISO; records with created_at ≥ since) + limit (default 20,
 * max 100) + offset. Sorted newest-first. `total` counts the full match set.
 */
export async function queryLibrary(args: LibraryQuery & StoreOptions): Promise<LibraryQueryResult> {
  const libraryRoot = resolveLibraryRoot(args)
  if (!libraryRoot) return { items: [], total: 0 }

  const needle = (args.query ?? '').trim().toLowerCase()
  const wantTags = (args.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
  const wantFavorite = typeof args.favorite === 'boolean' ? (args.favorite as boolean) : undefined
  const wantModel = args.model?.trim().toLowerCase() || undefined
  const sinceMs = args.since ? Date.parse(args.since) : NaN

  const matches = loadLibrary(libraryRoot)
    .images.filter((im) => {
      if (wantFavorite !== undefined && im.favorite !== wantFavorite) return false
      if (wantModel && im.model.toLowerCase() !== wantModel) return false
      if (!Number.isNaN(sinceMs)) {
        const t = Date.parse(im.created_at)
        if (Number.isNaN(t) || t < sinceMs) return false
      }
      if (wantTags.length) {
        const have = im.tags.map((t) => t.toLowerCase())
        if (!wantTags.every((wt) => have.includes(wt))) return false
      }
      if (needle) {
        const inPrompt = im.prompt.toLowerCase().includes(needle)
        const inTags = im.tags.some((t) => t.toLowerCase().includes(needle))
        const inCaption = im.caption !== undefined && im.caption.toLowerCase().includes(needle)
        if (!inPrompt && !inTags && !inCaption) return false
      }
      return true
    })
    .sort((a, b) => {
      const ta = Date.parse(a.created_at)
      const tb = Date.parse(b.created_at)
      if (ta !== tb) return tb - ta // newest first
      return a.id < b.id ? 1 : -1 // stable tie-break
    })

  const rawLimit = args.limit
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.min(MAX_QUERY_LIMIT, Math.max(0, Math.floor(rawLimit)))
      : DEFAULT_QUERY_LIMIT
  const offset =
    typeof args.offset === 'number' && Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : 0

  const items = matches.slice(offset, offset + limit).map((im) => ({
    id: im.id,
    path: imageFileAbs(libraryRoot, im.file_rel),
    prompt: im.prompt.length > PROMPT_CUTOFF ? `${im.prompt.slice(0, PROMPT_CUTOFF - 1)}…` : im.prompt,
    model: im.model,
    preset: im.preset,
    tags: im.tags,
    favorite: im.favorite,
    created_at: im.created_at,
    width: im.width,
    height: im.height,
    gen_ms: im.gen_ms,
  }))
  return { items, total: matches.length }
}

export interface OrganizeOptions extends Omit<OrganizeRequest, 'image_ids'>, StoreOptions {
  image_ids?: string[]
}

export interface OrganizeResult {
  /** Post-update full records for ids that existed (§3.2 "updated records"). */
  updated: ImageRecord[]
  /** Ids actually deleted (file + record). */
  deleted: string[]
}

/**
 * `sylo_image_gen_organize` (§3.2): add/remove tags (case-insensitive identity,
 * add after remove), favorite (applied only when a boolean is passed), album
 * set/clear (string sets; null or '' clears; undefined = no change), or
 * `delete: true` — which takes precedence over the tag/favorite/album ops and
 * unlinks the PNG file, drops the record, and rewrites the index. The skill
 * warns the agent to confirm with the operator before delete (§3.2).
 */
export async function organizeRecords(args: OrganizeOptions): Promise<OrganizeResult> {
  const libraryRoot = requireLibraryRoot(args)
  const workspaceCwd = args.workspaceCwd?.trim() ? args.workspaceCwd : undefined
  return enqueueWrite(() => {
    const store = loadLibrary(libraryRoot)
    const ids = new Set((args.image_ids ?? []).map((id) => String(id).trim()).filter(Boolean))

    if (args.delete === true) {
      const deleted: string[] = []
      const survivors: ImageRecord[] = []
      for (const rec of store.images) {
        if (!ids.has(rec.id)) {
          survivors.push(rec)
          continue
        }
        // File unlink + record drop go together; a missing file never blocks the record drop.
        try {
          unlinkSync(imageFileAbs(libraryRoot, rec.file_rel))
        } catch {
          /* file already gone — record removal still proceeds (index is metadata truth) */
        }
        deleted.push(rec.id)
      }
      if (deleted.length) {
        store.images = survivors
        saveLibrary(store, libraryRoot)
        notifyLibraryChanged(workspaceCwd, 'delete')
      }
      return { updated: [], deleted }
    }

    const removeKeys = new Set(
      (args.remove_tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
    )
    const addTags = (args.add_tags ?? []).map((t) => String(t).trim()).filter(Boolean)
    const updated: ImageRecord[] = []
    for (const rec of store.images) {
      if (!ids.has(rec.id)) continue
      if (removeKeys.size) rec.tags = rec.tags.filter((t) => !removeKeys.has(t.toLowerCase()))
      if (addTags.length) {
        const seen = new Set(rec.tags.map((t) => t.toLowerCase()))
        for (const tag of addTags) {
          const key = tag.toLowerCase()
          if (!seen.has(key)) {
            seen.add(key)
            rec.tags.push(tag)
          }
        }
      }
      if (typeof args.favorite === 'boolean') rec.favorite = args.favorite
      if (args.album !== undefined) {
        const album = typeof args.album === 'string' ? args.album.trim() : ''
        if (album) rec.album = album
        else rec.album = undefined
      }
      updated.push(rec)
    }
    if (updated.length) {
      saveLibrary(store, libraryRoot)
      notifyLibraryChanged(workspaceCwd, 'organize')
    }
    return { updated, deleted: [] }
  })
}