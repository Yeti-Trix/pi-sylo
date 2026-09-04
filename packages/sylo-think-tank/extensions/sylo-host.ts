import { randomUUID } from 'node:crypto'

export type ThinkTankStance = 'continue' | 'satisfied' | 'no_more_to_add'

export type ThinkTankSessionStatus =
  | 'debating'
  | 'final_reports'
  | 'awaiting_pick'
  | 'complete'
  | 'error'

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

export function newThinkTankSessionId(): string {
  return randomUUID()
}

export function newThinkTankMessageId(): string {
  return randomUUID()
}

/** Notify the Sylo host of a think tank event. No-op when not running under fork IPC. */
export function notifyThinkTank(event: SyloThinkTankEvent): void {
  const snd = process.send?.bind(process) as ((msg: unknown) => boolean) | undefined
  if (!snd) return
  snd({ type: 'sylo_think_tank', event })
}

export type ThinkTankRpcRequest =
  | { op: 'status'; sessionId: string }
  | { op: 'pick'; sessionId: string; reportId: string }
  | { op: 'config_get' }
  | { op: 'inject'; sessionId: string; text: string }
  | { op: 'drain_injections'; sessionId: string }

export type ThinkTankRpcResult =
  | { op: 'status'; session: Record<string, unknown> | null }
  | { op: 'pick'; ok: true; selectedReportId: string }
  | { op: 'config_get'; config: Record<string, unknown> }
  | { op: 'inject'; ok: true; pendingCount: number }
  | { op: 'drain_injections'; messages: string[] }

const RPC_TIMEOUT_MS = 30_000

/** Synchronous host RPC for status/pick/config (broker forwards to main). */
export function thinkTankRpc(req: ThinkTankRpcRequest): Promise<ThinkTankRpcResult> {
  if (!process.send) {
    return Promise.reject(new Error('sylo_think_tank RPC requires Sylo broker IPC'))
  }
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off('message', onMessage)
      reject(new Error(`sylo_think_tank RPC timed out (${req.op})`))
    }, RPC_TIMEOUT_MS)

    const onMessage = (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const m = msg as {
        type?: string
        requestId?: string
        ok?: boolean
        result?: ThinkTankRpcResult
        error?: string
      }
      if (m.type !== 'sylo_think_tank_rpc_result' || m.requestId !== requestId) return
      clearTimeout(timer)
      process.off('message', onMessage)
      if (m.ok && m.result) resolve(m.result)
      else reject(new Error(m.error ?? 'sylo_think_tank RPC failed'))
    }

    process.on('message', onMessage)
    process.send!({ type: 'sylo_think_tank_rpc', requestId, ...req })
  })
}
