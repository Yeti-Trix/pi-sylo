import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import {
  combineLocalDateAndTime,
  computeNextRunAt,
  formatTimeLocalFromMs,
  isScheduleCompleted,
  parseTimeLocal,
} from '../shared/schedule-recurrence.js'
import type {
  ScheduledPromptInput,
  ScheduledPromptPatch,
  ScheduledPromptRow,
  ScheduleRecurrence,
} from '../shared/scheduled-prompts-types.js'
import {
  findScheduleDbForId,
  getWorkspaceScheduleDb,
  listExistingWorkspaceScheduleDbs,
} from './workspace-db.js'

const COLUMNS = `id, workspace_id, title, prompt_text, recurrence, start_at, time_local,
  day_of_week, day_of_month, max_runs, run_count, catchup_on_startup, enabled,
  next_run_at, last_run_at, last_conversation_id, last_run_status, created_at, updated_at`

function rowFromDb(r: Record<string, unknown>): ScheduledPromptRow {
  return r as unknown as ScheduledPromptRow
}

function normalizeRecurrence(raw: string): ScheduleRecurrence {
  if (raw === 'once' || raw === 'daily' || raw === 'weekly' || raw === 'monthly') return raw
  throw new Error('invalid_recurrence')
}

function resolveScheduleTiming(input: ScheduledPromptInput): {
  start_at: number
  time_local: string
  day_of_week: number | null
  day_of_month: number | null
  next_run_at: number
} {
  const recurrence = input.recurrence
  if (recurrence === 'once') {
    const start_at = input.start_at
    return {
      start_at,
      time_local: formatTimeLocalFromMs(start_at),
      day_of_week: null,
      day_of_month: null,
      next_run_at: start_at,
    }
  }

  const time_local = input.time_local?.trim() || formatTimeLocalFromMs(input.start_at)
  parseTimeLocal(time_local)
  const start_at = combineLocalDateAndTime(input.start_at, time_local)
  const day_of_week = recurrence === 'weekly' ? (input.day_of_week ?? new Date(start_at).getDay()) : null
  const day_of_month =
    recurrence === 'monthly' ? (input.day_of_month ?? new Date(start_at).getDate()) : null
  const next_run_at = computeNextRunAt({
    recurrence,
    startAt: start_at,
    timeLocal: time_local,
    dayOfWeek: day_of_week,
    dayOfMonth: day_of_month,
    afterMs: Date.now() - 1,
  })
  return { start_at, time_local, day_of_week, day_of_month, next_run_at }
}

export function listScheduledPrompts(workspaceId: string): ScheduledPromptRow[] {
  const wid = workspaceId.trim()
  if (!wid) return []
  const db = getWorkspaceScheduleDb(wid, { create: false })
  if (!db) return []
  return db
    .prepare(`SELECT ${COLUMNS} FROM scheduled_prompts WHERE workspace_id = ? ORDER BY next_run_at ASC`)
    .all(wid)
    .map((r) => rowFromDb(r as Record<string, unknown>))
}

export function getScheduledPrompt(id: string): ScheduledPromptRow | undefined {
  const trimmed = id.trim()
  if (!trimmed) return undefined
  const db = findScheduleDbForId(trimmed)
  if (!db) return undefined
  const row = db.prepare(`SELECT ${COLUMNS} FROM scheduled_prompts WHERE id = ?`).get(trimmed) as
    | Record<string, unknown>
    | undefined
  return row ? rowFromDb(row) : undefined
}

/**
 * All due prompts across every workspace's per-workspace DB (scheduler daemon fan-out).
 * Unions rows from each existing workspace DB; each row carries its `workspace_id`.
 */
export function listDueScheduledPrompts(now = Date.now()): ScheduledPromptRow[] {
  const out: ScheduledPromptRow[] = []
  for (const db of listExistingWorkspaceScheduleDbs()) {
    const rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_prompts
         WHERE enabled = 1 AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(now) as Record<string, unknown>[]
    for (const r of rows) out.push(rowFromDb(r))
  }
  // Re-sort the merged set across workspaces by next_run_at.
  return out.sort((a, b) => a.next_run_at - b.next_run_at)
}

