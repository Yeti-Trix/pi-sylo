/**
 * Durable render ledger (plan §4.3) — `jobs.json` beside the library index in the
 * same `<workspace>/.sylo/videos/` root. This is the deliberately-diverging half of
 * §8.5 (the §8.5 run scoped itself to the library store; this module landed with its
 * consumers at §8.6 per the §8.5 carve-out: issue #34 comment 6134994973 + tracker
 * §8.5 row). Consumers: the §3.1 generate tool (append queued → running → done/error)
 * and the §3.3 doctor's job-record health section; §8.7's host job ops + the
 * restart-replay read `listJobs({status})` compose on the same module.
 *
 * Image-gen's route jobs are an in-memory Map (imagegen-host.ts:112-115) — fine for
 * 10-second renders, wrong for minutes-long clips. Every video render persists here:
 *
 *   { version: 1, jobs: JobRecord[] }  — JobRecord is the §8.2 shared/types.ts
 *     contract verbatim: { id, request (the RESOLVED VideoGenRequest),
 *     status queued|running|done|error, comfy_prompt_id?, created_at,
 *     started_at?, finished_at?, error?, output_record_ids? }
 *
 * ComfyUI owns the true job queue; this ledger is Sylo's durable view of renders it
 * KNOWS about (agent-tool calls at §8.6; route/host calls at §8.7). On a Sylo
 * restart pending rows are replayable via `listJobs({status})` + client.ts
 * `historyFor(prompt_id)` (§2.3) — a long render survives a Sylo relaunch, which an
 * in-memory map cannot do (§4.3's whole point). Queue/ETA transparency rides on
 * this; the ledger is "interesting history" too (§4.1: keep `jobs.json` in git,
 * ignore the files/ tree).
 *
 * ── Atomicity + concurrency (§4.2 verbatim stance) ──────────────────────────
 * Every mutation is read-modify-write with the write as temp file + `renameSync`,
 * serialized through this module's OWN single-flight in-flight write queue (the
 * library and the ledger are separate files — separate chains keep them
 * independent; each process serializes its own ops, two-writer eventual
 * consistency as documented in the library store header; SQLite out of scope).
 * A corrupt/unparseable `jobs.json` is renamed to `jobs.json.corrupt-<timestamp>`
 * (evidence kept) and the ledger restarts empty — job history is not rebuildable
 * from disk (outputs live in the library), so unlike library.json there is no
 * rebuild step, just a plain-language note for the doctor (§3.3 job health).
 *
 * No change fan from this store: §4.5 defines the fan for LIBRARY mutations; job
 * state rides the §8.7 host plumbing (route job cards poll this file via the host
 * IPC), not the library-changed channel.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { coerceJobRecord, type JobRecord, type VideoJobStatus, type VideoGenRequest } from './types.ts'
import { resolveLibraryRoot, type StoreOptions } from './video-library-store.ts'

/** §4.1 layout: the ledger sits beside library.json in the video store root. */
export const JOBS_INDEX_FILE = 'jobs.json'

// ── In-flight write queue (single-process serialization, §4.2) ─────────────

let writeChain: Promise<unknown> = Promise.resolve()

/** Serialize work through the module-level jobs write queue. Errors propagate to
 *  the awaiting caller without breaking the chain (library-store enqueueWrite twin). */
export function enqueueJobsWrite<T>(op: () => T): Promise<T> {
  const run = writeChain.then(op, op)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run as Promise<T>
}

/** Test-only: drain in-flight queued writes + reset the chain (repo pattern). */
export async function __resetVideoJobsStoreForTests(): Promise<void> {
  await writeChain.catch(() => {})
  writeChain = Promise.resolve()
}

// ── Path resolution (same root as the library store) ────────────────────────

/** The ledger lives in the SAME root as library.json — `<workspace>/.sylo/videos`. */
export function resolveJobsRoot(opts: StoreOptions = {}): string | null {
  return resolveLibraryRoot(opts)
}

/** Fail-fast variant (tasks-store save() parity) with a jobs-flavored message. */
export function requireJobsRoot(opts: StoreOptions = {}): string {
  const root = resolveJobsRoot(opts)
  if (!root)
    throw new Error(
      'SYLO_PI_CWD is not set and no workspace/libraryRoot was given — the durable video render ledger needs a ' +
        'workspace. Run inside the Sylo broker with sylo-video-gen enabled, or pass libraryRoot/workspaceCwd.',
    )
  return root
}

