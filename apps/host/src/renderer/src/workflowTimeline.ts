/**
 * Parses Pi broker workflow telemetry persisted in messages.tool_calls_json.
 * Entries are stamped as { ts, event }; legacy installs stored raw slim events without ts.
 */

export type WorkflowStampedEntry = {
  ts: number
  event: unknown
}

export type StoredTelemetryKind = 'empty' | 'stamped' | 'legacy_plain' | 'mixed'

export type TimelineSegment = {
  /** Human label for interval starting at event i through next event */
  phase: string
  ms: number
  startTs: number
  endTs: number
}

export type ToolRunSummary = {
  toolCallId: string
  toolName: string
  args: unknown
  startTs: number
  endTs: number | null
  durationMs: number | null
  isError?: boolean
  resultPreview?: unknown
}

/** How rows were persisted (legacy rows invented ~50 ms spacing → useless intervals). */
export function classifyStoredTelemetryRaw(raw: string | null): StoredTelemetryKind {
  if (!raw?.trim()) return 'empty'
  try {
    const parsed = JSON.parse(raw) as unknown
    const arr = Array.isArray(parsed) ? parsed : []
    if (arr.length === 0) return 'empty'
    let stamped = 0
    let legacy = 0
    for (const item of arr) {
      if (isStampedEnvelope(item)) stamped++
      else legacy++
    }
    if (stamped > 0 && legacy > 0) return 'mixed'
    return stamped > 0 ? 'stamped' : 'legacy_plain'
  } catch {
    return 'empty'
  }
}

function isStampedEnvelope(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const o = item as Record<string, unknown>
  return (
    typeof o.ts === 'number' &&
    'event' in o &&
    o.event !== undefined &&
    o.event !== null &&
    typeof o.event === 'object'
  )
}

/** Flatten stored JSON (+ optional live IPC tail) into monotonic chronological rows. */
export function mergedWorkflowTelemetry(
  msg: {
    id: string
    tool_calls_json: string | null
    created_at: number
    status: string
  },
  liveByMsgId: Record<string, WorkflowStampedEntry[]>,
): WorkflowStampedEntry[] {
  const fromDb = normalizeStoredWorkflowJson(msg.tool_calls_json, msg.created_at)
  let rows = fromDb
  if (msg.status === 'streaming') {
    const tail = liveByMsgId[msg.id] ?? []
    rows = [...fromDb, ...tail]
  }
  rows = dedupe(rows)
  return rows.slice().sort((a, b) => a.ts - b.ts || 0)
}

function dedupe(entries: WorkflowStampedEntry[]): WorkflowStampedEntry[] {
  const seen = new Set<string>()
  const out: WorkflowStampedEntry[] = []
  for (const r of entries) {
    try {
      const k = `${r.ts}\u0001${typeof r.event === 'string' ? r.event : JSON.stringify(r.event)}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(r)
    } catch {
      const k = `${r.ts}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(r)
    }
  }
  return out
}

/** Accepts both legacy `{ type: ... }[]` rows and stamped `{ ts, event }`. */
export function normalizeStoredWorkflowJson(
  raw: string | null,
  messageCreatedAt: number,
): WorkflowStampedEntry[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    const arr = Array.isArray(parsed) ? parsed : []
    return arr.map((item, idx) => coerceEntry(item as unknown, messageCreatedAt + idx * 50))
  } catch {
    return []
  }
}

function coerceEntry(item: unknown, fallbackTs: number): WorkflowStampedEntry {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const o = item as Record<string, unknown>
    if ('ts' in o && 'event' in o) {
      const ts = typeof o.ts === 'number' ? o.ts : fallbackTs
      return { ts, event: o.event }
    }
  }
  return { ts: fallbackTs, event: item }
}

export type TurnEnvelope = {
  /** First `turn_start` timestamp seen in this telemetry window. */
  turnStartTs: number | null
  /** Matching `turn_end` timestamp (same turn assumption: one turn per assistant reply). */
  turnEndTs: number | null
}

export function findTurnEnvelope(entries: WorkflowStampedEntry[]): TurnEnvelope {
  let turnStartTs: number | null = null
  let turnEndTs: number | null = null
  for (const row of entries) {
    const ev = row.event
    if (!ev || typeof ev !== 'object') continue
    const t = (ev as { type?: string }).type
    if (t === 'turn_start' && turnStartTs === null) turnStartTs = row.ts
    if (t === 'turn_end') turnEndTs = row.ts
  }
  return { turnStartTs, turnEndTs }
}

