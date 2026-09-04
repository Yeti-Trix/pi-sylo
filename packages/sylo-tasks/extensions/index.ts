/**
 * sylo-tasks — agent tools for building/reading/updating per-workspace task
 * lists. Storage owns truth; the agent reads the list back via these tools.
 *
 * Tools:
 *   sylo_task_create_list  — create a list (agent_driven | operator_driven)
 *   sylo_task_add          — add a task to a list (with blocked_by/due/notes)
  *   sylo_task_update       — update title/status/notes/due/blocked_by
 *   sylo_task_move         — reorder a task within its list (after/before a task)
 *   sylo_task_list         — list all lists OR all tasks in a list
 *   sylo_task_get          — get one list (with tasks) or one task
 *   sylo_task_delete       — delete a task or a whole list
 *
 * Reminders are NOT reimplemented here: a due date is stored on the task; the
 * agent creates a `schedule_create` (sylo-scheduler) entry referencing the task
 * when an actual reminder is wanted (fires into a new chat — out-of-band).
 *
 * @see features_tracker/active/2026-07-25_12-11-42_live_canvas_sylo_tasks.md
 */
import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
  addTask,
  applyOperatorEdit,
  createList,
  deleteList,
  deleteTask,
  getListSnapshot,
  getTask,
  listLists,
    moveTask,
  openOnCanvas,
  resolveTasksPath,
  updateTask,
} from '../shared/tasks-store.js'
import { TASK_STATUSES } from '../shared/types.js'

type TaskToolResult = AgentToolResult<undefined>

function toolError(text: string): TaskToolResult {
  return { content: [{ type: 'text', text }], details: undefined }
}

function ok(summary: string, data: unknown): TaskToolResult {
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(data, null, 2) },
    ],
    details: undefined,
  }
}

/** Guard: every mutation reads `SYLO_PI_CWD`; if it's unset (not under the
 *  Sylo broker), fail fast with an actionable message. */
function requireStorePath(): true | TaskToolResult {
  const fp = resolveTasksPath()
  if (!fp) {
    return toolError(
      'sylo-tasks store path is not set (SYLO_PI_CWD missing). Enable the sylo-tasks package in Capability manager and restart the broker.',
    )
  }
  return true
}

/** Run a mutation; surface thrown errors as tool text (not exceptions). */
function withStore(fn: () => TaskToolResult): TaskToolResult {
  const guard = requireStorePath()
  if (guard !== true) return guard
  try {
    return fn()
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err))
  }
}

const statusSchema = Type.String({
  description: `One of: ${TASK_STATUSES.join(', ')}. Unrecognized values coerce to "todo".`,
})

