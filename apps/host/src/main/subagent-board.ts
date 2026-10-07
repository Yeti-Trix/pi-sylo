import { broadcastLiveUpdate, createLiveSubscription, disposeLive } from './canvas-live.js'
import type { AgentTaskRow, SubagentBoardData, SubagentRunBoardRow } from '../shared/subagent-tasks-types.js'
import { firstTaskLine as sharedFirstTaskLine } from './subagent-text.js'

export { firstTaskLine } from './subagent-text.js'

/**
 * Subagents canvas board (issue #27 P2, workspace-scoped F1/F2) — the per-workspace
 * "Agent" panel, fed by agent_tasks rows as lifecycle events land.
 *
 * v2 (2026-10-06): the board is bound to the WORKSPACE, not to one conversation — it
 * lists every subagent run from every chat of the workspace plus a presence section
 * for each chat's main agent. Any conversation's run event re-pushes the whole
 * workspace snapshot.
 *
 * v3 (2026-10-06): renamed "Subagents — Runs" → "Agent" (operator request); the
 * renderer opens it manually from the `+` picker, so `showSubagentBoard(.., { manual })`
 * boards are EXEMPT from the all-finished auto-dispose below — a manually opened
 * empty panel must not blank itself.
 *
 * Per-workspace registry (same restore-on-return model as task boards): each
 * workspace has at most one runs board; it rebinds only when a prior board was
 * disposed. `updateSubagentBoard` drops a board once the workspace has no runs left
 * at all, so the canvas clears instead of freezing at a stale list.
 *
 * No persistence across restart: the board is a view over agent_tasks, and the
 * restart wipes in-flight runs anyway (orphan cards handle the trail).
 *
 * Data shape comes from `../shared/subagent-tasks-types.js` — the shared contract also
 * rendered by the renderer's `SubagentRunsBoard` and returned to agents via the
 * `sylo_runs_list` tool host RPC.
 */

type BoardBinding = { liveId: string; manual?: boolean }

const boardByWorkspace = new Map<string, BoardBinding>()
const workspaceByLiveId = new Map<string, string>()

export function subagentBoardForWorkspace(workspaceKey: string): BoardBinding | null {
  return boardByWorkspace.get(workspaceKey) ?? null
}

/** Create/rebind the workspace's board and return the new liveId. `manual` marks a
 *  operator-opened panel (the `+` picker) — exempt from the auto-dispose. */
export function showSubagentBoard(
  workspaceKey: string,
  data: SubagentBoardData,
  opts?: { manual?: boolean },
): string {
  const prev = boardByWorkspace.get(workspaceKey)
  if (prev) {
    disposeLive(prev.liveId)
    const wk = workspaceByLiveId.get(prev.liveId)
    if (wk) workspaceByLiveId.delete(prev.liveId)
  }
  const sub = createLiveSubscription({
    kind: 'subagent-runs',
    title: 'Agent',
    data,
  })
  boardByWorkspace.set(workspaceKey, { liveId: sub.liveId, manual: opts?.manual })
  workspaceByLiveId.set(sub.liveId, workspaceKey)
  return sub.liveId
}

/**
 * Push a fresh workspace snapshot to the board. `false` when no board is bound
 * (the caller decides via `showSubagentBoard` whether to create one).
 */
export function updateSubagentBoard(workspaceKey: string, data: SubagentBoardData): boolean {
  const binding = boardByWorkspace.get(workspaceKey)
  if (!binding) return false
  if (data.rows.length === 0 && !binding.manual) {
    // Everything finished and nothing left for the workspace — drop the board so
    // the canvas clears instead of freezing at a stale list. A manually opened
    // panel (the `+` picker) stays; its empty state explains the situation.
    disposeLive(binding.liveId)
    boardByWorkspace.delete(workspaceKey)
    workspaceByLiveId.delete(binding.liveId)
    return false
  }
  broadcastLiveUpdate(binding.liveId, data)
  return true
}

export function disposeSubagentBoards(): void {
  for (const [wk, binding] of boardByWorkspace) {
    disposeLive(binding.liveId)
    boardByWorkspace.delete(wk)
    workspaceByLiveId.delete(binding.liveId)
  }
}

/**
 * Build board rows from agent_tasks rows. `conversationTitles` maps conversation id →
 * chat title (owning chat shown per row); pass `workspaceIds` when known so rows carry
 * the workspace id without an extra conversation lookup. Rows missing a conversation
 * title render an id tail instead of the name.
 */
export function rowsFromAgentTaskRows(
  rows: AgentTaskRow[],
  conversationTitles?: ReadonlyMap<string, string>,
): SubagentRunBoardRow[] {
  const out: SubagentRunBoardRow[] = []
  for (const row of rows) {
    let spec: {
      lastPartialText?: string
      lastToolName?: string
      lastToolPreview?: string
      question?: string
      goal?: string
      model?: string
      files?: string[]
      task?: string
    } = {}
    try {
      spec = JSON.parse(row.spec_json) as typeof spec
    } catch {
      spec = {}
    }
    let resultModel: string | undefined
    try {
      const parsed = row.result_json ? (JSON.parse(row.result_json) as { model?: unknown }) : undefined
      resultModel = typeof parsed?.model === 'string' && parsed.model.trim() ? parsed.model.trim() : undefined
    } catch {
      resultModel = undefined
    }
    out.push({
      taskId: row.id,
      runId: row.id,
      agent: row.agent_name,
      mode: row.mode,
      status:
        row.status === 'running' ? 'running'
        : row.status === 'awaiting_input' ? 'awaiting_input'
        : row.status === 'paused' ? 'paused'
        : row.status === 'orphaned' ? 'orphaned'
        : row.status === 'succeeded' ? 'succeeded'
        : row.status === 'failed' ? 'failed'
        : 'cancelled',
      startedAt: row.started_at,
      endedAt: row.ended_at,
      // Surface the model the run was dispatched with (spec, set at start) even while
      // it is still streaming; result_json's model only exists once it finished. A ran
      // `worker` on a pinned flash model while the chat said "Haiku" — with the model
      // visible from start, "cheap model" misrouting is visible immediately (B4).
      model: resultModel ?? spec.model ?? null,
      stepIndex: row.step_index,
      toolName: row.status === 'running' ? spec.lastToolName ?? null : null,
      toolPreview: row.status === 'running' ? spec.lastToolPreview ?? null : null,
      // A paused row keeps its partial tail visible: it is the resume point the
      // operator is deciding from.
      partialTail: row.status === 'running' || row.status === 'paused' ? spec.lastPartialText?.trim() ?? null : null,
      tokens: row.tokens_used,
      question: spec.question ?? null,
      conversationId: row.conversation_id,
      conversationTitle: conversationTitles?.get(row.conversation_id)?.trim() || null,
      // Headline: first line of the dispatched task (falls back to the auto title).
      title: sharedFirstTaskLine(spec.task && spec.task.trim() ? spec.task : row.title),
      files: Array.isArray(spec.files) ? spec.files.slice(0, 24) : [],
      resultSummary: row.result_summary ?? null,
    })
  }
  // Active first (running → awaiting → paused, oldest started first), then done.
  const rank = (r: SubagentRunBoardRow): number =>
    r.status === 'running' ? 0 : r.status === 'awaiting_input' ? 1 : r.status === 'paused' ? 2 : 3
  return out.sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    if (rank(a) === 0) return (a.startedAt ?? 0) - (b.startedAt ?? 0)
    return (b.endedAt ?? 0) - (a.endedAt ?? 0)
  })
}