/** Wall-clock duration for an assistant reply (turn envelope preferred). */
export function assistantTurnDurationMs(
  entries: WorkflowStampedEntry[],
  assistantCreatedAt: number,
): number | null {
  const turnEnv = findTurnEnvelope(entries)
  if (turnEnv.turnStartTs !== null && turnEnv.turnEndTs !== null) {
    return Math.max(0, turnEnv.turnEndTs - turnEnv.turnStartTs)
  }
  const span = totalSpanMs(entries)
  if (span !== null) return span
  if (entries.length > 0) {
    const sorted = entries.slice().sort((a, b) => a.ts - b.ts || 0)
    const last = sorted[sorted.length - 1]
    return Math.max(0, last!.ts - assistantCreatedAt)
  }
  return null
}

function assistantStreamType(ev: unknown): string | undefined {
  if (!ev || typeof ev !== 'object') return undefined
  const o = ev as Record<string, unknown>
  if (o.type !== 'message_update') return undefined
  return typeof o.assistantType === 'string' ? o.assistantType : undefined
}

/**
 * Reasoning chunks may arrive in either shape:
 * - Newer broker (>=0.1): typed `thinking_start | thinking_delta | thinking_end` envelopes
 *   carrying `delta` (text) so the UI can render the actual reasoning.
 * - Older broker: collapsed `message_update` envelopes whose `assistantType` is `thinking_*`
 *   (text not preserved). Still treated as thinking for spinner/duration purposes.
 */
export function isThinkingStreamEvent(ev: unknown): boolean {
  if (!ev || typeof ev !== 'object') return false
  const o = ev as Record<string, unknown>
  if (typeof o.type === 'string') {
    if (o.type === 'thinking_start' || o.type === 'thinking_delta' || o.type === 'thinking_end') {
      return true
    }
  }
  const at = assistantStreamType(ev)
  return at !== undefined && (at === 'thinking' || at.startsWith('thinking_'))
}

function thinkingDeltaText(ev: unknown): string | null {
  if (!ev || typeof ev !== 'object') return null
  const o = ev as Record<string, unknown>
  if (o.type !== 'thinking_delta') return null
  return typeof o.delta === 'string' ? o.delta : null
}

/** Wall-clock collapsed thinking blocks between non-thinking telemetry. */
export function thinkingWallBlocks(entries: WorkflowStampedEntry[]): { startTs: number; endTs: number; ms: number }[] {
  const sorted = entries.slice().sort((a, b) => a.ts - b.ts || 0)
  const blocks: { startTs: number; endTs: number; ms: number }[] = []
  let openStart: number | null = null
  let openEnd: number | null = null
  const flush = () => {
    if (openStart !== null && openEnd !== null && openEnd >= openStart) {
      blocks.push({ startTs: openStart, endTs: openEnd, ms: openEnd - openStart })
    }
    openStart = null
    openEnd = null
  }
  for (const row of sorted) {
    if (isThinkingStreamEvent(row.event)) {
      if (openStart === null) openStart = row.ts
      openEnd = row.ts
    } else {
      flush()
    }
  }
  flush()
  return blocks
}

export function extractToolRuns(entries: WorkflowStampedEntry[]): ToolRunSummary[] {
  const sorted = entries.slice().sort((a, b) => a.ts - b.ts || 0)
  type Pending = { toolCallId: string; toolName: string; args: unknown; startTs: number }
  const pending = new Map<string, Pending>()
  const done: ToolRunSummary[] = []
  for (const row of sorted) {
    const ev = row.event
    if (!ev || typeof ev !== 'object') continue
    const o = ev as Record<string, unknown>
    switch (o.type) {
      case 'tool_execution_start': {
        const id = String(o.toolCallId ?? '')
        if (!id) break
        pending.set(id, {
          toolCallId: id,
          toolName: typeof o.toolName === 'string' ? o.toolName : '?',
          args: 'args' in o ? o.args : undefined,
          startTs: row.ts,
        })
        break
      }
      case 'tool_execution_end': {
        const id = String(o.toolCallId ?? '')
        if (!id) break
        const base = pending.get(id)
        if (base) {
          done.push({
            toolCallId: id,
            toolName: base.toolName || (typeof o.toolName === 'string' ? o.toolName : '?'),
            args: base.args,
            startTs: base.startTs,
            endTs: row.ts,
            durationMs: Math.max(0, row.ts - base.startTs),
            isError: Boolean(o.isError),
            resultPreview: 'resultSummary' in o ? o.resultSummary : undefined,
          })
          pending.delete(id)
        } else {
          done.push({
            toolCallId: id,
            toolName: typeof o.toolName === 'string' ? o.toolName : '?',
            args: undefined,
            startTs: row.ts,
            endTs: row.ts,
            durationMs: 0,
            isError: Boolean(o.isError),
            resultPreview: 'resultSummary' in o ? o.resultSummary : undefined,
          })
        }
        break
      }
      default:
        break
    }
  }
  for (const left of pending.values()) {
    done.push({
      toolCallId: left.toolCallId,
      toolName: left.toolName,
      args: left.args,
      startTs: left.startTs,
      endTs: null,
      durationMs: null,
    })
  }
  return done.slice().sort((a, b) => a.startTs - b.startTs || 0)
}

