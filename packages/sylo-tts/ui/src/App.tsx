import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { bridge, localFileUrl, type SpeechGeneration, type TtsVoice } from './bridge'

const BACKEND_LABELS: Record<string, string> = {
  kokoro: 'Kokoro',
  orpheus: 'Orpheus',
}

const GENERATIONS_KEY = 'route-generations'
const CONFIG_DEBOUNCE_MS = 400

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function textPreview(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return '(empty)'
  return t.length > 80 ? `${t.slice(0, 77)}…` : t
}

function parseGenerations(raw: unknown): SpeechGeneration[] {
  if (!Array.isArray(raw)) return []
  const out: SpeechGeneration[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const g = row as Record<string, unknown>
    const id = typeof g.id === 'string' ? g.id : ''
    const wavPath = typeof g.wavPath === 'string' ? g.wavPath : ''
    if (!id || !wavPath) continue
    out.push({
      id,
      wavPath,
      voiceLabel: typeof g.voiceLabel === 'string' ? g.voiceLabel : 'Speech',
      voiceId: typeof g.voiceId === 'string' ? g.voiceId : '',
      textPreview: typeof g.textPreview === 'string' ? g.textPreview : '',
      createdAt: typeof g.createdAt === 'number' ? g.createdAt : 0,
    })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export function RouteAudioPlayer({
  wavPath,
  label,
}: {
  wavPath: string
  label: string
}): React.ReactElement {
  const ref = useRef<HTMLAudioElement>(null)
  const src = localFileUrl(wavPath)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    if (ref.current) ref.current.volume = volume
  }, [volume, src])

  const toggle = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }, [])

  const downloadName =
    (label || 'speech').replace(/[^\w.-]+/g, '_').slice(0, 48) + '.wav'

  const saveAudio = useCallback(async () => {
    try {
      await bridge.saveAudio({ sourcePath: wavPath, suggestedName: downloadName })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'cancelled') console.error('save audio failed:', msg)
    }
  }, [downloadName, wavPath])

  return (
    <div className="audio-player">
      <div style={{ fontSize: '0.85rem', marginBottom: 8, color: 'var(--color-text-muted)' }}>
        {label}
      </div>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrent(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(ref.current?.duration ?? 0)}
        onEnded={() => setPlaying(false)}
      />
      <div className="audio-controls">
        <button type="button" onClick={toggle}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => void saveAudio()}>
          Download
        </button>
        <span className="audio-time">
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>
      <label className="speech-label">
        Seek
        <input
          type="range"
          className="audio-slider"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.05}
          value={Math.min(current, duration || 0)}
          onChange={(e) => {
            const t = Number(e.target.value)
            if (ref.current) ref.current.currentTime = t
            setCurrent(t)
          }}
        />
      </label>
      <label className="speech-label">
        Volume
        <input
          type="range"
          className="audio-slider"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </label>
    </div>
  )
}

