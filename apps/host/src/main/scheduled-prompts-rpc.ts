import type { ScheduledPromptInput, ScheduledPromptPatch } from '../shared/scheduled-prompts-types.js'
import { getConversation } from './database.js'
import {
  createScheduledPrompt,
  deleteScheduledPrompt,
  getScheduledPrompt,
  listScheduledPrompts,
  normalizeRecurrenceValue,
  updateScheduledPrompt,
} from './scheduled-prompts-db.js'

export type ScheduleRpcRequest =
  | { op: 'list'; conversationId: string }
  | {
      op: 'create'
      conversationId: string
      title?: string
      prompt_text: string
      recurrence: string
      start_at: number
      time_local?: string
      day_of_week?: number
      day_of_month?: number
      max_runs?: number | null
      catchup_on_startup?: boolean
    }
  | {
      op: 'update'
      conversationId: string
      id: string
      patch: Record<string, unknown>
    }
  | { op: 'delete'; conversationId: string; id: string }

export type ScheduleRpcResult =
  | { op: 'list'; schedules: ReturnType<typeof serializeSchedule>[] }
  | { op: 'create'; schedule: ReturnType<typeof serializeSchedule> }
  | { op: 'update'; schedule: ReturnType<typeof serializeSchedule> }
  | { op: 'delete'; ok: true }

function workspaceForConversation(conversationId: string): string {
  const conv = getConversation(conversationId.trim())
  if (!conv?.workspace_id) throw new Error('conversation_workspace_missing')
  return conv.workspace_id
}

function serializeSchedule(row: NonNullable<ReturnType<typeof getScheduledPrompt>>) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    title: row.title,
    prompt_text: row.prompt_text,
    recurrence: row.recurrence,
    start_at: row.start_at,
    time_local: row.time_local,
    day_of_week: row.day_of_week,
    day_of_month: row.day_of_month,
    max_runs: row.max_runs,
    run_count: row.run_count,
    catchup_on_startup: row.catchup_on_startup === 1,
    enabled: row.enabled === 1,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    last_conversation_id: row.last_conversation_id,
    last_run_status: row.last_run_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function patchFromRpc(raw: Record<string, unknown>): ScheduledPromptPatch {
  const patch: ScheduledPromptPatch = {}
  if (typeof raw.title === 'string') patch.title = raw.title
  if (typeof raw.prompt_text === 'string') patch.prompt_text = raw.prompt_text
  if (typeof raw.recurrence === 'string') patch.recurrence = normalizeRecurrenceValue(raw.recurrence)
  if (typeof raw.start_at === 'number' && Number.isFinite(raw.start_at)) patch.start_at = raw.start_at
  if (typeof raw.time_local === 'string') patch.time_local = raw.time_local
  if (typeof raw.day_of_week === 'number') patch.day_of_week = raw.day_of_week
  if (typeof raw.day_of_month === 'number') patch.day_of_month = raw.day_of_month
  if (raw.max_runs === null) patch.max_runs = null
  else if (typeof raw.max_runs === 'number') patch.max_runs = raw.max_runs
  if (typeof raw.catchup_on_startup === 'boolean') patch.catchup_on_startup = raw.catchup_on_startup
  if (typeof raw.enabled === 'boolean') patch.enabled = raw.enabled
  return patch
}

export function handleScheduleRpc(req: ScheduleRpcRequest): ScheduleRpcResult {
  const convId = req.conversationId.trim()
  if (!convId) throw new Error('missing_conversation_id')
  const workspaceId = workspaceForConversation(convId)

  if (req.op === 'list') {
    const rows = listScheduledPrompts(workspaceId)
    return { op: 'list', schedules: rows.map(serializeSchedule) }
  }

  if (req.op === 'create') {
    if (!req.prompt_text?.trim()) throw new Error('missing_prompt_text')
    const input: ScheduledPromptInput = {
      title: req.title,
      prompt_text: req.prompt_text,
      recurrence: normalizeRecurrenceValue(req.recurrence),
      start_at: req.start_at,
      time_local: req.time_local,
      day_of_week: req.day_of_week,
      day_of_month: req.day_of_month,
      max_runs: req.max_runs,
      catchup_on_startup: req.catchup_on_startup,
    }
    const row = createScheduledPrompt(workspaceId, input)
    return { op: 'create', schedule: serializeSchedule(row) }
  }

  if (req.op === 'update') {
    const existing = getScheduledPrompt(req.id)
    if (!existing || existing.workspace_id !== workspaceId) throw new Error('schedule_not_found')
    const updated = updateScheduledPrompt(req.id, patchFromRpc(req.patch))
    if (!updated) throw new Error('schedule_not_found')
    return { op: 'update', schedule: serializeSchedule(updated) }
  }

  if (req.op === 'delete') {
    const existing = getScheduledPrompt(req.id)
    if (!existing || existing.workspace_id !== workspaceId) throw new Error('schedule_not_found')
    deleteScheduledPrompt(req.id)
    return { op: 'delete', ok: true }
  }

  throw new Error('unknown_schedule_op')
}
