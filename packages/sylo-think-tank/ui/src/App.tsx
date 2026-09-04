import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  MAX_DEBATERS,
  MIN_DEBATERS,
  isModeratorSeat,
  normalizeThinkTankUiConfig,
  setDebaterCount,
  type ThinkTankConfig,
  type ThinkTankSeatRow,
} from './thinkTankConfig'
import {
  bridge,
  BUNDLED_PERSONAS,
  MODEL_PROVIDERS,
} from './bridge'

type TabId = 'settings' | 'guide'

function personaSelectOptions(currentId: string): Array<{ id: string; label: string; hint?: string }> {
  const known = new Set(BUNDLED_PERSONAS.map((p) => p.id))
  const options = BUNDLED_PERSONAS.map((p) => ({ id: p.id, label: p.label, hint: p.hint }))
  if (currentId.trim() && !known.has(currentId)) {
    options.push({ id: currentId, label: currentId, hint: 'Custom persona from ~/.pi/agent/agents/' })
  }
  return options
}

function SeatModelFields({
  seat,
  ollamaModels,
  onChange,
}: {
  seat: ThinkTankSeatRow
  ollamaModels: string[]
  onChange: (patch: Partial<ThinkTankSeatRow>) => void
}): React.ReactElement {
  const provider = seat.model_provider
  return (
    <>
      <div className="think-tank-field">
        <span className="think-tank-label">Provider</span>
        <select
          className="think-tank-select"
          value={provider}
          onChange={(e) => onChange({ model_provider: e.target.value })}
        >
          {MODEL_PROVIDERS.map((p) => (
            <option key={p.value || 'default'} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="think-tank-field">
        <span className="think-tank-label">
          {provider === 'ollama' ? 'Model (Ollama)' : 'Model id'}
        </span>
        {provider === 'ollama' ?
          <select
            className="think-tank-select"
            value={seat.model_id}
            onChange={(e) => onChange({ model_id: e.target.value })}
          >
            <option value="">— select model —</option>
            {ollamaModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        : <input
            className="think-tank-input"
            value={seat.model_id}
            onChange={(e) => onChange({ model_id: e.target.value })}
            placeholder={provider ? 'Model id from Pi models.json' : 'Empty = Pi default'}
          />
        }
      </div>
    </>
  )
}

export function App(): React.ReactElement {
  const [tab, setTab] = useState<TabId>('settings')
  const [config, setConfig] = useState<ThinkTankConfig>(() => normalizeThinkTankUiConfig({ debater_count: 2, seats: [] }))
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const debaterSeats = useMemo(() => config.seats.filter((s) => !isModeratorSeat(s)), [config.seats])
  const moderatorSeat = useMemo(() => config.seats.find(isModeratorSeat), [config.seats])

  const refreshOllama = useCallback(async () => {
    try {
      const r = await bridge.listOllamaModels()
      setOllamaModels(r.models)
      setOllamaBaseUrl(r.baseUrl)
    } catch (e) {
      setOllamaModels([])
      setOllamaBaseUrl('')
      console.error(e)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setStatus(null)
      try {
        const raw = await bridge.configGet()
        setConfig(normalizeThinkTankUiConfig(raw as unknown as Record<string, unknown>))
      } catch (e) {
        setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
      } finally {
        setLoading(false)
      }
    })()
    void refreshOllama()
  }, [refreshOllama])

  const updateSeat = (index: number, patch: Partial<ThinkTankSeatRow>) => {
    setConfig((prev) => ({
      ...prev,
      seats: prev.seats.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }))
  }

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const payload = {
        debater_count: config.debater_count,
        seats: config.seats.map((s) => ({
          id: s.id,
          role: s.role,
          label: s.label,
          agent: s.agent,
          model_provider: s.model_provider,
          model_id: s.model_id,
          persona: s.persona?.trim() || undefined,
        })),
        min_cycles: config.min_cycles,
        max_cycles: Math.max(config.min_cycles, config.max_cycles),
      }
      const r = await bridge.configSave(payload)
      if (!r.ok) throw new Error('Save failed')
      setStatus({
        kind: 'ok',
        text: `Saved ${config.debater_count} debater(s) + Moderator. Next think tank run uses these models.`,
      })
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const ollamaHint = useMemo(() => {
    if (!ollamaBaseUrl) return 'Ollama list from Sylo Settings server URL.'
    return `${ollamaModels.length} model(s) from ${ollamaBaseUrl}`
  }, [ollamaBaseUrl, ollamaModels.length])

  return (
    <div className="think-tank-app">
      <h1 className="think-tank-title">Think Tank</h1>
      <p className="think-tank-sub">
        Multi-model debate ({MIN_DEBATERS}–{MAX_DEBATERS} debaters + Moderator, min 2 / max 10 cycles). Configure
        each seat&apos;s Pi provider and model here — same options as <strong>Settings → Model (Pi)</strong>.
        Start debates from chat: <code>Think Tank: your topic</code>.
      </p>

      <nav className="think-tank-tabs" aria-label="Think Tank sections">
        <button
          type="button"
          className={`think-tank-tab${tab === 'settings' ? ' active' : ''}`}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
        <button
          type="button"
          className={`think-tank-tab${tab === 'guide' ? ' active' : ''}`}
          onClick={() => setTab('guide')}
        >
          Guide
        </button>
      </nav>

      {loading ?
        <p className="think-tank-muted">Loading think tank config…</p>
      : tab === 'settings' ?
        <>
          <div className="think-tank-card">
            <h3>Debate defaults</h3>
            <div className="think-tank-row">
              <label className="think-tank-field" style={{ flex: '1 1 140px' }}>
                <span className="think-tank-label">Number of debaters</span>
                <select
                  className="think-tank-select"
                  value={config.debater_count}
                  onChange={(e) =>
                    setConfig((prev) => setDebaterCount(prev, Number(e.target.value)))
                  }
                >
                  {Array.from({ length: MAX_DEBATERS - MIN_DEBATERS + 1 }, (_, i) => MIN_DEBATERS + i).map((n) => (
                    <option key={n} value={n}>
                      {n} debaters + Moderator
                    </option>
                  ))}
                </select>
              </label>
              <label className="think-tank-field" style={{ flex: '1 1 120px' }}>
                <span className="think-tank-label">Min cycles</span>
                <input
                  className="think-tank-input"
                  type="number"
                  min={2}
                  max={10}
                  value={config.min_cycles}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, min_cycles: Math.max(2, Number(e.target.value) || 2) }))
                  }
                />
              </label>
              <label className="think-tank-field" style={{ flex: '1 1 120px' }}>
                <span className="think-tank-label">Max cycles</span>
                <input
                  className="think-tank-input"
                  type="number"
                  min={2}
                  max={10}
                  value={config.max_cycles}
                  onChange={(e) =>
                    setConfig((p) => ({
                      ...p,
                      max_cycles: Math.min(10, Math.max(p.min_cycles, Number(e.target.value) || 10)),
                    }))
                  }
                />
              </label>
            </div>
          </div>

          <div className="think-tank-row" style={{ marginBottom: 10 }}>
            <button type="button" className="think-tank-btn think-tank-btn-ghost" onClick={() => void refreshOllama()}>
              Refresh Ollama models
            </button>
            <span className="think-tank-muted">{ollamaHint}</span>
          </div>

          <h3 className="think-tank-label" style={{ margin: '0 0 8px' }}>
            Debaters
          </h3>
          <div className="think-tank-grid seats">
            {debaterSeats.map((seat) => {
              const index = config.seats.findIndex((s) => s.id === seat.id)
              return (
                <div key={seat.id} className="think-tank-card">
                  <h3>{seat.label || seat.id}</h3>
                  <div className="think-tank-field">
                    <span className="think-tank-label">Seat label</span>
                    <input
                      className="think-tank-input"
                      value={seat.label}
                      onChange={(e) => updateSeat(index, { label: e.target.value })}
                    />
                  </div>
                  <div className="think-tank-field">
                    <span className="think-tank-label">Persona file</span>
                    <select
                      className="think-tank-select"
                      value={seat.agent}
                      onChange={(e) => updateSeat(index, { agent: e.target.value })}
                    >
                      {personaSelectOptions(seat.agent).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                          {p.hint ? ` — ${p.hint}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <SeatModelFields
                    seat={seat}
                    ollamaModels={ollamaModels}
                    onChange={(patch) => updateSeat(index, patch)}
                  />
                  <div className="think-tank-field">
                    <span className="think-tank-label">Extra instructions (optional)</span>
                    <textarea
                      className="think-tank-textarea"
                      value={seat.persona ?? ''}
                      onChange={(e) => updateSeat(index, { persona: e.target.value })}
                      placeholder="Extra system prompt for this seat"
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {moderatorSeat ?
            <>
              <h3 className="think-tank-label" style={{ margin: '16px 0 8px' }}>
                Moderator (advisory — not scored)
              </h3>
              <div className="think-tank-grid seats">
                <div className="think-tank-card">
                  <h3>{moderatorSeat.label}</h3>
                  <p className="think-tank-muted" style={{ marginBottom: 8 }}>
                    Compares debaters, proposes research/tests. Speaks last each cycle.
                  </p>
                  <div className="think-tank-field">
                    <span className="think-tank-label">Persona file</span>
                    <select
                      className="think-tank-select"
                      value={moderatorSeat.agent}
                      onChange={(e) => {
                        const idx = config.seats.findIndex((s) => s.id === moderatorSeat.id)
                        updateSeat(idx, { agent: e.target.value })
                      }}
                    >
                      {personaSelectOptions(moderatorSeat.agent).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                          {p.hint ? ` — ${p.hint}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <SeatModelFields
                    seat={moderatorSeat}
                    ollamaModels={ollamaModels}
                    onChange={(patch) => {
                      const idx = config.seats.findIndex((s) => s.id === moderatorSeat.id)
                      updateSeat(idx, patch)
                    }}
                  />
                  <div className="think-tank-field">
                    <span className="think-tank-label">Extra instructions (optional)</span>
                    <textarea
                      className="think-tank-textarea"
                      value={moderatorSeat.persona ?? ''}
                      onChange={(e) => {
                        const idx = config.seats.findIndex((s) => s.id === moderatorSeat.id)
                        updateSeat(idx, { persona: e.target.value })
                      }}
                      placeholder="Extra system prompt for Moderator"
                    />
                  </div>
                </div>
              </div>
            </>
          : null}

          <div className="think-tank-row" style={{ marginTop: 12 }}>
            <button type="button" className="think-tank-btn" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save think tank settings'}
            </button>
          </div>
          {status ?
            <p className={`think-tank-msg ${status.kind}`}>{status.text}</p>
          : null}
        </>
      : <>
          <div className="think-tank-card">
            <h3>Past sessions</h3>
            <p className="think-tank-muted">
              Every think tank run is stored in Sylo&apos;s local database and replayed in the chat thread (color-coded
              turns + final reports). There is no global keyword search — you choose what carries forward.
            </p>
          </div>

          <div className="think-tank-card">
            <h3>Continue a thread (recommended)</h3>
            <p className="think-tank-muted">
              To build on a prior debate, paste the relevant final report (or export) into{' '}
              <code>sylo_think_tank_run</code> <strong>context</strong> and ask a new question in{' '}
              <strong>topic</strong>. Seats see only what you pass — full prose beats search snippets.
            </p>
            <pre className="think-tank-pre" style={{ marginTop: 10 }}>{`{
  "topic": "Given the prior think tank, should we change the 0.95 PF gate?",
  "context": "Prior Debater 1 final report (excerpt): …\\n\\nPrior Moderator outcomes: …"
}`}</pre>
          </div>

          <div className="think-tank-card">
            <h3>Final reports & the decision brief</h3>
            <p className="think-tank-muted">
              After a run finishes, the chat thread shows every color-coded debate turn (clickable to expand) and the
              three final reports. The <strong>Moderator</strong> final report is the decision brief — that is what you
              actually read and act on. Debater reports are supporting perspectives. The session finalizes
              automatically when reports are ready; there is no “pick a winner” step in the UI, and an accidental
              click on a final report only expands/collapses it (nothing destructive). To carry a conclusion into a
              follow-up run, paste the relevant final report into <code>sylo_think_tank_run</code>{' '}
              <strong>context</strong>.
            </p>
          </div>
        </>
      }
    </div>
  )
}
