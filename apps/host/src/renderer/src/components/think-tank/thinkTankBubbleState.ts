export type ThinkTankBubbleRow = {
  id: string
  sessionId: string
  cycle: number
  seatId: string
  seatLabel: string
  seatAgent: string
  body: string
  stance?: string
  phase: 'debate' | 'final_report'
  status: 'streaming' | 'complete' | 'failed'
  created_at: number
  tool_calls_json: string | null
  model?: string
}

function seatAgentFromRaw(
  seatId: string,
  raw: Record<string, unknown>,
  seats: ThinkTankBubbleRow[] | undefined,
): string {
  if (typeof raw.agent === 'string' && raw.agent.trim()) return raw.agent.trim()
  const fromSeats = Array.isArray(raw.seats) ?
    (raw.seats as Array<{ id?: string; agent?: string }>).find((s) => String(s.id) === seatId)?.agent
  : undefined
  if (fromSeats) return String(fromSeats)
  const prev = seats?.find((b) => b.seatId === seatId)
  return prev?.seatAgent ?? 'think-tank-seat'
}

export function applyThinkTankBubbleEvent(
  prev: ThinkTankBubbleRow[] | undefined,
  raw: Record<string, unknown>,
): ThinkTankBubbleRow[] {
  const type = String(raw.type ?? '')
  const sessionId = String(raw.sessionId ?? '')
  if (!sessionId) return prev ?? []

  if (type === 'session_start') {
    return prev ?? []
  }

  const list = prev ?? []

  if (type === 'turn_start') {
    const messageId = String(raw.messageId ?? '')
    if (!messageId) return list
    const seatId = String(raw.seatId ?? '')
    return [
      ...list.filter((b) => b.id !== messageId),
      {
        id: messageId,
        sessionId,
        cycle: Number(raw.cycle ?? 1),
        seatId,
        seatLabel: String(raw.seatLabel ?? seatId),
        seatAgent: seatAgentFromRaw(seatId, raw, list),
        body: '',
        phase: 'debate',
        status: 'streaming',
        created_at: Date.now(),
        tool_calls_json: null,
        model: typeof raw.model === 'string' ? raw.model : undefined,
      },
    ]
  }

  if (type === 'turn_workflow') {
    return list
  }

  if (type === 'turn') {
    const messageId = String(raw.messageId ?? '')
    const seatId = String(raw.seatId ?? '')
    const idx = messageId ? list.findIndex((b) => b.id === messageId) : -1
    const body = String(raw.body ?? '')
    const workflowJson = typeof raw.workflowJson === 'string' ? raw.workflowJson : null
    const patch: Partial<ThinkTankBubbleRow> = {
      body,
      stance: String(raw.stance ?? 'continue'),
      status: 'complete',
      tool_calls_json: workflowJson ?? (idx >= 0 ? list[idx]!.tool_calls_json : null),
      model: typeof raw.model === 'string' ? raw.model : undefined,
    }
    if (idx >= 0) {
      const next = [...list]
      next[idx] = { ...list[idx]!, ...patch }
      return next
    }
    return [
      ...list,
      {
        id: messageId || `${sessionId}-${seatId}-${raw.cycle ?? list.length}`,
        sessionId,
        cycle: Number(raw.cycle ?? 1),
        seatId,
        seatLabel: String(raw.seatLabel ?? seatId),
        seatAgent: seatAgentFromRaw(seatId, raw, list),
        body,
        phase: 'debate',
        stance: patch.stance,
        status: 'complete',
        created_at: Date.now(),
        tool_calls_json: workflowJson,
        model: patch.model,
      },
    ]
  }

  if (type === 'report') {
    const reportId = String(raw.reportId ?? '')
    if (!reportId) return list
    const seatId = String(raw.seatId ?? '')
    const body = String(raw.body ?? raw.bodyPreview ?? '')
    return [
      ...list.filter((b) => b.id !== reportId),
      {
        id: reportId,
        sessionId,
        cycle: 0,
        seatId,
        seatLabel: String(raw.seatLabel ?? seatId),
        seatAgent: seatAgentFromRaw(seatId, raw, list),
        body,
        phase: 'final_report',
        status: 'complete',
        created_at: Date.now(),
        tool_calls_json: null,
      },
    ]
  }

  return list
}
