/**
 * §5.6b "In progress" strip (added live 2026-10-13): the Videos dashboard
 * previously gave ZERO feedback while a render was in flight — the ledger row
 * existed (createJob/updateJob) but nothing surfaced it, and the library only
 * refreshed after the whole multi-minute render returned. This strip polls the
 * durable job ledger every few seconds and renders one card per queued/running
 * job: live elapsed time (client-ticked), a ms-per-frame ETA from same-model
 * library history (first render of a model = elapsed only, honestly), a
 * progress % capped at 96 (never claims 100 before the clip is actually on
 * disk), and a thin progress bar. When a previously-running job flips to
 * terminal in the ledger it fires onChanged() once — the grid refetches and
 * the new clip walks in by itself, no manual refresh.
 *
 * Poll design notes: unfiltered jobsList (not status=running) so terminal
 * flips are OBSERVED, not inferred; ETA cache is per model id (only filled
 * while a job actually runs — idle dashboards make zero extra RPC); the 1 s
 * timer just re-renders elapsed text.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import {
  bridge,
  MODE_LABELS,
  type VideoGenRequest,
  type VideogenCatalogEntry,
  type VideogenJobSnapshot,
} from '../bridge'

type EtaEntry = { per_frame_ms: number | null; samples: number }

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

export function JobProgressStrip({
  catalog,
  onChanged,
}: {
  catalog: VideogenCatalogEntry[]
  onChanged: () => void
}): ReactElement | null {
  const [jobs, setJobs] = useState<VideogenJobSnapshot[]>([])
  const [now, setNow] = useState(() => Date.now())
  const etas = useRef<Map<string, EtaEntry>>(new Map())
  const runningSeen = useRef<Set<string>>(new Set())
  // Latest onChanged without resubscribing the poller on identity churn.
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  useEffect(() => {
    let alive = true
    const fillEta = async (model: string): Promise<void> => {
      const fallback: EtaEntry = { per_frame_ms: null, samples: 0 }
      try {
        const lib = await bridge.libraryList({ model, limit: 100, offset: 0 })
        const perFrame = lib.items
          .filter((it) => it.render_ms > 0 && it.frame_count > 0)
          .map((it) => it.render_ms / it.frame_count)
        if (perFrame.length === 0) {
          etas.current.set(model, fallback)
        } else {
          const avg = perFrame.reduce((a, b) => a + b, 0) / perFrame.length
          etas.current.set(model, { per_frame_ms: avg, samples: perFrame.length })
        }
      } catch {
        etas.current.set(model, fallback)
      }
    }
    const poll = async (): Promise<void> => {
      try {
        const res = await bridge.jobsList({ limit: 8 })
        if (!alive) return
        const active = res.jobs.filter((j) => j.status === 'running' || j.status === 'queued')
        const stillActive = new Set(active.map((j) => j.id))
        // Completion fan (observed, not inferred): a job that was active on the
        // previous poll and is gone from the active set fires ONE refresh.
        for (const id of Array.from(runningSeen.current)) {
          if (stillActive.has(id)) continue
          runningSeen.current.delete(id)
          if (res.jobs.some((j) => j.id === id)) onChangedRef.current()
        }
        runningSeen.current = stillActive
        setJobs(active)
        for (const j of active) {
          const model = (j.request as VideoGenRequest | undefined)?.model
          if (model && !etas.current.has(model)) void fillEta(model)
        }
      } catch {
        /* ledger unavailable (no workspace) — idle */
      }
    }
    void poll()
    const poller = setInterval(() => void poll(), 5_000)
    const ticker = setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      alive = false
      clearInterval(poller)
      clearInterval(ticker)
    }
  }, [])

  if (jobs.length === 0) return null
  const labelForModel = (id: string): string => catalog.find((c) => c.id === id)?.label ?? id

  return (
    <section className="vg-progress-strip" aria-live="polite">
      {jobs.map((j) => {
        const req = (j.request ?? {}) as Partial<VideoGenRequest>
        const startedMs = [j.started_at, j.created_at].find((v) => typeof v === 'string' && Date.parse(v) > 0)
        const elapsed = startedMs ? now - Date.parse(startedMs) : 0
        const eta = req.model ? etas.current.get(req.model) : undefined
        const etaMs = eta?.per_frame_ms && req.frame_count ? eta.per_frame_ms * req.frame_count : null
        const pct = etaMs && elapsed > 0 ? Math.min(96, Math.round((elapsed / etaMs) * 100)) : null
        const leftMs = etaMs ? Math.max(0, etaMs - elapsed) : null
        return (
          <div key={j.id} className="vg-progress-card">
            <div className="vg-progress-head">
              <span className={j.status === 'running' ? 'vg-progress-badge' : 'vg-progress-badge vg-progress-queued'}>
                {j.status === 'running' ? '● In progress' : '◌ Queued'}
              </span>
              <span className="vg-progress-meta">
                {MODE_LABELS[(req.mode ?? 'clip') as keyof typeof MODE_LABELS] ?? req.mode}
                {req.model ? ` · ${labelForModel(req.model)}` : ''}
                {req.frame_count ? ` · ${req.frame_count} frames` : ''}
              </span>
            </div>
            <div className="vg-progress-stats">
              {j.status === 'running' ? `elapsed ${fmtElapsed(elapsed)}` : 'waiting for the engine queue'}
              {pct != null ? ` · ${pct}%` : ''}
              {pct != null && leftMs != null && elapsed > etaMs! ? ' · wrapping up…' : pct != null && leftMs != null ? ` · ≈${fmtElapsed(leftMs)} left` : ''}
              {pct == null && j.status === 'running' ? ' · estimating from first render…' : ''}
            </div>
            <div className="vg-progress-bar">
              <div className="vg-progress-fill" style={{ width: `${pct ?? 0}%` }} />
            </div>
            {req.prompt ? (
              <div className="vg-progress-prompt" title={req.prompt}>
                {req.prompt}
              </div>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}