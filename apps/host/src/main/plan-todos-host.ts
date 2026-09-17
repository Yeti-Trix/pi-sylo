/**
 * Live planner goals for the chat UI. Each `##` section in the workspace plan
 * file is a goal; the worker ticks the heading. This module watches the file
 * and pushes snapshots.
 */
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

import {
  snapshotPlanMarkdown,
  type PlanStatus,
  type PlanTodo,
} from '../../../../packages/sylo-subagents/extensions/plan-checklist.ts'
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
import { countRunningAgentTasks } from './subagent-tasks-db.js'

export type PlanTodosSnapshot = {
  conversationId: string
  goal?: string
  todos: PlanTodo[]
  status: PlanStatus
}

type PlanTodosListener = (event: { kind: 'changed' }) => void

let listener: PlanTodosListener | undefined
let watcher: FSWatcher | undefined
let watchedDir: string | undefined
let watchDebounce: ReturnType<typeof setTimeout> | undefined

export function setPlanTodosListener(fn: PlanTodosListener | undefined): void {
  listener = fn
}

function emitChanged(): void {
  listener?.({ kind: 'changed' })
}

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
    return countRunningAgentTasks() > 0
  } catch {
    return true
  }
}

function ensureWatch(cwd: string): void {
  const dir = join(cwd, '.sylo', 'plans')
  if (watchedDir === dir && watcher) return
  watcher?.close()
  watcher = undefined
  watchedDir = undefined
  if (!existsSync(dir)) return
  watchedDir = dir
  watcher = watch(dir, () => {
    if (watchDebounce) clearTimeout(watchDebounce)
    watchDebounce = setTimeout(() => emitChanged(), 250)
  })
}

export function readPlanTodos(conversationId: string): PlanTodosSnapshot {
  const empty: PlanTodosSnapshot = { conversationId, todos: [], status: 'active' }
  if (!conversationId.trim()) return empty
  const cwd = cwdForConversation(conversationId)
  if (!cwd) return empty
  ensureWatch(cwd)
  const raw = readPlanMarkdown(cwd, conversationId)
  if (!raw) return empty
  const snap = snapshotPlanMarkdown(raw)
  if (snap.conversationId && snap.conversationId !== conversationId) return empty
  // Still on disk so "continue" can bring it back — just not on the bar right now.
  if (snap.hidden) return empty
  return {
    conversationId,
    goal: snap.goal,
    todos: snap.todos,
    status: snap.status,
  }
}

export function notifyPlanTodosChanged(): void {
  emitChanged()
}

/** New chat: drop a leftover workspace current.md. Other chats' scoped files stay. */
export function clearPlanForNewChat(workspaceId: string): void {
  const cwd = cwdForWorkspace(workspaceId)
  if (cwd && !subagentsRunning()) removeCurrentPlan(cwd)
  emitChanged()
}

const NO_PLAN: PlanScope = { planRel: null, done: 0, total: 0 }

/**
 * Runs at the start of every operator turn in this chat:
 *  - drops a leftover `current.md` owned by another conversation,
 *  - hides this chat's plan if it is finished (reviewed / all ticked), so the
 *    previous run's goals leave the bar exactly when the operator sends again,
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
  emitChanged()
  if (!raw) return NO_PLAN
  ensureWatch(cwd)
  const snap = snapshotPlanMarkdown(raw)
  return {
    planRel: conversationPlanRel(conversationId),
    done: snap.todos.filter((t) => t.done).length,
    total: snap.todos.length,
    nextGoal: snap.todos.find((t) => !t.done)?.text,
    hidden: snap.hidden,
  }
}
