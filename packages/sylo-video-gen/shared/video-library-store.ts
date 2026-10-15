/**
 * Per-workspace video library store (plan §4.1/§4.2/§4.4/§4.5 — §8 step 5).
 * The sylo-image-gen `library-store.ts` twin (packages/sylo-image-gen/shared) with
 * video semantics. Layout: `<workspace>/.sylo/videos/{library.json, files/<yyyy>/<mm>/<id>.<ext>
 * + <id>.poster.png}`. Files are truth for bytes; the index (library.json) is truth for
 * metadata, operator-readable JSON (sylo-tasks store parity). Videos are big (5 s 720p ≈
 * 5–20 MB — a working day is easily hundreds of MB), so library.json stays tiny (metadata
 * only); the files tree is never read into the index beyond header probes. The durable
 * `jobs.json` render ledger (§4.3) is the deliberately-diverging half of this step and
 * lands with its consumers (host job ops §5.2 / §8.7) — this module is the library half.
 *
 * ── Atomicity (§4.2, verbatim image-gen stance) ─────────────────────────────
 * Every index mutation is read-modify-write with the write done as temp file +
 * `renameSync` (tasks-store.ts save() pattern): readers never see a half-written
 * index, and a crash between the clip byte save and the index write leaves only an
 * orphan clip — recoverable, never corruption.
 *
 * ── Concurrency ─────────────────────────────────────────────────────────────
 * Store entry points are async and every mutation runs inside a module-level
 * in-flight write queue (`enqueueWrite`): concurrent calls within one process are
 * fully serialized, each op re-reads the index fresh before modifying, and all fs
 * work inside an op is synchronous, so ops cannot interleave mid-flight. Reads
 * (getRecord/queryLibrary) are not queued — `renameSync` gives them a consistent
 * snapshot for free.
 *
 * ── Multi-writer eventual consistency (accepted risk, sylo-tasks stance) ────
 * Two processes can hold this store open at once: the broker extension child (agent
 * tool ops) and host main (sidebar route ops). Each process serializes its own ops
 * and writes via atomic rename; the worst case across processes is a rare lost
 * *update*, never a corrupt or half-written index. Escalation path if ever observed:
 * route UI mutations via broker IPC (sylo-tasks `apply-edit` precedent). SQLite is
 * explicitly out of scope (plan §1 non-goal).
 *
 * ── Malformed-index recovery (§4.4, image-store twin) ───────────────────────
 * A corrupt or shape-invalid `library.json` is renamed to
 * `library.json.corrupt-<timestamp>` (evidence kept, never deleted) and a new index
 * is rebuilt by scanning `files/**` — every `<id>.<ext>` filename carries at minimum
 * the record id; `<id>.poster.png` siblings carry the display poster. Rebuilt records
 * carry only on-disk truth: id, file_rel, poster_rel (when present), width/height
 * (from the poster PNG's IHDR), byte size, video_format from the file extension, and
 * created_at from file mtime. Prompt/model/preset/framing are unknowable from the
 * filesystem — they are written as documented placeholders and each rebuilt record
 * is tagged `recovered` (RECOVERY_TAG) so the loss is visible in-band (§8.9 QA/§3.3
 * doctor surfaces it too).
 *
 * ── Cross-package lineage (§3.5) — one-way, no back-writes ──────────────────
 * A clip record may carry `lineage.source_image_id` (an image-gen library still) —
 * this store persists the lineage exactly as the record carries it, and NEVER touches
 * the image-gen library (no import of it, no writes into `<workspace>/.sylo/images/`).
 * The read of the image record is the §3.5 tool-level guarded dynamic `import()`
 * (read-only, soft-fail); at store level lineage is plain data.
 *
 * ── Change fan-out (§4.5; consumer twin at §5.5) ────────────────────────────
 * Successful mutations send `{ type: 'sylo-video-gen:changed', workspaceKey, reason }`
 * to host main via `process.send` (guarded no-op outside the broker, tasks-store
 * sendToHost pattern) — byte-identical mechanism to image-gen's fan. Host main fans
 * it on to the Videos route as `videogen:library-changed` (wired at §8.7 — NOT in
 * this step; main/index.ts is deliberately untouched here).
 *
 * Record shape: the §8.2 `VideoRecord` contract verbatim (shared/types.ts) — this
 * module adds nothing to the record shape; read-back coercion reuses
 * types.ts `coerceVideoRecord` (single source of truth). Storage helpers only.
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

import { VIDEO_MODES } from './catalog.ts'
import { coerceVideoRecord, type VideoFormat, type VideoLineage, type VideoMode, type VideoRecord } from './types.ts'

// ── Layout constants (§4.1) ────────────────────────────────────────────────

export const LIBRARY_INDEX_FILE = 'library.json'
export const LIBRARY_FILES_DIR = 'files'
/** In-graph first-frame poster (§2.4): `<id>.poster.png` beside the clip in the same dated dir. */
export const POSTER_SUFFIX = '.poster.png'
/** Containers the record contract carries (§8.2 VideoFormat; SaveVideo mp4+h264 is the locked v1 value). */
export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv', 'mov'] as const
/** gitignore guidance surfaced by the README (§4.1): binaries out, index in. */
export const LIBRARY_GITIGNORE_LINE = '.sylo/videos/files/'