export type SummaryBar = {
  key: string
  label: string
  ms: number
}

/** Compact chart rows: collapsed thinking segments + actual tool durations. */
export function buildSummaryBars(
  entries: WorkflowStampedEntry[],
  toolRuns: ToolRunSummary[],
): SummaryBar[] {
  const bars: SummaryBar[] = []
  const thinkBlocks = thinkingWallBlocks(entries)
  thinkBlocks.forEach((b, i) => {
    bars.push({
      key: `think-${i}-${b.startTs}`,
      label: thinkBlocks.length > 1 ? `Thinking stream (${i + 1})` : 'Thinking stream',
      ms: Math.max(b.ms, 1),
    })
  })
  for (let i = 0; i < toolRuns.length; i++) {
    const run = toolRuns[i]!
    const ms =
      typeof run.durationMs === 'number' && run.durationMs > 0 ? run.durationMs
      : run.endTs === null ?
        0
      : 1
    if (ms <= 0) continue
    bars.push({
      key: `${run.toolCallId}-${i}`,
      label: `Tool: ${run.toolName}`,
      ms,
    })
  }
  return bars
}

export function formatEventBrief(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return typeof ev === 'string' ? ev : '?'
  const o = ev as Record<string, unknown>
  switch (o.type) {
    case 'message_update': {
      const at = o.assistantType ? String(o.assistantType) : '(stream)'
      return `Assistant stream (${at})`
    }
    case 'tool_execution_start':
      return `Tool start: ${typeof o.toolName === 'string' ? o.toolName : '?'}`
    case 'tool_execution_update':
      return `Tool streaming: ${typeof o.toolName === 'string' ? o.toolName : '?'}`
    case 'tool_execution_end':
      return `Tool end: ${typeof o.toolName === 'string' ? o.toolName : '?'}`
    default:
      return typeof o.type === 'string' ? o.type.replace(/_/g, ' ') : '?'
  }
}

/** One row in a collapsed raw timeline (consecutive identical brief labels merged). */
export type CollapsedTimelineRow = {
  key: string
  startTs: number
  endTs: number
  spanMs: number
  brief: string
  eventCount: number
}

/**
 * Merges consecutive telemetry rows that share the same {@link formatEventBrief} label
 * (e.g. dozens of `thinking delta` or `Tool streaming: grep` edges → one row).
 */
export function collapseConsecutiveTimelineEvents(
  entries: WorkflowStampedEntry[],
): CollapsedTimelineRow[] {
  const sorted = entries.slice().sort((a, b) => a.ts - b.ts || 0)
  if (sorted.length === 0) return []

  const out: CollapsedTimelineRow[] = []
  let runStart = sorted[0]!
  let runEnd = sorted[0]!
  let runBrief = formatEventBrief(runStart.event)
  let runCount = 1

  const flush = () => {
    out.push({
      key: `${runStart.ts}-${runBrief}-${runCount}`,
      startTs: runStart.ts,
      endTs: runEnd.ts,
      spanMs: Math.max(runCount > 1 ? 1 : 0, runEnd.ts - runStart.ts),
      brief: runBrief,
      eventCount: runCount,
    })
  }

  for (let i = 1; i < sorted.length; i++) {
    const row = sorted[i]!
    const brief = formatEventBrief(row.event)
    if (brief === runBrief) {
      runEnd = row
      runCount++
    } else {
      flush()
      runStart = row
      runEnd = row
      runBrief = brief
      runCount = 1
    }
  }
  flush()
  return out
}

function formatTimelineWallTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Markdown / plain line for export and workflow modal raw lists. */
export function formatCollapsedTimelineLine(
  row: CollapsedTimelineRow,
  index: number,
  prevEndTs: number | null,
): string {
  const gap =
    prevEndTs !== null ?
      `${formatDurationMs(Math.max(1, row.startTs - prevEndTs))} after prev · `
    : ''
  if (row.eventCount > 1) {
    const wall =
      row.startTs === row.endTs ?
        formatTimelineWallTime(row.startTs)
      : `${formatTimelineWallTime(row.startTs)}–${formatTimelineWallTime(row.endTs)}`
    return `${index + 1}. +${gap}${wall} — ${row.brief} (${row.eventCount}×, ${formatDurationMs(row.spanMs)} span)`
  }
  return `${index + 1}. +${gap}${formatTimelineWallTime(row.startTs)} — ${row.brief}`
}

/** Builds wall-clock gaps between successive broker-visible events on this turn (proxy for latency). */
export function timelineSegments(entries: WorkflowStampedEntry[]): TimelineSegment[] {
  if (entries.length < 2) return []
  const sorted = entries.slice().sort((a, b) => a.ts - b.ts || 0)
  const segments: TimelineSegment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    const rawMs = b.ts - a.ts
    const ms = rawMs <= 0 ? 1 : rawMs
    segments.push({
      phase: formatEventBrief(a.event),
      ms,
      startTs: a.ts,
      endTs: b.ts,
    })
  }
  return segments
}

export function totalSpanMs(entries: WorkflowStampedEntry[]): number | null {
  if (entries.length < 2) return null
  const sorted = entries.slice().sort((a, b) => a.ts - b.ts || 0)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return last!.ts - first!.ts
}

/**
 * Inline chat segments shown in the assistant bubble during/after streaming.
 * Built by walking telemetry rows in chronological order and grouping contiguous
 * thinking deltas + interleaving them with completed/in-flight tool runs.
 */
export type AssistantSegment =
  | {
      kind: 'thinking'
      id: string
      startTs: number
      endTs: number | null
      /**
       * Cumulative assistant text length at the moment this block began (stamped by
       * main as `_textOffset`). Used to splice segment cards between markdown chunks.
       * `null` means we have no offset (legacy persisted rows) and the renderer
       * falls back to placing the segment after the entire body.
       */
      textOffset: number | null
      /** Concatenated reasoning text from contiguous thinking deltas. May be empty for legacy rows. */
      text: string
      /** True until we observe a non-thinking event (tool/text) after this block. */
      live: boolean
    }
  | {
      kind: 'tool'
      id: string
      toolName: string
      args: unknown
      startTs: number
      endTs: number | null
      durationMs: number | null
      isError: boolean
      /** See thinking.textOffset; uses the offset captured at tool_execution_start. */
      textOffset: number | null
      /** Truncated result preview captured at tool_execution_end. */
      resultPreview: unknown
    }
  | {
      kind: 'compaction'
      id: string
      reason: string
      startTs: number
      endTs: number | null
      tokensBefore: number | null
      tokensAfter: number | null
      summary: string | null
      live: boolean
      textOffset: number | null
    }

function readTextOffset(ev: unknown): number | null {
  if (!ev || typeof ev !== 'object') return null
  const o = ev as Record<string, unknown>
  return typeof o._textOffset === 'number' ? o._textOffset : null
}

/**
 * Walks merged telemetry in chronological order, producing inline segments for the chat bubble.
 *
 * Scheduling assumption: tool runs and reasoning streams interleave naturally, so a tool segment's
 * sort key is its `tool_execution_start` ts. Thinking blocks group contiguous `thinking_*` rows
 * (broken by any other event). A still-streaming reasoning block stays `live: true` until
 * something else is observed, so the renderer can pulse the chevron.
 */
