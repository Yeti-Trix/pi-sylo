import { randomUUID } from 'node:crypto'

export type SyloSubagentRunMode = 'single' | 'parallel' | 'chain'

export type SyloSubagentHostEvent =
  | {
      type: 'subagent_run_start'
      runId: string
      mode: SyloSubagentRunMode
      agent: string
      task: string
      groupRunId: string
      parentRunId?: string
      stepIndex?: number
    }
  | {
      type: 'subagent_run_update'
      runId: string
      partialText?: string
      toolName?: string
      toolPreview?: string
    }
  | {
      type: 'subagent_run_end'
      runId: string
      status: 'succeeded' | 'failed' | 'cancelled'
      resultText?: string
      error?: string
      usage?: {
        input: number
        output: number
        cost: number
        turns: number
      }
    }

export function newSubagentRunId(): string {
  return randomUUID()
}

/** Notify Sylo host (broker child → Electron main). No-op outside fork IPC. */
export function notifySyloSubagent(event: SyloSubagentHostEvent): void {
  const snd = process.send?.bind(process) as ((msg: unknown) => boolean) | undefined
  if (!snd) return
  snd({ type: 'sylo_subagent', event })
}
