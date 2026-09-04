/**
 * Sylo scheduled prompts — agent tools for workspace-scoped prompt schedules.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import { scheduleRpc } from './sylo-host.ts'

const RecurrenceEnum = StringEnum(['once', 'daily', 'weekly', 'monthly'], {
  description: 'How often the prompt runs (local timezone).',
})

function formatSchedule(row: Record<string, unknown>): string {
  const lines = [
    `- **${String(row.title || row.id)}** (\`${row.id}\`)`,
    `  recurrence: ${row.recurrence}; next: ${new Date(Number(row.next_run_at)).toLocaleString()}`,
    `  runs: ${row.run_count}${row.max_runs != null ? ` / ${row.max_runs}` : ' (indefinite)'}`,
    `  enabled: ${row.enabled}; catchup: ${row.catchup_on_startup}`,
  ]
  return lines.join('\n')
}

export default function syloSchedulerExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'schedule_list',
    label: 'List scheduled prompts',
    description:
      'List prompt schedules for the **active workspace** (from the current chat). Returns id, title, recurrence, next run, run counts, and enabled state.',
    parameters: Type.Object({}),
    async execute() {
      const result = (await scheduleRpc({ op: 'list' })) as { schedules?: Record<string, unknown>[] }
      const schedules = result.schedules ?? []
      if (schedules.length === 0) {
        return { content: [{ type: 'text', text: 'No scheduled prompts in this workspace.' }] }
      }
      const body = schedules.map(formatSchedule).join('\n')
      return {
        content: [{ type: 'text', text: `${schedules.length} schedule(s):\n\n${body}` }],
        details: { schedules },
      }
    },
  })

  pi.registerTool({
    name: 'schedule_create',
    label: 'Create scheduled prompt',
    description:
      'Create a workspace-scoped scheduled prompt. When it fires, Sylo opens a **new chat** and sends `prompt_text`. Times use the operator local timezone.',
    parameters: Type.Object({
      prompt_text: Type.String({ description: 'User message to send when the schedule fires.' }),
      title: Type.Optional(Type.String({ description: 'Short label for the Schedules panel.' })),
      recurrence: RecurrenceEnum,
      start_at: Type.Number({
        description: 'First run as Unix ms. For once: exact datetime. For recurring: earliest calendar day.',
      }),
      time_local: Type.Optional(
        Type.String({ description: 'HH:MM 24h local time for daily/weekly/monthly (default from start_at).' }),
      ),
      day_of_week: Type.Optional(
        Type.Number({ description: '0=Sun … 6=Sat for weekly schedules.', minimum: 0, maximum: 6 }),
      ),
      day_of_month: Type.Optional(
        Type.Number({ description: '1–31 for monthly schedules.', minimum: 1, maximum: 31 }),
      ),
      max_runs: Type.Optional(
        Type.Union([Type.Number({ minimum: 1 }), Type.Null()], {
          description: 'Stop after N fires; omit or null for indefinite.',
        }),
      ),
      catchup_on_startup: Type.Optional(
        Type.Boolean({
          description:
            'If true and Sylo was closed when a run was due, fire once on next startup (most recent missed interval only). Default true.',
        }),
      ),
    }),
    async execute(_id, params) {
      const result = (await scheduleRpc({
        op: 'create',
        title: params.title,
        prompt_text: params.prompt_text,
        recurrence: params.recurrence,
        start_at: params.start_at,
        time_local: params.time_local,
        day_of_week: params.day_of_week,
        day_of_month: params.day_of_month,
        max_runs: params.max_runs,
        catchup_on_startup: params.catchup_on_startup,
      })) as { schedule?: Record<string, unknown> }
      const schedule = result.schedule
      return {
        content: [
          {
            type: 'text',
            text:
              schedule ?
                `Created schedule \`${schedule.id}\`. Next run: ${new Date(Number(schedule.next_run_at)).toLocaleString()}.`
              : 'Schedule created.',
          },
        ],
        details: result,
      }
    },
  })

  pi.registerTool({
    name: 'schedule_update',
    label: 'Update scheduled prompt',
    description: 'Update a schedule in the active workspace. Pass only fields to change in `patch`.',
    parameters: Type.Object({
      id: Type.String({ description: 'Schedule id from schedule_list.' }),
      patch: Type.Object(
        {
          title: Type.Optional(Type.String()),
          prompt_text: Type.Optional(Type.String()),
          recurrence: Type.Optional(RecurrenceEnum),
          start_at: Type.Optional(Type.Number()),
          time_local: Type.Optional(Type.String()),
          day_of_week: Type.Optional(Type.Number({ minimum: 0, maximum: 6 })),
          day_of_month: Type.Optional(Type.Number({ minimum: 1, maximum: 31 })),
          max_runs: Type.Optional(Type.Union([Type.Number({ minimum: 1 }), Type.Null()])),
          catchup_on_startup: Type.Optional(Type.Boolean()),
          enabled: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    }),
    async execute(_id, params) {
      const result = (await scheduleRpc({
        op: 'update',
        id: params.id,
        patch: params.patch as Record<string, unknown>,
      })) as { schedule?: Record<string, unknown> }
      const schedule = result.schedule
      return {
        content: [
          {
            type: 'text',
            text:
              schedule ?
                `Updated \`${schedule.id}\`. Next run: ${new Date(Number(schedule.next_run_at)).toLocaleString()}.`
              : 'Schedule updated.',
          },
        ],
        details: result,
      }
    },
  })

  pi.registerTool({
    name: 'schedule_delete',
    label: 'Delete scheduled prompt',
    description: 'Delete a schedule from the active workspace.',
    parameters: Type.Object({
      id: Type.String({ description: 'Schedule id from schedule_list.' }),
    }),
    async execute(_id, params) {
      await scheduleRpc({ op: 'delete', id: params.id })
      return { content: [{ type: 'text', text: `Deleted schedule \`${params.id}\`.` }] }
    },
  })
}