export function buildAssistantSegments(
  entries: WorkflowStampedEntry[],
): AssistantSegment[] {
  const sorted = entries.slice().sort((a, b) => a.ts - b.ts || 0)
  const segments: AssistantSegment[] = []

  type PendingThink = {
    startTs: number
    endTs: number
    text: string
    textOffset: number | null
  }
  let openThink: PendingThink | null = null
  const flushThink = (live: boolean) => {
    if (!openThink) return
    segments.push({
      kind: 'thinking',
      id: `think-${openThink.startTs}`,
      startTs: openThink.startTs,
      endTs: live ? null : openThink.endTs,
      textOffset: openThink.textOffset,
      text: openThink.text,
      live,
    })
    openThink = null
  }

  type PendingTool = {
    toolCallId: string
    toolName: string
    args: unknown
    startTs: number
    textOffset: number | null
  }
  const pendingTools = new Map<string, PendingTool>()

  for (const row of sorted) {
    const ev = row.event
    if (!ev || typeof ev !== 'object') continue
    const o = ev as Record<string, unknown>
    const t = typeof o.type === 'string' ? o.type : ''
    const offset = readTextOffset(ev)

    if (isThinkingStreamEvent(ev)) {
      const delta = thinkingDeltaText(ev) ?? ''
      if (!openThink) {
        openThink = { startTs: row.ts, endTs: row.ts, text: delta, textOffset: offset }
      } else {
        openThink.endTs = row.ts
        openThink.text += delta
        if (openThink.textOffset === null) openThink.textOffset = offset
      }
      continue
    }

    flushThink(false)

    if (t === 'tool_execution_start') {
      const id = String(o.toolCallId ?? '')
      if (!id) continue
      pendingTools.set(id, {
        toolCallId: id,
        toolName: typeof o.toolName === 'string' ? o.toolName : '?',
        args: 'args' in o ? o.args : undefined,
        startTs: row.ts,
        textOffset: offset,
      })
      segments.push({
        kind: 'tool',
        id: `tool-${id}-${row.ts}`,
        toolName: typeof o.toolName === 'string' ? o.toolName : '?',
        args: 'args' in o ? o.args : undefined,
        startTs: row.ts,
        endTs: null,
        durationMs: null,
        isError: false,
        textOffset: offset,
        resultPreview: undefined,
      })
      continue
    }
    if (t === 'tool_execution_end') {
      const id = String(o.toolCallId ?? '')
      if (!id) continue
      const start = pendingTools.get(id)
      pendingTools.delete(id)
      const segId = start ? `tool-${id}-${start.startTs}` : `tool-${id}-${row.ts}`
      const ix = segments.findIndex((s) => s.kind === 'tool' && s.id === segId)
      const endTs = row.ts
      const startTs = start?.startTs ?? row.ts
      const finalized: AssistantSegment = {
        kind: 'tool',
        id: segId,
        toolName:
          start?.toolName ?? (typeof o.toolName === 'string' ? o.toolName : '?'),
        args: start?.args,
        startTs,
        endTs,
        durationMs: Math.max(0, endTs - startTs),
        isError: Boolean(o.isError),
        textOffset: start?.textOffset ?? offset,
        resultPreview: 'resultSummary' in o ? o.resultSummary : undefined,
      }
      if (ix >= 0) segments[ix] = finalized
      else segments.push(finalized)
      continue
    }
    if (t === 'compaction_start') {
      segments.push({
        kind: 'compaction',
        id: `compaction-${row.ts}`,
        reason: typeof o.reason === 'string' ? o.reason : 'threshold',
        startTs: row.ts,
        endTs: null,
        tokensBefore: null,
        tokensAfter: null,
        summary: null,
        live: true,
        textOffset: offset,
      })
      continue
    }
    if (t === 'compaction_end') {
      const segId = `compaction-${row.ts}`
      const openIx = segments.findIndex((s) => s.kind === 'compaction' && s.live)
      const finalized: AssistantSegment = {
        kind: 'compaction',
        id: openIx >= 0 ? segments[openIx]!.id : segId,
        reason: typeof o.reason === 'string' ? o.reason : 'threshold',
        startTs: openIx >= 0 ? (segments[openIx] as Extract<AssistantSegment, { kind: 'compaction' }>).startTs : row.ts,
        endTs: row.ts,
        tokensBefore: typeof o.tokensBefore === 'number' ? o.tokensBefore : null,
        tokensAfter: typeof o.tokensAfter === 'number' ? o.tokensAfter : null,
        summary: typeof o.summary === 'string' ? o.summary : null,
        live: false,
        textOffset: openIx >= 0 ? segments[openIx]!.textOffset : offset,
      }
      if (openIx >= 0) segments[openIx] = finalized
      else segments.push(finalized)
      continue
    }
    // Unknown / text_delta / lifecycle envelopes: ignore for inline segments.
  }

  flushThink(true)
  // Some providers (e.g. Ollama thinking models) emit a follow-on thinking_* span with no deltas
  // (timing-only / lifecycle). Those become empty 0 ms cards next to real thoughts — drop them once
  // finished; keep empty blocks only while still `live` so the in-flight spinner can show.
  return segments.filter((s) => {
    if (s.kind !== 'thinking') return true
    if (s.text.trim()) return true
    return s.live
  })
}

