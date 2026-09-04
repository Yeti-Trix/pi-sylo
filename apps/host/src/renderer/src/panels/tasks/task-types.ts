export type AgentTaskStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'orphaned'

export type SubagentRunMode = 'single' | 'parallel' | 'chain'

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
  lastPartialText?: string
  lastToolName?: string
  lastToolPreview?: string
}

export type TaskGroup =
  | { kind: 'single'; task: AgentTaskRow }
  | { kind: 'batch'; groupRunId: string; mode: 'parallel' | 'chain'; tasks: AgentTaskRow[] }
