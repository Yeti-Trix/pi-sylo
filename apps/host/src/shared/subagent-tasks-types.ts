export type SubagentTaskStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'orphaned'

export type SubagentRunMode = 'single' | 'parallel' | 'chain'

export type SyloSubagentHostEvent =
  | {
      type: 'subagent_run_start'
      runId: string
      mode: SubagentRunMode
      agent: string
      task: string
      groupRunId: string
      parentRunId?: string
      stepIndex?: number
      model?: string
      /**
       * Plan goal heading this run is working, when the orchestrator named one.
       * A reviewer's verdict closes exactly this goal; without it a passing review
       * is treated as covering the whole plan.
       */
      goal?: string
    }
  | {
      type: 'subagent_run_update'
      runId: string
      partialText?: string
      /** Tail of the child's reasoning channel, so a long silent think still shows progress. */
      partialThinking?: string
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

export type AgentTaskRow = {
  id: string
  host_session_id: string
  conversation_id: string
  parent_task_id: string | null
  group_run_id: string | null
  depth: number
  title: string
  spec_json: string
  status: SubagentTaskStatus
  status_reason: string | null
  mode: SubagentRunMode
  agent_name: string
  step_index: number | null
  started_at: number | null
  ended_at: number | null
  result_summary: string | null
  result_json: string | null
  tokens_used: number | null
  created_at: number
  updated_at: number
}

export type AgentTaskSpec = {
  task: string
  mode: SubagentRunMode
  agent: string
  groupRunId: string
  stepIndex?: number
  /** Plan goal heading this run was dispatched against, if any. */
  goal?: string
  lastPartialText?: string
  lastPartialThinking?: string
  lastThinkingLive?: boolean
  lastToolName?: string
  lastToolPreview?: string
  /** Provider/id the child was spawned with. */
  model?: string
}
