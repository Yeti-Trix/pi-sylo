import type { BrowserWindow } from 'electron'

import type { ScheduledPromptRow } from '../shared/scheduled-prompts-types.js'
import {
  listCatchupCandidates,
  listDueScheduledPrompts,
  getScheduledPrompt,
  recordScheduledPromptRun,
  skipMissedScheduledPrompt,
} from './scheduled-prompts-db.js'

const TICK_MS = 30_000

export type ScheduleFireFn = (
  schedule: ScheduledPromptRow,
) => Promise<{ conversationId: string; status: 'started' | 'failed' | 'broker_unavailable' }>

let tickTimer: ReturnType<typeof setInterval> | undefined
let catchupDoneThisSession = false
let firing = false
let fireFn: ScheduleFireFn | undefined
let mainWindowRef: (() => BrowserWindow | null) | undefined

export function initScheduledPromptsService(opts: {
  fire: ScheduleFireFn
  getMainWindow: () => BrowserWindow | null
}): void {
  fireFn = opts.fire
  mainWindowRef = opts.getMainWindow
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(() => {
    void runSchedulerTick(false)
  }, TICK_MS)
}

export function shutdownScheduledPromptsService(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = undefined
  }
}

export function notifyBrokerReadyForSchedules(): void {
  void runStartupCatchup()
}

async function runStartupCatchup(): Promise<void> {
  if (catchupDoneThisSession) return
  catchupDoneThisSession = true
  const now = Date.now()
  const candidates = listCatchupCandidates(now)
  for (const schedule of candidates) {
    await fireScheduledPrompt(schedule, { catchup: true })
  }
  await advanceSkippedMissed(now)
}

async function advanceSkippedMissed(now: number): Promise<void> {
  const due = listDueScheduledPrompts(now)
  for (const schedule of due) {
    if (schedule.catchup_on_startup) continue
    skipMissedScheduledPrompt(schedule.id, now)
  }
}

async function runSchedulerTick(fromCatchup: boolean): Promise<void> {
  if (firing || !fireFn) return
  firing = true
  try {
    const now = Date.now()
    const due = listDueScheduledPrompts(now)
    for (const schedule of due) {
      if (fromCatchup && schedule.catchup_on_startup) continue
      await fireScheduledPrompt(schedule, { catchup: false })
    }
  } finally {
    firing = false
  }
}

async function fireScheduledPrompt(
  schedule: ScheduledPromptRow,
  opts: { catchup: boolean },
): Promise<void> {
  if (!fireFn) return
  if (!schedule.enabled) return

  let result: { conversationId: string; status: 'started' | 'failed' | 'broker_unavailable' }
  try {
    result = await fireFn(schedule)
  } catch {
    result = { conversationId: '', status: 'failed' }
  }

  recordScheduledPromptRun(schedule.id, {
    conversationId: result.conversationId || '',
    status: result.status,
  })

  mainWindowRef?.()?.webContents.send('schedules:changed', {
    workspaceId: schedule.workspace_id,
    scheduleId: schedule.id,
    conversationId: result.conversationId || null,
    catchup: opts.catchup,
  })
}

/** Manual fire from UI (Run now) — does not advance run_count or next_run_at. */
export async function fireScheduledPromptNow(id: string): Promise<
  | { ok: true; conversationId: string }
  | { ok: false; error: string }
> {
  const schedule = getScheduledPrompt(id)
  if (!schedule) return { ok: false, error: 'not_found' }
  if (!fireFn) return { ok: false, error: 'scheduler_not_ready' }
  let result: { conversationId: string; status: 'started' | 'failed' | 'broker_unavailable' }
  try {
    result = await fireFn(schedule)
  } catch {
    return { ok: false, error: 'fire_failed' }
  }
  mainWindowRef?.()?.webContents.send('schedules:changed', {
    workspaceId: schedule.workspace_id,
    scheduleId: schedule.id,
    conversationId: result.conversationId || null,
    catchup: false,
  })
  return { ok: true, conversationId: result.conversationId }
}
