import type { ChildProcess } from 'node:child_process'

import { isProcAlive, killSubagentTree } from './subagent-kill.ts'

/** Optional per-run metadata so conversational cancel can resolve "stop the scout run". */
type RunMeta = { agent?: string; task?: string; mode?: string; groupRunId?: string }

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
  pausedRuns.delete(runId)
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
      // Register the cancel BEFORE killing so finalize reports `cancelled`,
      // matching cancelSubagentRun — previously wholesale cancels finalized
      // these runs as `failed`, which mislabeled operator stops.
      cancelledRuns.add(runId)
      killSubagentTree(proc)
      count++
    }
    active.delete(runId)
  }
  return count
}

// ── Operator pause/resume (runs board ⏸/▶) ────────────────────────────────────
// Semantics: pause = the operator stops feeding this run. A live child is killed
// (like cancel) but the run parks as `paused` — not cancelled — and Start
// re-dispatches it from its stored context. Chain units additionally record a
// between-steps pause request so the driver never spawns the next step.
const pausedRuns = new Set<string>()
const pauseRequested = new Set<string>()

export type PauseOutcome = { killed: boolean; chainFlagged: boolean }

/**
 * Pause a run: if its child is live, kill it; the child's finalize reports `paused`.
 * `groupRunId` also flags the whole chain unit so the driver stops between steps.
 * Returns false when no live child is on that id (already exited/finished).
 */
export function pauseSubagentRun(runId: string): PauseOutcome {
  const proc = active.get(runId)
  if (!proc) return { killed: false, chainFlagged: false }
  pausedRuns.add(runId)
  const meta = runMeta.get(runId)
  const groupRunId = meta?.groupRunId
  let chainFlagged = false
  if (groupRunId && groupRunId !== runId) {
    // Killing this chain step also stops the unit before its next step.
    pauseRequested.add(groupRunId)
    chainFlagged = true
  }
  killSubagentTree(proc)
  return { killed: true, chainFlagged }
}

/** Flag a chain unit to stop before its next step (pause pressed between steps). */
export function requestSubagentPause(groupRunId: string): void {
  pauseRequested.add(groupRunId)
}

/** The chain driver consumes its unit's pause flag before spawning each step. */
export function consumePauseRequest(groupRunId: string): boolean {
  if (!pauseRequested.has(groupRunId)) return false
  pauseRequested.delete(groupRunId)
  return true
}

/** The child's finalize consumes its own pause flag to report `paused`, not `cancelled`. */
export function consumeRunPaused(runId: string): boolean {
  if (!pausedRuns.has(runId)) return false
  pausedRuns.delete(runId)
  return true
}
