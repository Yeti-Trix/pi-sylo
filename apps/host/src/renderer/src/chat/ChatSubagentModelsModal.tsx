import React, { useCallback, useEffect, useState } from 'react'

import {
  CHATGPT_CODEX_MODELS,
  CHATGPT_CODEX_PROVIDER,
  SYLO_MODEL_PROVIDER_LABELS,
} from '../../../shared/chatgpt-codex'
import {
  SUBAGENT_THINKING_LEVELS,
  type SubagentModelPin,
} from '../../../shared/subagent-model-pin'
import { cn } from '../lib/cn'
import { normalizeOllamaOriginUi, OllamaModelSelect } from '../panels/ollama-ui'
import { btnGhostSm, btnPrimarySm, input, mutedText, select } from '../panels/ui-classes'
import { useConfiguredProviders } from './useConfiguredProviders'

/**
 * Per-chat subagent model and thinking pins.
 *
 * Settings → Subagents sets the defaults for every chat; this narrows them for one
 * conversation. A role left on inherit uses the Settings pin, then this chat's
 * model and thinking.
 */
type AgentInfo = { name: string; description: string; source: 'builtin' | 'user' | 'project' }

function emptyPin(): SubagentModelPin {
  return { provider: '', modelId: '' }
}

function pinLabel(pin: SubagentModelPin | undefined): string {
  if (!pin?.provider || !pin.modelId) return 'the chat model'
  const provider =
    SYLO_MODEL_PROVIDER_LABELS[pin.provider as keyof typeof SYLO_MODEL_PROVIDER_LABELS] ??
    pin.provider
  return `${provider} · ${pin.modelId}`
}

function thinkingInheritLabel(
  global: SubagentModelPin | undefined,
  allThinking: string,
  chatThinking: string | null,
): string {
  const level = global?.thinkingLevel || allThinking || chatThinking
  return level ? `Inherit (${level})` : 'Inherit (model default)'
}

