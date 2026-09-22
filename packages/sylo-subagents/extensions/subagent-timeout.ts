/** Last-resort runaway ceiling when the agent file does not set `timeout_seconds`. */
export const DEFAULT_SUBAGENT_CEILING_MS = 7_200_000

/** Cloud / default wall-clock kill (legacy name — same as the 2h ceiling). */
export const DEFAULT_SUBAGENT_TIMEOUT_MS = DEFAULT_SUBAGENT_CEILING_MS

/** Local GPU models are slower; kept as an alias of the shared ceiling. */
export const LOCAL_SUBAGENT_TIMEOUT_MS = DEFAULT_SUBAGENT_CEILING_MS

/** Kill a silent cloud child after this long with no tokens or tool activity. */
export const DEFAULT_SUBAGENT_STALL_MS = 300_000

/** Local models can sit on first-token / GPU warmup longer than cloud. */
export const LOCAL_SUBAGENT_STALL_MS = 600_000

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

function clampTimeoutMs(ms: number): number {
  return Math.min(MAX_SUBAGENT_TIMEOUT_MS, Math.max(MIN_SUBAGENT_TIMEOUT_MS, Math.round(ms)))
}

/**
 * Hard ceiling. Agent frontmatter `timeout_seconds` still wins (scout stays at 300).
 * Otherwise this is a 2h runaway cap — working children are kept alive by the stall timer.
 */
export function resolveSubagentTimeoutMs(opts: {
  timeoutSeconds?: number
  provider?: string
}): number {
  const fromAgent = opts.timeoutSeconds
  if (typeof fromAgent === 'number' && Number.isFinite(fromAgent) && fromAgent > 0) {
    return clampTimeoutMs(fromAgent * 1000)
  }
  return DEFAULT_SUBAGENT_CEILING_MS
}

/** No-output kill. Resets on thinking/text/tool activity. */
export function resolveSubagentStallMs(opts: { provider?: string }): number {
  return isLocalModelProvider(opts.provider) ? LOCAL_SUBAGENT_STALL_MS : DEFAULT_SUBAGENT_STALL_MS
}
