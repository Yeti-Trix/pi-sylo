/**
 * Host → broker child push telling a running think tank session to wind itself down.
 * Mirrors `THINK_TANK_CANCEL_MESSAGE` in packages/sylo-think-tank/extensions/sylo-host.ts,
 * which is where the broker side listens.
 */
export const THINK_TANK_CANCEL_MESSAGE = 'sylo_think_tank_cancel'

/**
 * How long a cancelled run has to return a tool result before the turn is aborted outright.
 *
 * Covers a seat's kill deadline plus the engine unwinding. The fallback exists so Stop always
 * stops; the grace exists so the model gets a real result instead of an empty tool call.
 */
export const THINK_TANK_CANCEL_GRACE_MS = 30_000

export type ThinkTankStance = 'continue' | 'satisfied' | 'no_more_to_add'

export type ThinkTankSessionStatus =
  | 'debating'
  | 'final_reports'
  | 'awaiting_pick'
  | 'complete'
  | 'error'
  | 'cancelled'

export type SyloThinkTankEvent =
  | {
      type: 'session_start'
      sessionId: string
      topic: string
      minCycles: number
      maxCycles: number
      seats: Array<{ id: string; label: string; agent: string; model?: string }>
      sourceConversationId?: string
      sourceMessageId?: string
    }
  | {
      type: 'turn_start'
      sessionId: string
      messageId: string
      cycle: number
      seatId: string
      seatLabel: string
      agent: string
      model?: string
    }
  | {
      type: 'turn_workflow'
      sessionId: string
      messageId: string
      ts: number
      event: unknown
    }
  | {
      type: 'turn'
      sessionId: string
      messageId: string
      cycle: number
      seatId: string
      seatLabel: string
      stance: ThinkTankStance
      summary: string
      body: string
      bodyPreview: string
      model?: string
      agent?: string
      workflowJson?: string
      reasoningTrace?: string
      debugJson?: string
    }
  | {
      type: 'phase'
      sessionId: string
      phase: 'final_reports' | 'awaiting_pick'
    }
  | {
      type: 'report'
      sessionId: string
      reportId: string
      seatId: string
      seatLabel: string
      body: string
      bodyPreview: string
      debugJson?: string
    }
  | {
      type: 'complete'
      sessionId: string
      selectedReportId: string
    }
  | {
      type: 'error'
      sessionId: string
      message: string
    }
  | {
      type: 'operator_inject_queued'
      sessionId: string
      text: string
      pendingCount: number
    }
  | {
      type: 'operator_inject_delivered'
      sessionId: string
      cycle: number
      messages: string[]
    }

export type ThinkTankLifecyclePayload = SyloThinkTankEvent & {
  conversationId?: string | null
  turnId?: string | null
}