/** Same sort order as inline chat interleaving (offset, then start time). */
export function orderAssistantSegments(segments: AssistantSegment[]): AssistantSegment[] {
  return segments.slice().sort((a, b) => {
    const ao = a.textOffset ?? Number.POSITIVE_INFINITY
    const bo = b.textOffset ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    return a.startTs - b.startTs
  })
}

/**
 * Assistant reply text when workflow cards are collapsed: only the tail after the
 * last stamped segment offset. Omits preamble and between-step fragments that
 * render inline while streaming.
 */
export function collapsedAssistantAnswerText(
  body: string,
  segments: AssistantSegment[],
): string {
  if (segments.length === 0) return body
  if (!segments.some((s) => s.textOffset !== null)) return body

  const ordered = orderAssistantSegments(segments)
  let cursor = 0
  for (const seg of ordered) {
    const rawOffset = seg.textOffset ?? body.length
    cursor = Math.max(cursor, Math.min(rawOffset, body.length))
  }
  const tail = body.slice(cursor)
  return tail.trim().length > 0 ? tail : body
}

/** Minimum wall gap before we show an inline “between cards” row in chat. */
export const CHAT_INLINE_GAP_MIN_MS = 50

export type ChatInlineGap = {
  id: string
  ms: number
  label: string
  placement: 'lead' | 'between'
  /** Insert immediately before the segment with this id. */
  beforeSegmentId: string
}

function assistantSegmentEndTs(seg: AssistantSegment): number | null {
  return seg.endTs
}

/**
 * Gaps to render between inline Thought/Tool cards (same sort order as InterleavedAssistantBody).
 * `leadAnchorTs` is usually the assistant message `created_at`.
 */
/** Shown while no stamped telemetry yet (broker + model TTFT, not reasoning channel). */
export function labelLeadChatGap(): string {
  return 'Waiting for first output'
}

/** Wall-clock gap between two inline cards; not the same as “thinking” duration. */
export function labelBetweenChatSegments(prev: AssistantSegment, curr: AssistantSegment): string {
  if (prev.kind === 'thinking' && curr.kind === 'tool') {
    return 'Preparing tool call'
  }
  if (prev.kind === 'tool' && curr.kind === 'thinking') {
    return 'Processing tool results'
  }
  if (prev.kind === 'tool' && curr.kind === 'tool') {
    return 'Between tool calls'
  }
  if (prev.kind === 'thinking' && curr.kind === 'thinking') {
    return 'Between reasoning blocks'
  }
  return 'Between steps'
}

export type LiveOpenChatGap = {
  label: string
  startTs: number
}

/**
 * While the assistant message is still streaming, returns an in-flight gap row when
 * nothing has a live segment card (reasoning/tool) but work may still be happening.
 */
export function liveOpenChatGap(
  ordered: AssistantSegment[],
  leadAnchorTs: number,
  isStreaming: boolean,
): LiveOpenChatGap | null {
  if (!isStreaming) return null

  if (ordered.length === 0) {
    return { label: labelLeadChatGap(), startTs: leadAnchorTs }
  }

  const last = ordered[ordered.length - 1]!
  if (last.kind === 'thinking' && last.live) return null
  if (last.kind === 'tool' && last.endTs === null) return null

  const endTs = last.endTs
  if (endTs === null) return null

  if (last.kind === 'thinking') {
    return { label: 'Preparing tool call', startTs: endTs }
  }
  if (last.kind === 'tool') {
    return { label: 'Processing tool results', startTs: endTs }
  }
  return null
}

export function gapsForOrderedChatSegments(
  ordered: AssistantSegment[],
  leadAnchorTs: number,
): ChatInlineGap[] {
  const gaps: ChatInlineGap[] = []
  if (ordered.length === 0) return gaps

  const first = ordered[0]!
  const leadMs = first.startTs - leadAnchorTs
  if (leadMs >= CHAT_INLINE_GAP_MIN_MS) {
    gaps.push({
      id: `lead-${first.id}`,
      ms: leadMs,
      label: labelLeadChatGap(),
      placement: 'lead',
      beforeSegmentId: first.id,
    })
  }

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!
    const curr = ordered[i]!
    const prevEnd = assistantSegmentEndTs(prev)
    if (prevEnd === null) continue
    const ms = curr.startTs - prevEnd
    if (ms < CHAT_INLINE_GAP_MIN_MS) continue
    gaps.push({
      id: `between-${prev.id}-${curr.id}`,
      ms,
      label: labelBetweenChatSegments(prev, curr),
      placement: 'between',
      beforeSegmentId: curr.id,
    })
  }
  return gaps
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 800) return `${Math.round(ms)} ms`
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}

