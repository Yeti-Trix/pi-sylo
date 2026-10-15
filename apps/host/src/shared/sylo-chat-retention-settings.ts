/**
 * Chat-retention settings (Settings → General → Inactive chats).
 *
 * Sylo runs a startup retention sweep (`archiveStaleConversations` in
 * `apps/host/src/main/conversation-lifecycle.ts`): chats with no activity inside
 * the retention window are ARCHIVED, not deleted — transcript, messages,
 * attachments and session file all stay; the chat leaves the sidebar main list and
 * is retrievable via the Archived section. Empty chats (zero messages) are
 * hard-deleted in the same sweep. The same window feeds the related internal
 * housekeeping prunes (stale subagent host sessions, stale web-access runs).
 *
 * The operator can turn the sweep off entirely and choose the window length in days.
 * Both values are Sylo prefs; this module is shared by the main process (sweep) and
 * the renderer (Settings UI) so both agree on pref keys, bounds, and the default.
 */

/** Pref key: auto-archive sweep enabled (boolean; default true — the historical behavior). */
export const SYLO_RETENTION_AUTO_ARCHIVE_PREF = 'sylo.retention.auto_archive'

/** Pref key: retention window in days (number; default {@link DEFAULT_RETENTION_DAYS}). */
export const SYLO_RETENTION_DAYS_PREF = 'sylo.retention.days'

/** Retention window in days when the operator has not set one (the old hard-coded value). */
export const DEFAULT_RETENTION_DAYS = 30

/** Bounds for the "days before archiving" setting. Turning the sweep off entirely is the checkbox's job. */
export const MIN_RETENTION_DAYS = 1
export const MAX_RETENTION_DAYS = 3650

export const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Coerce any user input (number or numeric string) into a valid retention window:
 * a finite integer clamped to [MIN_RETENTION_DAYS, MAX_RETENTION_DAYS], with
 * garbage falling back to the default.
 */
export function clampRetentionDays(value: unknown): number {
  const n =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.round(n)))
}

/**
 * Sanitize one stored days pref; anything unusable returns null so the caller
 * falls back to {@link DEFAULT_RETENTION_DAYS}.
 */
export function normalizeRetentionDays(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return clampRetentionDays(raw)
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw.trim(), 10)
    if (Number.isFinite(n)) return clampRetentionDays(n)
  }
  return null
}

/**
 * Sanitize the stored auto-archive flag: only a literal boolean is meaningful;
 * anything else returns null so the caller falls back to enabled=true.
 */
export function normalizeAutoArchiveEnabled(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null
}