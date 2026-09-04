import React, { useMemo } from 'react'

import { cn } from '../../lib/cn'
import {
  chatLinkQuiet,
  chatMsgAssistant,
  chatMsgBubble,
  chatMsgHead,
  chatMsgRoleRow,
  chatMsgRow,
  chatMsgRowAssistant,
} from '../../panels/ui-classes'

/** Debaters only — Moderator is advisory, not selectable as a winner report. */
export function isThinkTankDebateCompetitor(seatId: string, seatLabel: string, role?: string): boolean {
  if (role === 'moderator') return false
  if (role === 'debater') return true
  if (seatId === 'seat-moderator' || seatId === 'seat-c') return false
  if (/moderator|synthesis|^ref$/i.test(seatLabel)) return false
  return true
}

export type ThinkTankLiveSession = {
  sessionId: string
  topic: string
  status: string
  sourceMessageId?: string
  minCycles: number
  maxCycles: number
  currentCycle: number
  seats: Array<{ id: string; label: string; stance?: string }>
  turns: Array<{ cycle: number; seatId: string; seatLabel: string; summary: string; stance: string }>
  reports: Array<{ id: string; seatId: string; seatLabel: string; body: string }>
  selectedReportId?: string
  error?: string
  /** Operator messages waiting for next Moderator turn. */
  pendingOperatorInjectCount?: number
  queuedOperatorInjects?: string[]
}

/** Compact think tank footer at the end of the chat stream (not above the composer). */
export function ThinkTankChatInline({
  session,
  onOpenThinkTankRoute,
}: {
  session: ThinkTankLiveSession
  onOpenThinkTankRoute?: () => void
}): React.ReactElement | null {
  const statusLabel = useMemo(() => {
    if (session.error) return 'error'
    if (session.status === 'complete') return 'complete'
    // Legacy sessions persisted before the pick UI was removed may still carry
    // awaiting_pick; render them as the terminal state they effectively are.
    if (session.status === 'awaiting_pick') return 'complete'
    if (session.status === 'final_reports') return 'final reports'
    return 'debating'
  }, [session.error, session.status])

  const showFooter = session.error || session.status === 'complete' || session.status === 'awaiting_pick'

  if (!showFooter) return null

  const selectedReport = session.selectedReportId ?
    session.reports.find((r) => r.id === session.selectedReportId)
  : undefined

  return (
    <div className={cn(chatMsgRow, chatMsgRowAssistant)}>
      <div className={cn(chatMsgBubble, chatMsgAssistant, 'w-fit max-w-[92%] min-w-0')}>
        <div className={chatMsgHead}>
          <div className={chatMsgRoleRow}>Think Tank · {statusLabel}</div>
        </div>

        {session.error ?
          <p className="text-[0.85rem] text-[rgb(255_107_107)]">{session.error}</p>
        : null}

        {session.status === 'complete' && !session.error ?
          <p className="text-[0.78rem] text-text-secondary">
            Debate finished. Expand this block for color-coded final reports. The{' '}
            <strong>Moderator</strong> report is the decision brief; debater reports are supporting
            perspectives. All reports stay in this Think Tank block for follow-up.
          </p>
        : null}

        {session.status === 'awaiting_pick' && !session.error ?
          <p className="text-[0.78rem] text-text-secondary">
            Debate finished. Expand this block for color-coded final reports. The{' '}
            <strong>Moderator</strong> report is the decision brief; debater reports are supporting
            perspectives.
          </p>
        : null}

        {selectedReport && !session.error ?
          <p className="text-[0.82rem] text-emerald-300">
            Marked debater report: <strong>{selectedReport.seatLabel}</strong> (recorded via{' '}
            <code>sylo_think_tank_pick</code>). All final reports stay in this Think Tank block.
          </p>
        : null}

        {onOpenThinkTankRoute ?
          <p className="mt-2 border-t border-border/60 pt-2">
            <button type="button" className={chatLinkQuiet} onClick={onOpenThinkTankRoute}>
              Open Think Tank route (settings & history)
            </button>
          </p>
        : null}
      </div>
    </div>
  )
}

