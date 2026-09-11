/** Cloud / default wall-clock kill. */
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 600_000

/** Local GPU models are slower and can stall if the display parks the GPU. */
export const LOCAL_SUBAGENT_TIMEOUT_MS = 1_800_000

export const MIN_SUBAGENT_TIMEOUT_MS = 60_000
export const MAX_SUBAGENT_TIMEOUT_MS = 7_200_000

export function isLocalModelProvider(provider: string | undefined): boolean {
  const p = provider?.trim().toLowerCase() ?? ''
  return p === '' || p === 'ollama' || p === 'lmstudio' || p === 'llamacpp' || p === 'local'
}

export function parseTimeoutSeconds(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim())
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

/** Agent frontmatter wins; otherwise local models get 30 minutes, cloud 10. */
export function resolveSubagentTimeoutMs(opts: {
  timeoutSeconds?: number
  provider?: string
}): number {
  const fromAgent = opts.timeoutSeconds
  if (typeof fromAgent === 'number' && Number.isFinite(fromAgent) && fromAgent > 0) {
    return Math.min(MAX_SUBAGENT_TIMEOUT_MS, Math.max(MIN_SUBAGENT_TIMEOUT_MS, Math.round(fromAgent * 1000)))
  }
  return isLocalModelProvider(opts.provider) ? LOCAL_SUBAGENT_TIMEOUT_MS : DEFAULT_SUBAGENT_TIMEOUT_MS
}
