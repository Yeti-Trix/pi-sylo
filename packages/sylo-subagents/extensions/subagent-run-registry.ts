import type { ChildProcess } from 'node:child_process'

import { isProcAlive, killSubagentTree } from './subagent-kill.ts'

/** Optional per-run metadata so conversational cancel can resolve "stop the scout run". */
type RunMeta = { agent?: string; task?: string; mode?: string }

const active = new Map<string, ChildProcess>()
const runMeta = new Map<string, RunMeta>()
const cancelledRuns = new Set<string>()

export function registerSubagentRun(runId: string, proc: ChildProcess, meta?: RunMeta): void {
  active.set(runId, proc)
  if (meta instanceof Object) runMeta.set(runId, meta)
}

export function unregisterSubagentRun(runId: string): void {
  active.delete(runId)
  runMeta.delete(runId)
  cancelledRuns.delete(runId)
}

/**
 * Most recent live run for an agent name ("stop what scout is doing right now").
 * Registry iteration order is insertion order, so the last live match is newest.
 */
export function findActiveRunByAgent(agentName: string): string | null {
  let found: string | null = null
  for (const [runId, meta] of runMeta) {
    if (meta.agent?.toLowerCase() === agentName.toLowerCase() && active.has(runId)) {
      found = runId
    }
  }
  return found
}

/** Summaries of live runs, newest last: id, agent, task tail. */
export function listActiveRunSummaries(): Array<{
  runId: string
  agent?: string
  task?: string
  mode?: string
}> {
  const out: Array<{ runId: string; agent?: string; task?: string; mode?: string }> = []
  for (const [runId, meta] of runMeta) {
    if (!active.has(runId)) continue
    out.push({ runId, agent: meta.agent, task: meta.task, mode: meta.mode })
  }
  return out
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
