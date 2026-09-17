import type { ChildProcess } from 'node:child_process'

import { isProcAlive, killSubagentTree } from './subagent-kill.ts'

const active = new Map<string, ChildProcess>()
const cancelledRuns = new Set<string>()

export function registerSubagentRun(runId: string, proc: ChildProcess): void {
  active.set(runId, proc)
}

export function unregisterSubagentRun(runId: string): void {
  active.delete(runId)
  cancelledRuns.delete(runId)
}

export function consumeRunCancelled(runId: string): boolean {
  if (!cancelledRuns.has(runId)) return false
  cancelledRuns.delete(runId)
  return true
}

/** Kill a child Pi subprocess by run id. Returns true if a live run was found. */
export function cancelSubagentRun(runId: string): boolean {
  const proc = active.get(runId)
  if (!proc) return false
  cancelledRuns.add(runId)
  killSubagentTree(proc)
  return true
}

export function cancelAllSubagentRuns(): number {
  let count = 0
  for (const [runId, proc] of active) {
    if (isProcAlive(proc)) {
      killSubagentTree(proc)
      count++
    }
    active.delete(runId)
  }
  return count
}