/** Tag applied to records rebuilt from disk after corrupt-index recovery — marks in-band that metadata was lost. */
export const RECOVERY_TAG = 'recovered'

/** §4.1 index shape (operator-readable; mirrors image-gen's LibraryStore). */
export interface VideoLibraryStore {
  version: 1
  videos: VideoRecord[]
}

// ── Path resolution (SYLO_PI_CWD mirror of tasks-store.ts:37-39, fail-fast) ─

/** Options accepted by every store entry point. `libraryRoot` (explicit, tests/host
 *  convenience) wins over `workspaceCwd`, which wins over `process.env.SYLO_PI_CWD`
 *  (broker supervisor injects it). */
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

/** Library root for a workspace root: `<workspace>/.sylo/videos` (pure join). */
export function libraryRootForWorkspace(workspaceRoot: string): string {
  return join(workspaceRoot, '.sylo', 'videos')
}

/** Resolve the per-workspace library index path from SYLO_PI_CWD. Returns null when
 *  not running inside a Sylo broker (no SYLO_PI_CWD) — mirror of tasks-store
 *  `resolveTasksPath` (tasks-store.ts:37-39). */
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

/** Fail-fast variant for mutations (tasks-store save() parity): no workspace, no store.
 *  Callers (agent tools / route ops) catch and render text. */
export function requireLibraryRoot(opts: StoreOptions = {}): string {
  const root = resolveLibraryRoot(opts)
  if (!root)
    throw new Error(
      'SYLO_PI_CWD is not set and no workspace/libraryRoot was given — the video library needs a ' +
        'workspace. Run inside the Sylo broker with sylo-video-gen enabled, or pass libraryRoot/workspaceCwd.',
    )
  return root
}

export function resolveLibraryIndexPath(libraryRoot: string): string {
  return join(libraryRoot, LIBRARY_INDEX_FILE)
}

/** `files/<yyyy>/<mm>/<id>.<ext>` — relative to the library root, forward slashes. */
export function fileRelForRecord(videoId: string, createdAtIso: string, ext: string = 'mp4'): string {
  const d = new Date(createdAtIso)
  const yyyy = Number.isNaN(d.getTime()) ? '1970' : String(d.getFullYear())
  const mm = Number.isNaN(d.getTime()) ? '01' : String(d.getMonth() + 1).padStart(2, '0')
  return join(LIBRARY_FILES_DIR, yyyy, mm, `${videoId}.${ext.replace(/^\./, '')}`).replace(/\\/g, '/')
}

/** `files/<yyyy>/<mm>/<id>.poster.png` — same dated dir as the clip (§2.1/§4.1). */
export function posterRelForRecord(videoId: string, createdAtIso: string): string {
  const fileRel = fileRelForRecord(videoId, createdAtIso, 'png')
  return fileRel.replace(/\.png$/, POSTER_SUFFIX)
}

/** Absolute path of a record's clip (or poster) inside the library root; rejects rel
 *  paths that escape the root (defense against a tampered index / bad caller input). */