export function resolveJobsIndexPath(jobsRoot: string): string {
  return join(jobsRoot, JOBS_INDEX_FILE)
}

// ── Index: load / coerce / atomic save / corrupt keep-evidence reset ────────

function emptyJobs(): VideoJobsStore {
  return { version: 1, jobs: [] }
}

export interface VideoJobsStore {
  version: 1
  jobs: JobRecord[]
}

export interface LoadJobsResult {
  store: VideoJobsStore
  /** Non-empty when the previous ledger was corrupt and kept as evidence (§4.2/§3.3). */
  recovery_note?: string
}

/** Raw read (validate-coerce each row per types.ts coerceJobRecord; unknown-shaped
 *  rows dropped). Exported for the §3.3 doctor's job health + tests. */
export function loadJobs(jobsRoot: string): VideoJobsStore {
  return loadJobsWithRecovery(jobsRoot).store
}

export function loadJobsWithRecovery(jobsRoot: string): LoadJobsResult {
  const fp = resolveJobsIndexPath(jobsRoot)
  if (!existsSync(fp)) return { store: emptyJobs() }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(fp, 'utf8'))
  } catch (err) {
    return recoverJobsFromCorruptLedger(jobsRoot, err instanceof Error ? err.message : String(err))
  }
  const rows =
    raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as VideoJobsStore).jobs)
      ? ((raw as VideoJobsStore).jobs as unknown[])
      : null
  if (!rows) return recoverJobsFromCorruptLedger(jobsRoot, 'jobs.json is not a {version, jobs[]} object')
  const jobs = rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const { record } = coerceJobRecord(row as Record<string, unknown>)
      if (!record.id || record.id === 'unknown') return null
      return record
    })
    .filter((j): j is JobRecord => j !== null)
  return { store: { version: 1, jobs } }
}

/** Corrupt/unparseable ledger → keep the evidence as `jobs.json.corrupt-<ts>` and
 *  start empty. Job history is not rebuildable from disk (§4.3 vs §4.4: the LIBRARY
 *  has a rebuild path, the ledger does not — its outputs live in the library).
 *  Exported for tests. */
export function recoverJobsFromCorruptLedger(jobsRoot: string, reason: string): LoadJobsResult {
  const fp = resolveJobsIndexPath(jobsRoot)
  try {
    renameSync(fp, `${fp}.corrupt-${Date.now()}`)
  } catch {
    /* rename is best-effort evidence keeping (Windows AV lock); reset proceeds */
  }
  const fresh = emptyJobs()
  try {
    writeJobsSync(fresh, jobsRoot)
  } catch {
    /* a failed reset write is retried on the next mutation */
  }
  return {
    store: fresh,
    recovery_note: `jobs.json was corrupt (${reason}) — evidence kept as ${JOBS_INDEX_FILE}.corrupt-<timestamp> and the ledger restarted empty; the library index is unaffected.`,
  }
}

