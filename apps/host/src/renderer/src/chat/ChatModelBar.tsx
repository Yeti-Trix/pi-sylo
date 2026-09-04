import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '../lib/cn'
import { select, input, mutedText } from '../panels/ui-classes'
import { normalizeOllamaOriginUi, OllamaModelSelect } from '../panels/ollama-ui'

/**
 * Per-chat model selector shown in the chat status row. Each chat stores an
 * optional override (null fields inherit the global default from Settings).
 * New chats start with the global default. When the selected main model is
 * text-only, a second selector for the image (fallback) model appears, defaulted
 * to the global image model and overridable per chat.
 *
 * Changing the model persists to the chat and asks the host to re-bind the
 * broker (switchSession re-resolves the model — no full restart).
 */

const PROVIDERS = ['ollama', 'anthropic', 'groq', 'openai', 'openrouter'] as const
type Provider = (typeof PROVIDERS)[number]

const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: 'Ollama',
  anthropic: 'Anthropic',
  groq: 'Groq',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

type GlobalDefaults = {
  provider: string
  modelId: string
  imageModelId: string
  imageModelProvider: string
  ollamaOrigin: string
}

type PerChatOverride = {
  model_provider: string | null
  model_id: string | null
  image_model_id: string | null
  image_model_provider: string | null
  /** null = Pi default thinking level for the model. */
  thinking_level: string | null
}

const THINK_DEFAULT_SENTINEL = '__think_default__'

const GLOBAL_SENTINEL = '__sylo_global__'

function trimOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const s = v.trim()
  return s === '' ? null : s
}