export function videoFileAbs(libraryRoot: string, fileRel: string): string {
  const abs = resolve(libraryRoot, fileRel.trim().replace(/\\/g, '/'))
  const check = relative(resolve(libraryRoot), abs)
  if (!check || check.startsWith('..') || isAbsolute(check))
    throw new Error(`file_rel escapes the video library root: "${fileRel}".`)
  return abs
}

// ── In-flight write queue (single-process serialization) ───────────────────

let writeChain: Promise<unknown> = Promise.resolve()

/** Serialize work through the module-level write queue. Mutations wrap their whole
 *  read-modify-write here; async callers that batch multi-step sequences (§8 step 6:
 *  count-2 createRecord pairs) can also route through this primitive directly.
 *  Errors propagate to the awaiting caller without breaking the chain. */
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

/** Send a message to the host main process. No-op when not running under the broker
 *  (`process.send` undefined — unit tests, vanilla Pi). */
function sendToHost(msg: unknown): void {
  const snd = process.send?.bind(process) as ((m: unknown) => boolean) | undefined
  if (!snd) return
  snd(msg)
}

export type LibraryChangeReason = 'create' | 'organize' | 'delete'

/** Broker → main: the video library changed for this workspace. Host looks up the
 *  bound workspace key and fans `videogen:library-changed` to the route (§8.7 — this
 *  step only emits the broker-side message; IDENTICAL to image-gen's fan, §4.5). */
function notifyLibraryChanged(workspaceCwd: string | undefined, reason: LibraryChangeReason): void {
  const workspaceKey = resolveWorkspaceKey(workspaceCwd)
  if (!workspaceKey) return
  sendToHost({ type: 'sylo-video-gen:changed', workspaceKey, reason })
}

// ── Index: load / validate-coerce / atomic save / corrupt recovery ─────────

function emptyStore(): VideoLibraryStore {
  return { version: 1, videos: [] }
}

function isVideoMode(v: unknown): v is VideoMode {
  return (VIDEO_MODES as readonly string[]).includes(v as string)
}

/**
 * Index-row validate-coerce (§4.2): unknown JSON → VideoRecord or null. Reuses
 * types.ts `coerceVideoRecord` (the §8.2 contract coercer — placeholders + notes,
 * never throws) and adds the store-level hard drops: rows without id/created_at/
 * file_rel, or whose file_rel escapes the library root, are dropped instead of
 * brick-loading the library (a single bad row must not take the whole index down).
 * The coerce's plain-language notes are honest placeholders — dropped here: the
 * recovery path re-tags with RECOVERY_TAG, which is the visible loss marker.
 */
function coerceRecordRow(raw: unknown): VideoRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const { record } = coerceVideoRecord(raw as Record<string, unknown>)
  if (!record.id || record.id === '' || record.id === 'unknown') return null
  if (!record.created_at) return null // created_at is the sort key
  const fileRel = record.file_rel.replace(/\\/g, '/')
  if (!fileRel || isAbsolute(fileRel) || fileRel.split('/').includes('..')) return null
  // Normalize: drop undefined-valued optional keys (top level + lineage) so in-memory
  // records deepStrictEqual their JSON round-trips through the index (coerceVideoRecord
  // assigns optional contract fields as explicit undefined keys).
  const out: VideoRecord & Record<string, unknown> = {
    ...record,
    file_rel: fileRel,
    poster_rel: record.poster_rel?.replace(/\\/g, '/'),
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  const lineage = out.lineage as VideoLineage & Record<string, unknown>
  for (const k of Object.keys(lineage)) if (lineage[k] === undefined) delete lineage[k]
  return out
}

/** Raw index read (validate-coerce, corrupt-recovery on demand). Graceful when
 *  missing → fresh. Exported for §3.3 doctor library stats + tests; the higher-level
 *  entry points (getRecord/queryLibrary) wrap it. */
export function loadLibrary(libraryRoot: string): VideoLibraryStore {
  const fp = resolveLibraryIndexPath(libraryRoot)
  if (!existsSync(fp)) return emptyStore()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(fp, 'utf8'))
  } catch {
    return recoverFromCorruptIndex(libraryRoot, fp)
  }
  const videos =
    raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as VideoLibraryStore).videos)
      ? ((raw as VideoLibraryStore).videos as unknown[])
      : null
  if (!videos) return recoverFromCorruptIndex(libraryRoot, fp)
  return { version: 1, videos: videos.map(coerceRecordRow).filter((v): v is VideoRecord => v !== null) }
}

