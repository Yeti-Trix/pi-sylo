export type AgentTaskStatus = 'running' | 'awaiting_input' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'orphaned'

export type SubagentRunMode = 'single' | 'parallel' | 'chain'

/** One pill of the run's working trace (mirrors the host's SubagentTraceEntry).
 *  Renderer keeps its own copy — it cannot import from apps/host/src/shared. */
export type SubagentTraceEntry =
  | { seq: number; k: 'think'; text: string }
  | { seq: number; k: 'text'; text: string }
  | {
      seq: number
      k: 'tool'
      name: string
      preview: string
      ms?: number
      err?: boolean
      tail?: string
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
  status: AgentTaskStatus
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
  task?: string
  mode?: SubagentRunMode
  agent?: string
  groupRunId?: string
  stepIndex?: number
  goal?: string
  lastPartialText?: string
  lastPartialThinking?: string
  lastThinkingLive?: boolean
  lastToolName?: string
  lastToolPreview?: string
  model?: string
  question?: string
  what_i_tried?: string
  context_digest?: string
  files?: string[]
  /** Working trace pills — bound think/text/tool sequence emitted by the child. */
  trace?: SubagentTraceEntry[]
}

export type TaskGroup =
  | { kind: 'single'; task: AgentTaskRow }
  | { kind: 'batch'; groupRunId: string; mode: 'parallel' | 'chain'; tasks: AgentTaskRow[] }
