import type { ThinkTankBubbleRow } from './thinkTankBubbleState'
import type { WorkflowStampedEntry } from '../../workflowTimeline'

export type ExportThinkTankTurn = {
  id: string
  sessionId: string
  topic: string
  sessionStatus: string
  cycle: number
  seatId: string
  seatLabel: string
  seatAgent: string
  body: string
  stance: string
  status: 'streaming' | 'complete' | 'failed' | 'cancelled'
  created_at: number
  tool_calls_json: string | null
  debug_json?: string | null
  model?: string
}

export type ExportThinkTankReport = {
  id: string
  sessionId: string
  seatId: string
  seatLabel: string
  body: string
  created_at: number
  selected: boolean
  metadata_json?: string | null
}

export type MergedThinkTankExport = {
  turns: ExportThinkTankTurn[]
  reports: ExportThinkTankReport[]
}

type DbThinkTankSession = {
  id?: unknown
  topic?: unknown
  status?: unknown
  config_json?: unknown
  messages?: Array<Record<string, unknown>>
}

function seatMetaFromConfig(
  configJson: unknown,
  seatId: string,
): { label: string; agent: string } {
  try {
    const cfg = typeof configJson === 'string' ? JSON.parse(configJson) : configJson
    const seats = (cfg as { seats?: Array<{ id?: string; label?: string; agent?: string }> }).seats
    if (Array.isArray(seats)) {
      const hit = seats.find((s) => String(s.id) === seatId)
      if (hit) {
        return {
          label: String(hit.label ?? seatId),
          agent: String(hit.agent ?? 'think-tank-seat'),
        }
      }
    }
  } catch {
    /* ignore */
  }
  return { label: seatId, agent: 'think-tank-seat' }
}

function inferStatus(body: string, toolCallsJson: string | null): ExportThinkTankTurn['status'] {
  if (body.trim()) return 'complete'
  if (toolCallsJson && toolCallsJson !== '[]') return 'streaming'
  return 'streaming'
}

function mergeThinkTankReportsFromSessions(
  sessions: DbThinkTankSession[],
): ExportThinkTankReport[] {
  const reports: ExportThinkTankReport[] = []
  for (const session of sessions) {
    const sessionId = String(session.id ?? '')
    const selectedId = String(
      (session as { selected_report_id?: unknown }).selected_report_id ?? '',
    )
    const rows = Array.isArray((session as { reports?: unknown }).reports) ?
      ((session as { reports: Array<Record<string, unknown>> }).reports)
    : []
    for (const row of rows) {
      const id = String(row.id ?? '')
      if (!id) continue
      reports.push({
        id,
        sessionId,
        seatId: String(row.seat_id ?? ''),
        seatLabel: String(row.seat_label ?? row.seat_id ?? 'seat'),
        body: String(row.body ?? ''),
        created_at: Number(row.created_at ?? Date.now()),
        selected: id === selectedId,
        metadata_json:
          typeof row.metadata_json === 'string' ? row.metadata_json
          : row.metadata_json ? JSON.stringify(row.metadata_json)
          : null,
      })
    }
  }
  return reports.sort((a, b) => a.created_at - b.created_at)
}

