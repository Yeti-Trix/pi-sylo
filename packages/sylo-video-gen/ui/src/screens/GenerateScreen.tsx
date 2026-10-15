/**
 * §5.6 Generate composer — the sylo-image-gen GenerateScreen twin with video
 * semantics: the MODE segmented control (Clip · Living photo · Restyle —
 * v1's three preset-graph modes, §1) sits above the composer; per-mode
 * controls ride the mode (loop = duration chips + motion-strength + REQUIRED
 * source still; restyle = strength + REQUIRED source clip; clip = draft/final
 * preset chips + t2v, or i2v when a source still is given); mode-aware model
 * dropdown (catalog ∩ detected + license badges); job card with honest
 * elapsed + poll (§4.3); result strip of native <video preload="metadata">
 * thumbs with hover-play (muted — v1 clips carry no audio); a draft→final
 * banner with per-pick rerun; and the §4.3 RENDER-LEDGER card (recent durable
 * job rows + live ComfyUI queue status + replay — the v1 "queue/jobs card"
 * while the full Queue screen stays v2/§6).
 *
 * The route NEVER resolves the request itself: it sends the same raw input
 * shape the agent tool sends; host main's videogen-host builds
 * VideoGenRequestInput via coerceVideoGenRequest + resolveVideoGenRequest
 * (§5.2), owns the job + the durable ledger row, and surfaces preflight
 * refusals as the job's error text. Rerun-as-final = generate({
 * from_video_id, preset:'final' }) — lineage + inheritance, never a resubmit
 * of the parent's job. One submit in flight at a time (clips cost GPU
 * minutes; §7 long-queue UX).
 *
 * NOTE vs imagegen: the sandboxed route iframe (allow-scripts, no
 * allow-modals) silently blocks window.confirm — destructive actions here use
 * inline two-step confirm state instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import {
  bridge,
  fmtElapsed,
  fmtHMM,
  fmtTime,
  hoverPreviewStart,
  hoverPreviewStop,
  localFileUrl,
  MODE_LABELS,
  type VideoMode,
  type VideogenCatalogEntry,
  type VideogenConfig,
  type VideogenHealth,
  type VideogenJobSnapshot,
  type VideogenReplayResult,
  type VideoRecord,
  type VideoPreset,
} from '../bridge'

const RECENTS_KEY = 'route-recent-prompts'
const DRAFT_KEY = 'route-draft'
const CONFIG_DEBOUNCE_MS = 400
const LEDGER_PAGE = 8

/** Remix payload the Detail drawer hands back to the composer (§5.6 Remix/Restyle). */
export interface RemixRequest {
  record: VideoRecord
  /** Drawer "Restyle this clip" → composer mode restyle with the record as the source. */
  asRestyle?: boolean
}

const DURATIONS = [4, 5, 8] as const

/** "C:\dir\file.mp4" / "\\server\share" / "/abs" look like paths; single words look like library ids. */
function looksLikePath(v: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('\\\\') || v.startsWith('/')
}

interface DraftPrefs {
  prompt: string
  mode: string
  preset: string
  model: string
  count: number
  duration: number
  orientation: string
  resolution: string
  framerate: string
  seed: string
  seed_lock: boolean
  negative: string
  loop_motion: number
  restyle_strength: number
  source_still: string
  source_video: string
}

function parseDraft(raw: unknown): Partial<DraftPrefs> | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as Partial<DraftPrefs>
}

