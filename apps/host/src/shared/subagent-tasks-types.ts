export type SubagentTaskStatus =
  | 'running'
  | 'awaiting_input'
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
      /** Plan goal heading this run is working, when the orchestrator named one.
        * A reviewer's verdict closes exactly this goal; without it a passing review
        * is treated as covering the whole plan.
        */
      goal?: string
      /** Detached run: the tool returned at once; the result arrives via run_completed. */
      background?: boolean
    }
  | {
      /** Child parked on await_user_input (issue #27 P3): relay the question to the operator. */
      type: 'subagent_run_awaiting_input'
      runId: string
      mode: SubagentRunMode
      agent: string
      task: string
      question: string
      what_i_tried?: string
      context_digest?: string
      model?: string
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
      /** Workspace files this run has touched so far (deduped, capped at source). */
      files?: string[]
    }
  | {
      type: 'subagent_run_end'
      runId: string
      status: 'succeeded' | 'failed' | 'cancelled'
      resultText?: string
      thinking?: string
      model?: string
      error?: string
      /** Workspace files this run touched, in first-touch order (deduped, capped at source). */
      files?: string[]
      usage?: {
        input: number
        output: number
        cost: number
        turns: number
      }
    }
  | {
      /**
       * Terminal event for a detached (background) run: the orchestrator tool call has
       * long since resolved, so the host delivers this into the main chat as a result
       * card + a wake turn for the orchestrator. Blocking runs never emit this.
       */
      type: 'subagent_run_completed'
      runId: string
      mode: SubagentRunMode
      agent: string
      task: string
      status: 'succeeded' | 'failed' | 'cancelled'
      resultText?: string
      error?: string
      model?: string
      /**
       * Stable chain/group id when the terminal event is for a unit rather than a
       * single row — lets the host attribute delivery by group when the row lookup
       * misses (chain completions resolved without per-step rows).
       */
      groupRunId?: string
      /** Workspace files the unit touched (union across steps, capped at source). */
      files?: string[]
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
  /** Pause/resume (issue #27 P3): the question the parked agent is waiting on. */
  question?: string
  what_i_tried?: string
  context_digest?: string
  /** Workspace files this run has touched (updated on run_update/run_end). */
  files?: string[]
}

/**
 * One chat (owning main agent) row for the workspace runs board / sylo_runs_list *
 * presence section: what that chat's main agent is working on right now or last.
 */
export type ChatPresenceRow = {
  conversationId: string
  title: string
  /** A turn is currently streaming/steering in this conversation. */
  activeTurn: boolean
  /** First line of the newest user prompt in this conversation (the assignment). */
  lastPrompt: string | null
  /** Composed provider/model label for the chat's main agent, when pinned. */
  model: string | null
  /** DB updated_at (last activity) for the conversation. */
  workspaceId?: string
  updatedAt: number
}

/**
 * ONE row on the workspace Subagents board: the union of the old conversation-scoped
 * SubagentRunBoardRow plus workspace-window fields (owning chat, task title, files,
 * result summary, model resolved from spec at start). Built in main from agent_tasks.
 */
export type SubagentRunBoardRow = {
  taskId: string
  runId: string
  agent: string
  mode: SubagentRunMode
  status:
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'orphaned'
    | 'awaiting_input'
  startedAt: number | null
  endedAt: number | null
  /** Provider/id resolved at dispatch (spec) or at finish (result), when known. */
  model: string | null
  stepIndex: number | null
  toolName: string | null
  toolPreview: string | null
  partialTail: string | null
  tokens: number | null
  question: string | null
  /** Owning chat. */
  conversationId: string
  conversationTitle: string | null
  /** First line of the dispatched task — the run's headline. */
  title: string | null
  /** Workspace files the run touched (running: so far; finished: final list). */
  files: string[]
  /** First 2k chars of the finished run's report/error (DB result_summary). */
  resultSummary: string | null
}

/** Live workspace snapshot carried by the `subagent-runs` canvas board and the `sylo_runs_list` tool (host RPC). */
export type SubagentBoardData = {
  workspaceKey: string
  generatedAt: number
  /** Presence for each (non-archived) chat in the workspace. */
  chats: ChatPresenceRow[]
  /** Subagent runs across ALL chats of the workspace, live-first sorted. */
  rows: SubagentRunBoardRow[]
}
