import { useCallback, useEffect, useState } from 'react'

import {
  compactionModelKey,
  PI_DEFAULT_COMPACTION_RESERVE_TOKENS,
  PI_FALLBACK_CONTEXT_WINDOW_TOKENS,
  reserveTokensForTriggerPct,
  SYLO_COMPACTION_RESERVE_PREF,
} from '../../../shared/sylo-compaction-settings'
import {
  CHATGPT_CODEX_DEFAULT_MODEL,
  CHATGPT_CODEX_MODELS,
  CHATGPT_CODEX_PROVIDER,
  SYLO_MODEL_PROVIDERS,
  SYLO_MODEL_PROVIDER_LABELS,
} from '../../../shared/chatgpt-codex'
import { SYLO_DEFAULT_MODEL_ID } from '../../../shared/sylo-model-defaults'
import { ChatGptSignIn } from './ChatGptSignIn'
import { ManageProvidersModal } from './ManageProvidersModal'
import { normalizeOllamaOriginUi, OllamaModelSelect } from './ollama-ui'
import { Badge } from './Badge'
import { ConfirmButton } from './ConfirmButton'
import { toast } from './toast'
import { cn } from '../lib/cn'
import {
  btnGhostSm,
  btnPrimary,
  card,
  cardTitle,
  detailsBody,
  detailsSummary,
  errorText,
  fieldLabel,
  input,
  leadText,
  mutedText,
  select,
} from './ui-classes'

const caption = cn(mutedText, 'm-0 text-[0.78rem] leading-[1.4]')

// --- Compaction trigger (per model) helpers ---------------------------------

/** Format a percentage for display/draft without trailing zeros (91.8 → "91.8", 85 → "85"). */
function formatCompactionPct(pct: number): string {
  return String(Math.round(pct * 100) / 100)
}

/** Parse the trigger draft: number in (0, 100], rounded to 2dp; null when invalid. */
function parseCompactionDraftPct(draft: string): number | null {
  const raw = Number(draft.trim())
  if (!Number.isFinite(raw) || raw <= 0 || raw > 100) return null
  return Math.round(raw * 100) / 100
}

function isCompactionDraftValid(draft: string): boolean {
  return parseCompactionDraftPct(draft) != null
}

/** Current per-model compaction overrides from the Sylo prefs store. */
async function readCompactionOverrides(): Promise<Record<string, number>> {
  const raw = (await window.sylo.prefs.get(SYLO_COMPACTION_RESERVE_PREF, {})) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100) {
      out[key] = Math.round(value * 100) / 100
    }
  }
  return out
}

/**
 * Model card — provider/model id (Pi), per-provider panels (Ollama URL, ChatGPT
 * OAuth, OpenRouter free tier), plus the context-management panels (compaction
 * trigger, vision support, image fallback, chat-only). They share one save path
 * (`saveModelPrefs`) and one broker restart, so they live in one card.
 */