/** One interval the chat UI does not label (or only partially covers). */
export type WorkflowTimingGap = {
  id: string
  label: string
  ms: number
  startTs: number
  endTs: number
  /** Where the gap lives in the pipeline. */
  stage:
    | 'before_telemetry'
    | 'between_telemetry_events'
    | 'between_chat_segments'
    | 'after_last_segment'
  /** Shown in workflow modal / tests. */
  detail: string
}

export type WorkflowTimingAudit = {
  gaps: WorkflowTimingGap[]
  /** Sum of thinking + tool durations shown inline in chat (overlaps excluded). */
  chatVisibleMs: number
  /** First→last stamped telemetry row, when ≥2 rows. */
  telemetryWindowMs: number | null
  /** telemetryWindowMs − chatVisibleMs (rough); large ⇒ lots of untracked wall time. */
  untrackedInWindowMs: number | null
  flags: string[]
}

function eventType(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return ''
  const t = (ev as { type?: string }).type
  return typeof t === 'string' ? t : ''
}

function segmentEndTs(seg: AssistantSegment): number | null {
  if (seg.kind === 'thinking') return seg.endTs
  return seg.endTs
}

function segmentLabel(seg: AssistantSegment): string {
  if (seg.kind === 'thinking') return seg.text.trim() ? 'Thought' : 'Thinking (no text)'
  if (seg.kind === 'compaction') return seg.live ? 'Compacting context' : 'Context compacted'
  return `Tool: ${seg.toolName}`
}

function pushGap(
  gaps: WorkflowTimingGap[],
  partial: Omit<WorkflowTimingGap, 'ms'> & { ms?: number },
): void {
  const ms = partial.ms ?? Math.max(0, partial.endTs - partial.startTs)
  if (ms <= 0) return
  gaps.push({ ...partial, ms })
}

/**
 * Surfaces wall-clock intervals that are **not** shown on inline chat segment cards.
 * Use from Workflow modal or unit tests with fixture telemetry.
 */
