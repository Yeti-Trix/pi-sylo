/**
 * §5.1 Generate composer — prompt textarea (Ctrl/⌘+Enter submits), Draft ⇄
 * Final segmented control (MJ draft-mode analog), model dropdown (catalog ∩
 * detected, license badges), count 1–4, job card with elapsed + poll spinner,
 * result strip (thumbnail / favorite ★ / Open detail / Send to agent / Copy
 * path / Delete), draft→final banner with per-pick rerun. Shoulds folded:
 * aspect chips, seed lock, per-model negative (hidden on z-image), recent
 * prompts, auto-tag toggle. Could-tier chips (style presets, reference drop,
 * token counter, surprise-me) are absent per plan.
 *
 * The route NEVER resolves the request itself: it sends the same input shape
 * the agent tool sends; host main's imagegen-host builds GenRequestInput via
 * resolveGenRequest (catalog defaults on preset change — §3 note 2) and owns
 * the job. Rerun-as-final = generate({ from_image_id, preset:'final' })
 * exactly — the parent's draft steps never leak onto the final model.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  bridge,
  fmtElapsed,
  localFileUrl,
  type ImagegenCatalogEntry,
  type ImagegenConfig,
  type ImagegenHealth,
  type ImagegenJob,
  type ImagePreset,
} from '../bridge'
import type { RemixRequest } from '../App'

const ASPECTS = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'] as const
const RECENTS_KEY = 'route-recent-prompts'
const DRAFT_KEY = 'route-draft'
const CONFIG_DEBOUNCE_MS = 400

interface DraftPrefs {
  prompt: string
  preset: ImagePreset
  model: string
  count: number
  aspect: string
  seed: string
  seed_lock: boolean
  negative: string
}

function parseDraft(raw: unknown): Partial<DraftPrefs> | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as Partial<DraftPrefs>
}

/** Models that ignore negative prompts (flow-matching, no negative input). */
function modelIgnoresNegative(entry: ImagegenCatalogEntry | undefined): boolean {
  return entry?.family === 'z-image'
}

