/**
 * sylo-tasks — per-workspace JSON store.
 *
 * Path: `${SYLO_PI_CWD}/.sylo/tasks.json`. `SYLO_PI_CWD` is the workspace's
 * `pi_cwd`, injected by the broker supervisor (see `broker-supervisor.ts`),
 * so each workspace gets its own task store. JSON (not SQLite) is intentional
 * for v1: the store is small, operator-editable by absolute path (the Phase 1
 * validation adds a note via direct file edit), and trivially portable to main
 * for renderer-edit IPC (Phase 3/4). SQLite is a Phase-7 escalation if query
 * needs grow.
 *
 * Every mutation rewrites the file atomically (temp + rename) and emits a
 * `sylo-tasks:changed` notification to the host main process via
 * `process.send`. Main (Phase 2) binds `liveId`s to (workspaceKey, listId) and
 * fans `canvas:live-update` to subscribers; Phase 1 just proves the plumbing
 * reaches main.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  normalizeTaskListMode,
  normalizeTaskStatus,
  type Task,
  type TaskList,
  type TaskListSnapshot,
  type TasksStore,
  type TasksWorkspaceSnapshot,
} from './types.js'

const STORE_VERSION = 1

/** Resolve the per-workspace tasks JSON path. Returns null when not running
 *  inside a Sylo broker (no SYLO_PI_CWD). */
export function resolveTasksPath(workspaceCwd?: string): string | null {
  const cwd = (workspaceCwd?.trim() || process.env.SYLO_PI_CWD?.trim())
  if (!cwd) return null
  return join(cwd, '.sylo', 'tasks.json')
}

/** Stable workspace key for live-subscription binding. We use the resolved
 *  `pi_cwd` so two workspaces with the same name but different folders don't
 *  collide. */
export function resolveWorkspaceKey(workspaceCwd?: string): string | null {
  const cwd = (workspaceCwd?.trim() || process.env.SYLO_PI_CWD?.trim())
  return cwd || null
}

function emptyStore(): TasksStore {
  return { version: STORE_VERSION, lists: [], tasks: [] }
}

function load(workspaceCwd?: string): TasksStore {
  const fp = resolveTasksPath(workspaceCwd)
  if (!fp || !existsSync(fp)) return emptyStore()
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf8'))
    if (!raw || typeof raw !== 'object') return emptyStore()
    const lists = Array.isArray((raw as TasksStore).lists) ? (raw as TasksStore).lists : []
    const tasks = Array.isArray((raw as TasksStore).tasks) ? (raw as TasksStore).tasks : []
    return { version: STORE_VERSION, lists, tasks }
  } catch {
    return emptyStore()
  }
}