export function App(): React.ReactElement {
  const [text, setText] = useState('')
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [voiceId, setVoiceId] = useState('kokoro-am_michael')
  const [kokoroSpeed, setKokoroSpeed] = useState(1)
  const [orpheusTemperature, setOrpheusTemperature] = useState(0.8)
  const [orpheusTopP, setOrpheusTopP] = useState(0.95)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generations, setGenerations] = useState<SpeechGeneration[]>([])
  const configHydrated = useRef(false)
  const configSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [list, cfg, stored] = await Promise.all([
          bridge.listVoices(),
          bridge.configGet(),
          bridge.readSkillData(GENERATIONS_KEY),
        ])
        setVoices(list)
        const uiVoice =
          typeof cfg.ui_voice_id === 'string' && cfg.ui_voice_id.trim() ?
            cfg.ui_voice_id.trim()
          : typeof cfg.default_voice_id === 'string' && cfg.default_voice_id ?
            cfg.default_voice_id
          : 'kokoro-am_michael'
        const knownIds = new Set(list.map((v) => v.id))
        setVoiceId(knownIds.has(uiVoice) ? uiVoice : (list[0]?.id ?? uiVoice))
        if (typeof cfg.kokoro_speed === 'number') setKokoroSpeed(cfg.kokoro_speed)
        if (typeof cfg.orpheus_temperature === 'number') {
          setOrpheusTemperature(cfg.orpheus_temperature)
        }
        if (typeof cfg.orpheus_top_p === 'number') setOrpheusTopP(cfg.orpheus_top_p)
        setGenerations(parseGenerations(stored))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        configHydrated.current = true
      }
    })()
  }, [])

  useEffect(() => {
    if (!configHydrated.current) return
    if (configSaveTimer.current) clearTimeout(configSaveTimer.current)
    configSaveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const cfg = await bridge.configGet()
          await bridge.configSave({
            ...cfg,
            ui_voice_id: voiceId,
            kokoro_speed: kokoroSpeed,
            orpheus_temperature: orpheusTemperature,
            orpheus_top_p: orpheusTopP,
          })
        } catch {
          /* silent — operator can retry by changing a setting again */
        }
      })()
    }, CONFIG_DEBOUNCE_MS)
    return () => {
      if (configSaveTimer.current) clearTimeout(configSaveTimer.current)
    }
  }, [voiceId, kokoroSpeed, orpheusTemperature, orpheusTopP])

  const persistGenerations = useCallback(async (next: SpeechGeneration[]) => {
    setGenerations(next)
    await bridge.writeSkillData(GENERATIONS_KEY, next)
  }, [])

  const selectedVoice = useMemo(
    () => voices.find((v) => v.id === voiceId) ?? null,
    [voices, voiceId],
  )
  const selectedBackend = selectedVoice?.backend ?? 'kokoro'

  const voiceGroups = useMemo(() => {
    const order = ['kokoro', 'orpheus']
    const byBackend = new Map<string, TtsVoice[]>()
    for (const v of voices) {
      const key = v.backend || 'other'
      const list = byBackend.get(key) ?? []
      list.push(v)
      byBackend.set(key, list)
    }
    return order
      .filter((b) => byBackend.has(b))
      .map((b) => ({ backend: b, label: BACKEND_LABELS[b] ?? b, voices: byBackend.get(b)! }))
  }, [voices])

  const onGenerate = async () => {
    setError(null)
    setBusy(true)
    try {
      const out = await bridge.generate({
        text,
        voice_id: voiceId,
        kokoro_speed: kokoroSpeed,
        orpheus_temperature: orpheusTemperature,
        orpheus_top_p: orpheusTopP,
      })
      const gen: SpeechGeneration = {
        id: crypto.randomUUID(),
        wavPath: out.wavPath,
        voiceLabel: out.voiceLabel,
        voiceId: out.voiceId,
        textPreview: textPreview(text),
        createdAt: Date.now(),
      }
      const next = [gen, ...generations]
      await persistGenerations(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onRemoveGeneration = async (id: string) => {
    setError(null)
    const hit = generations.find((g) => g.id === id)
    if (!hit) return
    try {
      await bridge.deleteRouteClip(hit.wavPath)
    } catch {
      /* file may already be gone */
    }
    try {
      await persistGenerations(generations.filter((g) => g.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="speech-app">
      <h1 className="speech-title">Speech</h1>
      <p className="speech-sub">
        Paste text, pick a voice, generate local audio. Voice and settings are remembered. Generations
        stay until you remove them.
      </p>

      <div className="speech-row">
        <label className="speech-label" htmlFor="speech-text">
          Text
        </label>
        <textarea
          id="speech-text"
          className="speech-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Text to speak…"
        />
      </div>

      <div className="speech-row">
        <label className="speech-label" htmlFor="speech-voice">
          Voice
        </label>
        <select
          id="speech-voice"
          className="speech-select"
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
        >
          {voiceGroups.map((group) => (
            <optgroup key={group.backend} label={group.label}>
              {group.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {selectedBackend === 'kokoro' ?
        <div className="speech-row">
          <label className="speech-label" htmlFor="speech-speed">
            Speed <span className="speech-value">{kokoroSpeed.toFixed(2)}×</span>
          </label>
          <input
            id="speech-speed"
            className="audio-slider"
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={kokoroSpeed}
            onChange={(e) => setKokoroSpeed(Number(e.target.value))}
          />
          <p className="speech-hint">0.5 = slower · 1.0 = normal · 2.0 = faster</p>
        </div>
      : null}

      {selectedBackend === 'orpheus' ?
        <>
          <div className="speech-row">
            <label className="speech-label" htmlFor="speech-temp">
              Temperature <span className="speech-value">{orpheusTemperature.toFixed(2)}</span>
            </label>
            <input
              id="speech-temp"
              className="audio-slider"
              type="range"
              min={0.3}
              max={1.2}
              step={0.05}
              value={orpheusTemperature}
              onChange={(e) => setOrpheusTemperature(Number(e.target.value))}
            />
            <p className="speech-hint">Lower = steadier/cleaner · higher = more expressive</p>
          </div>
          <div className="speech-row">
            <label className="speech-label" htmlFor="speech-top-p">
              Top P <span className="speech-value">{orpheusTopP.toFixed(2)}</span>
            </label>
            <input
              id="speech-top-p"
              className="audio-slider"
              type="range"
              min={0.7}
              max={1}
              step={0.01}
              value={orpheusTopP}
              onChange={(e) => setOrpheusTopP(Number(e.target.value))}
            />
          </div>
        </>
      : null}

      <div className="speech-actions">
        <button type="button" className="speech-btn" disabled={busy || !text.trim()} onClick={() => void onGenerate()}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error ?
        <p className="speech-error">{error}</p>
      : null}

      {generations.length > 0 ?
        <section className="speech-generations">
          <h2 className="speech-section-title">Generations</h2>
          {generations.map((g) => (
            <article key={g.id} className="speech-generation">
              <div className="speech-generation-head">
                <p className="speech-generation-preview">{g.textPreview}</p>
                <button
                  type="button"
                  className="speech-btn-remove"
                  onClick={() => void onRemoveGeneration(g.id)}
                >
                  Remove
                </button>
              </div>
              <RouteAudioPlayer wavPath={g.wavPath} label={g.voiceLabel} />
            </article>
          ))}
        </section>
      : null}
    </div>
  )
}
