import { isPiUserSlashCommand } from './pi-slash-command.js'

/**
 * Format a local datetime as `YYYY-MM-DD HH:MM:SS TZ`
 * (e.g. `2026-08-03 19:32:15 ET`).
 *
 * Uses the operator's system local time + short timezone abbreviation so the
 * model sees the same "now" the operator does.
 */
export function formatDateTimeStamp(date: Date = new Date()): string {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}:${s} ${tzAbbrev(date)}`
}

function tzAbbrev(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(date)
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value
    if (tz) return tz
  } catch {
    // fall through to offset fallback
  }
  const off = -date.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/**
 * Prepend a local datetime stamp to a message before it is sent to the model,
 * so the model always knows the operator's current date/time. The stamp lands
 * at the top of the message text, e.g.:
 *
 *   [2026-08-03 19:32:15 ET] alright we need to update sylo...
 *
 * Slash commands (e.g. `/clear`, `/reload`) and empty/whitespace-only text are
 * passed through unchanged — commands must reach the broker verbatim, and
 * there is nothing to timestamp on blank input. `/skill:` expansions are NOT
 * commands (they are real prompts) and ARE stamped.
 */
export function withDateTimeStamp(text: string): string {
  if (!text) return text
  const trimmed = text.trimStart()
  if (trimmed.length === 0) return text
  if (isPiUserSlashCommand(trimmed)) return text
  return `[${formatDateTimeStamp()}] ${text}`
}