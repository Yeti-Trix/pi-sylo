/** Persisted in SQLite `messages.content` for role=system compaction rows. */
export type CompactionNoticePayload = {
  kind: 'compaction'
  reason: 'manual' | 'threshold' | 'overflow'
  tokensBefore?: number
  /** Estimated context tokens after compaction (chars/4 heuristic). Optional; absent on older rows. */
  tokensAfter?: number
  summary?: string
  aborted?: boolean
  errorMessage?: string
}

export type CompactionReason = CompactionNoticePayload['reason']

export function compactionTriggerLabel(reason: CompactionReason): string {
  switch (reason) {
    case 'manual':
      return 'manual (/compact)'
    case 'overflow':
      return 'context overflow recovery'
    default:
      return 'auto (context threshold)'
  }
}

export function formatCompactionNoticeContent(payload: CompactionNoticePayload): string {
  return JSON.stringify(payload)
}

export function parseCompactionNoticeContent(content: string): CompactionNoticePayload | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const o = JSON.parse(trimmed) as unknown
    if (!o || typeof o !== 'object') return null
    const kind = (o as { kind?: string }).kind
    if (kind !== 'compaction') return null
    const reason = (o as { reason?: string }).reason
    if (reason !== 'manual' && reason !== 'threshold' && reason !== 'overflow') return null
    return {
      kind: 'compaction',
      reason,
      tokensBefore:
        typeof (o as { tokensBefore?: unknown }).tokensBefore === 'number' ?
          (o as { tokensBefore: number }).tokensBefore
        : undefined,
      tokensAfter:
        typeof (o as { tokensAfter?: unknown }).tokensAfter === 'number' ?
          (o as { tokensAfter: number }).tokensAfter
        : undefined,
      summary:
        typeof (o as { summary?: unknown }).summary === 'string' ?
          (o as { summary: string }).summary
        : undefined,
      aborted: (o as { aborted?: unknown }).aborted === true,
      errorMessage:
        typeof (o as { errorMessage?: unknown }).errorMessage === 'string' ?
          (o as { errorMessage: string }).errorMessage
        : undefined,
    }
  } catch {
    return null
  }
}

export function compactionNoticeTitle(payload: CompactionNoticePayload): string {
  if (payload.aborted) return 'Context compaction cancelled'
  if (payload.errorMessage) return 'Context compaction failed'
  return 'Context compacted'
}

export function compactionNoticeBody(payload: CompactionNoticePayload): string {
  if (payload.aborted) {
    return 'Older history was not summarized. The full conversation is still in context.'
  }
  if (payload.errorMessage) {
    return payload.errorMessage
  }
  const before =
    typeof payload.tokensBefore === 'number' ?
      `${payload.tokensBefore.toLocaleString()} tokens before compaction`
    : ''
  const after =
    typeof payload.tokensAfter === 'number' ?
      `${payload.tokensAfter.toLocaleString()} tokens after`
    : ''
  const tokenLine =
    before && after ? `${before} → ${after}.`
    : before ? `${before}.`
    : after ? `${after}.`
    : ''
  return (
    `${tokenLine ? tokenLine + ' ' : ''}Older turns were summarized to free context space. Recent messages are kept; ` +
    'facts from before this point may be missing unless you restate them.'
  )
}
