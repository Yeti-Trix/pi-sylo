import type { ChatMessageRowModel } from '../../chat/ConversationMessage'
import type { ThinkTankLiveSession } from './ThinkTankSessionCard'
import type { ThinkTankBubbleRow } from './thinkTankBubbleState'
import { splitThinkTankTopic } from './thinkTankExportFormat'

export type ThinkTankSessionView = {
  sessionId: string
  topic: string
  status: string
  sourceMessageId?: string | null
  createdAt?: number
}

/** Operator-facing title — not the full staged context package stored in DB. */
export function thinkTankDisplayTopic(fullTopic: string): string {
  const { question } = splitThinkTankTopic(fullTopic.trim() || '(think tank)')
  const q = question.trim() || '(think tank)'
  return q.length > 240 ? `${q.slice(0, 237)}…` : q
}

export type ChatTimelineRow =
  | { kind: 'message'; key: string; message: ChatMessageRowModel & { conversation_id?: string } }
  | {
      kind: 'think_tank'
      key: string
      sessionId: string
      topic: string
      status: string
      bubbles: ThinkTankBubbleRow[]
      liveSession?: ThinkTankLiveSession
    }

function messageInvokesThinkTankRun(m: ChatMessageRowModel): boolean {
  if (m.role !== 'assistant' || !m.tool_calls_json?.trim()) return false
  try {
    const parsed = JSON.parse(m.tool_calls_json) as unknown
    if (!Array.isArray(parsed)) return false
    for (const row of parsed) {
      const ev =
        row && typeof row === 'object' && 'event' in row ?
          (row as { event: unknown }).event
        : row
      if (!ev || typeof ev !== 'object') continue
      const toolName = (ev as { toolName?: string }).toolName
      if (toolName === 'sylo_think_tank_run') return true
    }
  } catch {
    /* ignore */
  }
  return false
}

function collectThinkTankTriggerMessageIds(messages: ChatMessageRowModel[]): string[] {
  return messages.filter(messageInvokesThinkTankRun).map((m) => m.id)
}

function resolveAnchorIndex(
  messages: ChatMessageRowModel[],
  meta: ThinkTankSessionView,
  bubbles: ThinkTankBubbleRow[],
  triggerMessageIds: string[],
  triggerIndex: number,
): number {
  if (meta.sourceMessageId) {
    const idx = messages.findIndex((m) => m.id === meta.sourceMessageId)
    if (idx >= 0) return idx
  }
  if (triggerIndex >= 0 && triggerIndex < triggerMessageIds.length) {
    const idx = messages.findIndex((m) => m.id === triggerMessageIds[triggerIndex])
    if (idx >= 0) return idx
  }
  if (bubbles.length > 0) {
    const firstTs = Math.min(...bubbles.map((b) => b.created_at))
    let bestIdx = -1
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.created_at <= firstTs) bestIdx = i
    }
    if (bestIdx >= 0) return bestIdx
  }
  if (typeof meta.createdAt === 'number') {
    let bestIdx = -1
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.created_at <= meta.createdAt) bestIdx = i
    }
    if (bestIdx >= 0) return bestIdx
  }
  return Math.max(0, messages.length - 1)
}

/** Default collapsed when debate is done so follow-up chat stays readable. */
export function defaultThinkTankBlockCollapsed(status: string): boolean {
  return status === 'complete' || status === 'awaiting_pick' || status === 'error'
}

export function buildChatTimeline(args: {
  messages: Array<ChatMessageRowModel & { conversation_id?: string }>
  bubbles: ThinkTankBubbleRow[]
  sessions: ThinkTankSessionView[]
  liveSession?: ThinkTankLiveSession
}): ChatTimelineRow[] {
  const sessionMap = new Map<string, ThinkTankSessionView>()
  for (const s of args.sessions) sessionMap.set(s.sessionId, s)
  if (args.liveSession) {
    sessionMap.set(args.liveSession.sessionId, {
      sessionId: args.liveSession.sessionId,
      topic: args.liveSession.topic,
      status: args.liveSession.status,
      sourceMessageId: args.liveSession.sourceMessageId,
      createdAt: Date.now(),
    })
  }

  for (const b of args.bubbles) {
    if (!sessionMap.has(b.sessionId)) {
      sessionMap.set(b.sessionId, {
        sessionId: b.sessionId,
        topic: '(think tank)',
        status: 'complete',
        createdAt: b.created_at,
      })
    }
  }

  const bubblesBySession = new Map<string, ThinkTankBubbleRow[]>()
  for (const b of args.bubbles) {
    const list = bubblesBySession.get(b.sessionId) ?? []
    list.push(b)
    bubblesBySession.set(b.sessionId, list)
  }
  for (const sessionId of sessionMap.keys()) {
    if (!bubblesBySession.has(sessionId)) bubblesBySession.set(sessionId, [])
  }

  const triggerIds = collectThinkTankTriggerMessageIds(args.messages)
  const sortedSessions = [...sessionMap.values()].sort(
    (a, c) => (a.createdAt ?? 0) - (c.createdAt ?? 0),
  )

  const blocks = sortedSessions.map((meta, triggerIndex) => {
    const bubbles = (bubblesBySession.get(meta.sessionId) ?? []).sort(
      (a, b) => a.created_at - b.created_at || a.cycle - b.cycle,
    )
    return {
      meta,
      bubbles,
      anchorIndex: resolveAnchorIndex(args.messages, meta, bubbles, triggerIds, triggerIndex),
    }
  })

  blocks.sort(
    (a, b) => a.anchorIndex - b.anchorIndex || (a.meta.createdAt ?? 0) - (b.meta.createdAt ?? 0),
  )

  const rows: ChatTimelineRow[] = []
  let blockIdx = 0
  for (let i = 0; i < args.messages.length; i++) {
    const m = args.messages[i]!
    rows.push({ kind: 'message', key: m.id, message: m })
    while (blockIdx < blocks.length && blocks[blockIdx]!.anchorIndex === i) {
      const block = blocks[blockIdx]!
      rows.push({
        kind: 'think_tank',
        key: `think-tank:${block.meta.sessionId}`,
        sessionId: block.meta.sessionId,
        topic: thinkTankDisplayTopic(block.meta.topic),
        status: block.meta.status,
        bubbles: block.bubbles,
        liveSession:
          args.liveSession?.sessionId === block.meta.sessionId ? args.liveSession : undefined,
      })
      blockIdx++
    }
  }
  while (blockIdx < blocks.length) {
    const block = blocks[blockIdx]!
    rows.push({
      kind: 'think_tank',
      key: `think-tank:${block.meta.sessionId}`,
      sessionId: block.meta.sessionId,
      topic: thinkTankDisplayTopic(block.meta.topic),
      status: block.meta.status,
      bubbles: block.bubbles,
      liveSession:
        args.liveSession?.sessionId === block.meta.sessionId ? args.liveSession : undefined,
    })
    blockIdx++
  }
  return rows
}