export function ModelCard({
  onChanged,
  diagnostics,
  ollamaBaseUrl,
  setOllamaBaseUrl,
  ollamaTags,
  ollamaListLoading,
  ollamaListError,
  refreshOllamaTags,
  onProvidersChanged,
}: {
  onChanged: () => void | Promise<void>
  diagnostics: {
    modelProvider: string
    modelId: string
    chatOnly: boolean
  }
  /** Shared Ollama connection state — owned by the settings shell. */
  ollamaBaseUrl: string
  setOllamaBaseUrl: (v: string) => void
  ollamaTags: string[]
  ollamaListLoading: boolean
  ollamaListError: string | null
  refreshOllamaTags: () => Promise<void>
  /** Notify the shell that provider lists may have changed. */
  onProvidersChanged: () => void
}): React.ReactElement {
  const [modelId, setModelId] = useState(diagnostics.modelId)
  const [modelProvider, setModelProvider] = useState(diagnostics.modelProvider)
  const [chatOnly, setChatOnly] = useState(diagnostics.chatOnly)
  const [modelVisionCapable, setModelVisionCapable] = useState(false)
  const [modelVisionExplicit, setModelVisionExplicit] = useState(false)
  const [ollamaVisionDetected, setOllamaVisionDetected] = useState<boolean | null>(null)
  const [visionProbeLoading, setVisionProbeLoading] = useState(false)
  const [visionProbeError, setVisionProbeError] = useState<string | null>(null)
  type OllamaContextStatus = Extract<
    Awaited<ReturnType<typeof window.sylo.ollama.contextStatus>>,
    { ok: true }
  >['status']
  const [contextStatus, setContextStatus] = useState<OllamaContextStatus | null>(null)
  type CompactionStateOk = Extract<
    Awaited<ReturnType<typeof window.sylo.compaction.state>>,
    { ok: true }
  >
  const [compactionState, setCompactionState] = useState<CompactionStateOk | null>(null)
  /** Free-text draft of the compaction trigger (% of context window) — persisted only when valid. */
  const [compactionDraft, setCompactionDraft] = useState('')
  const [compactionBusy, setCompactionBusy] = useState(false)
  const [imageModelId, setImageModelId] = useState('')
  // OpenRouter (free tier): API key (auth.json) + live free-model list.
  const [orKeyInput, setOrKeyInput] = useState('')
  const [orAuthHasKey, setOrAuthHasKey] = useState(false)
  const [orAuthPreview, setOrAuthPreview] = useState<string | null>(null)
  const [orAuthError, setOrAuthError] = useState<string | null>(null)
  const [orModels, setOrModels] = useState<{ id: string; name: string; contextLength: number | null }[]>([])
  const [orModelsSource, setOrModelsSource] = useState<'live' | 'fallback' | null>(null)
  const [orModelsLoading, setOrModelsLoading] = useState(false)
  const [orKeySaving, setOrKeySaving] = useState(false)
  const [providersModalOpen, setProvidersModalOpen] = useState(false)

  useEffect(() => {
    setModelId(diagnostics.modelId)
    setModelProvider(diagnostics.modelProvider)
    setChatOnly(diagnostics.chatOnly)
  }, [diagnostics.modelId, diagnostics.modelProvider, diagnostics.chatOnly])

  useEffect(() => {
    void (async () => {
      setImageModelId((await window.sylo.prefs.get('sylo.image_model_id', '')) as string)
    })()
  }, [])

  useEffect(() => {
    const id = modelId.trim()
    if (modelProvider !== 'ollama' || !id) {
      setModelVisionCapable(false)
      setModelVisionExplicit(false)
      setOllamaVisionDetected(null)
      setVisionProbeError(null)
      return
    }
    let cancelled = false
    void (async () => {
      const cfg = await window.sylo.models.getInputConfig('ollama', id)
      if (cancelled) return
      if (cfg.ok) {
        setModelVisionCapable(cfg.visionCapable)
        setModelVisionExplicit(cfg.explicit)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modelProvider, modelId])

  useEffect(() => {
    const id = modelId.trim()
    if (modelProvider !== 'ollama' || !id) {
      setOllamaVisionDetected(null)
      setVisionProbeError(null)
      setVisionProbeLoading(false)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        setVisionProbeLoading(true)
        setVisionProbeError(null)
        const origin = normalizeOllamaOriginUi(ollamaBaseUrl)
        const probed = await window.sylo.ollama.probeVision(origin, id)
        if (cancelled) return
        setVisionProbeLoading(false)
        if (!probed.ok) {
          setOllamaVisionDetected(null)
          setVisionProbeError(probed.error)
          return
        }
        setOllamaVisionDetected(probed.vision)
        setVisionProbeError(null)
        setModelVisionCapable((prev) => {
          if (modelVisionExplicit) return prev
          return probed.vision
        })
      })()
    }, 320)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [modelProvider, modelId, ollamaBaseUrl, modelVisionExplicit])

  // Ollama's /v1 endpoint ignores num_ctx, so models.json is the only place Pi's
  // context window can be reconciled with reality. Surface a mismatch rather than
  // letting it fail silently as truncation or premature compaction.
  useEffect(() => {
    const id = modelId.trim()
    if (modelProvider !== 'ollama' || !id) {
      setContextStatus(null)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        const origin = normalizeOllamaOriginUi(ollamaBaseUrl)
        const res = await window.sylo.ollama.contextStatus(origin, id)
        if (cancelled) return
        setContextStatus(res.ok ? res.status : null)
      })()
    }, 320)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [modelProvider, modelId, ollamaBaseUrl])

  const refreshOrAuth = useCallback(async () => {
    const r = await window.sylo.piAuth.get('openrouter')
    if (r.ok) {
      setOrAuthHasKey(r.hasKey)
      setOrAuthPreview(r.keyPreview)
      setOrAuthError(null)
    } else {
      setOrAuthError(r.error)
    }
  }, [])

  const refreshOrModels = useCallback(async () => {
    setOrModelsLoading(true)
    const r = await window.sylo.openrouter.listModels()
    setOrModelsLoading(false)
    if (r.ok) {
      setOrModels(r.models)
      setOrModelsSource(r.source)
    } else {
      setOrModels([])
      setOrModelsSource(null)
    }
  }, [])

  useEffect(() => {
    if (modelProvider !== 'openrouter') return
    void refreshOrAuth()
    void refreshOrModels()
  }, [modelProvider, refreshOrAuth, refreshOrModels])

  // Compaction trigger (per model): refetch whenever the drafted provider/model changes
  // so the card always previews the selected model's default and any saved override.
  const reloadCompactionState = useCallback(async () => {
    const st = await window.sylo.compaction.state(modelProvider.trim(), modelId.trim())
    if (!st.ok) return
    setCompactionState(st)
    setCompactionDraft(formatCompactionPct(st.effectivePct))
  }, [modelProvider, modelId])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const st = await window.sylo.compaction.state(modelProvider.trim(), modelId.trim())
      if (cancelled || !st.ok) return
      setCompactionState(st)
      setCompactionDraft(formatCompactionPct(st.effectivePct))
    })()
    return () => {
      cancelled = true
    }
  }, [modelProvider, modelId])

  const compactionKey = compactionModelKey(modelProvider.trim(), modelId.trim())
  const compactionDraftValid = isCompactionDraftValid(compactionDraft)
  const compactionHasOverride = compactionState?.overridePct != null

  const saveCompactionOverride = async () => {
    if (compactionBusy) return
    const pct = parseCompactionDraftPct(compactionDraft)
    if (pct == null) return
    setCompactionBusy(true)
    try {
      const current = await readCompactionOverrides()
      const next = { ...current, [compactionKey]: pct }
      await window.sylo.prefs.set(SYLO_COMPACTION_RESERVE_PREF, next)
      await window.sylo.compaction.apply(modelProvider.trim(), modelId.trim())
      await reloadCompactionState()
      onChanged()
    } finally {
      setCompactionBusy(false)
    }
  }

  const restoreCompactionDefault = async () => {
    if (compactionBusy) return
    setCompactionBusy(true)
    try {
      const current = await readCompactionOverrides()
      const next = { ...current }
      delete next[compactionKey]
      await window.sylo.prefs.set(SYLO_COMPACTION_RESERVE_PREF, next)
      await window.sylo.compaction.apply(modelProvider.trim(), modelId.trim())
      await reloadCompactionState()
      onChanged()
    } finally {
      setCompactionBusy(false)
    }
  }

  /** One-line status under the compaction trigger input (tokens, default vs override, apply note). */
  const compactionStatusLine = (): string => {
    if (!compactionState) return 'Loading compaction settings…'
    if (!compactionState.autoCompactionEnabled) {
      return (
        'Auto-compaction is disabled in ~/.pi/agent/settings.json (compaction.enabled = false) — ' +
        'this trigger has no effect until it is re-enabled.'
      )
    }
    const cw = compactionState.contextWindow ?? PI_FALLBACK_CONTEXT_WINDOW_TOKENS
    const pct =
      compactionDraftValid ? (parseCompactionDraftPct(compactionDraft) ?? compactionState.effectivePct)
      : compactionState.effectivePct
    const reserve = reserveTokensForTriggerPct(cw, pct)
    const source =
      compactionState.overridePct != null
        ? `Custom trigger for this model: ${formatCompactionPct(compactionState.overridePct)}%.`
        : "Using Pi's default trigger."
    const windowNote = compactionState.usesFallbackWindow
      ? " Using Pi's 128,000-token fallback window — declare contextWindow in ~/.pi/agent/models.json for an exact figure."
      : ''
    return (
      `${source} Compacts at ≈${(cw - reserve).toLocaleString('en-US')} of ` +
      `${cw.toLocaleString('en-US')} tokens (${formatCompactionPct(pct)}% full), keeping ` +
      `${reserve.toLocaleString('en-US')} in reserve. Applies immediately — no broker restart needed.` +
      windowNote
    )
  }

  const saveModelPrefs = async () => {
    const origin = normalizeOllamaOriginUi(ollamaBaseUrl)
    let trimmedId = modelId.trim()
    const trimmedImageId = imageModelId.trim()
    // OpenRouter: persist the key to Pi's auth.json BEFORE saving prefs, so the
    // broker restart that follows always has the credential to work with.
    if (modelProvider === CHATGPT_CODEX_PROVIDER) {
      const st = await window.sylo.chatgpt.status()
      if (!st.connected) {
        toast(
          'Sign in with ChatGPT Plus first — Sylo uses your ChatGPT subscription (Codex), not an OpenAI API key.',
          'error',
        )
        return
      }
      if (trimmedId === '') {
        trimmedId = CHATGPT_CODEX_DEFAULT_MODEL
        setModelId(trimmedId)
      }
    }
    if (modelProvider === 'openrouter' && orKeyInput.trim() !== '') {
      setOrKeySaving(true)
      const w = await window.sylo.piAuth.set('openrouter', orKeyInput.trim())
      setOrKeySaving(false)
      if (!w.ok) {
        toast(`Could not save the OpenRouter key to auth.json: ${w.error}`, 'error')
        return
      }
      const k = orKeyInput.trim()
      setOrAuthHasKey(true)
      setOrAuthPreview('…' + (k.length > 12 ? k.slice(-8) : k.slice(-4)))
      setOrKeyInput('')
      setOrAuthError(null)
    }
    await window.sylo.prefs.set('sylo.model_provider', modelProvider)
    await window.sylo.prefs.set('sylo.model_id', trimmedId)
    await window.sylo.prefs.set('sylo.image_model_id', trimmedImageId)
    await window.sylo.prefs.set(
      'sylo.image_model_provider',
      trimmedImageId ? 'ollama' : '',
    )
    if (modelProvider === 'ollama') {
      await window.sylo.prefs.set('sylo.ollama_base_url', origin)
      const patch = await window.sylo.ollama.patchBaseUrl(
        origin,
        trimmedId || undefined,
        trimmedId ? modelVisionCapable : undefined,
      )
      if (!patch.ok) {
        toast(`Could not update ~/.pi/agent/models.json: ${patch.error}`, 'error')
        return
      }
      if (trimmedId) {
        setModelVisionExplicit(true)
      }
    }
    if (trimmedImageId) {
      const patchImage = await window.sylo.ollama.patchBaseUrl(origin, trimmedImageId, true)
      if (!patchImage.ok) {
        toast(`Could not register image fallback model in models.json: ${patchImage.error}`, 'error')
        return
      }
      const probed = await window.sylo.ollama.probeVision(origin, trimmedImageId)
      if (probed.ok) {
        await window.sylo.models.setVision('ollama', trimmedImageId, probed.vision)
      }
    }
    // Chat caption + AgentSession read the running broker; prefs alone do not hot-swap the model.
    await window.sylo.broker.restart()
    onProvidersChanged()
    onChanged()
  }

  return (
    <>
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={cn(cardTitle, 'mb-0')}>Model (Pi)</h2>
          <button type="button" className={btnGhostSm} onClick={() => setProvidersModalOpen(true)}>
            Manage providers
          </button>
        </div>
        <p className={leadText}>
          Leave both empty to use Pi&apos;s own defaults from <code>settings.json</code> (no Sylo override).
        </p>
        <div className="flex flex-col gap-2.5">
          <label className="flex min-w-[140px] flex-col gap-1">
            <span className={fieldLabel}>Provider</span>
            <select className={select} value={modelProvider} onChange={(e) => setModelProvider(e.target.value)}>
              <option value="">Pi default (no Sylo override)</option>
              {SYLO_MODEL_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {SYLO_MODEL_PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          {modelProvider === 'ollama' ?
            <>
              <label className="flex min-w-[140px] flex-col gap-1">
                <span className={fieldLabel}>Ollama server URL</span>
                <p className={caption}>
                  Saved to <code>~/.pi/agent/models.json</code> as OpenAI-compatible{' '}
                  <code>{normalizeOllamaOriginUi(ollamaBaseUrl) || '…'}/v1</code> (used by Pi for requests).
                </p>
                <input
                  className={input}
                  value={ollamaBaseUrl}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:11434 or http://host:11434"
                  autoComplete="off"
                />
              </label>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => void refreshOllamaTags()}
                  disabled={ollamaListLoading}
                >
                  {ollamaListLoading ? 'Loading models…' : 'Refresh model list'}
                </button>
                {ollamaTags.length > 0 ?
                  <Badge>{ollamaTags.length} local model{ollamaTags.length === 1 ? '' : 's'}</Badge>
                : null}
              </div>
              {ollamaListError ?
                <p className={errorText}>{ollamaListError}</p>
              : null}
            </>
          : null}

          {modelProvider === CHATGPT_CODEX_PROVIDER ?
            <ChatGptSignIn
              onSignedIn={() =>
                setModelId((cur) => (cur.trim() === '' ? CHATGPT_CODEX_DEFAULT_MODEL : cur))
              }
              onChange={onProvidersChanged}
            />
          : null}

          {modelProvider === 'openrouter' ?
            <div className="flex flex-col gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
              <label className="flex min-w-[140px] flex-col gap-1" htmlFor="sylo-or-key-input">
                <span className={fieldLabel}>OpenRouter API key</span>
                <input
                  id="sylo-or-key-input"
                  className={input}
                  type="password"
                  value={orKeyInput}
                  onChange={(e) => setOrKeyInput(e.target.value)}
                  placeholder="sk-or-... — create one at openrouter.ai/keys"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <p className={caption}>
                {orAuthHasKey ?
                  <>Saved key: <code>{orAuthPreview}</code>. Leave the box empty to keep it.</>
                  : <>Stored in Pi&apos;s <code>~/.pi/agent/auth.json</code>, so it survives restarts and provider switches.</>
                }
                {orKeySaving ? ' Saving…' : null}
              </p>
              {orAuthError ? <p className={errorText}>{orAuthError}</p> : null}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => void refreshOrModels()}
                  disabled={orModelsLoading}
                >
                  {orModelsLoading ? 'Loading models…' : 'Refresh free model list'}
                </button>
                {orModels.length > 0 ?
                  <Badge title={orModelsSource === 'fallback' ? 'Offline fallback list' : 'Live from openrouter.ai'}>
                    {orModels.length} free model{orModels.length === 1 ? '' : 's'}
                  </Badge>
                : null}
                {orAuthHasKey ?
                  <ConfirmButton
                    confirmLabel="Confirm remove?"
                    onConfirm={() =>
                      void (async () => {
                        const w = await window.sylo.piAuth.set('openrouter', '')
                        if (!w.ok) {
                          toast(`Could not remove the key: ${w.error}`, 'error')
                          return
                        }
                        setOrAuthHasKey(false)
                        setOrAuthPreview(null)
                        onProvidersChanged()
                        toast('OpenRouter key removed')
                      })()
                    }
                  >
                    Remove saved key
                  </ConfirmButton>
                : null}
              </div>
              {orModels.length > 0 ?
                <select
                  className={select}
                  value={modelId}
                  onChange={(e) => {
                    if (e.target.value !== '') setModelId(e.target.value)
                  }}
                  aria-label="OpenRouter free model"
                >
                  <option value="">Choose a free model… (or type any id below)</option>
                  {modelId.trim() !== '' && !orModels.some((m) => m.id === modelId) ?
                    <option value={modelId}>{modelId} (custom)</option>
                  : null}
                  {orModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.id}
                    </option>
                  ))}
                </select>
              : null}
            </div>
          : null}

          <label
            className="flex min-w-[140px] flex-col gap-1"
            htmlFor={
              modelProvider === 'ollama' ? 'sylo-ollama-model-select'
              : modelProvider === CHATGPT_CODEX_PROVIDER ? 'sylo-chatgpt-model-select'
              : 'sylo-model-id-input'
            }
          >
            <span className={fieldLabel}>
              {modelProvider === 'ollama' || modelProvider === CHATGPT_CODEX_PROVIDER ?
                'Model'
              : 'Model id'}
            </span>
            {modelProvider === 'ollama' ?
              <OllamaModelSelect modelId={modelId} setModelId={setModelId} ollamaTags={ollamaTags} />
            : modelProvider === CHATGPT_CODEX_PROVIDER ?
              <select
                id="sylo-chatgpt-model-select"
                className={select}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                aria-label="ChatGPT Codex model"
              >
                <option value="">Choose a Codex model…</option>
                {modelId.trim() !== '' && !CHATGPT_CODEX_MODELS.some((m) => m.id === modelId) ?
                  <option value={modelId}>{modelId} (custom)</option>
                : null}
                {CHATGPT_CODEX_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.id}
                    {m.vision ? '' : ' (text only)'}
                  </option>
                ))}
              </select>
            : <input
                id="sylo-model-id-input"
                className={input}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder={`e.g. ${SYLO_DEFAULT_MODEL_ID} — or leave empty for Pi default`}
              />
            }
          </label>

          {contextStatus && contextStatus.verdict !== 'ok' && contextStatus.verdict !== 'unknown' ?
            <div
              className={cn(
                'rounded-md border px-3 py-2.5 text-[0.82rem] leading-snug',
                contextStatus.verdict === 'truncating' ?
                  'border-red-500/45 bg-red-500/10 text-red-200'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-200',
              )}
            >
              <div className="font-medium">
                {contextStatus.verdict === 'truncating' ?
                  'Context window too large — Ollama will silently drop tokens'
                : contextStatus.verdict === 'wasting' ?
                  'Context window under-declared — Pi compacts early'
                : contextStatus.verdict === 'missing' ?
                  'Context window not declared — Pi assumes 128,000'
                : 'Context window is very small'}
              </div>
              <p className="mt-1 opacity-90">{contextStatus.message}</p>
              <p className="mt-1 opacity-70">
                {contextStatus.measured ?
                  'Measured from the running model — saving writes it to models.json.'
                : 'Estimated from the model card (load the model for an exact figure); saving writes it to models.json.'}
              </p>
            </div>
          : null}

          <div className="flex flex-col gap-2 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={fieldLabel}>Compaction — when context is summarized</span>
              <button
                type="button"
                className={btnGhostSm}
                disabled={!compactionHasOverride || compactionBusy}
                onClick={() => void restoreCompactionDefault()}
              >
                Restore default
              </button>
            </div>
            <p className={caption}>
              Pi summarizes older turns when context reaches the trigger. Default for this model:{' '}
              <strong>
                {compactionState ? `${formatCompactionPct(compactionState.defaultPct)}%` : '…'}
              </strong>{' '}
              of the context window.
            </p>
            <details className="m-0">
              <summary className={detailsSummary}>How compaction works</summary>
              <p className={detailsBody}>
                At the trigger, Pi summarizes older turns into a compact summary, keeping{' '}
                {PI_DEFAULT_COMPACTION_RESERVE_TOKENS.toLocaleString('en-US')} tokens of the context
                window free for it. The trigger is saved per model — switching models and back keeps
                each model&apos;s trigger.
              </p>
            </details>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-[200px] flex-col gap-1">
                <span className={fieldLabel}>Trigger at % of context window</span>
                <input
                  id="sylo-compaction-trigger-pct"
                  className={input}
                  inputMode="decimal"
                  value={compactionDraft}
                  onChange={(e) => setCompactionDraft(e.target.value)}
                  placeholder="e.g. 85"
                />
              </label>
              <button
                type="button"
                className={btnPrimary}
                disabled={!compactionDraftValid || compactionBusy}
                onClick={() => void saveCompactionOverride()}
              >
                {compactionBusy ? 'Saving…' : 'Save compaction'}
              </button>
            </div>
            {compactionDraft.trim() !== '' && !compactionDraftValid ?
              <p className={errorText}>Enter a trigger between 0 (exclusive) and 100.</p>
            : null}
            <p className={caption}>{compactionStatusLine()}</p>
          </div>

          {modelProvider === 'ollama' && modelId.trim() !== '' ?
            <div className="flex flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
              <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={modelVisionCapable}
                  onChange={(e) => {
                    setModelVisionCapable(e.target.checked)
                    setModelVisionExplicit(true)
                  }}
                />
                <span>Supports vision (image paste in chat)</span>
              </label>
              <p className={caption}>
                Detected automatically from Ollama when you save — uncheck to keep a vision model text-only.
              </p>
              <details className="m-0">
                <summary className={detailsSummary}>How detection works</summary>
                <p className={detailsBody}>
                  Pi only sends pasted screenshots when <code>models.json</code> lists{' '}
                  <code>&quot;image&quot;</code> in <code>input</code>. Sylo probes Ollama{' '}
                  <code>/api/show</code> and sets it for you on save.
                </p>
              </details>
              {visionProbeLoading ?
                <p className={caption}>Detecting vision from Ollama…</p>
              : visionProbeError ?
                <p className={errorText}>Ollama vision probe failed: {visionProbeError}</p>
              : ollamaVisionDetected !== null ?
                <p className={caption}>
                  Ollama reports: <strong>{ollamaVisionDetected ? 'vision yes' : 'vision no'}</strong>
                  {modelVisionExplicit && modelVisionCapable !== ollamaVisionDetected ?
                    ' — your saved setting overrides detection.'
                  : !modelVisionExplicit && ollamaVisionDetected ?
                    ' — will be written when you save.'
                  : null}
                </p>
              : null}
            </div>
          : null}

          <div className="flex flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
            <span className={fieldLabel}>Image model (fallback, optional)</span>
            <p className={caption}>
              Describes pasted images when the main model is <strong>text-only</strong>; ignored if the main
              model already handles vision.
            </p>
            {/* Falls back to a free-text id only when Ollama returned no tags (server down or
                unreachable), so an unreachable server can't strip the ability to set one. */}
            {ollamaTags.length > 0 ?
              <OllamaModelSelect
                id="sylo-ollama-image-model-select"
                modelId={imageModelId}
                setModelId={setImageModelId}
                ollamaTags={ollamaTags}
                emptyOptionLabel="None — path only when main model lacks vision"
              />
            : <input
                id="sylo-image-model-id-input"
                className={input}
                value={imageModelId}
                onChange={(e) => setImageModelId(e.target.value)}
                placeholder="Ollama model id (e.g. qwen3-vl:8b) — empty to disable"
              />
            }
            {ollamaTags.length === 0 ?
              <p className={caption}>
                {ollamaListLoading ?
                  'Loading Ollama models…'
                : `No models listed from ${normalizeOllamaOriginUi(ollamaBaseUrl)}/api/tags — enter an id manually or start Ollama.`
                }
              </p>
            : null}
          </div>
        </div>

        <div className="mt-2.5 flex flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
          <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={chatOnly}
              onChange={(e) => {
                const next = e.target.checked
                setChatOnly(next)
                void window.sylo.prefs.set('sylo.chat_only', next).then(async () => {
                  await window.sylo.broker.restart()
                  onChanged()
                })
              }}
            />
            <span>Chat only (no tools)</span>
          </label>
          <p className={caption}>
            Plain conversation — tools (read/bash/MCP) are never sent to the model. For local chat models
            that reject tool payloads. Applies immediately when toggled.
          </p>
        </div>

        <button type="button" className={cn(btnPrimary, 'mt-3')} onClick={() => void saveModelPrefs()}>
          Save model settings
        </button>
        <p className={cn(leadText, 'mb-0 mt-2.5')}>
          Saving restarts the broker automatically. If the agent is stuck: <strong>Developer → Restart broker</strong>.
        </p>
      </section>

      {providersModalOpen ?
        <ManageProvidersModal
          activeProvider={modelProvider}
          onProvidersChanged={onProvidersChanged}
          onClose={() => setProvidersModalOpen(false)}
        />
      : null}
    </>
  )
}