/** Catchup candidates across every workspace's per-workspace DB (startup catchup). */
export function listCatchupCandidates(now = Date.now()): ScheduledPromptRow[] {
  const out: ScheduledPromptRow[] = []
  for (const db of listExistingWorkspaceScheduleDbs()) {
    const rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_prompts
         WHERE enabled = 1 AND catchup_on_startup = 1 AND next_run_at < ?
         ORDER BY next_run_at ASC`,
      )
      .all(now) as Record<string, unknown>[]
    for (const r of rows) out.push(rowFromDb(r))
  }
  return out.sort((a, b) => a.next_run_at - b.next_run_at)
}

export function createScheduledPrompt(workspaceId: string, input: ScheduledPromptInput): ScheduledPromptRow {
  const wid = workspaceId.trim()
  if (!wid) throw new Error('missing_workspace_id')
  if (!input.prompt_text.trim()) throw new Error('missing_prompt_text')
  const db = getWorkspaceScheduleDb(wid, { create: true })!
  const timing = resolveScheduleTiming(input)
  const now = Date.now()
  const id = randomUUID()
  const row: ScheduledPromptRow = {
    id,
    workspace_id: wid,
    title: (input.title ?? '').trim(),
    prompt_text: input.prompt_text.trim(),
    recurrence: input.recurrence,
    start_at: timing.start_at,
    time_local: timing.time_local,
    day_of_week: timing.day_of_week,
    day_of_month: timing.day_of_month,
    max_runs: input.max_runs ?? null,
    run_count: 0,
    catchup_on_startup: input.catchup_on_startup === false ? 0 : 1,
    enabled: input.enabled === false ? 0 : 1,
    next_run_at: timing.next_run_at,
    last_run_at: null,
    last_conversation_id: null,
    last_run_status: null,
    created_at: now,
    updated_at: now,
  }
  db.prepare(
    `INSERT INTO scheduled_prompts (
        id, workspace_id, title, prompt_text, recurrence, start_at, time_local,
        day_of_week, day_of_month, max_runs, run_count, catchup_on_startup, enabled,
        next_run_at, last_run_at, last_conversation_id, last_run_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.workspace_id,
    row.title,
    row.prompt_text,
    row.recurrence,
    row.start_at,
    row.time_local,
    row.day_of_week,
    row.day_of_month,
    row.max_runs,
    row.run_count,
    row.catchup_on_startup,
    row.enabled,
    row.next_run_at,
    row.last_run_at,
    row.last_conversation_id,
    row.last_run_status,
    row.created_at,
    row.updated_at,
  )
  return row
}

export function updateScheduledPrompt(id: string, patch: ScheduledPromptPatch): ScheduledPromptRow | undefined {
  const trimmed = id.trim()
  if (!trimmed) return undefined
  const db = findScheduleDbForId(trimmed)
  if (!db) return undefined
  const existing = db.prepare(`SELECT ${COLUMNS} FROM scheduled_prompts WHERE id = ?`).get(trimmed) as
    | ScheduledPromptRow
    | undefined
  if (!existing) return undefined

  const merged: ScheduledPromptInput = {
    title: patch.title !== undefined ? patch.title : existing.title,
    prompt_text: patch.prompt_text !== undefined ? patch.prompt_text : existing.prompt_text,
    recurrence: patch.recurrence !== undefined ? patch.recurrence : existing.recurrence,
    start_at: patch.start_at !== undefined ? patch.start_at : existing.start_at,
    time_local: patch.time_local !== undefined ? patch.time_local : existing.time_local,
    day_of_week: patch.day_of_week !== undefined ? patch.day_of_week : existing.day_of_week,
    day_of_month: patch.day_of_month !== undefined ? patch.day_of_month : existing.day_of_month,
    max_runs: patch.max_runs !== undefined ? patch.max_runs : existing.max_runs,
    catchup_on_startup:
      patch.catchup_on_startup !== undefined ?
        patch.catchup_on_startup
      : existing.catchup_on_startup === 1,
    enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled === 1,
  }

  const timing = resolveScheduleTiming(merged)
  const now = Date.now()
  const enabled =
    patch.enabled !== undefined ?
      patch.enabled ? 1 : 0
    : existing.enabled
  const next_run_at =
    isScheduleCompleted({
      recurrence: merged.recurrence,
      run_count: existing.run_count,
      max_runs: merged.max_runs ?? null,
      enabled,
    }) ?
      existing.next_run_at
    : timing.next_run_at

  db.prepare(
    `UPDATE scheduled_prompts SET
        title = ?, prompt_text = ?, recurrence = ?, start_at = ?, time_local = ?,
        day_of_week = ?, day_of_month = ?, max_runs = ?, catchup_on_startup = ?,
        enabled = ?, next_run_at = ?, updated_at = ?
       WHERE id = ?`,
  ).run(
    (merged.title ?? '').trim(),
    merged.prompt_text.trim(),
    merged.recurrence,
    timing.start_at,
    timing.time_local,
    timing.day_of_week,
    timing.day_of_month,
    merged.max_runs ?? null,
    merged.catchup_on_startup === false ? 0 : 1,
    enabled,
    next_run_at,
    now,
    trimmed,
  )
  const updated = db.prepare(`SELECT ${COLUMNS} FROM scheduled_prompts WHERE id = ?`).get(trimmed) as
    | Record<string, unknown>
    | undefined
  return updated ? rowFromDb(updated) : undefined
}

export function deleteScheduledPrompt(id: string): boolean {
  const trimmed = id.trim()
  if (!trimmed) return false
  const db = findScheduleDbForId(trimmed)
  if (!db) return false
  const result = db.prepare('DELETE FROM scheduled_prompts WHERE id = ?').run(trimmed)
  return result.changes > 0
}

/** Clear soft pointers when a conversation is deleted (schedules themselves stay). */
export function clearScheduledPromptLastConversationId(conversationId: string): number {
  const id = conversationId.trim()
  if (!id) return 0
  let changes = 0
  const now = Date.now()
  for (const db of listExistingWorkspaceScheduleDbs()) {
    try {
      const result = db
        .prepare(
          `UPDATE scheduled_prompts
           SET last_conversation_id = NULL, updated_at = ?
           WHERE last_conversation_id = ?`,
        )
        .run(now, id)
      changes += result.changes
    } catch {
      /* best-effort */
    }
  }
  return changes
}

export function recordScheduledPromptRun(
  id: string,
  patch: {
    conversationId: string
    status: 'started' | 'failed' | 'broker_unavailable'
    now?: number
  },
): ScheduledPromptRow | undefined {
  const trimmed = id.trim()
  if (!trimmed) return undefined
  const db = findScheduleDbForId(trimmed)
  if (!db) return undefined
  const existing = db.prepare(`SELECT ${COLUMNS} FROM scheduled_prompts WHERE id = ?`).get(trimmed) as
    | ScheduledPromptRow
    | undefined
  if (!existing) return undefined
  const now = patch.now ?? Date.now()
  const run_count = existing.run_count + 1
  let enabled = existing.enabled
  let next_run_at = existing.next_run_at

  const completed =
    existing.recurrence === 'once' ||
    (existing.max_runs != null && run_count >= existing.max_runs)

  if (completed) {
    enabled = 0
  } else {
    next_run_at = computeNextRunAt({
      recurrence: existing.recurrence,
      startAt: existing.start_at,
      timeLocal: existing.time_local,
      dayOfWeek: existing.day_of_week,
      dayOfMonth: existing.day_of_month,
      afterMs: now,
    })
  }

  db.prepare(
    `UPDATE scheduled_prompts SET
        run_count = ?, enabled = ?, next_run_at = ?, last_run_at = ?,
        last_conversation_id = ?, last_run_status = ?, updated_at = ?
       WHERE id = ?`,
  ).run(
    run_count,
    enabled,
    next_run_at,
    now,
    patch.conversationId,
    patch.status,
    now,
    trimmed,
  )
  const row = db.prepare(`SELECT ${COLUMNS} FROM scheduled_prompts WHERE id = ?`).get(trimmed) as
    | Record<string, unknown>
    | undefined
  return row ? rowFromDb(row) : undefined
}

/** Skip missed intervals without firing — advance next_run_at to the future. */
export function skipMissedScheduledPrompt(id: string, now = Date.now()): ScheduledPromptRow | undefined {
  const trimmed = id.trim()
  if (!trimmed) return undefined
  const db = findScheduleDbForId(trimmed)
  if (!db) return undefined
  const existing = db.prepare(`SELECT ${COLUMNS} FROM scheduled_prompts WHERE id = ?`).get(trimmed) as
    | ScheduledPromptRow
    | undefined
  if (!existing || !existing.enabled) return existing
  if (existing.next_run_at >= now) return existing
  if (isScheduleCompleted(existing)) return existing

  const next_run_at = computeNextRunAt({
    recurrence: existing.recurrence,
    startAt: existing.start_at,
    timeLocal: existing.time_local,
    dayOfWeek: existing.day_of_week,
    dayOfMonth: existing.day_of_month,
    afterMs: now,
  })

  db.prepare('UPDATE scheduled_prompts SET next_run_at = ?, updated_at = ? WHERE id = ?').run(
    next_run_at,
    now,
    trimmed,
  )
  const row = db.prepare(`SELECT ${COLUMNS} FROM scheduled_prompts WHERE id = ?`).get(trimmed) as
    | Record<string, unknown>
    | undefined
  return row ? rowFromDb(row) : undefined
}

export function normalizeRecurrenceValue(raw: unknown): ScheduleRecurrence {
  if (typeof raw !== 'string') throw new Error('invalid_recurrence')
  return normalizeRecurrence(raw)
}