/**
 * Lightweight perf instrumentation for the two "feels like a freeze" paths the
 * operator reported (2026-10-11): chat switching and image-attachment sends.
 *
 * Ring buffer in the main process. Every entry is (a) console.logged — it ends
 * up in the terminal when run via run-sylo.cmd / DevTools main logs — and
 * (b) kept so Developer → Testing can show the most recent entries through the
 * `perf:recent` IPC. Scope prefixes name the pipeline stage so a slow machine
 * shows exactly WHAT was loading instead of an opaque freeze.
 */

export type PerfEntry = {
  at: number
  /** Pipeline stage, e.g. `chat.load`, `chat.focusSession`, `chat.sendTurn`, `image.encode`. */
  scope: string
  /** Human description with the key counter(s) inline. */
  detail: string
  /** Milliseconds the step took, when measured. */
  ms?: number
}

const MAX_ENTRIES = 200

const ring: PerfEntry[] = []

function push(entry: PerfEntry): void {
  ring.push(entry)
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES)
  console.log(`[perf] ${entry.scope} ${entry.detail}`)
}

/** Log one measured step. */
export function perfMark(scope: string, detail: string, ms: number): void {
  push({ at: Date.now(), scope, detail, ms: Math.round(ms) })
}

/** Log an instantaneous fact (counts, skips, reasons) with no duration. */
export function perfNote(scope: string, detail: string): void {
  push({ at: Date.now(), scope, detail })
}

/** Copy of the most recent entries, newest last. */
export function perfRecent(limit = 100): PerfEntry[] {
  return ring.slice(-Math.max(1, limit))
}

/** One compact line per entry for the Testing panel renderer / clipboard. */
export function formatPerfEntry(e: PerfEntry): string {
  const timePrefix = new Date(e.at).toLocaleTimeString('en-US', { hour12: false })
  const ms = e.ms != null ? ` ${e.ms}ms` : ''
  return `${timePrefix} ${e.scope}${ms} — ${e.detail}`
}