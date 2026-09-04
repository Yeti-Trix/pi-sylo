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
