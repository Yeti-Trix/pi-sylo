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
 * Per-chat model selector for the companion (phone) app, rendered as a compact
 * chip for the chat header that opens a bottom sheet (mobile pattern used by
 * ChatGPT/Claude apps — model picker up top, full controls in a sheet).
 * Mirrors the desktop ChatModelBar: each chat stores an optional override
 * (null fields inherit the global default from Settings). When the selected
 * main model is text-only, a selector for the image (fallback) model appears.
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
  const [sheetOpen, setSheetOpen] = useState(false)

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

  const chipLabel = isGlobal
    ? `Global (${globalProviderLabel})`
    : `${effProvider} · ${effModelId || '(unset)'}`

  // Sheet controls: stacked full-width rows with big touch targets (mobile).
  const sheetSelectCls =
    'w-full rounded-lg border border-border bg-bg-primary px-3 py-2.5 text-base text-text-primary outline-none focus:border-accent disabled:opacity-40'

  return (
    <>
      <button
        type="button"
        className="flex min-w-0 max-w-[10rem] shrink-0 items-center gap-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-xs disabled:opacity-40"
        disabled={saving}
        onClick={() => setSheetOpen(true)}
        title="Model for this chat"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
      >
        <span className="min-w-0 truncate font-medium text-text-primary">{chipLabel}</span>
        <span
          className="shrink-0 border-l-4 border-transparent border-t-[5px] border-t-text-secondary"
          aria-hidden="true"
        />
      </button>

      {sheetOpen ? (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setSheetOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-2xl border border-border bg-bg-secondary p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="m-0 text-base font-semibold">Model for this chat</h2>
              {saving ? <span className="text-xs text-text-secondary">saving…</span> : null}
            </div>
            <p className="m-0 mb-3 text-xs text-text-secondary">
              Leave on Global to follow the desktop default (Settings → Model).
            </p>
            {!brokerReady ? (
              <p className="m-0 mb-3 text-xs text-danger">
                Desktop broker not ready — changes apply once it&apos;s back.
              </p>
            ) : null}

            <div className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1 text-xs text-text-secondary">
                Provider
                <select
                  className={sheetSelectCls}
                  value={providerValue}
                  onChange={(e) => onProviderChange(e.target.value)}
                  disabled={!brokerReady}
                  aria-label="Model provider"
                >
                  <option value={GLOBAL_SENTINEL}>Global ({globalProviderLabel})</option>
                  {(choice?.providers ?? ['ollama', 'openai-codex', 'openai', 'anthropic', 'groq', 'openrouter']).map((p) => (
                    <option key={p} value={p}>
                      {p === 'openai-codex' ? 'ChatGPT OAuth' : p === 'openai' ? 'OpenAI API' : p}
                    </option>
                  ))}
                </select>
              </label>

              {/* Model selector — only when a specific provider is chosen (not Global). */}
              {!isGlobal ? (
                isOllama ? (
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">
                    Model
                    <select
                      className={sheetSelectCls}
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
                  </label>
                ) : effProvider === 'openai-codex' ? (
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">
                    ChatGPT Codex model
                    <select
                      className={sheetSelectCls}
                      value={modelValue}
                      onChange={(e) => onModelChange(e.target.value)}
                      disabled={!brokerReady}
                      aria-label="ChatGPT Codex model"
                    >
                      <option value={GLOBAL_SENTINEL}>Global ({globalModelLabel})</option>
                      {(choice?.chatgptModels ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                      {override.model_id && !(choice?.chatgptModels ?? []).some((m) => m.id === override.model_id) ? (
                        <option value={override.model_id}>{override.model_id} (not listed)</option>
                      ) : null}
                    </select>
                  </label>
                ) : (
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">
                    Model id
                    <input
                      className={sheetSelectCls}
                      value={override.model_id ?? ''}
                      onChange={(e) => onModelChange(e.target.value)}
                      placeholder={`Model id (global: ${globalModelLabel})`}
                      disabled={!brokerReady}
                      aria-label="Model id"
                      spellCheck={false}
                    />
                  </label>
                )
              ) : null}

              {!isGlobal && showImageSelector ? (
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  <span>
                    Image fallback model <span className="text-text-secondary/70">(main model can&apos;t see images)</span>
                  </span>
                  <select
                    className={sheetSelectCls}
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
                </label>
              ) : null}

              {inheritingGlobal ? (
                <span className="self-start rounded-lg bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-secondary">
                  Following global default
                </span>
              ) : (
                <button
                  type="button"
                  className="self-start rounded-lg border border-border px-3 py-2 text-xs text-text-secondary active:bg-bg-tertiary"
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
                  Reset to global default
                </button>
              )}
            </div>

            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-accent py-3 font-medium text-bg-primary"
              onClick={() => setSheetOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}