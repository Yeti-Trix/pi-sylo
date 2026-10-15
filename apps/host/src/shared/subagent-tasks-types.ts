export type SubagentTaskStatus =
  | 'running'
  | 'awaiting_input'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'orphaned'

export type SubagentRunMode = 'single' | 'parallel' | 'chain'

/**
 * One entry of a run's working trace — the interleaved think/text/tool sequence the
 * child emitted while working. Persisted in the task's spec so an expanded pill can
 * replay it as pills (parity with the main chat's working stream).
 * `seq` is globally monotonic per run; entries other than a tool's pending ms/err
 * patch are immutable once emitted, so the consumer can merge/skip by seq.
 */
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
      /** Failed-call result tail when the tool returned an error. */
      tail?: string
    }

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
      /**
       * Full working trace so far — included on an update only when it changed
       * since the previous update (the child coalesces streams at ~750ms; this
       * keeps the usual delta cheap).
       */
      trace?: SubagentTraceEntry[]
    }
  | {
      /** Non-terminal: the operator paused this run; Start re-dispatches it in place. */
      type: 'subagent_run_end'
      runId: string
      status: 'succeeded' | 'failed' | 'cancelled' | 'paused'
      resultText?: string
      thinking?: string
      model?: string
      error?: string
            /** Workspace files this run touched, in first-touch order (deduped, capped at source). */
      files?: string[]
      /** Final working trace, so the pill replays the full run after it ends. */
      trace?: SubagentTraceEntry[]
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
  /** Working trace — think/text/tool entries in child-emitted order (bounded tail). */
  trace?: SubagentTraceEntry[]
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
  /** Human workspace name — set on the GLOBAL Agent board, whose presence spans
   *  every workspace; the panel shows it as a tag to disambiguate two chats with
   *  the same title (or two "Untitled chat"s) from different workspaces. */
  workspaceName?: string
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
    | 'paused'
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
  /** Bounded working-trace tail (last ≤80 think/text/tool entries) — replayed as
   *  pills when the row expands, matching the chat pill's trace feed. */
  trace: SubagentTraceEntry[]
}

/** Live snapshot carried by the `subagent-runs` canvas board and the `sylo_runs_list`
 *  tool (host RPC). Two scoping regimes:
 *  - agent RPC (workspace-scoped contract): `workspaceKey` = pi_cwd; chats/rows cover
 *    that workspace only (chats = sidebar-visible ones, all listed).
 *  - canvas Agent panel (v4, GLOBAL): `workspaceKey` = `'__global__'` — rows/chats
 *    span EVERY workspace; chats are active-turn only (idle chats are noise here),
 *    and `workspaceName` is set for cross-workspace disambiguation. */
export type SubagentBoardData = {
  workspaceKey: string
  generatedAt: number
  /** Presence rows — RPC: every non-archived chat of the workspace; global Agent
   *  panel: active-turn chats across ALL workspaces (workspaceName tagged). */
  chats: ChatPresenceRow[]
  /** Subagent runs, live-first sorted. RPC: workspace's chats; global: all workspaces. */
  rows: SubagentRunBoardRow[]
}
