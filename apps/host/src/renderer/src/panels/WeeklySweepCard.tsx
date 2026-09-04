import { useCallback, useEffect, useState } from 'react'

import { cn } from '../lib/cn'
import { btnGhostSm, btnPrimarySm, card, cardTitle, fieldLabel, input, leadText, mutedText, select } from './ui-classes'
import { normalizeOllamaOriginUi, OllamaModelSelect } from './ollama-ui'

const PROVIDERS = ['ollama', 'openai', 'anthropic', 'groq', 'openrouter']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Settings card for the weekly review sweep (ADR-38 Phase B0):
 * schedule, reader model (pick a fast local model — it reads raw chats),
 * digest cap, and a manual "Run now" for testing.
 */
export function WeeklySweepCard(): React.ReactElement {
  const [cfg, setCfg] = useState<SweepConfig | null>(null)
  const [ollamaTags, setOllamaTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    setCfg(await window.sylo.sweep.getConfig())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    void window.sylo.ollama
      .listTags(normalizeOllamaOriginUi('http://127.0.0.1:11434'))
      .then((r) => {
        if (r.ok) setOllamaTags(r.models)
      })
      .catch(() => {
        /* ollama not running — text input still works */
      })
  }, [])

  async function save(patch: Partial<SweepConfig>): Promise<void> {
    setBusy(true)
    try {
      setCfg(await window.sylo.sweep.setConfig(patch))
      setNotice('Saved.')
    } finally {
      setBusy(false)
    }
  }

  async function runNow(): Promise<void> {
    setBusy(true)
    setNotice('Sweep starting…')
    try {
      const r = await window.sylo.sweep.runNow()
      setNotice(
        r.ok
          ? `Sweep conversation started${r.conversationId ? ` (${r.conversationId.slice(0, 8)})` : ''} — ${r.msgCount} new message${r.msgCount === 1 ? '' : 's'} in scope`
          : `Run failed: ${r.error}`,
      )
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const lastRun = cfg?.last_run_at ? new Date(cfg.last_run_at).toLocaleString() : 'never'

  return (
    <section className={card}>
      <h2 className={cardTitle}>Weekly review sweep</h2>
      <p className={leadText}>
        Once a week, a hidden chat reads everything said in chats since the last sweep using the{' '}
        <strong>reader model</strong> — pick a fast local model (e.g. a Nemotron via Ollama) so raw
        chat reading never uses the main model. It writes a digest to{' '}
        <code>.sylo/proposals/sweeps/</code> and drafts proposals into the pending queues for you to
        approve in the Proposals tab. Reviewed messages are marked so they are not re-read.
      </p>

      {cfg ? (
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={cfg.enabled}
              disabled={busy}
              onChange={(e) => void save({ enabled: e.target.checked })}
            />
            <span>
              Run weekly
              <span className={cn('block text-[0.78rem]', mutedText)}>
                Fires one reader-model conversation at the scheduled time, Sunday 00:00 by default.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[130px] flex-col gap-1" htmlFor="sweep-day">
              <span className={fieldLabel}>Day</span>
              <select
                id="sweep-day"
                className={select}
                value={cfg.day_of_week}
                disabled={busy}
                onChange={(e) => void save({ day_of_week: parseInt(e.target.value, 10) })}
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1" htmlFor="sweep-time">
              <span className={fieldLabel}>Time (local)</span>
              <input
                id="sweep-time"
                type="time"
                className={input}
                value={cfg.time_local}
                disabled={busy}
                onChange={(e) => void save({ time_local: e.target.value })}
              />
            </label>
            <label className="flex min-w-[110px] flex-col gap-1" htmlFor="sweep-max">
              <span className={fieldLabel}>Digest cap (findings)</span>
              <input
                id="sweep-max"
                type="number"
                min={3}
                max={30}
                className={input}
                value={cfg.max_findings}
                disabled={busy}
                onChange={(e) => void save({ max_findings: parseInt(e.target.value, 10) || 12 })}
              />
            </label>
            <button type="button" className={btnPrimarySm} disabled={busy} onClick={() => void runNow()}>
              Run now
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[130px] flex-col gap-1" htmlFor="sweep-provider">
              <span className={fieldLabel}>Reader provider</span>
              <select
                id="sweep-provider"
                className={select}
                value={cfg.reader_provider}
                disabled={busy}
                onChange={(e) => void save({ reader_provider: e.target.value, reader_model_id: '' })}
              >
                <option value="">(inherit global model)</option>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            {cfg.reader_provider === 'ollama' ? (
              <label className="flex flex-col gap-1" htmlFor="sweep-ollama-model">
                <span className={fieldLabel}>Reader model (Ollama tag)</span>
                <OllamaModelSelect
                  modelId={cfg.reader_model_id}
                  setModelId={(m) => void save({ reader_model_id: m })}
                  ollamaTags={ollamaTags}
                />
              </label>
            ) : (
              <label className="flex flex-1 flex-col gap-1" htmlFor="sweep-model-id">
                <span className={fieldLabel}>Reader model id {cfg.reader_provider ? '' : '(inherits global)'}</span>
                <input
                  id="sweep-model-id"
                  className={input}
                  value={cfg.reader_model_id}
                  disabled={busy || !cfg.reader_provider}
                  placeholder={cfg.reader_provider ? 'must match Pi / models.json' : 'enable a provider to set'}
                  onChange={(e) => void save({ reader_model_id: e.target.value })}
                  onBlur={(e) => void save({ reader_model_id: e.target.value.trim() })}
                />
              </label>
            )}
          </div>

          <p className={cn('text-[0.8rem]', mutedText)}>
            Last run: {lastRun} — {cfg.last_status}
          </p>
          {notice && <p className="text-[0.82rem]">{notice}</p>}
        </div>
      ) : (
        <p className={mutedText}>Loading sweep settings…</p>
      )}
    </section>
  )
}