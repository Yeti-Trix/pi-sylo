import type { AgentTaskRow, AgentTaskSpec, AgentTaskStatus, TaskGroup } from './task-types'

export function parseTaskSpec(specJson: string): AgentTaskSpec {
  try {
    return JSON.parse(specJson) as AgentTaskSpec
  } catch {
    return {}
  }
}

export function parseResultJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export function statusLabel(status: AgentTaskStatus): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'orphaned':
      return 'Orphaned'
  }
}

export function statusTone(status: AgentTaskStatus): string {
  switch (status) {
    case 'running':
      return 'border-accent/40 bg-accent/10 text-accent'
    case 'succeeded':
      return 'border-success/35 bg-success/10 text-success'
    case 'failed':
      return 'border-danger/40 bg-danger/10 text-danger'
    case 'cancelled':
      return 'border-border bg-bg-tertiary text-text-secondary'
    case 'orphaned':
      return 'border-[rgb(255_193_7/0.35)] bg-[rgb(255_193_7/0.08)] text-[rgb(255_210_100)]'
  }
}

export function formatWhen(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDuration(start: number | null, end: number | null, now = Date.now()): string {
  if (start === null) return '—'
  const endTs = end ?? now
  const ms = Math.max(0, endTs - start)
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

export function groupTasksForDisplay(tasks: AgentTaskRow[]): TaskGroup[] {
  const byGroup = new Map<string, AgentTaskRow[]>()
  const singles: AgentTaskRow[] = []

  for (const task of tasks) {
    if (task.mode === 'parallel' || task.mode === 'chain') {
      const gid = task.group_run_id ?? task.id
      const bucket = byGroup.get(gid) ?? []
      bucket.push(task)
      byGroup.set(gid, bucket)
    } else {
      singles.push(task)
    }
  }

  const groups: TaskGroup[] = []

  for (const task of singles) {
    groups.push({ kind: 'single', task })
  }

  for (const [groupRunId, batch] of byGroup) {
    const mode = batch[0]?.mode === 'chain' ? 'chain' : 'parallel'
    const sorted =
      mode === 'chain' ?
        [...batch].sort((a, b) => (a.step_index ?? 0) - (b.step_index ?? 0))
      : [...batch].sort((a, b) => b.created_at - a.created_at)
    groups.push({ kind: 'batch', groupRunId, mode, tasks: sorted })
  }

  groups.sort((a, b) => {
    const aTs =
      a.kind === 'single' ? a.task.created_at : Math.max(...a.tasks.map((t) => t.created_at))
    const bTs =
      b.kind === 'single' ? b.task.created_at : Math.max(...b.tasks.map((t) => t.created_at))
    return bTs - aTs
  })

  return groups
}

export function batchProgress(tasks: AgentTaskRow[]): { done: number; total: number; running: number } {
  const total = tasks.length
  const running = tasks.filter((t) => t.status === 'running').length
  const done = tasks.filter((t) => t.status !== 'running').length
  return { done, total, running }
}

export function livePreviewText(task: AgentTaskRow): string | null {
  const spec = parseTaskSpec(task.spec_json)
  if (spec.lastPartialText?.trim()) return spec.lastPartialText.trim()
  if (task.status === 'running') return null
  if (task.result_summary?.trim()) return task.result_summary.trim()
  const result = parseResultJson(task.result_json)
  const text = result?.resultText
  return typeof text === 'string' && text.trim() ? text.trim() : null
}