function save(store: TasksStore, workspaceCwd?: string): void {
  const fp = resolveTasksPath(workspaceCwd)
  if (!fp) throw new Error('SYLO_PI_CWD is not set. Run inside the Sylo broker with sylo-tasks enabled.')
  mkdirSync(dirname(fp), { recursive: true })
  const tmp = `${fp}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  renameSync(tmp, fp)
}

/** Send a message to the host main process. No-op when not running under the
 *  broker (`process.send` undefined, e.g. unit tests). */
function sendToHost(msg: unknown): void {
  const snd = process.send?.bind(process) as ((m: unknown) => boolean) | undefined
  if (!snd) return
  snd(msg)
}

/** Broker → main: the store changed for `listId`. Main looks up the bound
 *  `liveId` (Phase 2) and fans the snapshot to subscribers. A `null` snapshot
 *  means the list was deleted — main clears any board bound to it. No-op when
 *  not running under the broker. */
function notifyChanged(listId: string, snapshot: TaskListSnapshot | null, workspaceCwd?: string): void {
  const workspaceKey = resolveWorkspaceKey(workspaceCwd)
  if (!workspaceKey) return
  sendToHost({ type: 'sylo-tasks:changed', workspaceKey, listId, snapshot })
}

/** Broker → main: the agent asked to surface `listId` on the live Canvas. Main
 *  (Phase 2) creates a `task-board` live subscription seeded with `snapshot`,
 *  emits `canvas:live-show`, and binds the liveId to (workspaceKey, listId) so
 *  later `sylo-tasks:changed` updates fan to the board. Returns the snapshot +
 *  workspaceKey so the tool can report; null if the list or workspace is gone. */
export function openOnCanvas(
  listId: string,
): { snapshot: TaskListSnapshot; workspaceKey: string } | null {
  const workspaceKey = resolveWorkspaceKey()
  if (!workspaceKey) return null
  const snapshot = getListSnapshot(listId)
  if (!snapshot) return null
  sendToHost({ type: 'sylo-tasks:open-on-canvas', workspaceKey, listId, snapshot })
  return { snapshot, workspaceKey }
}

function snapshotOf(store: TasksStore, listId: string): TaskListSnapshot | null {
  const list = store.lists.find((l) => l.id === listId)
  if (!list) return null
  return { list, tasks: store.tasks.filter((t) => t.list_id === listId) }
}

function emit(store: TasksStore, listId: string, workspaceCwd?: string): void {
  const snap = snapshotOf(store, listId)
  if (snap) notifyChanged(listId, snap, workspaceCwd)
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function createList(args: {
  title: string
  /** Loose string — normalized internally (agent_driven | operator_driven). */
  mode?: string
  description?: string
  /** Explicit workspace cwd (host main path, Phase 3). Defaults to
   *  `process.env.SYLO_PI_CWD` (broker path). */
  workspaceCwd?: string
}): TaskList {
  const title = String(args.title ?? '').trim()
  if (!title) throw new Error('title is required.')
  const store = load(args.workspaceCwd)
  const now = Date.now()
  const list: TaskList = {
    id: randomUUID(),
    title,
    mode: normalizeTaskListMode(args.mode),
    description: args.description?.trim() || undefined,
    created_at: now,
    updated_at: now,
  }
  store.lists.push(list)
  save(store, args.workspaceCwd)
  emit(store, list.id, args.workspaceCwd)
  return list
}

export function deleteList(id: string, workspaceCwd?: string): boolean {
  const store = load(workspaceCwd)
  const before = store.lists.length
  store.lists = store.lists.filter((l) => l.id !== id)
  store.tasks = store.tasks.filter((t) => t.list_id !== id)
  if (store.lists.length === before) return false
  save(store, workspaceCwd)
  // Notify main so a Phase 2 board bound to this list clears instead of
  // freezing at a stale last snapshot.
  notifyChanged(id, null, workspaceCwd)
  return true
}

export function addTask(args: {
  list_id: string
  title: string
  /** Loose string — normalized internally to the canonical status set. */
  status?: string
  notes?: string
  due?: string
  blocked_by?: string[]
  /** Id of a `sylo-scheduler` reminder for this task's due (Phase 6). Usually
   *  set later via updateTask after the agent calls `schedule_create`. */
    reminder_schedule_id?: string
  /** Insert the new task immediately AFTER this task id (within the same
   *  list). If omitted, see `before_task_id`. If neither is set (or the id
   *  isn't found), the task is appended to the end of the list. */
  after_task_id?: string
  /** Insert the new task immediately BEFORE this task id (within the same
   *  list). Used only if `after_task_id` is not set / not found. */
  before_task_id?: string
  /** Explicit workspace cwd (host main path, Phase 3). */
  workspaceCwd?: string
}): Task {
  const title = String(args.title ?? '').trim()
  if (!title) throw new Error('title is required.')
  const store = load(args.workspaceCwd)
  if (!store.lists.some((l) => l.id === args.list_id)) {
    throw new Error(`No task list with id ${args.list_id}.`)
  }
  const now = Date.now()
  const blocked_by = (args.blocked_by ?? []).map((s) => String(s)).filter(Boolean)
  const task: Task = {
    id: randomUUID(),
    list_id: args.list_id,
    title,
    status: normalizeTaskStatus(args.status),
    notes: args.notes?.trim() || undefined,
    due: args.due?.trim() || undefined,
    reminder_schedule_id: args.reminder_schedule_id?.trim() || undefined,
    blocked_by,
    blocks: [],
    created_at: now,
    updated_at: now,
  }
  // Position: after_task_id wins, then before_task_id, then end-of-list.
  let insertIndex = store.tasks.length
  if (args.after_task_id) {
    const i = store.tasks.findIndex(
      (t) => t.id === args.after_task_id && t.list_id === args.list_id,
    )
    if (i >= 0) insertIndex = i + 1
  } else if (args.before_task_id) {
    const i = store.tasks.findIndex(
      (t) => t.id === args.before_task_id && t.list_id === args.list_id,
    )
    if (i >= 0) insertIndex = i
  }
  store.tasks.splice(insertIndex, 0, task)
  // Maintain reverse edges: each blocker gains this task in `blocks`.
  for (const bid of blocked_by) {
    const b = store.tasks.find((t) => t.id === bid && t.list_id === args.list_id)
    if (b && !b.blocks.includes(task.id)) b.blocks.push(task.id)
  }
  save(store, args.workspaceCwd)
  emit(store, args.list_id, args.workspaceCwd)
  return task
}

export function updateTask(args: {
  id: string
  title?: string
  /** Loose string — normalized internally. */
  status?: string
  notes?: string | null
  due?: string | null
  blocked_by?: string[]
  /** Id of the `sylo-scheduler` reminder for this task's due (Phase 6). Pass
   *  null to clear (after `schedule_delete`). */
  reminder_schedule_id?: string | null
  /** Explicit workspace cwd (host main path, Phase 3). */
  workspaceCwd?: string
}): Task | null {
  const store = load(args.workspaceCwd)
  const task = store.tasks.find((t) => t.id === args.id)
  if (!task) return null
  if (args.title != null) task.title = String(args.title).trim() || task.title
  if (args.status != null) task.status = normalizeTaskStatus(args.status)
  if (args.notes !== undefined) task.notes = args.notes === null ? undefined : String(args.notes).trim() || undefined
  if (args.due !== undefined) task.due = args.due === null ? undefined : String(args.due).trim() || undefined
  if (args.reminder_schedule_id !== undefined) {
    task.reminder_schedule_id =
      args.reminder_schedule_id === null ? undefined : String(args.reminder_schedule_id).trim() || undefined
  }
  if (args.blocked_by != null) {
    const newBlockers = args.blocked_by.map((s) => String(s)).filter(Boolean)
    // Remove this task from `blocks` of old blockers no longer listed.
    for (const oldBid of task.blocked_by) {
      if (!newBlockers.includes(oldBid)) {
        const b = store.tasks.find((t) => t.id === oldBid)
        if (b) b.blocks = b.blocks.filter((x) => x !== task.id)
      }
    }
    // Add this task to `blocks` of new blockers.
    for (const newBid of newBlockers) {
      if (!task.blocked_by.includes(newBid)) {
        const b = store.tasks.find((t) => t.id === newBid)
        if (b && !b.blocks.includes(task.id)) b.blocks.push(task.id)
      }
    }
    task.blocked_by = newBlockers
  }
    task.updated_at = Date.now()
  save(store, args.workspaceCwd)
  emit(store, task.list_id, args.workspaceCwd)
  return task
}

/** Reorder a task within its own list. `after_task_id` wins over
 *  `before_task_id`; if neither is set (or the id isn't found in the same
 *  list) the task is moved to the end of the list. Cannot move a task into a
 *  different list — use addTask + deleteTask for that. */
export function moveTask(args: {
  id: string
  after_task_id?: string
  before_task_id?: string
  /** Explicit workspace cwd (host main path, Phase 3). */
  workspaceCwd?: string
}): Task | null {
  const store = load(args.workspaceCwd)
  const task = store.tasks.find((t) => t.id === args.id)
  if (!task) return null
  // Remove from current position (indices shift, so recompute on the shorter array).
  const cur = store.tasks.indexOf(task)
  store.tasks.splice(cur, 1)
  let insertIndex = store.tasks.length // end of list
  if (args.after_task_id) {
    const i = store.tasks.findIndex(
      (t) => t.id === args.after_task_id && t.list_id === task.list_id,
    )
    if (i >= 0) insertIndex = i + 1
  } else if (args.before_task_id) {
    const i = store.tasks.findIndex(
      (t) => t.id === args.before_task_id && t.list_id === task.list_id,
    )
    if (i >= 0) insertIndex = i
  }
  store.tasks.splice(insertIndex, 0, task)
  task.updated_at = Date.now()
  save(store, args.workspaceCwd)
  emit(store, task.list_id, args.workspaceCwd)
  return task
}

export function deleteTask(id: string, workspaceCwd?: string): boolean {
  const store = load(workspaceCwd)
  const task = store.tasks.find((t) => t.id === id)
  if (!task) return false
  const listId = task.list_id
  // Remove this task from any `blocks`/`blocked_by` edges.
  store.tasks = store.tasks.filter((t) => t.id !== id)
  for (const t of store.tasks) {
    t.blocked_by = t.blocked_by.filter((x) => x !== id)
    t.blocks = t.blocks.filter((x) => x !== id)
  }
  save(store, workspaceCwd)
  emit(store, listId, workspaceCwd)
  return true
}

// ── Operator-initiated edits (Phase 4) ───────────────────────────────────
/** Apply an operator edit (status toggle / notes) to a task in an EXPLICIT
 *  workspace. Unlike the agent-facing mutations above (which resolve the path
 *  from `process.env.SYLO_PI_CWD`), this takes the workspace cwd directly so
 *  ANY broker can apply it to the right file — the host main process forwards
 *  a `sylo-tasks:apply-edit` IPC message from the renderer (operator click) to
 *  the broker, carrying the board's bound `workspaceKey` as the explicit cwd.
 *  The emitted `sylo-tasks:changed` carries that same `workspaceKey`, so the
 *  existing fan-out matches the active board without broker-affinity tracking.
 *  Limited to `status` + `notes` (no `blocked_by`/`title`) — operator canvas
 *  edits don't touch dependency edges, so no reverse-edge sync is needed. */
export function applyOperatorEdit(
  workspaceCwd: string,
  args: { list_id: string; task_id: string; status?: string; notes?: string | null },
): Task | null {
  const cwd = workspaceCwd.trim()
  if (!cwd) return null
  const store = load(cwd)
  const task = store.tasks.find((t) => t.id === args.task_id && t.list_id === args.list_id)
  if (!task) return null
  if (args.status != null) task.status = normalizeTaskStatus(args.status)
  if (args.notes !== undefined) {
    task.notes = args.notes === null ? undefined : String(args.notes).trim() || undefined
  }
  task.updated_at = Date.now()
  save(store, cwd)
  emit(store, task.list_id, cwd)
  return task
}

// ── Reads ──────────────────────────────────────────────────────────────────

export function listLists(workspaceCwd?: string): TaskList[] {
  return load(workspaceCwd).lists
}

export function getListSnapshot(id: string, workspaceCwd?: string): TaskListSnapshot | null {
  return snapshotOf(load(workspaceCwd), id)
}

export function getTask(id: string, workspaceCwd?: string): Task | null {
  return load(workspaceCwd).tasks.find((t) => t.id === id) ?? null
}

/** Every list + every task in a workspace — the Phase 3 sidebar dashboard
 *  overview. `workspaceCwd` is required (host main path); the broker path has
 *  no use for a whole-workspace dump. */
export function getWorkspaceSnapshot(workspaceCwd: string): TasksWorkspaceSnapshot | null {
  const cwd = workspaceCwd.trim()
  if (!cwd) return null
  const store = load(cwd)
  return { lists: store.lists, tasks: store.tasks }
}