/** Atomic index write: temp file + renameSync (tasks-store.ts:73-74 pattern). */
function saveLibrary(store: VideoLibraryStore, libraryRoot: string): void {
  const fp = resolveLibraryIndexPath(libraryRoot)
  mkdirSync(dirname(fp), { recursive: true })
  const tmp = `${fp}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  renameSync(tmp, fp)
}

/** Corrupt/invalid index → keep the evidence under `library.json.corrupt-<ts>` and
 *  rebuild a fresh index from the files/ tree (§4.4). Every rebuilt record is tagged
 *  RECOVERY_TAG: the filename carries only the id, so prompt/model/preset/framing are
 *  documented placeholders (see module doc). Exported: §3.3 doctor + tests. */
export function recoverFromCorruptIndex(libraryRoot: string, indexPath: string): VideoLibraryStore {
  try {
    renameSync(indexPath, `${indexPath}.corrupt-${Date.now()}`)
  } catch {
    // Rename is best-effort evidence keeping (e.g. Windows AV lock); recovery proceeds.
  }
  const rebuilt = rebuildIndexFromFiles(libraryRoot)
  saveLibrary(rebuilt, libraryRoot)
  return rebuilt
}

function listMediaFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) listMediaFiles(abs, out)
    else if (entry.isFile()) out.push(abs)
  }
  return out.sort()
}

/** Only the PNG header matters (IHDR carries w/h, first 24 bytes) — never re-reads
 *  whole posters just to rebuild the index. Local port of image-gen's
 *  `pngDimensions` (comfyui/client.ts:453): the MECHANISM is reused; a runtime
 *  import across the two optional packages is deliberately not taken (the Images
 *  package may be uninstalled — §3.5 one-way discipline applies to store code too). */
function posterPngDimensions(buffer: Uint8Array): { width: number; height: number } | undefined {
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

function rebuildIndexFromFiles(libraryRoot: string): VideoLibraryStore {
  const posters = new Map<string, { rel: string; abs: string }>()
  const clips: string[] = []
  for (const abs of listMediaFiles(join(libraryRoot, LIBRARY_FILES_DIR))) {
    const name = basename(abs).toLowerCase()
    if (name.endsWith(POSTER_SUFFIX)) {
      const id = name.slice(0, name.length - POSTER_SUFFIX.length)
      if (id) posters.set(id, { rel: relative(resolve(libraryRoot), abs).split(/\\|\//).join('/'), abs })
    } else {
      const ext = name.slice(name.lastIndexOf('.') + 1)
      // Only record-format containers are indexed (image-gen's store indexes only .png —
      // same discipline): a stray junk file must not become a placeholder video record.
      if ((VIDEO_FORMATS as readonly string[]).includes(ext)) clips.push(abs)
    }
  }
  const videos: VideoRecord[] = []
  for (const abs of clips) {
    const name = basename(abs)
    const dot = name.lastIndexOf('.')
    const id = dot > 0 ? name.slice(0, dot) : name.replace(/\./g, '')
    const ext = dot > 0 ? name.slice(dot + 1) : ''
    if (!id) continue
    const fileRel = relative(resolve(libraryRoot), abs).split(/\\|\//).join('/')
    const poster = posters.get(`${id}`.toLowerCase()) ?? posters.get(id)
    let bytes = 0
    let created_at = ''
    try {
      const fd = openSync(abs, 'r')
      try {
        const st = fstatSync(fd)
        bytes = st.size
        created_at = new Date(st.mtimeMs).toISOString()
      } finally {
        closeSync(fd)
      }
    } catch {
      // Unreadable file: still index it (id/path survive), bytes unknown.
    }
    let width = 0
    let height = 0
    if (poster) {
      try {
        const fd2 = openSync(poster.abs, 'r')
        try {
          const header = Buffer.alloc(24)
          readSync(fd2, header, 0, 24, 0)
          const dims = posterPngDimensions(new Uint8Array(header.buffer, 0, header.byteLength)) ?? { width: 0, height: 0 }
          width = dims.width
          height = dims.height
        } finally {
          closeSync(fd2)
        }
      } catch {
        // Poster unreadable: documented placeholders (0×0); the loss marker stays in-band.
      }
    }
    const rec = coerceRecordRow({
      id,
      file_rel: fileRel,
      poster_rel: poster?.rel,
      created_at: created_at || new Date(0).toISOString(),
      bytes,
      resolution: { width, height },
      video_format: (VIDEO_FORMATS as readonly string[]).includes(ext) ? ext : 'mp4',
      // Unknowable from disk — documented placeholders, loss marked via RECOVERY_TAG:
      model: 'unknown',
      mode: 'clip',
      preset: 'final',
      prompt: '',
      framerate: 0,
      duration_seconds: 0,
      frame_count: 0,
      seed: -1,
      render_ms: 0,
      tags: [RECOVERY_TAG],
      favorite: false,
      lineage: {},
    })
    if (rec) videos.push(rec)
  }
  return { version: 1, videos }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Input for createRecord: everything §3 generation + §5.2 host job completion knows
 *  about an output. id/created_at/file_rel/poster_rel/bytes are derived (overrides
 *  exist for tests/import backfills). The record shape is the §8.2 VideoRecord
 *  contract verbatim — nothing added here (storage helpers only). */
export interface CreateRecordInput extends StoreOptions {
  prompt: string
  negative_prompt?: string
  model: string
  mode: VideoMode
  preset: 'draft' | 'final'
  resolution: { width: number; height: number }
  framerate: number
  /** 4 | 5 | 8 s (§2.1) — the store validates shape, not catalog membership. */
  duration_seconds: number
  /** d×fps (+1 latent rule enforced upstream; stored verbatim). */
  frame_count: number
  seed: number
  /** loop/restyle strength as resolved (0–1; undefined on plain clips). */
  motion_strength?: number
  /** Container the graph actually output (§2.1 VERIFY — locked mp4+h264 at §8.4b). */
  video_format: VideoFormat
  render_ms?: number
  comfy_prompt_id?: string
  /** §3.5 lineage — persisted one-way; the image library is NEVER touched. */
  lineage?: VideoLineage
  tags?: string[]
  favorite?: boolean
  /** Clip bytes — saved first ("after byte save"), then index append via atomic write. */
  data: Uint8Array
  /** In-graph poster PNG bytes (§2.4); optional — recovery (§4.4) tolerates missing posters. */
  poster_data?: Uint8Array
  /** ISO created_at (tests/import); default now. */
  created_at?: string
  /** Pinned id (tests/import); default randomUUID. */
  id?: string
  /** file_rel override (tests/import); default fileRelForRecord(id, created_at, ext). */
  file_rel?: string
  /** poster_rel override (tests/import); default posterRelForRecord(id, created_at). */
  poster_rel?: string
}

export interface CreateRecordResult {
  record: VideoRecord
  /** Absolute path of the written clip — tools use it for `_localPath` (§3.4). */
  file_abs: string
  /** Absolute poster path when a poster was written (route grid uses it §5.6). */
  poster_abs?: string
  library_root: string
  index_path: string
}

/**
 * Clip + poster byte save → index append (atomic rename) → change notify, fully
 * serialized through the write queue. The index is read (and, when corrupt,
 * recovered) BEFORE the byte saves so a recovery rebuild never sees this mutation's
 * own new files; replace-by-id on append makes a re-created id idempotent (e.g. an
 * orphan-recovered copy of the same clip). Throws (fail-fast) when no workspace is
 * resolvable. Lineage (incl. `source_image_id` from §3.5 `from_image_id`) is
 * persisted exactly as passed — one-way, no image-library writes.
 */
export async function createRecord(input: CreateRecordInput): Promise<CreateRecordResult> {
  const libraryRoot = requireLibraryRoot(input)
  const workspaceCwd = input.workspaceCwd?.trim() ? input.workspaceCwd : undefined
  return enqueueWrite(() => {
    if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0)
      throw new Error('createRecord requires non-empty video bytes (clip container).')
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (!prompt) throw new Error('createRecord requires a non-empty prompt.')
    const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : 'unknown'
    if (!isVideoMode(input.mode)) throw new Error(`mode must be one of ${VIDEO_MODES.join(' | ')} — got "${String(input.mode)}".`)
    if (input.preset !== 'draft' && input.preset !== 'final')
      throw new Error(`preset must be 'draft' or 'final' — got "${String(input.preset)}".`)
    const width = Number(input.resolution?.width)
    const height = Number(input.resolution?.height)
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)
      throw new Error(
        `createRecord requires positive width/height (got ${input.resolution?.width}×${input.resolution?.height}).`,
      )
    const framerate = Number(input.framerate)
    if (!Number.isFinite(framerate) || framerate <= 0)
      throw new Error(`framerate must be a positive fps (got "${String(input.framerate)}").`)
    const duration = Number(input.duration_seconds)
    if (!Number.isFinite(duration) || duration < 0)
      throw new Error(`duration_seconds must be finite ≥ 0 (got "${String(input.duration_seconds)}").`)
    const frameCount = Number(input.frame_count)
    if (!Number.isFinite(frameCount) || frameCount < 0)
      throw new Error(`frame_count must be finite ≥ 0 (got "${String(input.frame_count)}").`)
    const seed = Number(input.seed)
    if (!Number.isFinite(seed) || seed < -1)
      throw new Error(`seed must be ≥ -1 (-1 = unseeded) — got "${String(input.seed)}".`)
    const motion = input.motion_strength
    if (motion !== undefined && (!Number.isFinite(Number(motion)) || Number(motion) < 0 || Number(motion) > 1))
      throw new Error(`motion_strength must be within 0–1 — got "${String(motion)}".`)
    if (!(VIDEO_FORMATS as readonly string[]).includes(input.video_format))
      throw new Error(`video_format must be one of ${VIDEO_FORMATS.join(' | ')} — got "${String(input.video_format)}".`)

    const id = input.id?.trim() || randomUUID()
    const created_at = input.created_at?.trim() || new Date().toISOString()
    const fileRel = (input.file_rel?.trim() || fileRelForRecord(id, created_at, input.video_format)).replace(/\\/g, '/')
    const fileAbs = videoFileAbs(libraryRoot, fileRel)
    // Poster sits beside the clip in the same dated dir (§4.1); an explicit poster_rel
    // override covers import backfills (incl. posters placed earlier by the caller).
    const posterData = input.poster_data instanceof Uint8Array && input.poster_data.byteLength > 0 ? input.poster_data : undefined
    const posterRel = posterData
      ? input.poster_rel?.trim() || fileRel.replace(/\/[^/]+$/, `/${id}${POSTER_SUFFIX}`)
      : input.poster_rel?.trim() || undefined
    const posterAbs = posterRel ? videoFileAbs(libraryRoot, posterRel) : undefined

    // 1) Index load first (corrupt recovery scans only pre-existing files), then byte
    //    saves — a crash here leaves a recoverable orphan clip/poster, no index entry.
    const store = loadLibrary(libraryRoot)
    mkdirSync(dirname(fileAbs), { recursive: true })
    writeFileSync(fileAbs, input.data)
    if (posterData && posterAbs) {
      mkdirSync(dirname(posterAbs), { recursive: true })
      writeFileSync(posterAbs, posterData)
    }
    // 2) Coerce → replace-by-id append → atomic index write (full re-read per mutation
    //    is the multi-writer stance; the queue serializes within this process).
    const record = coerceRecordRow({
      id,
      file_rel: fileRel,
      poster_rel: posterRel,
      created_at,
      bytes: input.data.byteLength,
      resolution: { width, height },
      framerate,
      duration_seconds: duration,
      frame_count: frameCount,
      seed,
      motion_strength: motion,
      video_format: input.video_format,
      render_ms: Number.isFinite(Number(input.render_ms)) ? Math.max(0, Number(input.render_ms)) : 0,
      model,
      mode: input.mode,
      preset: input.preset,
      prompt,
      negative_prompt: input.negative_prompt?.trim() || undefined,
      comfy_prompt_id: input.comfy_prompt_id?.trim() || undefined,
      lineage: input.lineage ?? {},
      tags: input.tags,
      favorite: input.favorite === true,
    })
    if (!record) throw new Error('createRecord produced an invalid record (internal error).')
    // Replace-by-id: if an earlier attempt left an orphan-recovered copy of this same
    // clip (same id), the metadata-complete record wins.
    store.videos = store.videos.filter((v) => v.id !== record.id)
    store.videos.push(record)
    saveLibrary(store, libraryRoot)
    notifyLibraryChanged(workspaceCwd, 'create')
    return {
      record,
      file_abs: fileAbs,
      poster_abs: posterAbs,
      library_root: libraryRoot,
      index_path: resolveLibraryIndexPath(libraryRoot),
    } satisfies CreateRecordResult
  })
}

/** Full record by id (§3.2 `sylo_video_gen_get`), including lineage + poster path.
 *  Reads are not queued; graceful null on missing id. */
export async function getRecord(args: { video_id: string } & StoreOptions): Promise<VideoRecord | null> {
  const libraryRoot = resolveLibraryRoot(args)
  if (!libraryRoot) return null
  const id = args.video_id?.trim()
  if (!id) return null
  return loadLibrary(libraryRoot).videos.find((v) => v.id === id) ?? null
}

export interface VideoLibraryListItem {
  /** §3.2 compact list contract fields (image-gen parity + video framing). */
  id: string
  path: string
  poster_path?: string
  prompt: string
  model: string
  mode: VideoMode
  preset: 'draft' | 'final'
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

export interface VideoLibraryQueryResult {
  items: VideoLibraryListItem[]
  /** Full match count before offset/limit — pagination totals for the route UI. */
  total: number
}

/** §3.2 list filters (index scan; SQLite/FTS explicitly out of scope). `until` and
 *  `mode` are the video twins' additions on top of the image-gen query contract. */
export interface VideoLibraryQuery {
  /** Substring, case-insensitive over prompt + tags. */
  query?: string
  /** All must match (AND). */
  tags?: string[]
  favorite?: boolean
  /** Case-insensitive exact catalog id. */
  model?: string
  /** Exact mode match. */
  mode?: VideoMode
  /** ISO lower bound: records with created_at ≥ since. */
  since?: string
  /** ISO upper bound: records with created_at ≤ until. */
  until?: string
  limit?: number
  offset?: number
}

const DEFAULT_QUERY_LIMIT = 20
const MAX_QUERY_LIMIT = 100
/** §3.2 list contract: prompt truncated to ≤120 chars. */
const PROMPT_CUTOFF = 120

/**
 * `sylo_video_gen_list` / route-library query (§3.2): substring case-insensitive over
 * prompt/tags + all-match tags + favorite + model (case-insensitive exact) + mode +
 * since/until (ISO bounds; records with since ≤ created_at ≤ until) + limit (default
 * 20, max 100) + offset. Sorted newest-first. `total` counts the full match set.
 */
export async function queryLibrary(args: VideoLibraryQuery & StoreOptions): Promise<VideoLibraryQueryResult> {
  const libraryRoot = resolveLibraryRoot(args)
  if (!libraryRoot) return { items: [], total: 0 }

  const needle = (args.query ?? '').trim().toLowerCase()
  const wantTags = (args.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
  const wantFavorite = typeof args.favorite === 'boolean' ? (args.favorite as boolean) : undefined
  const wantModel = args.model?.trim().toLowerCase() || undefined
  const wantMode = isVideoMode(args.mode) ? args.mode : undefined
  const sinceMs = args.since ? Date.parse(args.since) : NaN
  const untilMs = args.until ? Date.parse(args.until) : NaN

  const matches = loadLibrary(libraryRoot)
    .videos.filter((v) => {
      if (wantFavorite !== undefined && v.favorite !== wantFavorite) return false
      if (wantModel && v.model.toLowerCase() !== wantModel) return false
      if (wantMode && v.mode !== wantMode) return false
      if (!Number.isNaN(sinceMs)) {
        const t = Date.parse(v.created_at)
        if (Number.isNaN(t) || t < sinceMs) return false
      }
      if (!Number.isNaN(untilMs)) {
        const t = Date.parse(v.created_at)
        if (Number.isNaN(t) || t > untilMs) return false
      }
      if (wantTags.length) {
        const have = v.tags.map((t) => t.toLowerCase())
        if (!wantTags.every((wt) => have.includes(wt))) return false
      }
      if (needle) {
        const inPrompt = v.prompt.toLowerCase().includes(needle)
        const inTags = v.tags.some((t) => t.toLowerCase().includes(needle))
        if (!inPrompt && !inTags) return false
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

  const items = matches.slice(offset, offset + limit).map((v) => ({
    id: v.id,
    path: videoFileAbs(libraryRoot, v.file_rel),
    ...(v.poster_rel ? { poster_path: videoFileAbs(libraryRoot, v.poster_rel) } : {}),
    prompt: v.prompt.length > PROMPT_CUTOFF ? `${v.prompt.slice(0, PROMPT_CUTOFF - 1)}…` : v.prompt,
    model: v.model,
    mode: v.mode,
    preset: v.preset,
    tags: v.tags,
    favorite: v.favorite,
    created_at: v.created_at,
    width: v.resolution.width,
    height: v.resolution.height,
    framerate: v.framerate,
    duration_seconds: v.duration_seconds,
    frame_count: v.frame_count,
    render_ms: v.render_ms,
  }))
  return { items, total: matches.length }
}

export interface OrganizeOptions extends StoreOptions {
  video_ids?: string[]
  add_tags?: string[]
  remove_tags?: string[]
  favorite?: boolean
  /** §3.3 delete-with-confirm: unlinks clip + poster, drops the record, rewrites the index. */
  delete?: boolean
}

export interface OrganizeResult {
  /** Post-update full records for ids that existed (§3.2 "updated records"). */
  updated: VideoRecord[]
  /** Ids actually deleted (files + record). */
  deleted: string[]
}

/**
 * `sylo_video_gen_organize` (§3.3): add/remove tags (case-insensitive identity, add
 * after remove) and favorite (applied only when a boolean is passed), or `delete:
 * true` — which takes precedence over the tag/favorite ops and unlinks the CLIP AND
 * ITS POSTER, drops the record, and rewrites the index (§3.3 delete policy: no clip
 * left orphaned, no poster left orphaned). The §8.2 VideoRecord contract has no
 * album/caption fields — image-gen's album/caption organize ops are deliberately
 * absent (the record contract is not extended here). The skill warns the agent to
 * confirm with the operator before delete (§3.3).
 */
export async function organizeRecords(args: OrganizeOptions): Promise<OrganizeResult> {
  const libraryRoot = requireLibraryRoot(args)
  const workspaceCwd = args.workspaceCwd?.trim() ? args.workspaceCwd : undefined
  return enqueueWrite(() => {
    const store = loadLibrary(libraryRoot)
    const ids = new Set((args.video_ids ?? []).map((id) => String(id).trim()).filter(Boolean))

    if (args.delete === true) {
      const deleted: string[] = []
      const survivors: VideoRecord[] = []
      for (const rec of store.videos) {
        if (!ids.has(rec.id)) {
          survivors.push(rec)
          continue
        }
        // File unlinks + record drop go together; a missing file never blocks the record
        // drop (index is metadata truth; §4.1: files are truth for bytes — deleted means gone).
        try {
          unlinkSync(videoFileAbs(libraryRoot, rec.file_rel))
        } catch {
          /* clip already gone — record removal still proceeds */
        }
        if (rec.poster_rel) {
          try {
            unlinkSync(videoFileAbs(libraryRoot, rec.poster_rel))
          } catch {
            /* poster already gone — not a blocker */
          }
        }
        deleted.push(rec.id)
      }
      if (deleted.length) {
        store.videos = survivors
        saveLibrary(store, libraryRoot)
        notifyLibraryChanged(workspaceCwd, 'delete')
      }
      return { updated: [], deleted }
    }

    const removeKeys = new Set((args.remove_tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))
    const addTags = (args.add_tags ?? []).map((t) => String(t).trim()).filter(Boolean)
    const updated: VideoRecord[] = []
    for (const rec of store.videos) {
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
      updated.push(rec)
    }
    if (updated.length) {
      saveLibrary(store, libraryRoot)
      notifyLibraryChanged(workspaceCwd, 'organize')
    }
    return { updated, deleted: [] }
  })
}