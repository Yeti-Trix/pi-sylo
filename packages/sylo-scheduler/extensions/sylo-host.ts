import { randomUUID } from 'node:crypto'

export type ScheduleRpcRequestPayload =
  | { op: 'list' }
  | {
      op: 'create'
      title?: string
      prompt_text: string
      recurrence: string
      start_at: number
      time_local?: string
      day_of_week?: number
      day_of_month?: number
      max_runs?: number | null
      catchup_on_startup?: boolean
    }
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'delete'; id: string }

export type ScheduleRpcResultPayload = Record<string, unknown>

const RPC_TIMEOUT_MS = 30_000

/** Broker child → main RPC for schedule CRUD (main resolves workspace from conversation). */
export function scheduleRpc(req: ScheduleRpcRequestPayload): Promise<ScheduleRpcResultPayload> {
  if (!process.send) {
    return Promise.reject(new Error('schedule RPC requires Sylo broker IPC'))
  }
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off('message', onMessage)
      reject(new Error(`schedule RPC timed out (${req.op})`))
    }, RPC_TIMEOUT_MS)

    const onMessage = (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const m = msg as {
        type?: string
        requestId?: string
        ok?: boolean
        result?: ScheduleRpcResultPayload
        error?: string
      }
      if (m.type !== 'sylo_schedule_rpc_result' || m.requestId !== requestId) return
      clearTimeout(timer)
      process.off('message', onMessage)
      if (m.ok && m.result) resolve(m.result)
      else reject(new Error(m.error ?? 'schedule RPC failed'))
    }

    process.on('message', onMessage)
    process.send!({ type: 'sylo_schedule_rpc', requestId, ...req })
  })
}