/** Atomic write: temp file + renameSync (tasks-store.ts:73-74 pattern). */
function writeJobsSync(store: VideoJobsStore, jobsRoot: string): void {
  const fp = resolveJobsIndexPath(jobsRoot)
  mkdirSync(dirname(fp), { recursive: true })
  writeFileSync(`${fp}.tmp`, JSON.stringify(store, null, 2), 'utf8')
  renameSync(`${fp}.tmp`, fp)
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CreateJobInput extends StoreOptions {
  /** The RESOLVED request (catalog resolveVideoGenRequest output — §3.1 flow). */
  request: VideoGenRequest
  /** Pinned id (tests); default randomUUID. */
  id?: string
}

/** Append a queued job row (§4.3). Serialized via the jobs write chain; replace-by-id
 *  on append keeps a retried create idempotent. */
export async function createJob(input: CreateJobInput): Promise<JobRecord> {
  const jobsRoot = requireJobsRoot(input)
  return enqueueJobsWrite(() => {
    const { store } = loadJobsWithRecovery(jobsRoot)
    const job: JobRecord = {
      id: input.id?.trim() || randomUUID(),
      request: input.request,
      status: 'queued',
      created_at: new Date().toISOString(),
    }
    const jobs = store.jobs.filter((j) => j.id !== job.id)
    jobs.push(job)
    writeJobsSync({ version: 1, jobs }, jobsRoot)
    return job
  })
}

/**
 * Update a job row by id — status transitions (queued → running → done|error),
 * timestamps, comfy_prompt_id, error text, output_record_ids. Replace-by-id; the
 * row is read fresh inside the write chain (§4.2). Throws a plain-language Error
 * on an unknown id (callers render it — the §3.1 generate tool treats that as a
 * ledger hiccup, never a render failure).
 */
export async function updateJob(
  args: {
    job_id: string
    status?: VideoJobStatus
    started_at?: string
    finished_at?: string
    comfy_prompt_id?: string
    error?: string
    output_record_ids?: string[]
  } & StoreOptions,
): Promise<JobRecord> {
  const jobsRoot = requireJobsRoot(args)
  const id = args.job_id?.trim()
  if (!id) throw new Error('updateJob requires a non-empty job_id (the createJob result).')
  return enqueueJobsWrite(() => {
    const { store } = loadJobsWithRecovery(jobsRoot)
    if (!store.jobs.some((j) => j.id === id))
      throw new Error(`Job "${id}" is not in the render ledger — it may have been reset after a corrupt jobs.json; the render itself is unaffected.`)
    const current = store.jobs.find((j) => j.id === id)!
    const next: JobRecord = {
      ...current,
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.started_at !== undefined ? { started_at: args.started_at } : {}),
      ...(args.finished_at !== undefined ? { finished_at: args.finished_at } : {}),
      ...(args.comfy_prompt_id !== undefined ? { comfy_prompt_id: args.comfy_prompt_id } : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
      ...(args.output_record_ids !== undefined ? { output_record_ids: args.output_record_ids } : {}),
    }
    // Coerce through the shared row contract so ledger writes and reads agree (§8.2);
    // drop undefined-valued keys so rows deepStrictEqual their JSON round-trips.
    const clean = JSON.parse(JSON.stringify(next, (_k, v) => (v === undefined ? undefined : v))) as Record<string, unknown>
    for (const key of Object.keys(clean)) if (clean[key] === undefined) delete clean[key]
    const { record } = coerceJobRecord(clean)
    const jobs = store.jobs.filter((j) => j.id !== id)
    jobs.push(record)
    writeJobsSync({ version: 1, jobs }, jobsRoot)
    return record
  })
}

/** Full row by id (§8.7 jobGet twin); graceful null when missing or no workspace. */
export async function getJob(args: { job_id: string } & StoreOptions): Promise<JobRecord | null> {
  const jobsRoot = resolveJobsRoot(args)
  if (!jobsRoot) return null
  const id = args.job_id?.trim()
  if (!id) return null
  return loadJobs(jobsRoot).jobs.find((j) => j.id === id) ?? null
}

export interface JobListQuery extends StoreOptions {
  status?: VideoJobStatus
  since?: string
  limit?: number
  offset?: number
}

export interface JobListResult {
  jobs: JobRecord[]
  total: number
}

const DEFAULT_JOB_LIST_LIMIT = 50
const MAX_JOB_LIST_LIMIT = 200

/**
 * Ledger query (newest first) — §8.7's jobGet/queueList + restart replay read
 * (`status: 'queued' | 'running'` + `historyFor`) ride this; §3.3 doctor counts via
 * loadJobs.
 */
export async function listJobs(args: JobListQuery = {}): Promise<JobListResult> {
  const jobsRoot = resolveJobsRoot(args)
  if (!jobsRoot) return { jobs: [], total: 0 }
  const sinceMs = args.since ? Date.parse(args.since) : NaN
  const matches = loadJobs(jobsRoot)
    .jobs.filter((j) => {
      if (args.status && j.status !== args.status) return false
      if (!Number.isNaN(sinceMs)) {
        const t = Date.parse(j.created_at)
        if (Number.isNaN(t) || t < sinceMs) return false
      }
      return true
    })
    .sort((a, b) => {
      const ta = Date.parse(a.created_at)
      const tb = Date.parse(b.created_at)
      if (ta !== tb) return tb - ta
      return a.id < b.id ? 1 : -1
    })
  const limit =
    typeof args.limit === 'number' && Number.isFinite(args.limit)
      ? Math.min(MAX_JOB_LIST_LIMIT, Math.max(0, Math.floor(args.limit)))
      : DEFAULT_JOB_LIST_LIMIT
  const offset =
    typeof args.offset === 'number' && Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : 0
  return { jobs: matches.slice(offset, offset + limit), total: matches.length }
}