export function GenerateScreen({
  catalog,
  detected,
  config,
  health,
  remix,
  onOpenDetail,
  onChanged,
}: {
  catalog: ImagegenCatalogEntry[]
  detected: Record<string, boolean> | null
  config: ImagegenConfig | null
  health: ImagegenHealth | null
  remix: RemixRequest | null
  onOpenDetail: (imageId: string) => void
  onChanged: () => void
}): React.ReactElement {
  const [prompt, setPrompt] = useState('')
  const [preset, setPreset] = useState<ImagePreset>('draft')
  const [model, setModel] = useState('')
  const [count, setCount] = useState(2)
  const [aspect, setAspect] = useState('1:1')
  const [seed, setSeed] = useState('')
  const [seedLock, setSeedLock] = useState(false)
  const [negative, setNegative] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [showRecent, setShowRecent] = useState(false)
  const hydrateDone = useRef(false)
  const savedPrefs = useRef<Partial<DraftPrefs> | null>(null)

  const [job, setJob] = useState<ImagegenJob | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [favIds, setFavIds] = useState<Record<string, boolean>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [tick, setTick] = useState(0)

  // Hydrate prefs once; record what was saved so config defaults don't clobber them.
  useEffect(() => {
    void (async () => {
      try {
        const [draftRaw, recentsRaw] = await Promise.all([
          bridge.readSkillData(DRAFT_KEY),
          bridge.readSkillData(RECENTS_KEY),
        ])
        const d = parseDraft(draftRaw)
        if (d) savedPrefs.current = d
        if (d) {
          if (typeof d.prompt === 'string' && d.prompt) setPrompt(d.prompt)
          if (d.preset === 'draft' || d.preset === 'final') setPreset(d.preset)
          if (typeof d.model === 'string' && d.model) setModel(d.model)
          if (typeof d.count === 'number' && d.count >= 1 && d.count <= 4) setCount(Math.floor(d.count))
          if (typeof d.aspect === 'string' && d.aspect) setAspect(d.aspect)
          if (typeof d.seed === 'string' && d.seed) setSeed(d.seed)
          if (d.seed_lock === true) setSeedLock(true)
          if (typeof d.negative === 'string') setNegative(d.negative)
        }
        if (Array.isArray(recentsRaw)) setRecent(recentsRaw.filter((r): r is string => typeof r === 'string').slice(0, 8))
      } catch {
        /* prefs are polish */
      } finally {
        hydrateDone.current = true
        setTick((n) => n + 1)
        // Config default aspect applies only when prefs never stored one (hydrateDone
        // re-render below + config may still be loading → second effect handles it).
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Config-driven defaults after hydration (never over saved prefs). Model
  // defaults follow preset switches only while the operator has no explicit pick.
  const configDefaultsApplied = useRef(false)
  useEffect(() => {
    if (!config || !hydrateDone.current || configDefaultsApplied.current) return
    configDefaultsApplied.current = true
    if (!savedPrefs.current?.aspect && config.default_aspect) setAspect(config.default_aspect)
  }, [config])

  useEffect(() => {
    if (!config || !hydrateDone.current) return
    if (model) return // explicit pick wins
    const want = preset === 'draft' ? config.draft_model : config.final_model
    if (want && want !== model) setModel(want)
  }, [preset, config, model])

  // Debounced draft persistence (Speech route's config-save pattern).
  useEffect(() => {
    if (!hydrateDone.current) return
    const t = setTimeout(() => {
      void bridge
        .writeSkillData(DRAFT_KEY, { prompt, preset, model, count, aspect, seed, seed_lock: seedLock, negative })
        .catch(() => {})
    }, CONFIG_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [prompt, preset, model, count, aspect, seed, seedLock, negative])

  // Remix adoption (§5.3): load the parent record's params into the composer.
  useEffect(() => {
    if (!remix) return
    const r = remix.record
    setPrompt(r.prompt ?? '')
    setModel(r.model)
    setPreset(remix.presetOverride ?? r.preset)
    if (r.negative_prompt) setNegative(r.negative_prompt)
    if (r.params.aspect) setAspect(r.params.aspect)
    if (Number.isFinite(r.params.seed) && r.params.seed > 0) {
      setSeed(String(r.params.seed))
      setSeedLock(true)
    }
  }, [remix])

  // Elapsed ticker while a job runs.
  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'running')) {
      const t = setInterval(() => setTick((n) => n + 1), 1000)
      return () => clearInterval(t)
    }
  }, [job])
  void tick // re-render only

  // Release pollers on unmount.
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current)
    },
    [],
  )

  const selectedEntry = useMemo(() => catalog.find((m) => m.id === model), [catalog, model])
  const availableModels = useMemo(() => {
    const list = catalog.filter((m) => !detected || detected[m.id] === true)
    return list.length > 0 ? list : catalog
  }, [catalog, detected])

  const pushRecent = useCallback(async (p: string) => {
    setRecent((prev) => {
      const next = [p, ...prev.filter((r) => r !== p)].slice(0, 8)
      void bridge.writeSkillData(RECENTS_KEY, next).catch(() => {})
      return next
    })
  }, [])

  const startPolling = useCallback(
    (jobId: string) => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const j = await bridge.jobGet(jobId)
            setJob(j)
            if (j.status === 'done' || j.status === 'error') {
              if (pollRef.current) clearInterval(pollRef.current)
              pollRef.current = null
              onChanged()
              if (j.status === 'done') setToast(`${j.outputs.length} image(s) saved to the library.`)
              else setJobError(j.error ?? 'generation failed')
            }
          } catch (e) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setJobError(e instanceof Error ? e.message : String(e))
            onChanged()
          }
        })()
      }, 1500)
    },
    [onChanged],
  )

  const submit = useCallback(
    async (extra?: Partial<{ from_image_id: string; preset: ImagePreset; prompt: string }>) => {
      setJobError(null)
      setSubmitting(true)
      try {
        const composed = {
          prompt: (extra?.prompt !== undefined ? extra.prompt : prompt).trim(),
          preset: extra?.preset ?? preset,
          ...(model ? { model } : {}),
          negative_prompt: modelIgnoresNegative(selectedEntry) ? undefined : negative.trim() || undefined,
          aspect,
          ...(extra?.from_image_id ? { from_image_id: extra.from_image_id } : {}),
          count,
          ...(seedLock && seed.trim() ? { seed: Number(seed) } : {}),
        }
        const startedJob = await bridge.generate(composed)
        setJob(startedJob)
        setToast(null)
        const text = composed.prompt
        if (text) void pushRecent(text)
        startPolling(startedJob.id)
      } catch (e) {
        setJobError(e instanceof Error ? e.message : String(e))
        onChanged()
      } finally {
        setSubmitting(false)
      }
    },
    [prompt, preset, model, negative, aspect, count, seed, seedLock, selectedEntry, pushRecent, startPolling, onChanged],
  )

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  /** §5.1 result strip actions. */
  const toggleFavorite = async (id: string, favorite: boolean) => {
    try {
      await bridge.imageUpdate({ image_id: id, favorite: !favorite })
      setFavIds((prev) => ({ ...prev, [id]: !favorite }))
      onChanged()
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteOutput = async (id: string) => {
    if (!window.confirm('Delete this image from the library (file + record)?')) return
    try {
      await bridge.imageDelete(id)
      setJob((j) => (j ? { ...j, outputs: j.outputs.filter((o) => o.id !== id) } : j))
      onChanged()
      setToast('Deleted.')
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const sendToAgent = async (id: string, path: string) => {
    try {
      await bridge.sendToAgent({
        note: 'Operator sent this library image to the agent for a remix.',
        image_id: id,
        image_path: path,
        ...(selectedEntry ? { model: selectedEntry.id } : {}),
        seed: seedLock && seed.trim() ? Number(seed) : undefined,
        request:
          `Remix library image ${id} with sylo_image_gen_generate (from_image_id=${id}). ` +
          'Ask the operator what to change if their message is not clear.',
      })
      setToast('Sent to agent — check the chat.')
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const copyPath = async (p: string) => {
    try {
      await navigator.clipboard.writeText(p)
      setToast('Path copied.')
    } catch {
      setToast(p) // clipboard may be blocked in the iframe — surface the path itself
    }
  }

  const reveal = async (id: string) => {
    try {
      await bridge.revealFile(id)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const jobLive = !!job && (job.status === 'queued' || job.status === 'running')
  const showDraftBanner = !!job && job.status === 'done' && job.preset === 'draft' && job.outputs.length > 0

  return (
    <section className="ig-panel">
      <div className="ig-field">
        <label className="ig-label" htmlFor="ig-prompt">
          Prompt <span className="ig-hint-inline">Ctrl/⌘+Enter to generate</span>
        </label>
        <textarea
          id="ig-prompt"
          className="ig-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder="Describe what to depict — full descriptive sentence(s). Put text to render inside quotes for Qwen-Image."
        />
        <div className="ig-hint-row">
          {recent.length > 0 ? (
            <button type="button" className="ig-btn-ghost" onClick={() => setShowRecent((s) => !s)}>
              {showRecent ? 'Hide recent prompts' : `Recent prompts (${recent.length})`}
            </button>
          ) : null}
          {config ? (
            <label className="ig-check">
              <input
                type="checkbox"
                checked={config.auto_tag_preset}
                onChange={() => {
                  void (async () => {
                    try {
                      const r = await bridge.configSave({ ...config, auto_tag_preset: !config.auto_tag_preset })
                      if (!r.ok) throw new Error(r.error)
                    } catch (e) {
                      setToast(e instanceof Error ? e.message : String(e))
                    }
                  })()
                }}
              />
              auto-tag preset
            </label>
          ) : null}
        </div>
        {showRecent && recent.length > 0 ? (
          <ul className="ig-recents">
            {recent.map((r) => (
              <li key={r}>
                <button
                  type="button"
                  className="ig-btn-ghost"
                  onClick={() => {
                    setPrompt(r)
                    setShowRecent(false)
                  }}
                >
                  {r.length > 90 ? `${r.slice(0, 87)}…` : r}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="ig-row">
        <div className="ig-field ig-grow">
          <span className="ig-label">Preset</span>
          <div className="ig-segmented" role="tablist" aria-label="Preset">
            {(['draft', 'final'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={preset === p}
                className={preset === p ? 'ig-seg ig-seg-active' : 'ig-seg'}
                onClick={() => setPreset(p)}
              >
                {p === 'draft' ? 'Draft (fast, low-res)' : 'Final (commit)'}
              </button>
            ))}
          </div>
        </div>
        <div className="ig-field">
          <span className="ig-label">Count</span>
          <div className="ig-segmented">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                className={count === n ? 'ig-seg ig-seg-active' : 'ig-seg'}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ig-row">
        <div className="ig-field ig-grow">
          <label className="ig-label" htmlFor="ig-model">
            Model {availableModels.length !== catalog.length ? <span className="ig-hint-inline">catalog ∩ detected</span> : null}
          </label>
          <select id="ig-model" className="ig-select" value={model} onChange={(e) => setModel(e.target.value)}>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.role === 'draft' ? '· draft' : m.role === 'final' ? '· final' : ''}
                {m.commercial_ok ? '' : ' · non-commercial'}
                {m.approx_size_gb ? ` · ~${m.approx_size_gb} GB` : ''}
              </option>
            ))}
          </select>
          {selectedEntry ? (
            <p className="ig-hint">
              {selectedEntry.license} · {selectedEntry.strengths ?? ''}
            </p>
          ) : null}
        </div>
        <div className="ig-field">
          <span className="ig-label">Aspect</span>
          <div className="ig-chips">
            {ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                className={aspect === a ? 'ig-chip ig-chip-active' : 'ig-chip'}
                onClick={() => setAspect(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ig-row ig-row-wrap">
        <div className="ig-field">
          <label className="ig-label" htmlFor="ig-seed">
            Seed {seedLock ? '🔒' : ''}
          </label>
          <div className="ig-seed-row">
            <input
              id="ig-seed"
              className="ig-input ig-input-num"
              type="text"
              inputMode="numeric"
              placeholder="random"
              value={seed}
              onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
            />
            <button
              type="button"
              className={seedLock ? 'ig-chip ig-chip-active' : 'ig-chip'}
              title="Lock the seed so reruns reproduce composition"
              onClick={() => setSeedLock((s) => !s)}
            >
              lock
            </button>
          </div>
        </div>
        {!modelIgnoresNegative(selectedEntry) ? (
          <div className="ig-field ig-grow">
            <label className="ig-label" htmlFor="ig-negative">
              Negative prompt
            </label>
            <input
              id="ig-negative"
              className="ig-input"
              type="text"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="Things to avoid (optional)"
            />
          </div>
        ) : (
          <p className="ig-hint ig-grow">This model ignores negative prompts (flow-matching, no negative input).</p>
        )}
      </div>

      <div className="ig-actions">
        <button type="button" className="ig-btn" disabled={submitting || !prompt.trim()} onClick={() => void submit()}>
          {submitting || jobLive ? 'Generating…' : `Generate ${preset}`}
        </button>
        {health && !health.ok ? <span className="ig-hint-inline ig-warn-inline">ComfyUI offline — check Settings</span> : null}
      </div>

      {job ? (
        <div className="ig-jobcard" data-status={job.status}>
          {jobLive ? (
            <span className="ig-spinner" role="status" aria-label="generating" />
          ) : (
            <span className="ig-jobdot" data-status={job.status} />
          )}
          <div className="ig-jobbody">
            <div className="ig-jobhead">
              <strong>
                {job.model} · {job.preset} · {job.count} image(s)
              </strong>
              <span className="ig-jobmeta">elapsed {fmtElapsed(job.elapsed_ms)}</span>
            </div>
            <p className="ig-jobprompt">{job.prompt.length > 110 ? `${job.prompt.slice(0, 107)}…` : job.prompt}</p>
            {job.status === 'error' ? <p className="ig-error">{job.error ?? 'generation failed'}</p> : null}
            {job.status === 'done' && job.outputs.length > 0 ? (
              <p className="ig-hint">
                saved · {fmtElapsed(job.outputs[0]?.gen_ms ?? 0)} per image · seed {job.outputs.map((o) => o.seed).join(', ')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {jobError ? <p className="ig-error">{jobError}</p> : null}

      {showDraftBanner ? (
        <div className="ig-banner">
          Drafts are fast/low-res. <strong>Rerun as final</strong> on a pick — steps and size upgrade to the configured
          final model.
        </div>
      ) : null}

      {job && job.outputs.length ? (
        <div className="ig-strip">
          {job.outputs.map((o) => (
            <figure key={o.id} className="ig-thumb">
              <img src={localFileUrl(o.path)} alt={job.prompt.slice(0, 60)} loading="lazy" />
              <figcaption className="ig-thumb-cap">
                <span className="ig-thumb-meta">
                  {o.width}×{o.height} · seed {o.seed}
                </span>
                <div className="ig-thumb-actions">
                  <button
                    type="button"
                    className="ig-iconbtn"
                    title={favIds[o.id] ? 'Unfavorite' : 'Favorite'}
                    onClick={() => void toggleFavorite(o.id, !!favIds[o.id])}
                  >
                    {favIds[o.id] ? '★' : '☆'}
                  </button>
                  <button type="button" className="ig-iconbtn" title="Open detail" onClick={() => onOpenDetail(o.id)}>
                    ⤢
                  </button>
                  <button
                    type="button"
                    className="ig-iconbtn"
                    title="Send to agent (remix in chat)"
                    onClick={() => void sendToAgent(o.id, o.path)}
                  >
                    ✈
                  </button>
                  <button type="button" className="ig-iconbtn" title="Copy path" onClick={() => void copyPath(o.path)}>
                    ⧉
                  </button>
                  <button type="button" className="ig-iconbtn" title="Reveal in Explorer" onClick={() => void reveal(o.id)}>
                    ➘
                  </button>
                  <button
                    type="button"
                    className="ig-iconbtn ig-iconbtn-danger"
                    title="Delete"
                    onClick={() => void deleteOutput(o.id)}
                  >
                    ✕
                  </button>
                  {showDraftBanner ? (
                    <button
                      type="button"
                      className="ig-iconbtn ig-iconbtn-go"
                      title="Rerun as final (upgrades to the configured final model)"
                      onClick={() => void submit({ from_image_id: o.id, preset: 'final' })}
                    >
                      ↻final
                    </button>
                  ) : null}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {toast ? <p className="ig-toast">{toast}</p> : null}
    </section>
  )
}