/**
 * Condensing rules for Pi broker telemetry persisted in `messages.tool_calls_json`.
 *
 * The raw broker stream is overwhelmingly `thinking_delta` envelopes. One measured
 * agent turn stored 51,123 entries totalling 5.4 MB, of which 50,593 were thinking
 * deltas carrying just 159 KB of reasoning text — 96 % of the blob was the repeated
 * `{"ts":…,"event":{"type":"thinking_delta",…}}` wrapper. Because the blob is
 * rewritten in full on every flush and shipped to the renderer on every refresh,
 * that overhead is what pushes long sessions into stalls and out-of-memory kills.
 *
 * Every consumer (inline chat segments, workflow modal, markdown export) already
 * re-concatenates contiguous deltas, so merging them at persist time costs no
 * information. `thinking_start` / `thinking_end` still bracket each run, so block
 * start and end timestamps survive the merge.
 */

export type StampedToolEvent = { ts: number; event: Record<string, unknown> }

/** Longest string kept inside a persisted event (file contents, diffs, command output). */
const MAX_STRING_CHARS = 32 * 1024

/**
 * Higher ceiling for merged reasoning text: unlike tool payloads it is rendered
 * verbatim in the thought cards, and a merged run is one entry rather than tens
 * of thousands. Measured runs averaged ~4.7 KB per block.
 */
const MAX_THINKING_CHARS = 128 * 1024

/** Hard ceiling for one message's blob; oldest entries are dropped past it. */
const MAX_BLOB_CHARS = 2 * 1024 * 1024

/** Guards against pathological nesting in tool args while walking for long strings. */
const MAX_WALK_DEPTH = 12

function truncated(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n…[Sylo trimmed ${value.length - limit} characters]`
}

function condense(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return truncated(value, MAX_STRING_CHARS)
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_WALK_DEPTH) return value
  if (Array.isArray(value)) return value.map((item) => condense(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = condense(item, depth + 1)
  }
  return out
}

function isThinkingDelta(entry: StampedToolEvent | undefined): boolean {
  return entry?.event?.type === 'thinking_delta'
}

function deltaText(entry: StampedToolEvent): string {
  const raw = entry.event.delta
  return typeof raw === 'string' ? raw : ''
}

/**
 * Append broker events to a message's persisted telemetry, merging each run of
 * consecutive thinking deltas into the entry that opened it. The merged entry keeps
 * the first delta's `ts` and `_textOffset` so ordering and inline placement in the
 * chat bubble are unchanged.
 */
export function appendPersistedToolEvents(
  persisted: StampedToolEvent[],
  incoming: readonly StampedToolEvent[],
): StampedToolEvent[] {
  const out = persisted
  for (const raw of incoming) {
    const entry: StampedToolEvent = {
      ts: raw.ts,
      event: condense(raw.event, 0) as Record<string, unknown>,
    }
    const last = out[out.length - 1]
    if (last && isThinkingDelta(last) && isThinkingDelta(entry)) {
      last.event.delta = truncated(deltaText(last) + deltaText(entry), MAX_THINKING_CHARS)
      // Lets the workflow modal still report how many raw edges were folded in.
      last.event._mergedDeltas = ((last.event._mergedDeltas as number | undefined) ?? 1) + 1
      continue
    }
    out.push(entry)
  }
  return out
}

function toolCallIdOf(entry: StampedToolEvent): string {
  const raw = entry.event.toolCallId
  return typeof raw === 'string' ? raw : ''
}

/**
 * `tool_execution_start` rows for calls that have not ended yet. A tool the operator
 * is still waiting on only renders as a live run because of its start row, so trimming
 * must never drop one — a long turn that lost it showed the running subagent as
 * "starting…" (or as some earlier, already-finished run) until the turn ended.
 */
export function openToolStartEntries(entries: readonly StampedToolEvent[]): StampedToolEvent[] {
  const starts = new Map<string, StampedToolEvent>()
  for (const entry of entries) {
    const type = entry.event.type
    if (type !== 'tool_execution_start' && type !== 'tool_execution_end') continue
    const id = toolCallIdOf(entry)
    if (!id) continue
    if (type === 'tool_execution_start') starts.set(id, entry)
    else starts.delete(id)
  }
  return [...starts.values()]
}

/**
 * Serialize for SQLite, dropping the oldest entries if the blob is still over the
 * ceiling after merging. Losing the head of an extreme turn keeps the app alive;
 * a marker entry records what went away. Starts for still-open tool calls are carried
 * over regardless of age so in-flight work stays visible.
 */
export function persistedToolEventsToJson(entries: StampedToolEvent[]): string {
  let json = JSON.stringify(entries)
  if (json.length <= MAX_BLOB_CHARS) return json

  const openStarts = openToolStartEntries(entries)
  const held = new Set(openStarts)
  const kept = entries.filter((entry) => !held.has(entry))
  let dropped = 0
  json = JSON.stringify([...openStarts, ...kept])
  while (kept.length > 1 && json.length > MAX_BLOB_CHARS) {
    // Drop in chunks so an oversized blob does not re-serialize thousands of times.
    const cut = Math.max(1, Math.ceil(kept.length * 0.1))
    kept.splice(0, cut)
    dropped += cut
    json = JSON.stringify([...openStarts, ...kept])
  }
  const marker: StampedToolEvent = {
    ts: entries[0]?.ts ?? Date.now(),
    event: {
      type: 'sylo_telemetry_trimmed',
      droppedEntries: dropped,
      reason: `telemetry exceeded ${MAX_BLOB_CHARS} characters`,
    },
  }
  // Consumers sort by ts, so the carried-over starts can sit at the front.
  return JSON.stringify([marker, ...openStarts, ...kept])
}

/** Flush cadence for a message's telemetry, backing off once the blob gets large. */
export function toolFlushDelayMs(serializedChars: number): number {
  return serializedChars > 256 * 1024 ? 5000 : 1000
}
