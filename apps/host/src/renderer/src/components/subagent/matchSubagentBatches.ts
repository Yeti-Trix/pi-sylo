import type { AgentTaskRow } from '../../panels/tasks/task-types'
import type { AssistantSegment } from '../../workflowTimeline'

export type SubagentTaskBatch = {
  batchKey: string
  mode: 'single' | 'parallel' | 'chain'
  tasks: AgentTaskRow[]
}

function batchKeyForTask(task: AgentTaskRow): string {
  return task.group_run_id ?? task.id
}

function tasksToBatch(tasks: AgentTaskRow[]): SubagentTaskBatch {
  const mode = tasks[0]?.mode ?? 'single'
  const sorted =
    mode === 'chain' ?
      [...tasks].sort((a, b) => (a.step_index ?? 0) - (b.step_index ?? 0))
    : [...tasks].sort((a, b) => (a.started_at ?? a.created_at) - (b.started_at ?? b.created_at))
  return {
    batchKey: batchKeyForTask(tasks[0]!),
    mode,
    tasks: sorted,
  }
}

/** Group conversation tasks into ordered batches (one per subagent tool invocation). */
export function buildSubagentBatches(tasks: AgentTaskRow[]): SubagentTaskBatch[] {
  const seen = new Set<string>()
  const batches: SubagentTaskBatch[] = []
  const sorted = [...tasks].sort(
    (a, b) => (a.started_at ?? a.created_at) - (b.started_at ?? b.created_at),
  )

  for (const task of sorted) {
    const key = batchKeyForTask(task)
    if (seen.has(key)) continue
    seen.add(key)
    const group = sorted.filter((t) => batchKeyForTask(t) === key)
    batches.push(tasksToBatch(group))
  }
  return batches
}

/** A batch placed on the wall clock, so segments can be matched by when they ran. */
type BatchWindow = {
  batch: SubagentTaskBatch
  startTs: number
  /** Null while any child is still going — nothing has finished the batch yet. */
  endTs: number | null
  running: boolean
}

function batchWindow(batch: SubagentTaskBatch): BatchWindow {
  let startTs = Number.POSITIVE_INFINITY
  let endTs = 0
  let running = false
  let allEnded = true
  for (const task of batch.tasks) {
    startTs = Math.min(startTs, task.started_at ?? task.created_at)
    if (task.status === 'running') running = true
    if (typeof task.ended_at === 'number') endTs = Math.max(endTs, task.ended_at)
    else allEnded = false
  }
  return {
    batch,
    startTs: Number.isFinite(startTs) ? startTs : 0,
    endTs: allEnded && !running ? endTs : null,
    running,
  }
}

/**
 * Claim the unused window scoring lowest, ignoring any the caller rules out.
 * Returns the claimed index, or -1 when nothing is eligible.
 */
function claimNearest(
  windows: BatchWindow[],
  used: Set<number>,
  eligible: (w: BatchWindow) => boolean,
  distance: (w: BatchWindow) => number,
): number {
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < windows.length; i++) {
    if (used.has(i)) continue
    const w = windows[i]!
    if (!eligible(w)) continue
    const d = distance(w)
    if (d < bestDistance) {
      best = i
      bestDistance = d
    }
  }
  if (best >= 0) used.add(best)
  return best
}

/**
 * Assign task batches to the subagent tool segments of one message turn.
 *
 * Matching is by wall clock, not array position. Long turns get their telemetry
 * trimmed from the head, which drops `tool_execution_start` rows and leaves fewer
 * segments than batches — pairing by index then slid every segment onto the wrong
 * run, so a live subagent rendered as some already-finished one.
 *
 * A still-open segment is the run the operator is watching, so it claims a batch
 * that is still running first. Closed segments anchor on their end, because a
 * subagent tool returns as soon as its last child does.
 */
export function mapSubagentBatchesToMessage(
  segments: AssistantSegment[],
  tasks: AgentTaskRow[],
  messageStartTs: number,
): Map<string, SubagentTaskBatch> {
  const subagentSegs = segments
    .filter(
      (s): s is Extract<AssistantSegment, { kind: 'tool' }> =>
        s.kind === 'tool' && s.toolName === 'subagent',
    )
    .sort((a, b) => a.startTs - b.startTs)
  if (subagentSegs.length === 0) return new Map()

  const msgTasks = tasks.filter((t) => (t.started_at ?? t.created_at) >= messageStartTs - 2000)
  const windows = buildSubagentBatches(msgTasks)
    .map(batchWindow)
    .sort((a, b) => a.startTs - b.startTs)

  const map = new Map<string, SubagentTaskBatch>()
  const used = new Set<number>()

  const openSegs = subagentSegs.filter((s) => s.endTs === null)
  const closedSegs = subagentSegs.filter((s) => s.endTs !== null)

  for (const seg of openSegs) {
    const ix = claimNearest(
      windows,
      used,
      (w) => w.running,
      (w) => Math.abs(w.startTs - seg.startTs),
    )
    if (ix >= 0) map.set(seg.id, windows[ix]!.batch)
  }

  for (const seg of closedSegs) {
    const segEnd = seg.endTs!
    const ix = claimNearest(
      windows,
      used,
      () => true,
      (w) => Math.abs((w.endTs ?? w.startTs) - segEnd),
    )
    if (ix >= 0) map.set(seg.id, windows[ix]!.batch)
  }

  // An open segment whose children already finished (the tool has not reported back
  // yet) still deserves its run rather than the "starting…" placeholder.
  for (const seg of openSegs) {
    if (map.has(seg.id)) continue
    const ix = claimNearest(
      windows,
      used,
      () => true,
      (w) => Math.abs(w.startTs - seg.startTs),
    )
    if (ix >= 0) map.set(seg.id, windows[ix]!.batch)
  }

  return map
}
