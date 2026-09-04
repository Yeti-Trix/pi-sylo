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

/** Assign batches to subagent tool segments in order within a message turn. */
export function mapSubagentBatchesToMessage(
  segments: AssistantSegment[],
  tasks: AgentTaskRow[],
  messageStartTs: number,
): Map<string, SubagentTaskBatch> {
  const subagentSegs = segments.filter(
    (s): s is Extract<AssistantSegment, { kind: 'tool' }> =>
      s.kind === 'tool' && s.toolName === 'subagent',
  )
  if (subagentSegs.length === 0) return new Map()

  const msgTasks = tasks.filter((t) => (t.started_at ?? t.created_at) >= messageStartTs - 2000)
  const batches = buildSubagentBatches(msgTasks)

  const map = new Map<string, SubagentTaskBatch>()
  const count = Math.min(subagentSegs.length, batches.length)
  for (let i = 0; i < count; i++) {
    map.set(subagentSegs[i]!.id, batches[i]!)
  }
  return map
}
