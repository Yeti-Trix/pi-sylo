import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ThinkTankTaskStatus = 'open' | 'submitted' | 'complete'

export type ThinkTankTask = {
  id: string
  session_id: string
  assignee_seat_id: string
  assignee_label: string
  title: string
  description: string
  status: ThinkTankTaskStatus
  assigner_seat_id: string
  assigned_cycle: number
  result_body?: string
  submitted_at?: number
  completed_at?: number
  created_at: number
}

export type ThinkTankTaskStoreFile = {
  session_id: string
  moderator_seat_id: string
  tasks: ThinkTankTask[]
}

function readStore(path: string): ThinkTankTaskStoreFile {
  if (!existsSync(path)) {
    throw new Error(`Think tank task store missing: ${path}`)
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as ThinkTankTaskStoreFile
  if (!raw || !Array.isArray(raw.tasks)) {
    throw new Error('Invalid think tank task store')
  }
  return raw
}

function writeStore(path: string, store: ThinkTankTaskStoreFile): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8')
}

export function initTaskStoreFile(args: {
  path: string
  sessionId: string
  moderatorSeatId: string
}): void {
  mkdirSync(dirname(args.path), { recursive: true })
  const store: ThinkTankTaskStoreFile = {
    session_id: args.sessionId,
    moderator_seat_id: args.moderatorSeatId,
    tasks: [],
  }
  writeStore(args.path, store)
}

export function listTasks(path: string): ThinkTankTask[] {
  return readStore(path).tasks
}

/** Accept full UUID or a unique prefix (models often copy the 8-char shorthand from the task list). */
export function resolveTaskId(tasks: ThinkTankTask[], taskId: string): string {
  const raw = taskId.trim()
  if (!raw) throw new Error('Task id is required')
  const exact = tasks.find((t) => t.id === raw)
  if (exact) return exact.id
  const lower = raw.toLowerCase()
  const prefixMatches = tasks.filter((t) => t.id.toLowerCase().startsWith(lower))
  if (prefixMatches.length === 1) return prefixMatches[0]!.id
  if (prefixMatches.length > 1) {
    throw new Error(`Ambiguous task id prefix "${raw}" — use the full task_id from sylo_think_tank_task_list`)
  }
  throw new Error(`Unknown task id: ${raw}`)
}

export function assignTask(args: {
  path: string
  callerSeatId: string
  assigneeSeatId: string
  assigneeLabel: string
  title: string
  description: string
  cycle: number
}): ThinkTankTask {
  const store = readStore(args.path)
  if (args.callerSeatId !== store.moderator_seat_id) {
    throw new Error('Only the Moderator may assign tasks')
  }
  const task: ThinkTankTask = {
    id: randomUUID(),
    session_id: store.session_id,
    assignee_seat_id: args.assigneeSeatId,
    assignee_label: args.assigneeLabel,
    title: args.title.trim(),
    description: args.description.trim(),
    status: 'open',
    assigner_seat_id: args.callerSeatId,
    assigned_cycle: args.cycle,
    created_at: Date.now(),
  }
  store.tasks.push(task)
  writeStore(args.path, store)
  return task
}

export function submitTask(args: {
  path: string
  callerSeatId: string
  taskId: string
  result: string
}): ThinkTankTask {
  const store = readStore(args.path)
  const resolvedId = resolveTaskId(store.tasks, args.taskId)
  const task = store.tasks.find((t) => t.id === resolvedId)!
  if (task.assignee_seat_id !== args.callerSeatId) {
    throw new Error('Only the assigned debater may submit results for this task')
  }
  if (task.status === 'complete') {
    throw new Error('Task is already complete')
  }
  task.status = 'submitted'
  task.result_body = args.result.trim()
  task.submitted_at = Date.now()
  writeStore(args.path, store)
  return task
}

export function completeTask(args: {
  path: string
  callerSeatId: string
  taskId: string
}): ThinkTankTask {
  const store = readStore(args.path)
  if (args.callerSeatId !== store.moderator_seat_id) {
    throw new Error('Only the Moderator may mark tasks complete')
  }
  const resolvedId = resolveTaskId(store.tasks, args.taskId)
  const task = store.tasks.find((t) => t.id === resolvedId)!
  if (task.status === 'open') {
    throw new Error('Task has no submitted result yet — debater must submit first')
  }
  task.status = 'complete'
  task.completed_at = Date.now()
  writeStore(args.path, store)
  return task
}

export function formatTasksForPrompt(tasks: ThinkTankTask[]): string {
  if (tasks.length === 0) {
    return '(no moderator assignments yet — Moderator may assign proof tasks with **sylo_think_tank_task_assign**)'
  }
  return tasks
    .map((t) => {
      const status =
        t.status === 'complete' ? '✓ complete'
        : t.status === 'submitted' ? '◐ submitted (awaiting Moderator review)'
        : '○ open'
      const result =
        t.result_body ?
          `\n  **Result (${t.assignee_label}):** ${t.result_body.slice(0, 1200)}${t.result_body.length > 1200 ? '…' : ''}`
        : ''
      return (
        `- **${t.title}** → **${t.assignee_label}** (${status}, cycle ${t.assigned_cycle})\n` +
        `  task_id: \`${t.id}\`\n` +
        `  ${t.description}${result}`
      )
    })
    .join('\n\n')
}
