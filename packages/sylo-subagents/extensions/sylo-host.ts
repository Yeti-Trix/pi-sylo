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
      /** Detached run: the tool returned at once; the result arrives via run_completed. */
      background?: boolean
    }
  | {
      /** Child parked on await_user_input (issue #27 P3): relay the question to the operator. */
      type: 'subagent_run_awaiting_input'
      runId: string
      mode: SyloSubagentRunMode
      agent: string
      task: string
      question: string
      what_i_tried?: string
      context_digest?: string
      model?: string
    }
  | {
      /**
       * Terminal event for a detached (background) run: the orchestrator tool call has
       * long since resolved, so the host must deliver this result into the main chat
       * (or the awaiting-input flow) as a new message. Blocking runs never emit this.
       */
      type: 'subagent_run_completed'
      runId: string
      mode: SyloSubagentRunMode
      agent: string
      task: string
      status: 'succeeded' | 'failed' | 'cancelled'
      /** Deliverable result text on success — what a blocking tool result would have been. */
      resultText?: string
      /** Error/abort text on failure or cancellation. */
      error?: string
      model?: string
      usage?: {
        input: number
        output: number
        cost: number
        turns: number
      }
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
