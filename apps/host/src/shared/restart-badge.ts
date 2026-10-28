/** Reload-pending badge ("Restart Required") shared between the broker extension
 *  (agent tool), the main process, the preload bridge, and the renderer.
 *  App-global: any chat can raise it; it survives app close and clears only at the
 *  next launch — the restart it was waiting for (issue #44). */

export const RESTART_BADGE_MARKER = 'restart-required.json'
export const RESTART_BADGE_CHANNEL_PREFIX = 'restart-badge'

export type RestartBadgeState = {
  /** Whether a restart is pending (badge visible in the renderer). */
  required: boolean
  /** One-line reason the agent recorded when raising the badge. */
  reason: string
  /** Unix ms the badge was FIRST raised (kept across reason updates). */
  raisedAt: number | null
  /** Workspace/chat cwd that raised it, for the tooltip. */
  source: string | null
}

export function emptyRestartBadge(): RestartBadgeState {
  return { required: false, reason: '', raisedAt: null, source: null }
}

/** Reason text cap — a one-line prompt summary, not a report. */
const MAX_REASON_CHARS = 300

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Sanitize untrusted marker-file / broker-message input into a badge state. */
export function coerceRestartBadge(raw: unknown, fallback: RestartBadgeState = emptyRestartBadge()): RestartBadgeState {
  const o = asRecord(raw)
  if (!o) return { ...fallback }
  if (o.required !== true) return { ...emptyRestartBadge() }
  const reason = typeof o.reason === 'string' ? o.reason.trim().slice(0, MAX_REASON_CHARS) : ''
  const raisedAt = typeof o.raisedAt === 'number' && Number.isFinite(o.raisedAt) ? Math.round(o.raisedAt) : Date.now()
  const source = typeof o.source === 'string' && o.source.trim() ? o.source.trim().slice(0, 400) : null
  if (!reason) return { ...emptyRestartBadge() }
  return {
    required: true,
    reason,
    raisedAt,
    source: fallback.required && source === null ? fallback.source : source,
  }
}

/** Merge a NEW raise into an existing state: latest reason wins, original raisedAt kept. */
export function mergeRestartBadge(current: RestartBadgeState, incoming: RestartBadgeState): RestartBadgeState {
  return {
    required: true,
    reason: incoming.reason,
    raisedAt: current.raisedAt ?? incoming.raisedAt,
    source: incoming.source ?? current.source,
  }
}