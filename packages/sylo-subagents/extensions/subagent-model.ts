/** A model pin is only usable as a complete pair — a provider alone cannot name a model. */
export type SubagentModelPin = { provider: string; modelId: string; thinkingLevel?: string }

function pinFrom(provider: string | undefined, modelId: string | undefined): {
  provider: string
  modelId: string
} | null {
  const p = provider?.trim() ?? ''
  const m = modelId?.trim() ?? ''
  return p && m ? { provider: p, modelId: m } : null
}

function readThinking(raw: string | undefined): string {
  return raw?.trim() ?? ''
}

/**
 * Per-agent pins keyed by agent name, published as JSON by the host on every
 * init / switch_session. One merge point up there: this-chat pin → this-workspace pin →
 * global SubAgents pin, so the extension only ever sees one resolved map.
 */
function readPinsByAgent(): Record<string, SubagentModelPin> {
  const raw = process.env.SYLO_SUBAGENTS_MODEL_BY_AGENT?.trim()
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, SubagentModelPin> = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as { provider?: unknown; modelId?: unknown; thinkingLevel?: unknown }
    const model = pinFrom(
      typeof entry.provider === 'string' ? entry.provider : undefined,
      typeof entry.modelId === 'string' ? entry.modelId : undefined,
    )
    const thinkingLevel =
      typeof entry.thinkingLevel === 'string' ? readThinking(entry.thinkingLevel) : ''
    if (!model && !thinkingLevel) continue
    out[name] = {
      provider: model?.provider ?? '',
      modelId: model?.modelId ?? '',
      ...(thinkingLevel ? { thinkingLevel } : {}),
    }
  }
  return out
}

/**
 * Pi CLI flags for the model and thinking one subagent runs on.
 *
 * Model: persona pin ?? the chat's model. Thinking: persona pin ?? this chat's thinking.
 * A thinking-only pin does not steal the model from a lower level.
 */
export function subagentModelCliArgs(agentName?: string): {
  provider?: string
  modelId?: string
  thinking?: string
  args: string[]
} {
  const byAgent = agentName ? readPinsByAgent()[agentName] : undefined
  const chat = pinFrom(process.env.SYLO_MODEL_PROVIDER, process.env.SYLO_MODEL_ID)
  const resolved = pinFrom(byAgent?.provider, byAgent?.modelId) ?? chat
  const thinking = readThinking(byAgent?.thinkingLevel) || readThinking(process.env.SYLO_THINKING_LEVEL)

  const args: string[] = []
  if (resolved) {
    args.push('--provider', resolved.provider, '--model', resolved.modelId)
  } else {
    const modelId = process.env.SYLO_MODEL_ID?.trim() ?? ''
    if (modelId) args.push('--model', modelId)
  }
  if (thinking) args.push('--thinking', thinking)

  if (resolved) {
    return { provider: resolved.provider, modelId: resolved.modelId, thinking: thinking || undefined, args }
  }
  const modelId = process.env.SYLO_MODEL_ID?.trim() ?? ''
  if (modelId) return { modelId, thinking: thinking || undefined, args }
  return { thinking: thinking || undefined, args }
}