/**
 * sylo-tasks — host main-process bridge for the Phase 3 sidebar dashboard.
 *
 * The dashboard runs as a package-owned Vite route (an iframe in the sidebar).
 * It cannot reach the broker's Pi-agent tools directly, so it talks to the host
 * via the skill-route bridge (postMessage → `handleSkillRouteBridge` →
 * `window.sylo.tasksDb.*` → `tasks:db-*` IPC → this module).
 *
 * This module imports the SAME shared store the broker extension uses
 * (`packages/sylo-tasks/shared/tasks-store.js`) and calls its mutations with an
 * EXPLICIT `workspaceCwd` (main has no `SYLO_PI_CWD` — that env var is frozen
 * into the broker child only). Because both writers share the identical store
 * code, the reverse-edge sync (`blocked_by`↔`blocks`) and atomic write are not
 * duplicated — the dashboard is a full-CRUD surface safely, unlike the Canvas
 * board which is intentionally limited to `status`+`notes`.
 *
 * After every write this module fans the fresh snapshot to any task-board
 * bound to that (workspace, list) via `fanTasksChanged` — the same path the
 * broker's `sylo-tasks:changed` takes — so a Canvas board open for the list the
 * operator is editing in the dashboard updates live, and vice-versa.
 *
 * v1 limitation: dashboard writes and agent writes are two writers on one JSON
 * file. Atomic temp+rename means a read never sees a corrupt file, but a
 * concurrent dashboard + agent write to the same list could lose one edit (last
 * writer wins). Single-operator pilot concurrency is near-zero, so this is
 * acceptable for v1 (same trade the personal-tool packages make today). Escalates to
 * broker-forward or SQLite in Phase 7 if it bites.
 */
import {
  addTask as storeAddTask,
  createList as storeCreateList,
  deleteList as storeDeleteList,
  deleteTask as storeDeleteTask,
  getListSnapshot,
  getWorkspaceSnapshot,
  updateTask as storeUpdateTask,
} from '../../../../packages/sylo-tasks/shared/tasks-store.js'
import type {
  Task,
  TaskList,
  TaskListSnapshot,
  TasksWorkspaceSnapshot,
} from '../../../../packages/sylo-tasks/shared/types.js'
import { fanTasksChanged } from './tasks-live.js'

type WriteResult<T> = { ok: true; result: T } | { ok: false; error: string }

function ok<T>(result: T): WriteResult<T> {
  return { ok: true, result }
}
function err(error: string): WriteResult<never> {
  return { ok: false, error }
}

/** Fan the fresh snapshot for `listId` to any bound Canvas board. Called after
 *  every dashboard write so the Canvas board (if open for this list) updates
 *  live. `workspaceKey` is the workspace cwd — same key the broker registers
 *  boards under, so `isActiveBoard` matches. */
function fan(workspaceCwd: string, listId: string): void {
  const snapshot = getListSnapshot(listId, workspaceCwd)
  fanTasksChanged({ workspaceKey: workspaceCwd, listId, snapshot })
}

// ── Reads ──────────────────────────────────────────────────────────────────

export function tasksDbSnapshotGet(
  workspaceCwd: string,
): WriteResult<TasksWorkspaceSnapshot | null> {
  try {
    return ok(getWorkspaceSnapshot(workspaceCwd))
  } catch (e) {
    return err(String(e?.toString?.() ?? e))
  }
}

export function tasksDbListGet(
  workspaceCwd: string,
  listId: string,
): WriteResult<TaskListSnapshot | null> {
  try {
    return ok(getListSnapshot(listId, workspaceCwd))
  } catch (e) {
    return err(String(e?.toString?.() ?? e))
  }
}

// ── Writes ─────────────────────────────────────────────────────────────────

export function tasksDbListCreate(
  workspaceCwd: string,
  args: { title?: string; mode?: string; description?: string },
): WriteResult<TaskList> {
  try {
    const list = storeCreateList({
      title: String(args.title ?? ''),
      mode: args.mode,
      description: args.description,
      workspaceCwd,
    })
    fan(workspaceCwd, list.id)
    return ok(list)
  } catch (e) {
    return err(String(e?.toString?.() ?? e))
  }
}

export function tasksDbListDelete(
  workspaceCwd: string,
  listId: string,
): WriteResult<boolean> {
  try {
    const removed = storeDeleteList(listId, workspaceCwd)
    if (removed) {
      // null snapshot → fanTasksChanged disposes any bound board so the Canvas
      // clears instead of freezing at a stale last value.
      fanTasksChanged({ workspaceKey: workspaceCwd, listId, snapshot: null })
    }
    return ok(removed)
  } catch (e) {
    return err(String(e?.toString?.() ?? e))
  }
}

export function tasksDbTaskAdd(
  workspaceCwd: string,
  args: {
    list_id?: string
    title?: string
    status?: string
    notes?: string
    due?: string
    blocked_by?: string[]
  },
): WriteResult<Task> {
  try {
    const task = storeAddTask({
      list_id: String(args.list_id ?? ''),
      title: String(args.title ?? ''),
      status: args.status,
      notes: args.notes,
      due: args.due,
      blocked_by: args.blocked_by,
      workspaceCwd,
    })
    fan(workspaceCwd, task.list_id)
    return ok(task)
  } catch (e) {
    return err(String(e?.toString?.() ?? e))
  }
}

export function tasksDbTaskUpdate(
  workspaceCwd: string,
  args: {
    id?: string
    title?: string
    status?: string
    notes?: string | null
    due?: string | null
    blocked_by?: string[]
  },
): WriteResult<Task | null> {
  try {
    const task = storeUpdateTask({
      id: String(args.id ?? ''),
      title: args.title,
      status: args.status,
      notes: args.notes,
      due: args.due,
      blocked_by: args.blocked_by,
      workspaceCwd,
    })
    if (task) fan(workspaceCwd, task.list_id)
    return ok(task)
  } catch (e) {
    return err(String(e?.toString?.() ?? e))
  }
}

export function tasksDbTaskDelete(
  workspaceCwd: string,
  taskId: string,
): WriteResult<boolean> {
  try {
    // Resolve list_id BEFORE deleting so we can fan the update to the board.
    const snap = getWorkspaceSnapshot(workspaceCwd)
    const listId = snap?.tasks.find((t) => t.id === taskId)?.list_id
    const removed = storeDeleteTask(taskId, workspaceCwd)
    if (removed && listId) fan(workspaceCwd, listId)
    return ok(removed)
  } catch (e) {
    return err(String(e?.toString?.() ?? e))
  }
}