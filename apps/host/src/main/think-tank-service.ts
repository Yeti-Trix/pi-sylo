import type { SyloThinkTankEvent } from '../shared/think-tank-events.js'
import { readThinkTankConfig } from './think-tank-config.js'
import {
  clearThinkTankInjections,
  drainThinkTankInjections,
  queueThinkTankInjection,
} from './think-tank-injections.js'
import * as store from './think-tank-db.js'
export function handleThinkTankHostEvent(
  conversationId: string | null,
  event: SyloThinkTankEvent,
): void {
  switch (event.type) {
    case 'session_start':
      store.insertThinkTankSessionStart({
        id: event.sessionId,
        topic: event.topic,
        minCycles: event.minCycles,
        maxCycles: event.maxCycles,
        configJson: JSON.stringify({ seats: event.seats }),
        sourceConversationId: event.sourceConversationId ?? conversationId,
        sourceMessageId: event.sourceMessageId ?? null,
      })
      break
    case 'turn':
      store.insertThinkTankTurn({
        id: event.messageId,
        sessionId: event.sessionId,
        cycle: event.cycle,
        seatId: event.seatId,
        body: event.body,
        stance: event.stance,
        summary: event.summary,
        model: event.model,
        toolCallsJson: event.workflowJson ?? null,
        debugJson: event.debugJson ?? null,
        reasoningTrace: event.reasoningTrace ?? null,
      })
      break
    case 'turn_start':
      store.upsertThinkTankTurnDraft({
        id: event.messageId,
        sessionId: event.sessionId,
        cycle: event.cycle,
        seatId: event.seatId,
        model: event.model,
      })
      break
    case 'turn_workflow':
      store.appendThinkTankTurnWorkflow(event.messageId, event.ts, event.event)
      break
    case 'phase':
      store.setThinkTankSessionStatus(event.sessionId, event.phase)
      break
    case 'report':
      store.insertThinkTankReport({
        id: event.reportId,
        sessionId: event.sessionId,
        seatId: event.seatId,
        seatLabel: event.seatLabel,
        body: event.body,
        metadataJson: event.debugJson ?? null,
      })
      break
    case 'error': {
      const existing = store.getThinkTankSessionDetail(event.sessionId)
      if (existing?.status !== 'cancelled') {
        store.setThinkTankSessionError(event.sessionId, event.message)
      }
      clearThinkTankInjections(event.sessionId)
      break
    }
    case 'complete':
      if (event.selectedReportId && event.selectedReportId.trim()) {
        store.pickThinkTankReport(event.sessionId, event.selectedReportId)
      } else {
        store.finalizeThinkTankSession(event.sessionId)
      }
      clearThinkTankInjections(event.sessionId)
      break
  }
}

export async function handleThinkTankRpc(
  req: Record<string, unknown>,
  userDataPath: string,
): Promise<Record<string, unknown>> {
  const op = String(req.op ?? '')
  if (op === 'status') {
    const sessionId = String(req.sessionId ?? '')
    return { op, session: store.getThinkTankSessionDetail(sessionId) }
  }
  if (op === 'pick') {
    const sessionId = String(req.sessionId ?? '')
    const reportId = String(req.reportId ?? '')
    store.pickThinkTankReport(sessionId, reportId)
    return { op, ok: true, selectedReportId: reportId }
  }
  if (op === 'config_get') {
    return { op, config: readThinkTankConfig(userDataPath) }
  }
  if (op === 'inject') {
    const sessionId = String(req.sessionId ?? '')
    const text = String(req.text ?? '')
    const pendingCount = queueThinkTankInjection(sessionId, text)
    return { op, ok: true as const, pendingCount }
  }
  if (op === 'drain_injections') {
    const sessionId = String(req.sessionId ?? '')
    return { op, messages: drainThinkTankInjections(sessionId) }
  }
  throw new Error(`Unknown think tank RPC op: ${op}`)
}

export function cancelThinkTankSession(sessionId: string, message: string): void {
  store.setThinkTankSessionCancelled(sessionId, message)
  clearThinkTankInjections(sessionId)
}

export { queueThinkTankInjection, clearThinkTankInjections }

export const thinkTankStore = store
