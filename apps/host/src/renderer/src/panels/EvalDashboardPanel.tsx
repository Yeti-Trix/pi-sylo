import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { cn } from '../lib/cn'
import { btnGhostSm, card, leadText, mutedText, panelTitle } from './ui-classes'

type TrackedMetric = {
  key: string
  label: string
  percent?: boolean
}

type EvalRunRow = {
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
  metrics: Record<string, number>
  anomaly_count: number
  model_error_breakdown: Array<{ model: string; calls: number; errors: number; error_rate: number }>
}

type DashboardData = {
  runs: EvalRunRow[]
  tracked: TrackedMetric[]
  builtAt: string
  runsDir: string
  minerPath: string
}

function fmtMetric(value: number, metric?: TrackedMetric): string {
  if (metric?.percent) return `${(value * 100).toFixed(1)}%`
  return Math.round(value).toLocaleString()
}

function deltaClass(delta: number): string {
  if (delta < 0) return 'text-emerald-400'
  if (delta > 0) return 'text-red-400'
  return 'text-text-secondary'
}

function deltaText(delta: number, metric?: TrackedMetric): string {
  if (delta === 0) return 'no change'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${fmtMetric(delta, metric)} vs prev`
}

function MetricSparkline({
  runs,
  metric,
}: {
  runs: EvalRunRow[]
  metric: TrackedMetric
}): React.ReactElement {
  const W = 300
  const H = 80
  const PAD = 10
  const vals = runs.map((r) => r.metrics[metric.key] ?? 0)
  const max = Math.max(...vals, 1e-9)
  const min = Math.min(...vals, 0)
  const range = max - min || 1
  const x = (i: number) => (runs.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (runs.length - 1))
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - 2 * PAD)
  const points = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block">
      {runs.length > 1 ?
        <polyline points={points} fill="none" stroke="rgb(107 159 255)" strokeWidth={2} />
      : null}
      {vals.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="rgb(107 159 255)" />
      ))}
      <text x={PAD} y={10} className="fill-text-secondary text-[10px]">
        {fmtMetric(max, metric)}
      </text>
      <text x={PAD} y={H - 2} className="fill-text-secondary text-[10px]">
        {fmtMetric(min, metric)}
      </text>
    </svg>
  )
}

export function EvalDashboardPanel(): React.ReactElement {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [runBusy, setRunBusy] = useState(false)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [sinceDate, setSinceDate] = useState<string>('')
  const [noteText, setNoteText] = useState<string>('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.sylo.evals.loadDashboard()
      if (!res.ok) {
        setData(null)
        setError(res.error)
        return
      }
      setData(res.data)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const latest = data?.runs[data.runs.length - 1] ?? null
  const prev = data && data.runs.length > 1 ? data.runs[data.runs.length - 2] : null
  const tableRuns = useMemo(() => (data ? [...data.runs].reverse() : []), [data])

  // The previous run is a valid comparison baseline only when it shares the
  // same scope as the latest run. A cumulative run averages all history; a
  // windowed run averages only sessions since a cutoff. Deltas between the two
  // are noise, not signal, so we suppress them and say so.
  const prevComparable =
    latest && prev && latest.scope === prev.scope ? prev : null

  const runSinceFromLatest = useCallback((): string | undefined => {
    if (!latest?.run_at) return undefined
    // Use the previous baseline's run_at as the cutoff so the window captures
    // only sessions created since then.
    const d = new Date(latest.run_at)
    if (Number.isNaN(d.getTime())) return undefined
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }, [latest?.run_at])

  const handleRunBaseline = (since?: string) => {
    setRunBusy(true)
    setRunMessage(null)
    void (async () => {
      try {
        const trimmedNote = noteText.trim() || undefined
        const res = await window.sylo.evals.runBaseline(trimmedNote, since)
        if (!res.ok) {
          setRunMessage(res.detail ?? res.error)
          return
        }
        const scopeLabel = since ? `windowed since ${since}` : 'cumulative'
        setRunMessage(
          res.runId ?
            `Baseline archived as ${res.runId} (${scopeLabel}).`
          : `Baseline run finished (${scopeLabel}).`,
        )
        await reload()
      } catch (e) {
        setRunMessage(e instanceof Error ? e.message : 'run_failed')
      } finally {
        setRunBusy(false)
      }
    })()
  }

  if (error === 'lab_not_found') {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-3">
        <h2 className={panelTitle}>Testing</h2>
        <p className={cn(mutedText, leadText)}>
          The dev-only <code>lab/</code> folder is not present in this Sylo install. Trajectory eval baselines
          live in the pi-sylo repo under <code>lab/evals/</code>.
        </p>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-3">
        <h2 className={panelTitle}>Testing</h2>
        <p className={cn(mutedText, leadText)}>Loading eval runs…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1180px] flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={panelTitle}>Testing</h2>
          <p className={cn(mutedText, 'm-0 text-[0.82rem]')}>
            Trajectory eval baseline from Pi session JSONL. Lower is better on every metric.
            {data ?
              ` ${data.runs.length} run(s) · refreshed ${new Date(data.builtAt).toLocaleString()}`
            : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGhostSm} disabled={loading} onClick={() => void reload()}>
            Refresh
          </button>
          <button
            type="button"
            className={btnGhostSm}
            disabled={runBusy}
            onClick={() => handleRunBaseline()}
          >
            {runBusy ? 'Running miner…' : 'Run cumulative'}
          </button>
          <button
            type="button"
            className={btnGhostSm}
            disabled={runBusy || !latest?.run_at}
            title={latest?.run_at ? `Window since ${runSinceFromLatest()}` : 'No prior run to window from'}
            onClick={() => {
              const s = runSinceFromLatest()
              if (s) handleRunBaseline(s)
            }}
          >
            {runBusy ? 'Running miner…' : 'Run since last baseline'}
          </button>
          <div className="flex items-center gap-1">
            <input
              type="date"
              aria-label="Since date"
              className="h-[30px] rounded border border-border bg-bg-secondary px-2 text-[0.78rem] text-text-primary"
              value={sinceDate}
              onChange={(e) => setSinceDate(e.target.value)}
            />
            <button
              type="button"
              className={btnGhostSm}
              disabled={runBusy || !sinceDate}
              onClick={() => handleRunBaseline(sinceDate)}
            >
              Run since date
            </button>
          </div>
          {data?.runsDir ?
            <button
              type="button"
              className={btnGhostSm}
              onClick={() => void window.sylo.shell.openPath(data.runsDir)}
            >
              Open runs folder
            </button>
          : null}
        </div>
      </div>

      {runMessage ?
        <p className={cn(mutedText, 'm-0 text-[0.82rem]')}>{runMessage}</p>
      : null}

      {!data || data.runs.length === 0 ?
        <div className={cn(card, 'text-center text-text-secondary')}>
          No archived runs yet. Use <strong className="font-medium text-text-primary">Run cumulative</strong>{' '}
          to scan all Pi sessions, or pick a since date / use <strong>Run since last baseline</strong> for a
          windowed view. CLI:{' '}
          <code className="text-[0.78rem]">node lab/evals/trajectory-miner/trajectory-miner.mjs</code>
        </div>
      : (
        <>
          <div className="flex flex-wrap gap-3">
            {data.tracked.map((metric) => {
              const value = latest!.metrics[metric.key] ?? 0
              const delta = prevComparable ? value - (prevComparable.metrics[metric.key] ?? 0) : null
              return (
                <div key={metric.key} className={cn(card, 'min-w-[170px] flex-1')}>
                  <div className="text-[0.72rem] uppercase tracking-wide text-text-secondary">
                    {metric.label}
                  </div>
                  <div className="text-2xl font-semibold text-text-primary">{fmtMetric(value, metric)}</div>
                  {delta === null ?
                    <div className="text-[0.78rem] text-text-secondary">
                      {data.runs.length > 1 && latest?.scope !== prev?.scope ?
                        'scope differs — not comparable'
                      : 'first run — no baseline to compare'}
                    </div>
                  : <div className={cn('text-[0.78rem]', deltaClass(delta))}>{deltaText(delta, metric)}</div>}
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3">
            {data.tracked.map((metric) => (
              <div key={metric.key} className={card}>
                <h3 className="m-0 mb-2 text-[0.82rem] font-medium text-text-secondary">{metric.label}</h3>
                <MetricSparkline runs={data.runs} metric={metric} />
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[0.82rem]">
              <thead>
                <tr className="border-b border-border bg-bg-secondary text-left text-[0.72rem] uppercase tracking-wide text-text-secondary">
                  <th className="px-3 py-2">Run</th>
                  <th className="px-3 py-2">Date / time</th>
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Sylo</th>
                  <th className="px-3 py-2 text-right">Sessions</th>
                  {data.tracked.map((m) => (
                    <th key={m.key} className="px-3 py-2 text-right">
                      {m.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Anomalies</th>
                </tr>
              </thead>
              <tbody>
                {tableRuns.map((run, idx) => {
                  const older =
                    idx < tableRuns.length - 1 ? tableRuns[idx + 1] : null
                  return (
                    <tr key={run.run_id} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[0.78rem]">{run.run_id}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {new Date(run.run_at).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[0.72rem] uppercase tracking-wide">
                        <span
                          className={run.scope === 'windowed' ? 'text-accent' : 'text-text-secondary'}
                          title={run.scope === 'windowed' && run.since ? `since ${run.since}` : 'all history'}
                        >
                          {run.scope === 'windowed' ? `since ${run.since ?? ''}` : 'cumulative'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-accent">{run.note ?? ''}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {run.sylo_version ?? '?'} ({run.sylo_git_commit ?? 'no git'}
                        {run.sylo_git_dirty ? ' dirty' : ''})
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {run.sessions_scanned.toLocaleString()}
                        {run.scope === 'windowed' && run.sessions_skipped_since > 0 ? (
                          <span className="ml-1 text-text-secondary" title="older sessions excluded by the since filter">
                            · {run.sessions_skipped_since.toLocaleString()} skipped
                          </span>
                        ) : null}
                      </td>
                      {data.tracked.map((metric) => {
                        const value = run.metrics[metric.key] ?? 0
                        // Suppress deltas across scope boundaries: a cumulative
                        // vs windowed comparison is noise, not signal.
                        const sameScope = older ? older.scope === run.scope : false
                        const delta =
                          sameScope && older ? value - (older.metrics[metric.key] ?? 0) : null
                        return (
                          <td key={metric.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {fmtMetric(value, metric)}
                            {delta !== null && delta !== 0 ?
                              <span className={cn('ml-1', deltaClass(delta))}>
                                {delta > 0 ? '▲' : '▼'}
                              </span>
                            : null}
                          </td>
                        )
                      })}
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {run.anomaly_count}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {latest && latest.model_error_breakdown.length > 0 ? (
            <div className={card}>
              <h3 className="m-0 mb-1 text-[0.82rem] font-medium text-text-secondary">
                Per-model tool error breakdown
              </h3>
              <p className={cn(mutedText, 'm-0 mb-2 text-[0.78rem]')}>
                Latest run ({latest.scope === 'windowed' ? `since ${latest.since ?? ''}` : 'cumulative'}).
                Error rate per model that issued tool calls. Answers whether a specific model is dragging the
                blended rate up.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.82rem]">
                  <thead>
                    <tr className="border-b border-border text-left text-[0.72rem] uppercase tracking-wide text-text-secondary">
                      <th className="px-3 py-2">Model</th>
                      <th className="px-3 py-2 text-right">Calls</th>
                      <th className="px-3 py-2 text-right">Errors</th>
                      <th className="px-3 py-2 text-right">Error rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.model_error_breakdown.map((row) => (
                      <tr key={row.model} className="border-b border-border last:border-b-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[0.78rem]">{row.model}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {row.calls.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {row.errors.toLocaleString()}
                        </td>
                        <td
                          className={cn(
                            'whitespace-nowrap px-3 py-2 text-right tabular-nums',
                            row.error_rate >= 0.15 ? 'text-red-400' : row.error_rate >= 0.05 ? 'text-amber-400' : 'text-emerald-400',
                          )}
                        >
                          {(row.error_rate * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
