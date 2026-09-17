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
      /** Provider/id the child was spawned with, for the run title. */
      model?: string
      /** Plan goal heading this run is working, when the orchestrator named one. */
      goal?: string
    }
  | {
      type: 'subagent_run_update'
      runId: string
      partialText?: string
      /** Tail of the child's reasoning channel, so a long silent think still shows progress. */
      partialThinking?: string
      /** True while the child is still in the reasoning channel (box stays open). */
      thinkingLive?: boolean
      toolName?: string
      toolPreview?: string
      model?: string
    }
  | {
      type: 'subagent_run_end'
      runId: string
      status: 'succeeded' | 'failed' | 'cancelled'
      resultText?: string
      thinking?: string
      model?: string
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