export function ChatSubagentModelsModal({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}): React.ReactElement {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null)
  const [chatPins, setChatPins] = useState<Record<string, SubagentModelPin>>({})
  const [globalPins, setGlobalPins] = useState<Record<string, SubagentModelPin>>({})
  const [allThinking, setAllThinking] = useState('')
  const [chatThinking, setChatThinking] = useState<string | null>(null)
  const [ollamaTags, setOllamaTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pinProviders = [
    ...Object.values(chatPins).map((p) => p.provider),
    ...Object.values(globalPins).map((p) => p.provider),
  ]
  const providers = useConfiguredProviders(pinProviders)

  // Everything loads on open rather than with the chat bar: the tag list and agent scan
  // are only worth paying for once someone actually reaches for this.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [agentRows, pins] = await Promise.all([
        window.sylo.tasks.agents().catch(() => [] as AgentInfo[]),
        window.sylo.conversations.getSubagentModels(conversationId).catch(() => null),
      ])
      if (cancelled) return
      setAgents(agentRows)
      setChatPins(pins?.chat ?? {})
      setGlobalPins(pins?.global ?? {})
      setAllThinking(pins?.allThinking ?? '')
      setChatThinking(pins?.chatThinking ?? null)

      const pref = ((await window.sylo.prefs.get('sylo.ollama_base_url', '')) as string).trim()
      const origin = pref ? normalizeOllamaOriginUi(pref) : await window.sylo.ollama.inferBaseUrl()
      const tags = await window.sylo.ollama.listTags(origin)
      if (!cancelled && tags.ok) setOllamaTags(tags.models)
    })()
    return () => {
      cancelled = true
    }
  }, [conversationId])

  const setPin = useCallback((agent: string, next: SubagentModelPin) => {
    setChatPins((prev) => ({ ...prev, [agent]: next }))
  }, [])

  const save = useCallback(async () => {
    const cleaned: Record<string, SubagentModelPin> = {}
    const incomplete: string[] = []
    for (const [agent, pin] of Object.entries(chatPins)) {
      const provider = pin.provider.trim()
      const modelId = pin.modelId.trim()
      const thinkingLevel = pin.thinkingLevel?.trim() ?? ''
      if (!provider && !thinkingLevel) continue
      // A provider without a model would hand the Pi CLI a model id that provider does
      // not serve, so a model pin only counts as a complete pair.
      if (provider && !modelId) incomplete.push(agent)
      else {
        cleaned[agent] = thinkingLevel ? { provider, modelId, thinkingLevel } : { provider, modelId }
      }
    }
    if (incomplete.length > 0) {
      setError(`Pick a model for: ${incomplete.join(', ')} — or set it back to inherit.`)
      return
    }
    setError(null)
    setSaving(true)
    const r = await window.sylo.conversations.setSubagentModels(conversationId, cleaned)
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onClose()
  }, [chatPins, conversationId, onClose])

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-[rgb(8_10_14/0.72)] px-4 py-12"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[640px] rounded-[10px] border border-border bg-bg-secondary px-[18px] py-4 shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-subagent-models-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="chat-subagent-models-title" className="m-0 text-base font-semibold">
            Subagents for this chat
          </h2>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-inherit text-[0.75rem] text-accent underline underline-offset-2 hover:text-[#8cb4ff]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <p className={cn(mutedText, 'mb-3 text-[0.82rem] leading-[1.45]')}>
          Each role runs in its own Pi session. Leave a model or think level on inherit to use
          Settings → Subagents, then this chat&apos;s model and thinking.
        </p>

        {agents === null ?
          <p className={cn(mutedText, 'text-[0.82rem]')}>Loading agents…</p>
        : agents.length === 0 ?
          <p className={cn(mutedText, 'text-[0.82rem]')}>
            No agent personas were found. Check that the subagents extension is enabled in the
            Capability manager.
          </p>
        : <div className="flex flex-col gap-3">
            {agents.map((agent) => {
              const pin = chatPins[agent.name] ?? emptyPin()
              return (
                <div key={agent.name} className="flex flex-col gap-1">
                  <span className="text-[0.84rem] text-text-primary">
                    <code className="font-mono text-[0.86em]">{agent.name}</code>
                    {agent.source !== 'builtin' ?
                      <span className={cn(mutedText, 'text-[0.74rem]')}> · {agent.source}</span>
                    : null}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className={cn(select, 'h-8 w-auto min-w-[150px] flex-none py-0.5 text-[0.78rem]')}
                      value={pin.provider}
                      // Model ids do not carry across providers, so switching clears the pair.
                      onChange={(e) =>
                        setPin(agent.name, { ...pin, provider: e.target.value, modelId: '' })
                      }
                      aria-label={`${agent.name} provider`}
                    >
                      <option value="">Inherit ({pinLabel(globalPins[agent.name])})</option>
                      {providers.map((p) => (
                        <option key={p} value={p}>
                          {SYLO_MODEL_PROVIDER_LABELS[p]}
                        </option>
                      ))}
                    </select>

                    {pin.provider === '' ?
                      null
                    : pin.provider === 'ollama' ?
                      <OllamaModelSelect
                        id={`chat-subagent-${agent.name}-ollama`}
                        className="h-8 min-w-[170px] flex-1 py-0.5 text-[0.78rem]"
                        modelId={pin.modelId}
                        setModelId={(v) => setPin(agent.name, { ...pin, modelId: v })}
                        ollamaTags={ollamaTags}
                        emptyOptionLabel="Select a model…"
                      />
                    : pin.provider === CHATGPT_CODEX_PROVIDER ?
                      <select
                        className={cn(select, 'h-8 min-w-[170px] flex-1 py-0.5 text-[0.78rem]')}
                        value={pin.modelId}
                        onChange={(e) => setPin(agent.name, { ...pin, modelId: e.target.value })}
                        aria-label={`${agent.name} model`}
                      >
                        <option value="">Select a model…</option>
                        {CHATGPT_CODEX_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    : <input
                        className={cn(input, 'h-8 min-w-[170px] flex-1 py-0.5 text-[0.78rem]')}
                        value={pin.modelId}
                        onChange={(e) => setPin(agent.name, { ...pin, modelId: e.target.value })}
                        placeholder="Model id"
                        aria-label={`${agent.name} model`}
                      />
                    }

                    <select
                      className={cn(select, 'h-8 w-auto min-w-[140px] flex-none py-0.5 text-[0.78rem]')}
                      value={pin.thinkingLevel ?? ''}
                      onChange={(e) => {
                        const thinkingLevel = e.target.value
                        setPin(
                          agent.name,
                          thinkingLevel ? { ...pin, thinkingLevel } : { provider: pin.provider, modelId: pin.modelId },
                        )
                      }}
                      aria-label={`${agent.name} thinking`}
                    >
                      <option value="">
                        {thinkingInheritLabel(globalPins[agent.name], allThinking, chatThinking)}
                      </option>
                      {SUBAGENT_THINKING_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          think: {lvl}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        }

        {error ? <p className="mt-3 mb-0 text-[0.8rem] text-danger">{error}</p> : null}

        <div className="mt-4 flex items-center gap-2">
          <button type="button" className={btnPrimarySm} onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className={btnGhostSm}
            onClick={() => setChatPins({})}
            disabled={saving}
          >
            Reset to inherit
          </button>
        </div>
      </div>
    </div>
  )
}