export function applyThinkTankLifecycleEvent(
  prev: ThinkTankLiveSession | undefined,
  raw: Record<string, unknown>,
): ThinkTankLiveSession | undefined {
  const type = String(raw.type ?? '')
  const sessionId = String(raw.sessionId ?? prev?.sessionId ?? '')
  if (!sessionId) return prev

  const base: ThinkTankLiveSession = prev ?? {
    sessionId,
    topic: String(raw.topic ?? '(think tank)'),
    status: 'debating',
    minCycles: Number(raw.minCycles ?? 2),
    maxCycles: Number(raw.maxCycles ?? 10),
    currentCycle: 0,
    seats: [],
    turns: [],
    reports: [],
  }

  if (type === 'session_start') {
    const seats = Array.isArray(raw.seats) ?
      (raw.seats as Array<{ id: string; label: string }>).map((s) => ({
        id: String(s.id),
        label: String(s.label),
      }))
    : []
    return {
      sessionId,
      topic: String(raw.topic ?? '(think tank)'),
      status: 'debating',
      sourceMessageId:
        typeof raw.sourceMessageId === 'string' && raw.sourceMessageId.trim() ?
          raw.sourceMessageId.trim()
        : undefined,
      minCycles: Number(raw.minCycles ?? 2),
      maxCycles: Number(raw.maxCycles ?? 10),
      currentCycle: 0,
      seats,
      turns: [],
      reports: [],
    }
  }

  if (type === 'turn') {
    const seatId = String(raw.seatId ?? '')
    const stance = String(raw.stance ?? 'continue')
    const turn = {
      cycle: Number(raw.cycle ?? base.currentCycle),
      seatId,
      seatLabel: String(raw.seatLabel ?? seatId),
      summary: String(raw.summary ?? ''),
      stance,
    }
    const seats = base.seats.map((s) => (s.id === seatId ? { ...s, stance } : s))
    return {
      ...base,
      currentCycle: Math.max(base.currentCycle, turn.cycle),
      seats: seats.length ? seats : base.seats,
      turns: [...base.turns, turn],
    }
  }

  if (type === 'phase') {
    return { ...base, status: String(raw.phase ?? base.status) }
  }

  if (type === 'report') {
    const report = {
      id: String(raw.reportId ?? ''),
      seatId: String(raw.seatId ?? ''),
      seatLabel: String(raw.seatLabel ?? ''),
      body: String(raw.body ?? raw.bodyPreview ?? ''),
    }
    return {
      ...base,
      reports: [...base.reports.filter((r) => r.id !== report.id), report],
    }
  }

  if (type === 'complete') {
    return {
      ...base,
      status: 'complete',
      selectedReportId: String(raw.selectedReportId ?? ''),
    }
  }

  if (type === 'error') {
    const msg = String(raw.message ?? 'Think Tank error')
    if (/stopped by operator|run aborted/i.test(msg)) {
      return { ...base, status: 'cancelled', error: msg }
    }
    return { ...base, status: 'error', error: msg }
  }

  if (type === 'operator_inject_queued') {
    const text = String(raw.text ?? '').trim()
    const pending = Number(raw.pendingCount ?? 0)
    const prevQueued = base.queuedOperatorInjects ?? []
    return {
      ...base,
      pendingOperatorInjectCount: pending,
      queuedOperatorInjects: text ? [...prevQueued, text] : prevQueued,
    }
  }

  if (type === 'operator_inject_delivered') {
    const delivered = Array.isArray(raw.messages) ?
      (raw.messages as unknown[]).map((m) => String(m)).filter(Boolean)
    : []
    const prevQueued = base.queuedOperatorInjects ?? []
    const nextQueued =
      delivered.length > 0 ?
        prevQueued.filter((q) => !delivered.includes(q))
      : prevQueued
    return {
      ...base,
      pendingOperatorInjectCount: Math.max(0, nextQueued.length),
      queuedOperatorInjects: nextQueued,
    }
  }

  return base
}
