import type { AgentTaskRow, AgentTaskStatus } from '../../panels/tasks/task-types'

/** Statuses worth surfacing over a plain success when a batch has ended. */
const TROUBLE: readonly AgentTaskStatus[] = ['failed', 'cancelled', 'orphaned']

function startedAt(task: AgentTaskRow): number {
  return task.started_at ?? task.created_at
}

/** The step a batch is working on right now — the newest running one. */
function liveTask(tasks: readonly AgentTaskRow[]): AgentTaskRow | undefined {
  let live: AgentTaskRow | undefined
  for (const task of tasks) {
    if (task.status !== 'running') continue
    if (!live || startedAt(task) > startedAt(live)) live = task
  }
  return live
}

/**
 * Which task the inline run block should show, given what it shows now.
 *
 * A chain registers each step only when that step starts, so the row the operator
 * wants is whichever one is running at the time. Selection used to be picked once
 * and then only revisited if the selected row disappeared, which pinned the pane to
 * step 1 and made every later step a click. Follow the live step instead.
 *
 * Two things it deliberately does not do: yank a step the operator is watching
 * stream (a running selection stays), and move the pane around after the batch has
 * ended (a finished selection stays too, so output does not shift while being read).
 */
export function pickFocusTask(
  tasks: readonly AgentTaskRow[],
  current: string | null,
): string | null {
  if (tasks.length === 0) return null
  const selected = tasks.find((t) => t.id === current) ?? null
  if (selected?.status === 'running') return selected.id

  const live = liveTask(tasks)
  if (live) return live.id
  if (selected) return selected.id

  // Nothing has run since this block appeared: open on whatever explains the batch
  // best — the step that went wrong, else the last one, which for a chain is the
  // final output rather than the step-1 preamble.
  return tasks.find((t) => TROUBLE.includes(t.status))?.id ?? tasks[tasks.length - 1]!.id
}

const SEVERITY: Record<AgentTaskStatus, number> = {
  failed: 4,
  orphaned: 3,
  cancelled: 2,
  succeeded: 1,
  running: 0,
}

/**
 * The status that speaks for a whole batch.
 *
 * The summary badge used to read the *first* task's status, so a chain that failed
 * at step 3 still announced itself as succeeded.
 */
export function batchWorstStatus(tasks: readonly AgentTaskRow[]): AgentTaskStatus {
  let worst: AgentTaskStatus = 'succeeded'
  for (const task of tasks) {
    if (SEVERITY[task.status] > SEVERITY[worst]) worst = task.status
  }
  return worst
}