/** Merge SQLite think tank rows with live UI bubbles for export (UI wins on conflicts). */
export function mergeThinkTankTurnsForExport(args: {
  dbSessions: DbThinkTankSession[]
  uiBubbles: ThinkTankBubbleRow[]
  liveWorkflow: Record<string, WorkflowStampedEntry[]>
  uiSessionById?: Record<string, { topic: string; status: string }>
}): MergedThinkTankExport {
  const byId = new Map<string, ExportThinkTankTurn>()

  for (const session of args.dbSessions) {
    const sessionId = String(session.id ?? '')
    const topic = String(session.topic ?? '')
    const sessionStatus = String(session.status ?? 'debating')
    const messages = Array.isArray(session.messages) ? session.messages : []
    for (const msg of messages) {
      const id = String(msg.id ?? '')
      if (!id) continue
      const seatId = String(msg.seat_id ?? '')
      const meta = seatMetaFromConfig(session.config_json, seatId)
      const body = String(msg.body ?? '')
      const tool_calls_json =
        typeof msg.tool_calls_json === 'string' ? msg.tool_calls_json
        : msg.tool_calls_json ? JSON.stringify(msg.tool_calls_json)
        : null
      const debug_json =
        typeof msg.debug_json === 'string' ? msg.debug_json
        : msg.debug_json ? JSON.stringify(msg.debug_json)
        : null
      byId.set(id, {
        id,
        sessionId,
        topic,
        sessionStatus,
        cycle: Number(msg.cycle ?? 1),
        seatId,
        seatLabel: meta.label,
        seatAgent: meta.agent,
        body,
        stance: String(msg.stance ?? 'continue'),
        status: inferStatus(body, tool_calls_json),
        created_at: Number(msg.created_at ?? Date.now()),
        tool_calls_json,
        debug_json,
        model: typeof msg.model === 'string' ? msg.model : undefined,
      })
    }
  }

  for (const bubble of args.uiBubbles) {
    const uiSession = args.uiSessionById?.[bubble.sessionId]
    const existing = byId.get(bubble.id)
    byId.set(bubble.id, {
      id: bubble.id,
      sessionId: bubble.sessionId,
      topic: uiSession?.topic ?? existing?.topic ?? '',
      sessionStatus: uiSession?.status ?? existing?.sessionStatus ?? 'debating',
      cycle: bubble.cycle,
      seatId: bubble.seatId,
      seatLabel: bubble.seatLabel,
      seatAgent: bubble.seatAgent,
      body: bubble.body,
      stance: bubble.stance ?? 'continue',
      status: bubble.status,
      created_at: bubble.created_at,
      tool_calls_json: bubble.tool_calls_json,
      model: bubble.model,
    })
  }

  // Fill topic/sessionStatus from any sibling turn in same session
  for (const turn of byId.values()) {
    if (turn.topic) continue
    for (const other of byId.values()) {
      if (other.sessionId === turn.sessionId && other.topic) {
        turn.topic = other.topic
        turn.sessionStatus = other.sessionStatus
        break
      }
    }
  }

  const merged = [...byId.values()].sort((a, b) => a.created_at - b.created_at || a.cycle - b.cycle)

  // Attach live workflow tail for streaming turns
  const turns = merged.map((turn) => {
    if (turn.status !== 'streaming') return turn
    const tail = args.liveWorkflow[turn.id] ?? []
    if (tail.length === 0) return turn
    let prior: WorkflowStampedEntry[] = []
    if (turn.tool_calls_json) {
      try {
        const parsed = JSON.parse(turn.tool_calls_json) as unknown
        if (Array.isArray(parsed)) prior = parsed as WorkflowStampedEntry[]
      } catch {
        prior = []
      }
    }
    const seen = new Set<string>()
    const combined = [...prior, ...tail].filter((row) => {
      const key = `${row.ts}:${JSON.stringify(row.event)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { ...turn, tool_calls_json: JSON.stringify(combined) }
  })

  return {
    turns,
    reports: mergeThinkTankReportsFromSessions(args.dbSessions),
  }
}

/** Rebuild chat think tank bubbles from SQLite when reopening a conversation. */
export function thinkTankUiBubblesFromDb(sessions: DbThinkTankSession[]): import('./thinkTankBubbleState').ThinkTankBubbleRow[] {
  const { turns, reports } = mergeThinkTankTurnsForExport({
    dbSessions: sessions,
    uiBubbles: [],
    liveWorkflow: {},
  })
  const debateRows = turns.map((t) => ({
    id: t.id,
    sessionId: t.sessionId,
    cycle: t.cycle,
    seatId: t.seatId,
    seatLabel: t.seatLabel,
    seatAgent: t.seatAgent,
    body: t.body,
    stance: t.stance,
    phase: 'debate' as const,
    status: t.status === 'failed' ? ('failed' as const) : t.status === 'streaming' ? ('streaming' as const) : ('complete' as const),
    created_at: t.created_at,
    tool_calls_json: t.tool_calls_json,
    model: t.model,
  }))
  const reportRows = reports.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    cycle: 0,
    seatId: r.seatId,
    seatLabel: r.seatLabel,
    seatAgent: r.seatId,
    body: r.body,
    phase: 'final_report' as const,
    status: 'complete' as const,
    created_at: r.created_at,
    tool_calls_json: null,
  }))
  return [...debateRows, ...reportRows].sort(
    (a, b) => a.created_at - b.created_at || a.cycle - b.cycle,
  )
}
