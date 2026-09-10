/**
 * Per-agent subagent pin. A model is only usable as a complete pair; thinking
 * can be set on its own so a role can follow the chat model but think harder.
 */
export type SubagentModelPin = {
  provider: string
  modelId: string
  thinkingLevel?: string
}

/** Levels Pi's `--thinking` flag accepts. The model clamps anything it does not support. */
export const SUBAGENT_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export function parseSubagentPins(raw: unknown): Record<string, SubagentModelPin> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
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
    const provider = typeof entry.provider === 'string' ? entry.provider.trim() : ''
    const modelId = typeof entry.modelId === 'string' ? entry.modelId.trim() : ''
    const thinkingLevel =
      typeof entry.thinkingLevel === 'string' && entry.thinkingLevel.trim() ?
        entry.thinkingLevel.trim()
      : undefined
    if (!(provider && modelId) && !thinkingLevel) continue
    out[name] = thinkingLevel ? { provider, modelId, thinkingLevel } : { provider, modelId }
  }
  return out
}

/** Chat fields win when set; empty chat fields keep the Settings pin. */
export function mergeSubagentPins(
  globalPins: Record<string, SubagentModelPin>,
  chatPins: Record<string, SubagentModelPin>,
): Record<string, SubagentModelPin> {
  const names = new Set([...Object.keys(globalPins), ...Object.keys(chatPins)])
  const out: Record<string, SubagentModelPin> = {}
  for (const name of names) {
    const global = globalPins[name]
    const chat = chatPins[name]
    const provider = chat?.provider || global?.provider || ''
    const modelId = chat?.provider ? chat.modelId || '' : chat?.modelId || global?.modelId || ''
    const thinkingLevel = chat?.thinkingLevel || global?.thinkingLevel
    if (!(provider && modelId) && !thinkingLevel) continue
    out[name] = thinkingLevel ? { provider, modelId, thinkingLevel } : { provider, modelId }
  }
  return out
}

export function serializeSubagentPins(pins: Record<string, SubagentModelPin>): string {
  return Object.keys(pins).length > 0 ? JSON.stringify(pins) : ''
}
