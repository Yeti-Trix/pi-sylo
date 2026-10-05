import { broadcastLiveUpdate, createLiveSubscription, disposeLive } from './canvas-live.js'
import type { AgentTaskRow } from '../shared/subagent-tasks-types.js'

/**
 * Subagents canvas board (issue #27 P2) — a live per-workspace "Subagents — Runs"
 * board fed by agent_tasks rows as lifecycle events land.
 *
 * Per-workspace registry (same restore-on-return model as task boards): each
 * workspace has at most one runs board; a new conversation's first background run
 * rebinds it (dispose old liveId → fresh subscription). Updates broadcast in place
 * when the conversation matches; a different conversation's update rebinding is the
 * caller's decision (`showSubagentBoard` again).
 *
 * No persistence across restart: the board is a view over agent_tasks, and the
 * restart wipes in-flight runs anyway (orphan cards handle the trail).
 *
 * Data shape intentionally plain (rows built by main from agent_tasks + spec_json):
 * the renderer renders sections from it, nothing more.
 */

export type SubagentRunBoardRow = {
  taskId: string
  runId: string
  agent: string
  mode: 'single' | 'parallel' | 'chain'
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'orphaned' | 'awaiting_input'
  startedAt: number | null
  endedAt: number | null
  model: string | null
  stepIndex: number | null
  toolName: string | null
  toolPreview: string | null
  partialTail: string | null
  tokens: number | null
  question: string | null
}

export type SubagentBoardData = {
  conversationId: string
  workspaceKey: string
  generatedAt: number
  rows: SubagentRunBoardRow[]
}

type BoardBinding = { liveId: string; conversationId: string }

const boardByWorkspace = new Map<string, BoardBinding>()
const workspaceByLiveId = new Map<string, string>()

export function subagentBoardForWorkspace(workspaceKey: string): BoardBinding | null {
  return boardByWorkspace.get(workspaceKey) ?? null
}

/** Create/rebind the workspace's board and return the new liveId. */
export function showSubagentBoard(
  workspaceKey: string,
  conversationId: string,
  rows: SubagentRunBoardRow[],
): string {
  const prev = boardByWorkspace.get(workspaceKey)
  if (prev) {
    disposeLive(prev.liveId)
    const wk = workspaceByLiveId.get(prev.liveId)
    if (wk) workspaceByLiveId.delete(prev.liveId)
  }
  const sub = createLiveSubscription({
    kind: 'subagent-runs',
    title: 'Subagents — Runs',
    data: {
      conversationId,
      workspaceKey,
      generatedAt: Date.now(),
      rows,
    } satisfies SubagentBoardData,
  })
  boardByWorkspace.set(workspaceKey, { liveId: sub.liveId, conversationId })
  workspaceByLiveId.set(sub.liveId, workspaceKey)
  return sub.liveId
}

/**
 * Push fresh rows to the workspace's board. `null` when no board is bound, or the
 * bound conversation differs (caller rebinds via showSubagentBoard if wanted).
 */
export function updateSubagentBoard(
  workspaceKey: string,
  conversationId: string,
  rows: SubagentRunBoardRow[],
): void {
  const binding = boardByWorkspace.get(workspaceKey)
  if (!binding || binding.conversationId !== conversationId) return
  if (rows.length === 0) {
    // Everything finished and nothing to show — drop the board so the canvas
    // clears instead of freezing at a stale list.
    disposeLive(binding.liveId)
    boardByWorkspace.delete(workspaceKey)
    workspaceByLiveId.delete(binding.liveId)
    return
  }
  const data: SubagentBoardData = {
    conversationId,
    workspaceKey,
    generatedAt: Date.now(),
    rows,
  }
  broadcastLiveUpdate(binding.liveId, data)
}

export function disposeSubagentBoards(): void {
  for (const [wk, binding] of boardByWorkspace) {
    disposeLive(binding.liveId)
    boardByWorkspace.delete(wk)
    workspaceByLiveId.delete(binding.liveId)
  }
}

/** Build board rows from agent_tasks rows (spec_json carries the live tail fields). */
export function rowsFromAgentTaskRows(rows: AgentTaskRow[]): SubagentRunBoardRow[] {
  const out: SubagentRunBoardRow[] = []
  for (const row of rows) {
    let spec: {
      lastPartialText?: string
      lastToolName?: string
      lastToolPreview?: string
      question?: string
      goal?: string
    } = {}
    try {
      spec = JSON.parse(row.spec_json) as typeof spec
    } catch {
      spec = {}
    }
    out.push({
      taskId: row.id,
      runId: row.id,
      agent: row.agent_name,
      mode: row.mode,
      status:
        row.status === 'running' ? 'running'
        : row.status === 'awaiting_input' ? 'awaiting_input'
        : row.status === 'orphaned' ? 'orphaned'
        : row.status === 'succeeded' ? 'succeeded'
        : row.status === 'failed' ? 'failed'
        : 'cancelled',
      startedAt: row.started_at,
      endedAt: row.ended_at,
      model: row.result_json ? (safeModel(row.result_json) ?? null) : null,
      stepIndex: row.step_index,
      toolName: row.status === 'running' ? spec.lastToolName ?? null : null,
      toolPreview: row.status === 'running' ? spec.lastToolPreview ?? null : null,
      partialTail: row.status === 'running' ? spec.lastPartialText?.trim() ?? null : null,
      tokens: row.tokens_used,
      question: spec.question ?? null,
    })
  }
  // In-flight runs first (oldest started first), then finished ones, newest ended first.
  const rank = (r: SubagentRunBoardRow): number =>
    r.status === 'running' ? 0 : r.status === 'awaiting_input' ? 1 : 2
  return out.sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    if (rank(a) === 0) return (a.startedAt ?? 0) - (b.startedAt ?? 0)
    return (b.endedAt ?? 0) - (a.endedAt ?? 0)
  })
}

function safeModel(resultJson: string): string | undefined {
  try {
    const parsed = JSON.parse(resultJson) as { model?: unknown }
    return typeof parsed.model === 'string' ? parsed.model : undefined
  } catch {
    return undefined
  }
}