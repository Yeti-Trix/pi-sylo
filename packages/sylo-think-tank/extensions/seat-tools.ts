import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
  assignTask,
  completeTask,
  formatTasksForPrompt,
  listTasks,
  submitTask,
} from './task-store.ts'

function seatContext(): {
  tasksFile: string
  seatId: string
  seatRole: 'moderator' | 'debater'
  cycle: number
} {
  const tasksFile = process.env.SYLO_THINK_TANK_TASKS_FILE?.trim()
  const seatId = process.env.SYLO_THINK_TANK_SEAT_ID?.trim()
  const seatRole = process.env.SYLO_THINK_TANK_SEAT_ROLE === 'moderator' ? 'moderator' : 'debater'
  const cycle = Number(process.env.SYLO_THINK_TANK_CYCLE ?? '1')
  if (!tasksFile || !seatId) {
    throw new Error('Think tank seat tools require SYLO_THINK_TANK_TASKS_FILE and SYLO_THINK_TANK_SEAT_ID')
  }
  return { tasksFile, seatId, seatRole, cycle: Number.isFinite(cycle) ? cycle : 1 }
}

function toolText(text: string): { content: Array<{ type: 'text'; text: string }>; details: undefined } {
  return { content: [{ type: 'text', text }], details: undefined }
}

function toolErr(text: string): { content: Array<{ type: 'text'; text: string }>; details: undefined } {
  return { content: [{ type: 'text', text }], details: undefined }
}

/** Assignment tools for think tank seat subprocesses (SYLO_THINK_TANK_SEAT_RUN=1). */
export default function syloThinkTankSeatTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'sylo_think_tank_task_list',
    label: 'Think tank task list',
    description:
      'List Moderator assignments for this think tank session (open, submitted, complete). ' +
      'Debaters: complete your open tasks with sylo_think_tank_task_submit before debating further.',
    parameters: Type.Object({}),
    async execute() {
      try {
        const { tasksFile } = seatContext()
        const tasks = listTasks(tasksFile)
        return toolText(`## Think tank assignments\n\n${formatTasksForPrompt(tasks)}`)
      } catch (e) {
        return toolErr(e instanceof Error ? e.message : String(e))
      }
    },
  })

  pi.registerTool({
    name: 'sylo_think_tank_task_assign',
    label: 'Think tank assign task',
    description:
      'Moderator only: assign a concrete action item to a debater (script, simulation, web search, calculation). ' +
      'Debaters must submit results with sylo_think_tank_task_submit; only Moderator marks complete.',
    parameters: Type.Object({
      assignee_seat_id: Type.String({ description: 'Seat id (e.g. seat-a) or debater label' }),
      assignee_label: Type.String({ description: 'Debater label as shown in debate (e.g. Debater 1)' }),
      title: Type.String({ description: 'Short task title' }),
      description: Type.String({ description: 'What to do and what result to return' }),
    }),
    async execute(_id, params) {
      try {
        const ctx = seatContext()
        if (ctx.seatRole !== 'moderator') {
          return toolErr('Only the Moderator may assign tasks')
        }
        const task = assignTask({
          path: ctx.tasksFile,
          callerSeatId: ctx.seatId,
          assigneeSeatId: params.assignee_seat_id,
          assigneeLabel: params.assignee_label,
          title: params.title,
          description: params.description,
          cycle: ctx.cycle,
        })
        return toolText(
          `Assigned **${task.title}** to **${task.assignee_label}** (id \`${task.id}\`). ` +
            `They must submit via sylo_think_tank_task_submit; you mark complete after review.`,
        )
      } catch (e) {
        return toolErr(e instanceof Error ? e.message : String(e))
      }
    },
  })

  pi.registerTool({
    name: 'sylo_think_tank_task_submit',
    label: 'Think tank submit task result',
    description:
      'Debater only: submit your result for an assignment from the Moderator (script output, simulation summary, findings).',
    parameters: Type.Object({
      task_id: Type.String({
        description: 'Full task_id UUID from sylo_think_tank_task_list (8-char prefix also accepted if unique)',
      }),
      result: Type.String({ description: 'Result body — output, summary, or evidence' }),
    }),
    async execute(_id, params) {
      try {
        const ctx = seatContext()
        if (ctx.seatRole === 'moderator') {
          return toolErr('Moderator cannot submit task results — use sylo_think_tank_task_complete after review')
        }
        const task = submitTask({
          path: ctx.tasksFile,
          callerSeatId: ctx.seatId,
          taskId: params.task_id,
          result: params.result,
        })
        return toolText(
          `Submitted result for **${task.title}**. Status: submitted — awaiting Moderator review (\`sylo_think_tank_task_complete\`).`,
        )
      } catch (e) {
        return toolErr(e instanceof Error ? e.message : String(e))
      }
    },
  })

  pi.registerTool({
    name: 'sylo_think_tank_task_complete',
    label: 'Think tank complete task',
    description: 'Moderator only: mark a submitted assignment complete after reviewing the debater result.',
    parameters: Type.Object({
      task_id: Type.String({
        description: 'Full task_id UUID from sylo_think_tank_task_list (8-char prefix also accepted if unique)',
      }),
    }),
    async execute(_id, params) {
      try {
        const ctx = seatContext()
        if (ctx.seatRole !== 'moderator') {
          return toolErr('Only the Moderator may mark tasks complete')
        }
        const task = completeTask({
          path: ctx.tasksFile,
          callerSeatId: ctx.seatId,
          taskId: params.task_id,
        })
        return toolText(`Marked **${task.title}** complete for **${task.assignee_label}**.`)
      } catch (e) {
        return toolErr(e instanceof Error ? e.message : String(e))
      }
    },
  })
}