export function ChatModelBar({
  conversationId,
  agentReady,
}: {
  conversationId: string | undefined
  agentReady: boolean
}): React.ReactElement {
  const [globalDefaults, setGlobalDefaults] = useState<GlobalDefaults | null>(null)
  /** Effective model from the host (per-chat ?? global prefs, with SYLO default fallback). */
  const [effective, setEffective] = useState<{
    provider: string
    modelId: string
    imageModelId: string
    imageModelProvider: string
  } | null>(null)
    const [override, setOverride] = useState<PerChatOverride>({
    model_provider: null,
    model_id: null,
    image_model_id: null,
    image_model_provider: null,
    thinking_level: null,
  })
    const [ollamaTags, setOllamaTags] = useState<string[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [mainVisionCapable, setMainVisionCapable] = useState<boolean | null>(null)
  const [visionProbeLoading, setVisionProbeLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Thinking (effort) levels advertised by Pi for the effective model.
  const [thinkLevels, setThinkLevels] = useState<string[] | null>(null)
  const [thinkLevelsLoading, setThinkLevelsLoading] = useState(false)
  // Ollama tags confirmed vision-capable (probed once per tag set) so the
  // image-fallback dropdown lists only vision models.
  const [visionTags, setVisionTags] = useState<string[]>([])
  const [visionTagsLoading, setVisionTagsLoading] = useState(false)

  // Load global defaults (prefs) once.
  useEffect(() => {
    void (async () => {
      const gProvider = ((await window.sylo.prefs.get('sylo.model_provider', '')) as string).trim()
      const gModelId = ((await window.sylo.prefs.get('sylo.model_id', '')) as string).trim()
      const gImageId = ((await window.sylo.prefs.get('sylo.image_model_id', '')) as string).trim()
      const gImageProvider = ((await window.sylo.prefs.get('sylo.image_model_provider', '')) as string).trim()
      const ollamaPref = ((await window.sylo.prefs.get('sylo.ollama_base_url', '')) as string).trim()
      const ollamaOrigin = ollamaPref ? normalizeOllamaOriginUi(ollamaPref) : await window.sylo.ollama.inferBaseUrl()
      setGlobalDefaults({
        provider: gProvider,
        modelId: gModelId,
        imageModelId: gImageId,
        imageModelProvider: gImageProvider || 'ollama',
        ollamaOrigin,
      })
    })()
  }, [])

  // Load per-chat override when the conversation changes.
    useEffect(() => {
    if (!conversationId) {
      setOverride({ model_provider: null, model_id: null, image_model_id: null, image_model_provider: null, thinking_level: null })
      return
    }
    void (async () => {
      const m = await window.sylo.conversations.getModel(conversationId)
      if (!m) {
        setOverride({ model_provider: null, model_id: null, image_model_id: null, image_model_provider: null, thinking_level: null })
        return
      }
      setOverride({
        model_provider: trimOrNull(m.model_provider),
        model_id: trimOrNull(m.model_id),
        image_model_id: trimOrNull(m.image_model_id),
        image_model_provider: trimOrNull(m.image_model_provider),
        thinking_level: trimOrNull(m.thinking_level),
      })
      setEffective(m.effective)
    })()
  }, [conversationId])

  // Effective values: use the host-reported effective (per-chat ?? global, with
  // SYLO default fallback) so the vision probe targets the model the broker
  // actually binds — not a possibly-empty prefs value.
  const effProvider = (override.model_provider ?? effective?.provider ?? '').trim()
  const effModelId = (override.model_id ?? effective?.modelId ?? '').trim()
  const effImageProvider = (override.image_model_provider ?? effective?.imageModelProvider ?? 'ollama').trim()
  const isOllama = effProvider === 'ollama'
  const isGlobal = override.model_provider === null

  // Fetch ollama tags when the effective provider is ollama and we have an origin.
  useEffect(() => {
    if (!isOllama || !globalDefaults) {
      setOllamaTags([])
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        setTagsLoading(true)
        const r = await window.sylo.ollama.listTags(globalDefaults.ollamaOrigin)
        if (cancelled) return
        setTagsLoading(false)
        if (r.ok) setOllamaTags(r.models)
      })()
    }, 120)
        return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [isOllama, globalDefaults])

  // Probe vision capability for each Ollama tag so the image-fallback selector
  // can list only vision-capable models. Keyed on ollamaTags (fetched once), so
  // this runs once per tag set — not on every chat switch. Concurrency-limited
  // to avoid flooding Ollama `/api/show`.
  useEffect(() => {
    if (!globalDefaults || ollamaTags.length === 0) {
      setVisionTags([])
      setVisionTagsLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      setVisionTagsLoading(true)
      const origin = globalDefaults.ollamaOrigin
      const vision: string[] = []
      const CHUNK = 4
      for (let i = 0; i < ollamaTags.length; i += CHUNK) {
        if (cancelled) return
        const slice = ollamaTags.slice(i, i + CHUNK)
        const results = await Promise.all(
          slice.map(async (name) => {
            try {
              const r = await window.sylo.ollama.probeVision(origin, name)
              return r.ok && r.vision ? name : null
            } catch {
              return null
            }
          }),
        )
        for (const n of results) if (n) vision.push(n)
      }
      if (cancelled) return
      vision.sort((a, b) => a.localeCompare(b))
      setVisionTags(vision)
      setVisionTagsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [globalDefaults, ollamaTags])

  // Probe whether the effective main model supports vision.
  useEffect(() => {
    if (isGlobal || !effProvider || !effModelId) {
      setMainVisionCapable(null)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        setVisionProbeLoading(true)
        try {
          const r = await window.sylo.models.getInputConfig(effProvider, effModelId)
          if (cancelled) return
          if (r.ok) setMainVisionCapable(r.visionCapable)
          else setMainVisionCapable(null)
        } catch {
          if (!cancelled) setMainVisionCapable(null)
        } finally {
          if (!cancelled) setVisionProbeLoading(false)
        }
      })()
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [isGlobal, effProvider, effModelId])

  // Thinking levels for the effective model (Pi clamps unsupported levels anyway;
  // this keeps the menu honest). Re-queried when the effective provider/model id changes.
  useEffect(() => {
    if (!effProvider || !effModelId) {
      setThinkLevels(null)
      return
    }
    let cancelled = false
    void (async () => {
      setThinkLevelsLoading(true)
      const r = await window.sylo.thinking.levels(effProvider, effModelId)
      if (cancelled) return
      setThinkLevelsLoading(false)
      // null = hide the selector entirely (model doesn't report thinking support).
      if (r.ok && r.levels.length > 0) setThinkLevels(r.levels)
      else setThinkLevels(null)
    })()
    return () => {
      cancelled = true
    }
  }, [effProvider, effModelId])

  const persist = useCallback(
    async (next: PerChatOverride) => {
      setOverride(next)
      if (!conversationId) return
      setSaving(true)
      try {
        await window.sylo.conversations.setModel(conversationId, next)
      } finally {
        setSaving(false)
      }
    },
    [conversationId],
  )

  const onProviderChange = useCallback(
    (raw: string) => {
      const provider = raw === GLOBAL_SENTINEL ? null : raw
      // Reset the model override when switching to "global default" provider, so
      // the chat fully inherits the global model. Otherwise keep the model
      // override (the user can refine it next).
      const next: PerChatOverride = {
        ...override,
        model_provider: provider,
        model_id: provider === null ? null : override.model_id,
      }
      void persist(next)
    },
    [override, persist],
  )

  const onModelChange = useCallback(
    (raw: string) => {
      const modelId = raw === '' || raw === GLOBAL_SENTINEL ? null : raw
      const next: PerChatOverride = {
        ...override,
        model_id: modelId,
        // When the user picks an explicit model, also pin the provider override
        // to the effective provider so the override is self-contained.
        model_provider: modelId === null ? null : (override.model_provider ?? effective?.provider ?? 'ollama'),
      }
      void persist(next)
    },
    [override, persist, effective],
  )

  const onThinkingLevelChange = useCallback(
    (raw: string) => {
      const level = raw === THINK_DEFAULT_SENTINEL ? null : raw
      void persist({ ...override, thinking_level: level })
    },
    [override, persist],
  )

  const onImageModelChange = useCallback(
    (raw: string) => {
      const imageModelId = raw === '' || raw === GLOBAL_SENTINEL ? null : raw
      const next: PerChatOverride = {
        ...override,
        image_model_id: imageModelId,
        image_model_provider: imageModelId === null ? null : (override.image_model_provider ?? 'ollama'),
      }
      void persist(next)
    },
    [override, persist],
  )

  const showImageSelector = !mainVisionCapable && !!effModelId && !!effProvider

  const providerSelectValue = override.model_provider === null ? GLOBAL_SENTINEL : override.model_provider
  const modelSelectValue = override.model_id === null ? '' : override.model_id
  const imageSelectValue = override.image_model_id === null ? '' : override.image_model_id

  const globalProviderLabel = globalDefaults?.provider || '(unset)'
  const globalModelLabel = globalDefaults?.modelId || '(unset)'
  const globalImageLabel = globalDefaults?.imageModelId || '(none)'

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className={cn(select, 'h-7 max-w-[110px] py-0.5 text-[0.72rem]')}
          value={providerSelectValue}
          onChange={(e) => onProviderChange(e.target.value)}
          disabled={!agentReady}
          aria-label="Model provider"
          title="Model provider (global default shown in parentheses)"
        >
          <option value={GLOBAL_SENTINEL}>Global ({globalProviderLabel})</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>

        {/* Model selector — only when a specific provider is chosen (not Global). */}
        {!isGlobal ? (
          isOllama ? (
            <OllamaModelSelect
              modelId={modelSelectValue}
              setModelId={(v) => onModelChange(v)}
              ollamaTags={ollamaTags}
              emptyOptionLabel={`Global (${globalModelLabel})`}
              id="sylo-chat-model-select"
              className="h-7 min-w-0 max-w-[220px] flex-1 py-0.5 text-[0.72rem]"
            />
          ) : (
            <input
              className={cn(input, 'h-7 max-w-[200px] py-0.5 text-[0.72rem]')}
              value={override.model_id ?? ''}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder={`Model id (global: ${globalModelLabel})`}
              disabled={!agentReady}
              aria-label="Model id"
            />
          )
        ) : null}

                {tagsLoading && !isGlobal ? (
          <span className={cn(mutedText, 'text-[0.7rem]')}>loading…</span>
        ) : null}

        {/* Thinking effort — listed from the effective model's Pi-reported levels.
         * Hidden entirely when the model only reports `off` (no real effort
         * control), so the bar stays clean until a model declares usable levels. */}
        {effProvider && effModelId && thinkLevels && thinkLevels.some((l) => l !== 'off') ? (
          <select
            className={cn(select, 'h-7 max-w-[90px] py-0.5 text-[0.72rem]')}
            value={override.thinking_level ?? THINK_DEFAULT_SENTINEL}
            onChange={(e) => onThinkingLevelChange(e.target.value)}
            disabled={!agentReady || saving}
            aria-label="Thinking effort"
            title={`Thinking effort — ${override.thinking_level ?? 'default for this model'} (levels as reported by the model provider)`}
          >
            <option value={THINK_DEFAULT_SENTINEL}>think: default</option>
            {thinkLevels.map((lvl) => (
              <option key={lvl} value={lvl}>
                think: {lvl}
              </option>
            ))}
          </select>
        ) : null}
        {thinkLevelsLoading ? (
          <span className={cn(mutedText, 'text-[0.7rem]')}>thinking…</span>
        ) : null}

        {/* Image fallback selector — inline when the main model can't see images. */}
        {!isGlobal && showImageSelector ? (
          <>
            <span
              className={cn(mutedText, 'text-[0.68rem]')}
              title="The selected main model cannot see images. Pick a vision (fallback) model to describe pasted images."
            >
              image ↦
            </span>
            {effImageProvider === 'ollama' ? (
                            <OllamaModelSelect
                modelId={imageSelectValue}
                setModelId={(v) => onImageModelChange(v)}
                ollamaTags={ollamaTags}
                visionTags={visionTags}
                emptyOptionLabel={`Global (${globalImageLabel})`}
                id="sylo-chat-image-model-select"
                className="h-7 min-w-0 max-w-[220px] flex-1 py-0.5 text-[0.72rem]"
              />
            ) : (
              <input
                className={cn(input, 'h-7 max-w-[200px] py-0.5 text-[0.72rem]')}
                value={override.image_model_id ?? ''}
                onChange={(e) => onImageModelChange(e.target.value)}
                placeholder={`Image model id (global: ${globalImageLabel})`}
                aria-label="Image fallback model id"
              />
            )}
                        {visionTagsLoading ? (
              <span className={cn(mutedText, 'text-[0.7rem]')}>marking vision models…</span>
            ) : visionProbeLoading ? (
              <span className={cn(mutedText, 'text-[0.7rem]')}>checking vision…</span>
            ) : null}
          </>
        ) : null}

        {saving ? <span className={cn(mutedText, 'text-[0.7rem]')}>saving…</span> : null}
      </div>
    </div>
  )
}