export function auditWorkflowTiming(input: {
  assistantCreatedAt: number
  precedingUserCreatedAt?: number | null
  entries: WorkflowStampedEntry[]
}): WorkflowTimingAudit {
  const { assistantCreatedAt, precedingUserCreatedAt, entries } = input
  const sorted = entries.slice().sort((a, b) => a.ts - b.ts || 0)
  const gaps: WorkflowTimingGap[] = []
  const flags: string[] = []

  if (precedingUserCreatedAt != null && precedingUserCreatedAt > 0) {
    pushGap(gaps, {
      id: 'user-to-assistant-row',
      label: 'User sent → assistant row created',
      startTs: precedingUserCreatedAt,
      endTs: assistantCreatedAt,
      stage: 'before_telemetry',
      detail:
        'SQLite inserts the user row, then immediately creates the empty streaming assistant row. Broker prompt runs after session bind.',
    })
  }

  const firstRow = sorted[0]
  if (firstRow) {
    pushGap(gaps, {
      id: 'assistant-to-first-telemetry',
      label: 'Assistant row → first stamped event',
      startTs: assistantCreatedAt,
      endTs: firstRow.ts,
      stage: 'before_telemetry',
      detail: `Includes broker IPC, Pi session.prompt(), and provider latency until first non–text_delta event (${formatEventBrief(firstRow.event)}). text_delta is not stamped.`,
    })
  } else {
    flags.push('no_telemetry_rows')
  }

  const turnEnv = findTurnEnvelope(sorted)
  if (turnEnv.turnStartTs !== null && turnEnv.turnStartTs > assistantCreatedAt) {
    pushGap(gaps, {
      id: 'assistant-to-turn-start',
      label: 'Assistant row → turn_start',
      startTs: assistantCreatedAt,
      endTs: turnEnv.turnStartTs,
      stage: 'before_telemetry',
      detail: 'Pi turn_start when present; may overlap assistant→first-telemetry if turn_start is first row.',
    })
  } else if (sorted.length > 0) {
    flags.push('no_turn_start')
  }

  let firstThinkingTs: number | null = null
  for (const row of sorted) {
    if (isThinkingStreamEvent(row.event)) {
      firstThinkingTs = row.ts
      break
    }
  }
  if (firstThinkingTs !== null && firstRow && firstThinkingTs > firstRow.ts) {
    pushGap(gaps, {
      id: 'first-telemetry-to-thinking',
      label: 'First stamped event → first thinking',
      startTs: firstRow.ts,
      endTs: firstThinkingTs,
      stage: 'between_telemetry_events',
      detail: 'Lifecycle or tool events before reasoning channel opens.',
    })
  }

  const segments = buildAssistantSegments(sorted)
  let chatVisibleMs = 0
  for (const seg of segments) {
    const end = segmentEndTs(seg)
    if (seg.kind === 'tool' && seg.durationMs !== null) {
      chatVisibleMs += seg.durationMs
    } else if (seg.kind === 'thinking' && end !== null) {
      chatVisibleMs += Math.max(0, end - seg.startTs)
    }
  }

  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i]!
    const b = segments[i + 1]!
    const aEnd = segmentEndTs(a)
    if (aEnd === null) continue
    if (b.startTs <= aEnd) continue
    pushGap(gaps, {
      id: `segment-gap-${i}`,
      label: `${segmentLabel(a)} → ${segmentLabel(b)}`,
      startTs: aEnd,
      endTs: b.startTs,
      stage: 'between_chat_segments',
      detail: 'Not shown on inline cards; may include thinking_end, turn events, provider silence, or unstamped text_delta.',
    })
  }

  const lastSeg = segments[segments.length - 1]
  const lastSegEnd = lastSeg ? segmentEndTs(lastSeg) : null
  const lastRow = sorted[sorted.length - 1]
  if (lastSeg && lastSegEnd !== null && lastRow && lastRow.ts > lastSegEnd) {
    pushGap(gaps, {
      id: 'last-segment-to-last-telemetry',
      label: `${segmentLabel(lastSeg)} → last stamped event`,
      startTs: lastSegEnd,
      endTs: lastRow.ts,
      stage: 'after_last_segment',
      detail: 'Tail after final thinking/tool block (e.g. turn_end, trailing lifecycle).',
    })
  }

  // Gaps between consecutive telemetry rows that are NOT fully inside a single chat segment duration.
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    const edgeMs = b.ts - a.ts
    if (edgeMs <= 0) continue
    const aType = eventType(a.event)
    const bType = eventType(b.event)
    const bothThinking = isThinkingStreamEvent(a.event) && isThinkingStreamEvent(b.event)
    if (bothThinking) continue
    const aInTool =
      aType === 'tool_execution_start' ||
      aType === 'tool_execution_update' ||
      aType === 'tool_execution_end'
    const bInTool =
      bType === 'tool_execution_start' ||
      bType === 'tool_execution_update' ||
      bType === 'tool_execution_end'
    if (aInTool && bInTool && aType !== 'tool_execution_end') continue
    const coveredBySegmentGap = gaps.some(
      (g) =>
        g.stage === 'between_chat_segments' &&
        g.startTs <= a.ts &&
        g.endTs >= b.ts,
    )
    if (coveredBySegmentGap) continue
    if (aType === 'tool_execution_start' && bType === 'tool_execution_end') continue
    pushGap(gaps, {
      id: `telemetry-edge-${i}`,
      label: `${formatEventBrief(a.event)} → ${formatEventBrief(b.event)}`,
      ms: edgeMs,
      startTs: a.ts,
      endTs: b.ts,
      stage: 'between_telemetry_events',
      detail: 'Dense timeline edge (Workflow modal raw list); omitted from inline segment cards when lifecycle-only.',
    })
  }

  const telemetryWindowMs = totalSpanMs(sorted)
  const untrackedInWindowMs =
    telemetryWindowMs !== null ? Math.max(0, telemetryWindowMs - chatVisibleMs) : null
  if (untrackedInWindowMs !== null && untrackedInWindowMs > 500) {
    flags.push('large_untracked_window')
  }

  return {
    gaps: gaps.sort((x, y) => x.startTs - y.startTs || x.endTs - y.endTs),
    chatVisibleMs,
    telemetryWindowMs,
    untrackedInWindowMs,
    flags,
  }
}

/** Show args in UI without flooding the modal. */
export function summarizeToolArgsPreview(args: unknown, maxChars: number): string {
  if (args === undefined) return '(no args)'
  try {
    const s =
      typeof args === 'string' ?
        args
      : typeof args === 'object' && args !== null ?
        JSON.stringify(args)
      : String(args)
    return s.length > maxChars ? s.slice(0, maxChars) + '…' : s
  } catch {
    return String(args).slice(0, maxChars)
  }
}
