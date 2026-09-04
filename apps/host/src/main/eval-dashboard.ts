import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const TRACKED_METRICS = [
  { key: 'median_tokens_per_turn', label: 'Median tokens/turn' },
  { key: 'error_rate', label: 'Tool error rate', percent: true as const },
  { key: 'total_retries', label: 'Retries' },
  { key: 'compaction_events', label: 'Compactions' },
  { key: 'median_tool_calls', label: 'Median tool calls' },
] as const

export type TrackedMetricKey = (typeof TRACKED_METRICS)[number]['key']

export type EvalRunRow = {
  run_id: string
  run_at: string
  note: string | null
  sylo_version: string | null
  sylo_git_commit: string | null
  sylo_git_dirty: boolean | null
  sessions_scanned: number
  sessions_skipped_since: number
  scope: 'cumulative' | 'windowed'
  since: string | null
  metrics: Record<TrackedMetricKey, number>
  totals: Record<string, number>
  anomaly_count: number
  model_error_breakdown: Array<{ model: string; calls: number; errors: number; error_rate: number }>
}

export type EvalDashboardPayload = {
  runs: EvalRunRow[]
  tracked: typeof TRACKED_METRICS
  builtAt: string
  runsDir: string
  minerPath: string
  labRoot: string
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Load archived trajectory runs (oldest first). Skips folders missing manifest or baseline JSON. */
export function loadEvalRuns(runsDir: string): EvalRunRow[] {
  if (!existsSync(runsDir)) return []
  const runs: EvalRunRow[] = []
  for (const ent of readdirSync(runsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const dir = join(runsDir, ent.name)
    const manifest = readJsonSafe(join(dir, 'manifest.json'))
    const baseline = readJsonSafe(join(dir, 'trajectory-baseline.json'))
    const corpus = baseline?.corpus as Record<string, unknown> | undefined
    if (!manifest || !corpus) continue
    const totals = (corpus.totals as Record<string, number> | undefined) ?? {}
    const medians = (corpus.medians as Record<string, number> | undefined) ?? {}
    const compaction = (corpus.compaction as Record<string, number> | undefined) ?? {}
    const sylo = (manifest.sylo as Record<string, unknown> | undefined) ?? {}
    const cliArgs = (manifest.cli_args as Record<string, unknown> | undefined) ?? {}
    const scan = (manifest.scan as Record<string, number> | undefined) ?? {}
    const sinceRaw = typeof cliArgs.since === 'string' ? cliArgs.since : null
    const totalCalls = totals.tool_calls ?? 0
    const modelErrorBreakdown = Array.isArray(corpus.model_error_breakdown)
      ? (corpus.model_error_breakdown as Array<Record<string, unknown>>)
          .filter((r) => r && typeof r.model === 'string')
          .map((r) => ({
            model: String(r.model),
            calls: typeof r.calls === 'number' ? r.calls : 0,
            errors: typeof r.errors === 'number' ? r.errors : 0,
            error_rate: typeof r.error_rate === 'number' ? r.error_rate : 0,
          }))
      : []
    runs.push({
      run_id: String(manifest.run_id ?? ent.name),
      run_at: String(manifest.run_at ?? ''),
      note: typeof manifest.note === 'string' ? manifest.note : null,
      sylo_version: typeof sylo.version === 'string' ? sylo.version : null,
      sylo_git_commit: typeof sylo.git_commit === 'string' ? sylo.git_commit : null,
      sylo_git_dirty: typeof sylo.git_dirty === 'boolean' ? sylo.git_dirty : null,
      sessions_scanned: typeof corpus.sessions_scanned === 'number' ? corpus.sessions_scanned : 0,
      sessions_skipped_since: typeof scan.sessions_skipped_since === 'number' ? scan.sessions_skipped_since : 0,
      scope: sinceRaw ? 'windowed' : 'cumulative',
      since: sinceRaw,
      metrics: {
        median_tokens_per_turn: medians.tokens_per_user_turn ?? 0,
        error_rate: totalCalls > 0 ? (totals.tool_errors ?? 0) / totalCalls : 0,
        total_retries: totals.retries ?? 0,
        compaction_events: compaction.total_events ?? 0,
        median_tool_calls: medians.tool_calls ?? 0,
      },
      totals,
      anomaly_count: Array.isArray(corpus.anomalies) ? corpus.anomalies.length : 0,
      model_error_breakdown: modelErrorBreakdown,
    })
  }
  runs.sort((a, b) => Date.parse(a.run_at) - Date.parse(b.run_at))
  return runs
}

export function loadEvalDashboard(
  repoRoot: string,
): { ok: true; data: EvalDashboardPayload } | { ok: false; error: string } {
  const labRoot = join(repoRoot, 'lab')
  if (!existsSync(labRoot)) {
    return { ok: false, error: 'lab_not_found' }
  }
  const runsDir = join(labRoot, 'evals', 'runs')
  const minerPath = join(labRoot, 'evals', 'trajectory-miner', 'trajectory-miner.mjs')
  return {
    ok: true,
    data: {
      runs: loadEvalRuns(runsDir),
      tracked: TRACKED_METRICS,
      builtAt: new Date().toISOString(),
      runsDir,
      minerPath,
      labRoot,
    },
  }
}

export async function runEvalBaseline(
  repoRoot: string,
  note?: string,
  since?: string,
): Promise<
  | { ok: true; runId: string | null; output: string }
  | { ok: false; error: string; detail?: string }
> {
  const labRoot = join(repoRoot, 'lab')
  const minerPath = join(labRoot, 'evals', 'trajectory-miner', 'trajectory-miner.mjs')
  if (!existsSync(minerPath)) {
    return { ok: false, error: 'miner_not_found' }
  }
  const args = [minerPath, '--sylo-root', repoRoot]
  const trimmedNote = note?.trim()
  if (trimmedNote) args.push('--note', trimmedNote)
  const trimmedSince = since?.trim()
  if (trimmedSince) args.push('--since', trimmedSince)
  try {
    const { stdout, stderr } = await execFileAsync('node', args, {
      cwd: labRoot,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    const latestPath = join(labRoot, 'evals', 'runs', 'LATEST.txt')
    let runId: string | null = null
    if (existsSync(latestPath)) {
      runId = readFileSync(latestPath, 'utf8').trim() || null
    }
    return { ok: true, runId, output }
  } catch (err) {
    const e = err as { message?: string; stdout?: string; stderr?: string }
    const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').trim() || e.message
    return { ok: false, error: 'miner_failed', detail }
  }
}
