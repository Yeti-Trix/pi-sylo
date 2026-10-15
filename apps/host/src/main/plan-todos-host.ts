/**
 * Host-side plan-file scoping. Each `##` section in the workspace plan file is
 * a goal; worker subagents tick the headings directly. This module only keeps
 * the per-turn plumbing the orchestrator needs (scope a chat's plan, drop
 * leftovers on new chat) — the operator-facing goals bar that used to live
 * above the composer was removed, so there is no snapshot/watch/notify layer.
 */
import { existsSync } from 'node:fs'

import { snapshotPlanMarkdown } from '../../../../packages/sylo-subagents/extensions/plan-checklist.ts'
import {
  conversationPlanRel,
  hideFinishedPlan,
  readPlanMarkdown,
  removeCurrentPlan,
  restorePlan,
  retractForeignCurrentPlan,
} from '../../../../packages/sylo-subagents/extensions/plan-file.ts'
import type { PlanScope } from '../shared/orchestrator-resume.js'
import { getConversation, getWorkspace } from './database.js'
import { countRunningAgentTasks, SUBAGENT_RUN_QUIET_MS } from './subagent-tasks-db.js'

function cwdForConversation(conversationId: string): string | null {
  const conv = getConversation(conversationId)
  if (!conv?.workspace_id) return null
  const cwd = getWorkspace(conv.workspace_id)?.pi_cwd?.trim() ?? ''
  return cwd && existsSync(cwd) ? cwd : null
}

function cwdForWorkspace(workspaceId: string): string | null {
  const cwd = getWorkspace(workspaceId)?.pi_cwd?.trim() ?? ''
  return cwd && existsSync(cwd) ? cwd : null
}

/**
 * A live worker reads and ticks the plan file for the whole run. Deleting it
 * mid-run makes the worker report the plan as lost and improvise, so no
 * host-side cleanup may touch the file while any subagent is still running.
 */
function subagentsRunning(): boolean {
  try {
    // Zombie-aware: a still-`running` row the orphan reconcile has not flipped yet
    // must not block plan cleanup forever — only rows seen alive within the run-quiet
    // window count (every broker event bumps the row's updated_at, so quiet = dead-ish).
    return countRunningAgentTasks(undefined, SUBAGENT_RUN_QUIET_MS) > 0
  } catch {
    return true
  }
}

/** New chat: drop a leftover workspace current.md. Other chats' scoped files stay. */
export function clearPlanForNewChat(workspaceId: string): void {
  const cwd = cwdForWorkspace(workspaceId)
  if (cwd && !subagentsRunning()) removeCurrentPlan(cwd)
}

const NO_PLAN: PlanScope = { planRel: null, done: 0, total: 0 }

/**
 * Runs at the start of every operator turn in this chat:
 *  - drops a leftover `current.md` owned by another conversation,
 *  - hides this chat's plan if it is finished (reviewed / all ticked), so the
 *    previous run's goals stop shaping `PlanScope` after the operator
 *    sends again,
 *  - or puts a hidden plan back when the operator asks to continue,
 *  - reports remaining progress so the orchestrator works the next section.
 */
export function isolatePlanForConversation(
  conversationId: string,
  options?: { resume?: boolean },
): PlanScope {
  if (!conversationId.trim()) return NO_PLAN
  const cwd = cwdForConversation(conversationId)
  if (!cwd) return NO_PLAN
  if (!subagentsRunning()) {
    retractForeignCurrentPlan(cwd, conversationId)
    if (options?.resume) restorePlan(cwd, conversationId)
    else hideFinishedPlan(cwd, conversationId)
  }
  const raw = readPlanMarkdown(cwd, conversationId)
  if (!raw) return NO_PLAN
  const snap = snapshotPlanMarkdown(raw)
  return {
    planRel: conversationPlanRel(conversationId),
    done: snap.todos.filter((t) => t.state === 'passed').length,
    total: snap.todos.length,
    built: snap.todos.filter((t) => t.state === 'built').length,
    nextGoal: snap.todos.find((t) => t.state === 'open')?.text,
    nextReview: snap.todos.find((t) => t.state === 'built')?.text,
    hidden: snap.hidden,
  }
}