export function GenerateScreen({
  catalog,
  detected,
  config,
  health,
  refreshKey,
  remix,
  onOpenDetail,
  onChanged,
}: {
  catalog: VideogenCatalogEntry[]
  detected: Record<string, boolean> | null
  config: VideogenConfig | null
  health: VideogenHealth | null
  refreshKey: number
  remix: RemixRequest | null
  onOpenDetail: (videoId: string) => void
  onChanged: () => void
}): ReactElement {
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<VideoMode>('clip')
  const [preset, setPreset] = useState<VideoPreset>('draft')
  const [model, setModel] = useState('')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState(5)
  const [orientation, setOrientation] = useState('landscape')
  const [resolution, setResolution] = useState('720p')
  const [framerate, setFramerate] = useState('') // '' = model default
  const [seed, setSeed] = useState('')
  const [seedLock, setSeedLock] = useState(false)
  const [negative, setNegative] = useState('')
  const [loopMotion, setLoopMotion] = useState(0.5)
  const [restyleStrength, setRestyleStrength] = useState(0.5)
  const [sourceStill, setSourceStill] = useState('')
  const [sourceVideo, setSourceVideo] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [showRecent, setShowRecent] = useState(false)
  const hydrateDone = useRef(false)
  const savedPrefs = useRef<Partial<DraftPrefs> | null>(null)
  /** Operator picked a model explicitly — stops config/mode pairing until the mode changes. */
  const modelTouched = useRef(false)
  const modeRef = useRef<VideoMode>('clip')

  const [job, setJob] = useState<VideogenJobSnapshot | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [favIds, setFavIds] = useState<Record<string, boolean>>({})
  const [deleteAskId, setDeleteAskId] = useState<string | null>(null)
  const [sentStill, setSentStill] = useState<string>('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [tick, setTick] = useState(0)

  // ── Render ledger card (§4.3) ──────────────────────────────────────────────
  const [ledgerJobs, setLedgerJobs] = useState<VideogenJobSnapshot[]>([])
  const [ledgerTotal, setLedgerTotal] = useState(0)
  const [queueText, setQueueText] = useState<string | null>(null)
  const [replay, setReplay] = useState<VideogenReplayResult | null>(null)
  const [replaying, setReplaying] = useState(false)

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
          if (d.mode === 'clip' || d.mode === 'loop' || d.mode === 'restyle') setMode(d.mode)
          if (d.preset === 'draft' || d.preset === 'final') setPreset(d.preset)
          if (typeof d.model === 'string' && d.model) {
            setModel(d.model)
            modelTouched.current = true
          }
          if (typeof d.count === 'number' && d.count >= 1 && d.count <= 2) setCount(Math.floor(d.count))
          if (typeof d.duration === 'number' && (DURATIONS as readonly number[]).includes(d.duration))
            setDuration(d.duration as 4 | 5 | 8)
          if (typeof d.orientation === 'string' && d.orientation) setOrientation(d.orientation)
          if (typeof d.resolution === 'string' && d.resolution) setResolution(d.resolution)
          if (typeof d.framerate === 'string') setFramerate(d.framerate)
          if (typeof d.seed === 'string' && d.seed) setSeed(d.seed)
          if (d.seed_lock === true) setSeedLock(true)
          if (typeof d.negative === 'string') setNegative(d.negative)
          if (typeof d.loop_motion === 'number' && d.loop_motion >= 0 && d.loop_motion <= 1) setLoopMotion(d.loop_motion)
          if (typeof d.restyle_strength === 'number' && d.restyle_strength >= 0 && d.restyle_strength <= 1)
            setRestyleStrength(d.restyle_strength)
          if (typeof d.source_still === 'string') setSourceStill(d.source_still)
          if (typeof d.source_video === 'string') setSourceVideo(d.source_video)
        }
        if (Array.isArray(recentsRaw)) setRecent(recentsRaw.filter((r): r is string => typeof r === 'string').slice(0, 8))
      } catch {
        /* prefs are polish */
      } finally {
        hydrateDone.current = true
        setTick((n) => n + 1)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Config-driven loop-motion default after hydration (never over a saved pick).
  const strengthFromConfig = useRef(false)
  useEffect(() => {
    if (!config || !hydrateDone.current) return
    if (!strengthFromConfig.current && savedPrefs.current?.loop_motion === undefined) setLoopMotion(config.loop_motion_strength)
    strengthFromConfig.current = true
  }, [config])

  // Hydration: apply the saved mode's config pairing (no model pick saved →
  // the config default for that mode).
  const modeDefaultsApplied = useRef(false)
  useEffect(() => {
    if (!config || !hydrateDone.current || modeDefaultsApplied.current) return
    modeDefaultsApplied.current = true
    if (!modelTouched.current) {
      const want =
        mode === 'restyle' ? config.restyle_model : mode === 'loop' ? config.final_model : mode === 'clip' && preset === 'final' ? config.final_model : config.draft_model
      if (want) setModel(want)
    }
  }, [config, mode, preset])

  // Mode switch: reset pairing + the per-entry chips (loop/restyle are pinned
  // to the final model family; §2.2 mode_roles drive the dropdown).
  useEffect(() => {
    if (!hydrateDone.current || modeRef.current === mode) return
    modeRef.current = mode
    modelTouched.current = false
    if (config) {
      const want = mode === 'restyle' ? config.restyle_model : mode === 'loop' ? config.final_model : config.draft_model
      if (want) setModel(want)
    }
  }, [mode, config])

  // Revalidate resolution/duration/framerate when the chosen entry changes.
  const entry = useMemo(() => catalog.find((m) => m.id === model), [catalog, model])
  useEffect(() => {
    if (!entry || !hydrateDone.current) return
    if (entry.resolutions.length > 0 && !(entry.resolutions as readonly string[]).includes(resolution)) {
      const fromConfig = config ? config.default_resolution : undefined
      const next =
        fromConfig && entry.resolutions.includes(fromConfig) ? fromConfig : entry.resolutions[0]
      if (next) setResolution(next)
    }
    if (!(entry.durations_seconds as readonly number[]).includes(duration)) {
      const next = (DURATIONS as readonly number[]).find((d) => (entry.durations_seconds as readonly number[]).includes(d))
      if (next !== undefined) setDuration(next as 4 | 5 | 8)
    }
    if (framerate && !entry.framerates.includes(Number(framerate))) setFramerate('')
  }, [entry, resolution, duration, framerate, config])

  // Debounced draft persistence (imagegen pattern).
  useEffect(() => {
    if (!hydrateDone.current) return
    const t = setTimeout(() => {
      void bridge
        .writeSkillData(DRAFT_KEY, {
          prompt,
          mode,
          preset,
          model,
          count,
          duration,
          orientation,
          resolution,
          framerate,
          seed,
          seed_lock: seedLock,
          negative,
          loop_motion: loopMotion,
          restyle_strength: restyleStrength,
          source_still: sourceStill,
          source_video: sourceVideo,
        })
        .catch(() => {})
    }, CONFIG_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [
    prompt,
    mode,
    preset,
    model,
    count,
    duration,
    orientation,
    resolution,
    framerate,
    seed,
    seedLock,
    negative,
    loopMotion,
    restyleStrength,
    sourceStill,
    sourceVideo,
  ])

  // Remix adoption (§5.6): load the parent record's params into the composer;
  // "Restyle this clip" switches to mode restyle with the record as the source.
  // Identity-guarded (imagegen parity): adopts ONCE per remix object — the
  // operator's subsequent param edits must not be clobbered by re-adopting.
  const remixAdoptedRef = useRef<RemixRequest | null>(null)
  useEffect(() => {
    if (!remix || remixAdoptedRef.current === remix) return
    remixAdoptedRef.current = remix
    const r = remix.record
    setModel(r.model)
    modelTouched.current = true
    setMode(remix.asRestyle ? 'restyle' : r.mode)
    if (remix.asRestyle) {
      setSourceVideo(r.id)
      setPrompt('')
    } else {
      setPrompt(r.prompt ?? '')
      if (r.negative_prompt) setNegative(r.negative_prompt)
      if (Number.isFinite(r.seed) && r.seed > 0) {
        setSeed(String(r.seed))
        setSeedLock(true)
      }
      if ((DURATIONS as readonly number[]).includes(r.duration_seconds)) setDuration(r.duration_seconds as 4 | 5 | 8)
      // Reverse the record's px to resolution/orientation via the entry's table.
      const ent = r.model === model ? entry : catalog.find((m) => m.id === r.model)
      let found = false
      for (const [res, byOrient] of Object.entries(ent?.resolution_px ?? {})) {
        for (const [orient, pair] of Object.entries(byOrient ?? {})) {
          const v = pair as { width: number; height: number } | undefined
          if (v && v.width === r.resolution.width && v.height === r.resolution.height) {
            setResolution(res)
            setOrientation(orient)
            found = true
            break
          }
        }
        if (found) break
      }
    }
    if (r.motion_strength !== undefined && r.mode === 'loop') setLoopMotion(r.motion_strength)
    if (r.motion_strength !== undefined && r.mode === 'restyle') setRestyleStrength(r.motion_strength)
  }, [remix, catalog, model, entry])

  // Elapsed ticker while a job runs.
  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'running')) {
      const t = setInterval(() => setTick((n) => n + 1), 1000)
      return () => clearInterval(t)
    }
  }, [job])
  void tick // re-render only

  // Release pollers on unmount (the parent keeps this screen mounted/hidden
  // across tab switches for exactly this reason).
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current)
    },
    [],
  )

  const availableModels = useMemo(() => {
    const modeServing = catalog.filter((m) => m.mode_roles.includes(mode))
    const list = modeServing.filter((m) => !detected || detected[m.id] === true)
    return list.length > 0 ? list : modeServing
  }, [catalog, detected, mode])

  const pushRecent = useCallback(async (p: string) => {
    setRecent((prev) => {
      const next = [p, ...prev.filter((r) => r !== p)].slice(0, 8)
      void bridge.writeSkillData(RECENTS_KEY, next).catch(() => {})
      return next
    })
  }, [])

  const refreshLedger = useCallback(async () => {
    try {
      const res = await bridge.jobsList({ limit: LEDGER_PAGE })
      setLedgerJobs(res.jobs)
      setLedgerTotal(res.total)
    } catch {
      /* the ledger card is informational — never throws into the composer */
    }
    // Live queue status rides the videoGenQueueList op on the same refresh
    // cycle (health + recent ledger in one host round trip); the App's
    // status.health prop is the fallback display when the probe is stale.
    try {
      const q = await bridge.queueList()
      const h = q.health
      if (h.ok) {
        setQueueText(
          `queue ${h.queue_depth ?? 0}` +
            (h.queue_running || h.queue_pending
              ? ` (running ${h.queue_running ?? 0} · pending ${h.queue_pending ?? 0})`
              : ''),
        )
      } else {
        setQueueText('ComfyUI offline')
      }
    } catch {
      /* falls back to the status prop */
    }
  }, [])

  // Ledger card: refresh on mount + fan/mutation bumps (refreshKey).
  useEffect(() => {
    void refreshLedger()
  }, [refreshLedger, refreshKey])

  const runReplay = async () => {
    setReplaying(true)
    try {
      const r = await bridge.jobsReplay()
      setReplay(r)
      void refreshLedger()
      onChanged()
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    } finally {
      setReplaying(false)
    }
  }

  const startPolling = useCallback(
    (jobId: string) => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const j = await bridge.jobGet(jobId)
            if (!j) {
              if (pollRef.current) clearInterval(pollRef.current)
              pollRef.current = null
              setJobError('The render record left the ledger (ledger reset) — check the Library tab for its outputs.')
              onChanged()
              void refreshLedger()
              return
            }
            setJob(j)
            if (j.status === 'done' || j.status === 'error') {
              if (pollRef.current) clearInterval(pollRef.current)
              pollRef.current = null
              onChanged()
              void refreshLedger()
              if (j.status === 'done') setToast(`${j.outputs.length} clip(s) saved to the library.`)
              else setJobError(j.error ?? 'generation failed')
            }
          } catch (e) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setJobError(e instanceof Error ? e.message : String(e))
            onChanged()
            void refreshLedger()
          }
        })()
      }, 1500)
    },
    [onChanged, refreshLedger],
  )

  const submit = useCallback(async () => {
    setJobError(null)
    setSubmitting(true)
    try {
      const still = sourceStill.trim()
      const stillIsPath = looksLikePath(still)
      const vidSrc = sourceVideo.trim()
      const vidIsPath = looksLikePath(vidSrc)
      const composed = {
        prompt: prompt.trim(),
        mode,
        ...(mode === 'clip' ? { preset } : {}),
        ...(model ? { model } : {}),
        negative_prompt: negative.trim() || undefined,
        resolution,
        orientation,
        duration_seconds: duration,
        ...(framerate ? { framerate: Number(framerate) } : {}),
        ...(seedLock && seed.trim() ? { seed: Number(seed) } : {}),
        count,
        ...(mode === 'loop' ? { loop_motion_strength: loopMotion } : {}),
        ...(mode === 'restyle' ? { restyle_strength: restyleStrength } : {}),
        ...(mode !== 'restyle' && still ? (stillIsPath ? { source_image_path: still } : { source_image_id: still }) : {}),
        ...(mode === 'restyle' && vidSrc ? (vidIsPath ? { source_video_path: vidSrc } : { source_video_id: vidSrc }) : {}),
      }
      setSentStill(mode !== 'restyle' && still && !stillIsPath ? still : '')
      const startedJob = await bridge.generate(composed)
      setJob(startedJob)
      setToast(null)
      const text = composed.prompt
      if (text) void pushRecent(text)
      startPolling(startedJob.id)
    } catch (e) {
      setJobError(e instanceof Error ? e.message : String(e))
      onChanged()
      void refreshLedger()
    } finally {
      setSubmitting(false)
    }
  }, [
    sourceStill,
    sourceVideo,
    prompt,
    mode,
    preset,
    model,
    negative,
    resolution,
    orientation,
    duration,
    framerate,
    seed,
    seedLock,
    count,
    loopMotion,
    restyleStrength,
    pushRecent,
    startPolling,
    onChanged,
    refreshLedger,
  ])

  const onTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  /** §5.6 result strip actions. */
  const toggleFavorite = async (id: string, favorite: boolean) => {
    try {
      await bridge.videoUpdate({ video_id: id, favorite: !favorite })
      setFavIds((prev) => ({ ...prev, [id]: !favorite }))
      onChanged()
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteOutput = async (id: string) => {
    if (deleteAskId !== id) {
      setDeleteAskId(id)
      return
    }
    setDeleteAskId(null)
    try {
      await bridge.videoDelete(id)
      setJob((j) => (j ? { ...j, outputs: j.outputs.filter((o) => o.id !== id) } : j))
      onChanged()
      void refreshLedger()
      setToast('Deleted.')
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const sendToAgent = async (o: { id: string; path: string }) => {
    try {
      await bridge.sendToAgent({
        note: 'Operator sent this library clip to the agent for a remix.',
        video_id: o.id,
        video_path: o.path,
        ...(entry ? { model: entry.id } : {}),
        ...(seedLock && seed.trim() ? { seed: Number(seed) } : {}),
        request:
          `Remix library clip ${o.id} with sylo_video_gen_generate (from_video_id=${o.id}). ` +
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

  const rerunAsFinal = (id: string) => {
    // Lineage rerun: from_video_id inherits prompt/seed/resolution/duration
    // (host-side §3.1) and records parent_video_id — never a resubmit of the parent's job.
    void (async () => {
      setJobError(null)
      setSentStill('')
      try {
        const started = await bridge.generate({ mode: 'clip', preset: 'final', from_video_id: id, count: 1 })
        setJob(started)
        startPolling(started.id)
      } catch (e) {
        setJobError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  const jobLive = !!job && (job.status === 'queued' || job.status === 'running')
  const showDraftBanner = !!job && job.status === 'done' && job.request.preset === 'draft' && job.outputs.length > 0
  const stillLinked = !sentStill || (!!job && !!job.request.source_image_id)
  const sourceRequired = mode !== 'clip'
  const sourceValue = mode === 'restyle' ? sourceVideo : sourceStill
  const canSubmit =
    (prompt.trim() !== '' || (mode === 'loop' && sourceStill.trim() !== '')) &&
    (!sourceRequired || sourceValue.trim() !== '') &&
    !submitting &&
    !jobLive

  const queueLine = queueText ?? (health
    ? health.ok
      ? `queue ${health.queue_depth ?? 0}` +
        (health.queue_running || health.queue_pending
          ? ` (running ${health.queue_running ?? 0} · pending ${health.queue_pending ?? 0})`
          : '')
      : 'ComfyUI offline'
    : '…')

  return (
    <section className="vg-panel">
      {/* §5.6: the mode segmented control ABOVE the composer. */}
      <div className="vg-field">
        <span className="vg-label">Mode</span>
        <div className="vg-segmented" role="tablist" aria-label="Mode">
          {(['clip', 'loop', 'restyle'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'vg-seg vg-seg-active' : 'vg-seg'}
              onClick={() => {
                setMode(m)
                setDeleteAskId(null)
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="vg-hint">
          {mode === 'clip'
            ? 'Text→video, or image→video when a source still is set. Drafts are cheap · finals are minutes.'
            : mode === 'loop'
              ? 'Living photo — one still + subtle cyclical motion (first == last frame conditioning). Needs a source still.'
              : 'Whole-clip style transfer (VACE v2v). Restyling grants no rights to the source material.'}
        </p>
      </div>

      <div className="vg-field">
        <label className="vg-label" htmlFor="vg-prompt">
          Prompt <span className="vg-hint-inline">Ctrl/⌘+Enter to generate</span>
        </label>
        <textarea
          id="vg-prompt"
          className="vg-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder={
            mode === 'loop'
              ? 'One movement at a time, cyclical: hair sway, light pulse, drifting cloud layer, slow orbit…'
              : 'Describe the shot — e.g. "slow dolly through a neon-lit rainy street at night".'
          }
        />
        <div className="vg-hint-row">
          {recent.length > 0 ? (
            <button type="button" className="vg-btn-ghost" onClick={() => setShowRecent((s) => !s)}>
              {showRecent ? 'Hide recent prompts' : `Recent prompts (${recent.length})`}
            </button>
          ) : null}
          {config ? (
            <label className="vg-check">
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
          <ul className="vg-recents">
            {recent.map((r) => (
              <li key={r}>
                <button
                  type="button"
                  className="vg-btn-ghost"
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

      <div className="vg-row vg-row-wrap">
        {mode === 'clip' ? (
          <div className="vg-field">
            <span className="vg-label">Preset</span>
            <div className="vg-segmented" role="tablist" aria-label="Preset">
              {(['draft', 'final'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={preset === p}
                  className={preset === p ? 'vg-seg vg-seg-active' : 'vg-seg'}
                  onClick={() => setPreset(p)}
                >
                  {p === 'draft' ? 'Draft (fast)' : 'Final (commit)'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="vg-field">
            <span className="vg-label">Preset</span>
            <span className="vg-hint-inline">runs on the final model</span>
          </div>
        )}
        <div className="vg-field">
          <span className="vg-label">Count</span>
          <div className="vg-segmented">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                className={count === n ? 'vg-seg vg-seg-active' : 'vg-seg'}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="vg-row vg-row-wrap">
        <div className="vg-field vg-grow">
          <label className="vg-label" htmlFor="vg-model">
            Model {detected ? <span className="vg-hint-inline">catalog ∩ detected</span> : null}
          </label>
          <select
            id="vg-model"
            className="vg-select"
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              modelTouched.current = true
            }}
          >
            {model && !availableModels.some((m) => m.id === model) ? <option value={model}>{model}</option> : null}
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.framerates.join('/')} fps
                {m.commercial_ok ? '' : ' · non-commercial'}
                {m.approx_size_gb ? ` · ~${m.approx_size_gb} GB` : ''}
              </option>
            ))}
          </select>
          {entry ? (
            <p className="vg-hint">
              <span className={entry.commercial_ok ? 'vg-badge vg-badge-ok' : 'vg-badge vg-badge-nc'}>{entry.license_badge}</span>{' '}
              {entry.strengths ?? ''}
            </p>
          ) : null}
        </div>
        {mode !== 'restyle' ? (
          <div className="vg-field vg-grow">
            <label className="vg-label" htmlFor="vg-source-still">
              Source still{' '}
              <span className="vg-hint-inline">{mode === 'loop' ? 'required — Images-library id or local path' : 'optional (image→video)'}</span>
            </label>
            <input
              id="vg-source-still"
              className="vg-input"
              type="text"
              value={sourceStill}
              onChange={(e) => setSourceStill(e.target.value)}
              placeholder={mode === 'loop' ? 'an Images-library id, or C:\…\still.png' : 'library id or local path'}
            />
          </div>
        ) : (
          <div className="vg-field vg-grow">
            <label className="vg-label" htmlFor="vg-source-video">
              Source clip <span className="vg-hint-inline">required — library id or local path</span>
            </label>
            <input
              id="vg-source-video"
              className="vg-input"
              type="text"
              value={sourceVideo}
              onChange={(e) => setSourceVideo(e.target.value)}
              placeholder="a Library clip id, or C:\…\source.mp4"
            />
          </div>
        )}
      </div>

      <div className="vg-row vg-row-wrap">
        <div className="vg-field">
          <span className="vg-label">Resolution</span>
          <div className="vg-chips">
            {(['480p', '720p'] as const).map((r) => {
              const supported = !entry || entry.resolutions.length === 0 || entry.resolutions.includes(r)
              return (
                <button
                  key={r}
                  type="button"
                  className={resolution === r ? 'vg-chip vg-chip-active' : 'vg-chip'}
                  disabled={!supported}
                  title={supported ? undefined : `${entry?.id ?? 'model'} does not support ${r}`}
                  onClick={() => setResolution(r)}
                >
                  {r}
                </button>
              )
            })}
          </div>
        </div>
        <div className="vg-field">
          <span className="vg-label">Orientation</span>
          <div className="vg-chips">
            {(['landscape', 'portrait'] as const).map((o) => (
              <button
                key={o}
                type="button"
                className={orientation === o ? 'vg-chip vg-chip-active' : 'vg-chip'}
                onClick={() => setOrientation(o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
        <div className="vg-field">
          <span className="vg-label">Duration</span>
          <div className="vg-chips">
            {DURATIONS.map((d) => {
              const supported = !entry || (entry.durations_seconds as readonly number[]).includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  className={duration === d ? 'vg-chip vg-chip-active' : 'vg-chip'}
                  disabled={!supported}
                  title={supported ? undefined : `${entry?.id ?? 'model'} caps at ${entry?.max_duration_seconds ?? 8} s`}
                  onClick={() => setDuration(d as 4 | 5 | 8)}
                >
                  {d}s
                </button>
              )
            })}
          </div>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-fps">
            Framerate
          </label>
          <select
            id="vg-fps"
            className="vg-select vg-select-inline"
            value={framerate}
            onChange={(e) => setFramerate(e.target.value)}
          >
            <option value="">model default{entry ? ` (${entry.default_framerate} fps)` : ''}</option>
            {(entry?.framerates ?? [16, 24]).map((f) => (
              <option key={f} value={String(f)}>
                {f} fps
              </option>
            ))}
          </select>
        </div>
      </div>

      {mode === 'loop' || mode === 'restyle' ? (
        <div className="vg-row vg-row-wrap">
          <div className="vg-field vg-grow">
            <label className="vg-label" htmlFor="vg-strength">
              {mode === 'loop' ? 'Motion strength' : 'Restyle strength'}{' '}
              <span className="vg-hint-inline">{mode === 'loop' ? '0–1 — subtle over dramatic' : '0–1 → VACE strength = 0.2 + 0.8 × input'}</span>
            </label>
            <input
              id="vg-strength"
              className="vg-slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((mode === 'loop' ? loopMotion : restyleStrength) * 100)}
              onChange={(e) =>
                mode === 'loop' ? setLoopMotion(Number(e.target.value) / 100) : setRestyleStrength(Number(e.target.value) / 100)
              }
            />
            <p className="vg-hint">
              {mode === 'loop'
                ? `loop_motion_strength ${loopMotion.toFixed(2)} — one movement at a time; 0.5 is the starting point.`
                : `restyle_strength ${restyleStrength.toFixed(2)} → VACE strength ${(0.2 + 0.8 * restyleStrength).toFixed(2)} (first-render calibration pending).`}
            </p>
          </div>
        </div>
      ) : null}

      <div className="vg-row vg-row-wrap">
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-seed">
            Seed {seedLock ? '🔒' : ''}
          </label>
          <div className="vg-seed-row">
            <input
              id="vg-seed"
              className="vg-input vg-input-num"
              type="text"
              inputMode="numeric"
              placeholder="random"
              value={seed}
              onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
            />
            <button
              type="button"
              className={seedLock ? 'vg-chip vg-chip-active' : 'vg-chip'}
              title="Lock the seed so reruns reproduce the shot"
              onClick={() => setSeedLock((s) => !s)}
            >
              lock
            </button>
          </div>
        </div>
        <div className="vg-field vg-grow">
          <label className="vg-label" htmlFor="vg-negative">
            Negative prompt
          </label>
          <input
            id="vg-negative"
            className="vg-input"
            type="text"
            value={negative}
            onChange={(e) => setNegative(e.target.value)}
            placeholder="Extra things to avoid — empty ships the official Wan negative"
          />
        </div>
      </div>

      <div className="vg-actions">
        <button type="button" className="vg-btn" disabled={!canSubmit} onClick={() => void submit()}>
          {submitting || jobLive
            ? 'Generating…'
            : mode === 'clip'
              ? `Generate ${preset} clip${count > 1 ? 's' : ''}`
              : `Generate ${MODE_LABELS[mode].toLowerCase()}`}
        </button>
        {health && !health.ok ? <span className="vg-hint-inline vg-warn-inline">ComfyUI offline — check Settings</span> : null}
        {sourceRequired && sourceValue.trim() === '' ? (
          <span className="vg-hint-inline vg-warn-inline">
            {mode === 'loop' ? 'pick a source still (Images id or path)' : 'pick a source clip (Library id or path)'}
          </span>
        ) : null}
      </div>

      {job ? (
        <div className="vg-jobcard" data-status={job.status}>
          {jobLive ? (
            <span className="vg-spinner" role="status" aria-label="generating" />
          ) : (
            <span className="vg-jobdot" data-status={job.status} />
          )}
          <div className="vg-jobbody">
            <div className="vg-jobhead">
              <strong>
                {job.request.model} · {MODE_LABELS[job.request.mode]}
                {job.request.mode === 'clip' ? ` · ${job.request.preset}` : ''} · {job.request.count} clip(s)
              </strong>
              <span className="vg-jobmeta">elapsed {fmtElapsed(job.elapsed_ms)}</span>
            </div>
            <p className="vg-jobprompt">{job.request.prompt.length > 110 ? `${job.request.prompt.slice(0, 107)}…` : job.request.prompt}</p>
            <p className="vg-hint">
              {job.request.orientation} · {job.request.resolution} · {job.request.duration_seconds}s @ {job.request.framerate} fps ·{' '}
              {job.request.frame_count} frames · seed {job.request.seed}
              {job.request.mode !== 'restyle' && job.request.source_image_id ? ` · still ${job.request.source_image_id}` : ''}
              {job.request.mode === 'restyle' ? ' · v2v' : ''}
            </p>
            {!stillLinked ? (
              <p className="vg-hint vg-warn-inline">
                Source still {sentStill} did not link — the render proceeded as text→video (a local path skips the link).
              </p>
            ) : null}
            {job.status === 'running' && job.comfy_prompt_id ? (
              <p className="vg-hint">ComfyUI job {job.comfy_prompt_id.slice(0, 8)}… — logged in the ledger, survives restarts</p>
            ) : null}
            {job.status === 'error' ? <p className="vg-error">{job.error ?? 'generation failed'}</p> : null}
            {job.status === 'done' && job.outputs.length > 0 ? (
              <p className="vg-hint">
                saved · {fmtElapsed(job.outputs[0]?.render_ms)} render · seed{' '}
                {job.outputs.map((o) => o.seed).join(', ')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {jobError ? <p className="vg-error">{jobError}</p> : null}

      {showDraftBanner ? (
        <div className="vg-banner">
          Drafts are fast/low-res. <strong>Rerun as final</strong> on a pick — upgrades to the configured final model with
          lineage.
        </div>
      ) : null}

      {job && job.outputs.length ? (
        <div className="vg-strip">
          {job.outputs.map((o) => (
            <figure key={o.id} className="vg-thumb">
              <div className="vg-thumb-media">
                <video
                  src={localFileUrl(o.path)}
                  poster={o.poster_path ? localFileUrl(o.poster_path) : undefined}
                  preload="metadata"
                  muted
                  playsInline
                  onMouseEnter={(e) => hoverPreviewStart(e.currentTarget)}
                  onMouseLeave={(e) => hoverPreviewStop(e.currentTarget)}
                  onClick={() => onOpenDetail(o.id)}
                />
                <span className="vg-duration">
                  {MODE_LABELS[job.request.mode] ?? job.request.mode} · {o.duration_seconds}s
                </span>
              </div>
              <figcaption className="vg-thumb-cap">
                <span className="vg-thumb-meta">
                  {o.width}×{o.height} · {o.framerate} fps · seed {o.seed}
                </span>
                <div className="vg-thumb-actions">
                  <button
                    type="button"
                    className="vg-iconbtn"
                    title={favIds[o.id] ? 'Unfavorite' : 'Favorite'}
                    onClick={() => void toggleFavorite(o.id, !!favIds[o.id])}
                  >
                    {favIds[o.id] ? '★' : '☆'}
                  </button>
                  <button type="button" className="vg-iconbtn" title="Open detail" onClick={() => onOpenDetail(o.id)}>
                    ⤢
                  </button>
                  {showDraftBanner && job.request.mode === 'clip' ? (
                    <button
                      type="button"
                      className="vg-iconbtn vg-iconbtn-go"
                      title="Rerun as final (lineage: from_video_id → final model)"
                      onClick={() => rerunAsFinal(o.id)}
                    >
                      ↻final
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="vg-iconbtn"
                    title="Send to agent (remix in chat)"
                    onClick={() => void sendToAgent(o)}
                  >
                    ✈
                  </button>
                  <button type="button" className="vg-iconbtn" title="Copy path" onClick={() => void copyPath(o.path)}>
                    ⧉
                  </button>
                  <button type="button" className="vg-iconbtn" title="Reveal in Explorer" onClick={() => void reveal(o.id)}>
                    ➘
                  </button>
                  {deleteAskId === o.id ? (
                    <>
                      <button
                        type="button"
                        className="vg-iconbtn vg-iconbtn-danger"
                        title="Confirm delete (file + record)"
                        onClick={() => void deleteOutput(o.id)}
                      >
                        Confirm
                      </button>
                      <button type="button" className="vg-iconbtn" title="Cancel delete" onClick={() => setDeleteAskId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="vg-iconbtn vg-iconbtn-danger"
                      title="Delete"
                      onClick={() => void deleteOutput(o.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {/* §4.3 render-ledger card — the v1 queue/jobs card (the Queue SCREEN is v2/§6):
          recent durable rows + live queue status + the read-only replay. */}
      <div className="vg-ledgercard">
        <div className="vg-ledgerhead">
          <strong>Render ledger</strong>
          <span className="vg-jobmeta">{queueLine}</span>
          <span className="vg-jobmeta">
            {ledgerTotal} row{ledgerTotal === 1 ? '' : 's'}
          </span>
          <div className="vg-ledgeractions">
            <button type="button" className="vg-btn-ghost" onClick={() => void refreshLedger()} title="Re-read the durable ledger">
              Refresh
            </button>
            <button
              type="button"
              className="vg-btn-ghost"
              disabled={replaying}
              onClick={() => void runReplay()}
              title="Re-poll ComfyUI history (read-only) for jobs interrupted by a restart"
            >
              {replaying ? 'Replaying…' : 'Replay pending'}
            </button>
          </div>
        </div>
        <p className="vg-hint">
          Rows persist in <code>jobs.json</code> — minutes-long renders survive Sylo restarts; Replay re-polls ComfyUI
          history for pending rows (read-only, never resubmits). The full Queue screen is v2.
        </p>
        {ledgerJobs.length > 0 ? (
          <ul className="vg-jobsledger">
            {ledgerJobs.map((j) => (
              <li
                key={j.id}
                className={j.status === 'done' && j.outputs.length > 0 ? 'vg-ledgerrow vg-ledgerrow-open' : 'vg-ledgerrow'}
                onClick={j.status === 'done' && j.outputs.length > 0 ? () => onOpenDetail(j.outputs[0]!.id) : undefined}
              >
                <span className="vg-jobdot" data-status={j.status} />
                <span className="vg-ledgermeta">
                  {fmtTime(j.created_at)} · {MODE_LABELS[j.request.mode] ?? j.request.mode}
                  {j.request.mode === 'clip' ? ` · ${j.request.preset}` : ''}
                  {j.source === 'route' ? '' : ' · agent'}
                </span>
                <span className="vg-ledgerprompt" title={j.request.prompt}>
                  {j.request.prompt.length > 44 ? `${j.request.prompt.slice(0, 42)}…` : j.request.prompt}
                </span>
                <span className="vg-ledgerstatus">
                  {j.status === 'queued' || j.status === 'running'
                    ? `${j.status} · ${fmtElapsed(j.elapsed_ms)}`
                    : j.status === 'error'
                      ? `error — ${(j.error ?? '').slice(0, 60)}`
                      : j.outputs.length > 0
                        ? `done · ${j.outputs.length} clip(s)${j.outputs[0]?.render_ms ? ` · ${fmtHMM(j.outputs[0].render_ms)} / clip` : ''}`
                        : 'done'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vg-hint">No renders in the ledger yet.</p>
        )}
        {replay ? (
          <div className="vg-replay">
            <p className={replay.skipped ? 'vg-warn' : 'vg-hint'}>Replay: {replay.note}</p>
            {replay.entries.map((en) => (
              <p key={`${en.job_id}-${en.status}`} className="vg-hint">
                {en.job_id.slice(0, 8)}… {en.status} — {en.note}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {toast ? <p className="vg-toast">{toast}</p> : null}
    </section>
  )
}