export default function syloTasksExtension(pi: ExtensionAPI): void {
  // Phase 4: receive operator-initiated edits from the host main process.
  // Main forwards a `sylo-tasks:apply-edit` IPC (renderer click → main →
  // broker child) carrying the board's bound `workspaceCwd` so any broker can
  // write to the right file. The broker entry.ts `handleMessage` deliberately
  // does NOT consume this type (it returns early, like `_rpc_result`), so the
  // message reaches this listener via Node's multi-listener `process` event.
  // The store writes + emits `sylo-tasks:changed`; main fans it to the board.
  process.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return
    const m = msg as {
      type?: string
      workspaceCwd?: string
      list_id?: string
      task_id?: string
      status?: string
      notes?: string | null
    }
    if (m.type !== 'sylo-tasks:apply-edit') return
    const workspaceCwd = typeof m.workspaceCwd === 'string' ? m.workspaceCwd : ''
    if (!workspaceCwd || !m.list_id || !m.task_id) return
    try {
      applyOperatorEdit(workspaceCwd, {
        list_id: m.list_id,
        task_id: m.task_id,
        status: m.status,
        notes: m.notes,
      })
    } catch {
      // Swallow — fire-and-forget. The board reconciles via the next
      // `sylo-tasks:changed` fan; a failed edit simply doesn't update.
    }
  })

  pi.registerTool({
    name: 'sylo_task_create_list',
    label: 'Task list create',
    description:
      'Create a new task list in the current workspace. Use mode "agent_driven" (default) when you own the structure, or "operator_driven" when the operator is building the plan themselves. Returns the new list.',
    parameters: Type.Object({
      title: Type.String({ description: 'List title' }),
      mode: Type.Optional(
        Type.String({ description: 'agent_driven (default) or operator_driven' }),
      ),
      description: Type.Optional(Type.String({ description: 'Short description / intent' })),
    }),
    async execute(_id, params) {
      return withStore(() => {
        const list = createList({
          title: String(params.title ?? ''),
          mode: params.mode,
          description: params.description,
        })
        return ok(`Created task list "${list.title}".`, { list })
      })
    },
  })

  pi.registerTool({
    name: 'sylo_task_add',
    label: 'Task add',
        description:
      'Add a task to a list. Use blocked_by (task ids) for dependencies; the reverse `blocks` edges are kept in sync. due is an ISO date (YYYY-MM-DD). notes is markdown. POSITION: by default the task is appended to the end of the list. To insert mid-sequence, pass after_task_id (insert immediately after that task, same list) or before_task_id (insert before it); after_task_id wins. If the id is not in the same list, the task falls back to the end. The Canvas board and dashboard render tasks in this order, so use after_task_id/before_task_id to place a step where it belongs.',
    parameters: Type.Object({
      list_id: Type.String({ description: 'List id from sylo_task_create_list' }),
      title: Type.String(),
      status: Type.Optional(statusSchema),
      notes: Type.Optional(Type.String({ description: 'Markdown notes' })),
      due: Type.Optional(Type.String({ description: 'ISO date YYYY-MM-DD' })),
      blocked_by: Type.Optional(
        Type.Array(Type.String(), { description: 'Task ids that must be done first' }),
      ),
      reminder_schedule_id: Type.Optional(
        Type.String({
          description:
            'Optional id of a sylo-scheduler reminder to store on the task (set after you call schedule_create).',
        }),
      ),
      after_task_id: Type.Optional(
        Type.String({ description: 'Insert immediately after this task id (same list).' }),
      ),
      before_task_id: Type.Optional(
        Type.String({ description: 'Insert immediately before this task id (same list). Used only if after_task_id is unset/not found.' }),
      ),
    }),
    async execute(_id, params) {
      return withStore(() => {
                const task = addTask({
          list_id: String(params.list_id ?? ''),
          title: String(params.title ?? ''),
          status: params.status,
          notes: params.notes,
          due: params.due,
          blocked_by: params.blocked_by,
          reminder_schedule_id: params.reminder_schedule_id,
          after_task_id: params.after_task_id,
          before_task_id: params.before_task_id,
        })
        return ok(`Added task "${task.title}" to list ${task.list_id}.`, { task })
      })
    },
  })

  pi.registerTool({
    name: 'sylo_task_update',
    label: 'Task update',
    description:
      'Update a task. Pass only the fields to change. Set notes/due/reminder_schedule_id to null to clear. status coerces to the canonical set. Changing blocked_by re-syncs reverse `blocks` edges. REMINDERS: when you set `due`, also call schedule_create (recurrence "once", start_at = due date at 09:00 local) with a prompt_text referencing this task + its list, then pass the returned schedule id as reminder_schedule_id. When you clear `due`, set status to `done`, or delete the task, first call schedule_delete(reminder_schedule_id) (if set) then clear the field here.',
    parameters: Type.Object({
      id: Type.String({ description: 'Task id' }),
      title: Type.Optional(Type.String()),
      status: Type.Optional(statusSchema),
      notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      due: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      blocked_by: Type.Optional(Type.Array(Type.String())),
      reminder_schedule_id: Type.Optional(
        Type.Union([
          Type.String(),
          Type.Null(),
        ], { description: 'sylo-scheduler reminder id for this task due; null to clear' }),
      ),
    }),
    async execute(_id, params) {
      const id = String(params.id ?? '').trim()
      if (!id) return toolError('sylo_task_update requires id.')
      return withStore(() => {
        const task = updateTask({
          id,
          title: params.title,
          status: params.status,
          notes: params.notes,
          due: params.due,
          blocked_by: params.blocked_by,
          reminder_schedule_id: params.reminder_schedule_id,
        })
                if (!task) return toolError(`No task with id ${id}.`)
        return ok('Task updated.', { task })
      })
    },
  })

  pi.registerTool({
    name: 'sylo_task_move',
    label: 'Task move',
    description:
      'Reorder a task WITHIN its own list. Pass after_task_id (move immediately after that task) OR before_task_id (move immediately before it); after_task_id wins. If neither is set, or the id is not in the same list, the task moves to the END of the list. The Canvas board and dashboard render in this order, so use this to fix sequencing without deleting and re-adding. Cannot move a task into a different list — use sylo_task_add (with after_task_id) + sylo_task_delete for that.',
    parameters: Type.Object({
      id: Type.String({ description: 'Task id to move' }),
      after_task_id: Type.Optional(
        Type.String({ description: 'Move to immediately after this task id (same list).' }),
      ),
      before_task_id: Type.Optional(
        Type.String({ description: 'Move to immediately before this task id (same list). Used only if after_task_id is unset/not found.' }),
      ),
    }),
    async execute(_id, params) {
      const id = String(params.id ?? '').trim()
      if (!id) return toolError('sylo_task_move requires id.')
      return withStore(() => {
        const task = moveTask({
          id,
          after_task_id: params.after_task_id,
          before_task_id: params.before_task_id,
        })
        if (!task) return toolError(`No task with id ${id}.`)
        return ok(`Moved task "${task.title}".`, { task })
      })
    },
  })

  pi.registerTool({
    name: 'sylo_task_list',
    label: 'Task list',
    description:
      'With no args: list all task lists (id, title, mode, counts). With list_id: list all tasks in that list. Use this to re-read the store on your turn — operator edits land here (eventual consistency).',
    parameters: Type.Object({
      list_id: Type.Optional(Type.String({ description: 'Omit to list all lists; set to list tasks in one list' })),
    }),
    async execute(_id, params) {
      return withStore(() => {
        if (params.list_id) {
          const snap = getListSnapshot(String(params.list_id))
          if (!snap) return toolError(`No task list with id ${params.list_id}.`)
          return ok(
            `List "${snap.list.title}" — ${snap.tasks.length} task(s).`,
            snap,
          )
        }
        const lists = listLists()
        return ok(`Found ${lists.length} task list(s).`, { lists })
      })
    },
  })

  pi.registerTool({
    name: 'sylo_task_get',
    label: 'Task get',
    description:
      'Get one list (with all its tasks) by list_id, or one task by id (use task_id). Pass exactly one.',
    parameters: Type.Object({
      list_id: Type.Optional(Type.String()),
      task_id: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      return withStore(() => {
        if (params.task_id) {
          const task = getTask(String(params.task_id))
          if (!task) return toolError(`No task with id ${params.task_id}.`)
          return ok('Task loaded.', { task })
        }
        if (params.list_id) {
          const snap = getListSnapshot(String(params.list_id))
          if (!snap) return toolError(`No task list with id ${params.list_id}.`)
          return ok(`List "${snap.list.title}" loaded.`, snap)
        }
        return toolError('sylo_task_get requires list_id or task_id.')
      })
    },
  })

  pi.registerTool({
    name: 'sylo_task_delete',
    label: 'Task delete',
    description:
      'Delete a task (task_id) or a whole list (list_id). Pass exactly one. Deleting a list also deletes its tasks; deleting a task cleans up dependency edges. REMINDERS: before deleting a task with a reminder_schedule_id, call schedule_delete(id) so its reminder does not keep firing.',
    parameters: Type.Object({
      list_id: Type.Optional(Type.String()),
      task_id: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      return withStore(() => {
        if (params.task_id) {
          const deleted = deleteTask(String(params.task_id))
          if (!deleted) return toolError(`No task with id ${params.task_id}.`)
          return ok('Task deleted.', { id: params.task_id })
        }
        if (params.list_id) {
          const deleted = deleteList(String(params.list_id))
          if (!deleted) return toolError(`No task list with id ${params.list_id}.`)
          return ok('Task list deleted.', { id: params.list_id })
        }
        return toolError('sylo_task_delete requires list_id or task_id.')
      })
    },
  })

  pi.registerTool({
    name: 'sylo_task_open_on_canvas',
    label: 'Task list open on canvas',
    description:
      'Surface a task list on the live Canvas (docked + any popped-out canvas window) so the operator can see it. The board is view-only in this phase; it live-updates as you mutate the list via the other sylo_task_* tools. Use after building/updating a list when the operator wants to watch it. Returns the list snapshot.',
    parameters: Type.Object({
      list_id: Type.String({ description: 'List id to surface on the canvas' }),
    }),
    async execute(_id, params) {
      return withStore(() => {
        const listId = String(params.list_id ?? '').trim()
        if (!listId) return toolError('sylo_task_open_on_canvas requires list_id.')
        const r = openOnCanvas(listId)
        if (!r) return toolError(`No task list with id ${listId} (or SYLO_PI_CWD unset).`)
        return ok(`Surfaced list "${r.snapshot.list.title}" on the canvas.`, r.snapshot)
      })
    },
  })
}