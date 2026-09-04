/**
 * sylo-tasks — shared types (importable by the broker extension and, later, by
 * the host main process for renderer-edit IPC). Pure types — no node:fs here.
 *
 * Storage owns truth, not the LLM. The agent reads the list back via
 * `sylo_task_list`/`sylo_task_get`; operator edits (Phase 3/4) write to the same
 * JSON file. The live Canvas board (Phase 2) subscribes to a `liveId` bound to
 * a (workspace, listId) and re-renders on `canvas:live-update`.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'skipped'

/**
 * `agent_driven` — the agent owns the structure (adds/reorders/stages tasks);
 * the operator checks items off and adds notes. Default for learning
 * roadmaps and agent-built checklists.
 *
 * `operator_driven` — the operator owns the structure; the agent reads and
 * advises but does not rewrite the list. Use when the operator is actively
 * building the plan themselves.
 */
export type TaskListMode = 'agent_driven' | 'operator_driven'

export type Task = {
  id: string
  list_id: string
  title: string
  status: TaskStatus
  /** Markdown notes the operator or agent can attach to a task. Agent-readable
   *  via `sylo_task_get`/`sylo_task_list`; editable from the Canvas board (P2). */
  notes?: string
  /** ISO date (YYYY-MM-DD) or null. Overdue state is derived by the renderer. */
  due?: string
  /** Id of the `sylo-scheduler` scheduled prompt that reminds the agent about
   *  this task's `due` (Phase 6). The agent creates it via `schedule_create`
   *  when it sets a due date and stores the returned id here; on clear-due /
   *  complete / delete it calls `schedule_delete` for this id and clears the
   *  field. Reminders are NOT reimplemented in the store — this is just the
   *  link so cleanup can find the schedule. */
  reminder_schedule_id?: string
  /** Task ids that must be done before this one. */
  blocked_by: string[]
  /** Task ids that this one blocks (reverse edges, kept in sync on update). */
  blocks: string[]
  created_at: number
  updated_at: number
}

export type TaskList = {
  id: string
  title: string
  mode: TaskListMode
  description?: string
  created_at: number
  updated_at: number
}

/** On-disk shape: `${SYLO_PI_CWD}/.sylo/tasks.json`. */
export type TasksStore = {
  version: 1
  lists: TaskList[]
  /** Flat array keyed by `list_id` — simpler to update than nesting. */
  tasks: Task[]
}

/** A list + its tasks, returned by `sylo_task_get` and fanned to live
 *  subscribers as the `canvas:live-update` data payload. */
export type TaskListSnapshot = {
  list: TaskList
  tasks: Task[]
}

/** Every list + every task in a workspace, returned to the Phase 3 sidebar
 *  dashboard so the operator can browse all lists across time. Mirrors the
 *  on-disk `TasksStore` minus the `version` tag. */
export type TasksWorkspaceSnapshot = {
  lists: TaskList[]
  tasks: Task[]
}

export const TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'done',
  'blocked',
  'skipped',
] as const

export function normalizeTaskStatus(raw: unknown): TaskStatus {
  const s = String(raw ?? 'todo').trim().toLowerCase()
  if (s === 'in_progress' || s === 'in-progress' || s === 'inprogress') return 'in_progress'
  if (TASK_STATUSES.includes(s as TaskStatus)) return s as TaskStatus
  return 'todo'
}

export function normalizeTaskListMode(raw: unknown): TaskListMode {
  const s = String(raw ?? 'agent_driven').trim().toLowerCase()
  if (s === 'operator_driven' || s === 'operator-driven') return 'operator_driven'
  return 'agent_driven'
}