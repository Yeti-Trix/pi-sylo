import { useEffect, useMemo, useState } from 'react'
import {
  fetchModels,
  setConversationModel,
  type Conversation,
  type ConversationModelOverride,
  type ModelChoice,
} from './api'

const GLOBAL_SENTINEL = '__sylo_global__'

function trimOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const s = v.trim()
  return s === '' ? null : s
}

/**
 * Per-chat model selector for the companion (phone) chat footer. Mirrors the
 * desktop ChatModelBar: each chat stores an optional override (null fields
 * inherit the global default from Settings). When the selected main model is
 * text-only, a second selector for the image (fallback) model appears, defaulted
 * to the global image model and overridable per chat.
 */
export function CompanionModelBar({
  conversation,
  brokerReady,
  onChanged,
}: {
  conversation: Conversation | undefined
  brokerReady: boolean
  onChanged?: () => void
}): React.ReactElement {
  const [choice, setChoice] = useState<ModelChoice | null>(null)
  const [override, setOverride] = useState<ConversationModelOverride>({
    model_provider: null,
    model_id: null,
    image_model_id: null,
    image_model_provider: null,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void fetchModels()
      .then(setChoice)
      .catch(() => setChoice(null))
  }, [])

  // Sync the override from the active conversation row.
  useEffect(() => {
    setOverride({
      model_provider: trimOrNull(conversation?.model_provider),
      model_id: trimOrNull(conversation?.model_id),
      image_model_id: trimOrNull(conversation?.image_model_id),
      image_model_provider: trimOrNull(conversation?.image_model_provider),
    })
  }, [conversation?.id, conversation?.model_provider, conversation?.model_id, conversation?.image_model_id, conversation?.image_model_provider])

  const effProvider = (override.model_provider ?? choice?.global.provider ?? '').trim()
  const effModelId = (override.model_id ?? choice?.global.modelId ?? '').trim()
  const effImageModelId = (override.image_model_id ?? choice?.global.imageModelId ?? '').trim()
  const isOllama = effProvider === 'ollama'
  const isGlobal = override.model_provider === null
  const inheritingGlobal = override.model_provider === null && override.model_id === null

  const mainVisionCapable = useMemo(() => {
    if (!choice || !isOllama || !effModelId) return false
    const hit = choice.ollamaModels.find((m) => m.id === effModelId)
    return hit?.visionCapable ?? false
  }, [choice, isOllama, effModelId])

  const showImageSelector = !mainVisionCapable && !!effModelId && !!effProvider

  const persist = async (next: ConversationModelOverride) => {
    setOverride(next)
    if (!conversation) return
    setSaving(true)
    try {
      await setConversationModel(conversation.id, next)
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  const onProviderChange = (raw: string) => {
    const provider = raw === GLOBAL_SENTINEL ? null : raw
    void persist({
      ...override,
      model_provider: provider,
      model_id: provider === null ? null : override.model_id,
    })
  }

  const onModelChange = (raw: string) => {
    const modelId = raw === GLOBAL_SENTINEL ? null : raw
    void persist({
      ...override,
      model_id: modelId,
      model_provider: modelId === null ? null : (override.model_provider ?? choice?.global.provider ?? ''),
    })
  }

  const onImageModelChange = (raw: string) => {
    const imageModelId = raw === GLOBAL_SENTINEL ? null : raw
    void persist({
      ...override,
      image_model_id: imageModelId,
      image_model_provider: imageModelId === null ? null : (override.image_model_provider ?? 'ollama'),
    })
  }

  const providerValue = override.model_provider === null ? GLOBAL_SENTINEL : override.model_provider
  const modelValue = override.model_id === null ? GLOBAL_SENTINEL : override.model_id
  const imageValue = override.image_model_id === null ? GLOBAL_SENTINEL : override.image_model_id
  const globalProviderLabel = choice?.global.provider || '(unset)'
  const globalModelLabel = choice?.global.modelId || '(unset)'
  const globalImageLabel = choice?.global.imageModelId || '(none)'

  const selectCls =
    'h-8 rounded-lg border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent disabled:opacity-40'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className={selectCls}
          value={providerValue}
          onChange={(e) => onProviderChange(e.target.value)}
          disabled={!brokerReady}
          aria-label="Model provider"
        >
          <option value={GLOBAL_SENTINEL}>Global ({globalProviderLabel})</option>
          {(choice?.providers ?? ['ollama', 'openai', 'anthropic', 'groq', 'openrouter']).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {/* Model selector — only when a specific provider is chosen (not Global). */}
        {!isGlobal ? (
          isOllama ? (
            <select
              className={`${selectCls} min-w-0 flex-1`}
              value={modelValue}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={!brokerReady}
              aria-label="Model"
            >
              <option value={GLOBAL_SENTINEL}>Global ({globalModelLabel})</option>
              {(choice?.ollamaModels ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {m.visionCapable ? ' 👁' : ''}
                </option>
              ))}
              {override.model_id && !(choice?.ollamaModels ?? []).some((m) => m.id === override.model_id) ? (
                <option value={override.model_id}>{override.model_id} (not listed)</option>
              ) : null}
            </select>
          ) : (
            <input
              className={`${selectCls} min-w-0 flex-1`}
              value={override.model_id ?? ''}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder={`Model id (global: ${globalModelLabel})`}
              disabled={!brokerReady}
              aria-label="Model id"
            />
          )
        ) : null}

        {inheritingGlobal ? (
          <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[0.62rem] text-text-secondary">
            global default
          </span>
        ) : (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[0.62rem] text-text-secondary active:bg-bg-primary"
            onClick={() =>
              void persist({
                model_provider: null,
                model_id: null,
                image_model_id: null,
                image_model_provider: null,
              })
            }
            title="Reset this chat to the global default model"
          >
            reset
          </button>
        )}
        {saving ? <span className="text-[0.62rem] text-text-secondary">saving…</span> : null}
      </div>

      {!isGlobal && showImageSelector ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.62rem] text-text-secondary">image ↦</span>
          <select
            className={`${selectCls} min-w-0 flex-1`}
            value={imageValue}
            onChange={(e) => onImageModelChange(e.target.value)}
            disabled={!brokerReady}
            aria-label="Image fallback model"
          >
            <option value={GLOBAL_SENTINEL}>Global ({globalImageLabel})</option>
            {(choice?.ollamaModels ?? [])
              .filter((m) => m.visionCapable)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            {override.image_model_id &&
            !(choice?.ollamaModels ?? []).some((m) => m.id === override.image_model_id) ? (
              <option value={override.image_model_id}>{override.image_model_id} (not listed)</option>
            ) : null}
          </select>
        </div>
      ) : null}
    </div>
  )
}