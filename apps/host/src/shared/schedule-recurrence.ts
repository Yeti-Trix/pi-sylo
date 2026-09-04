import type { ScheduleRecurrence } from './scheduled-prompts-types.js'

export function parseTimeLocal(hhmm: string): { hours: number; minutes: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) throw new Error('invalid_time_local')
  const hours = Number.parseInt(m[1]!, 10)
  const minutes = Number.parseInt(m[2]!, 10)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) throw new Error('invalid_time_local')
  return { hours, minutes }
}

export function formatTimeLocalFromMs(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function combineLocalDateAndTime(dateMs: number, timeLocal: string): number {
  const { hours, minutes } = parseTimeLocal(timeLocal)
  const d = new Date(dateMs)
  d.setHours(hours, minutes, 0, 0)
  return d.getTime()
}

export function computeNextRunAt(input: {
  recurrence: ScheduleRecurrence
  startAt: number
  timeLocal: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  /** Compute the next run strictly after this timestamp (default: now). */
  afterMs?: number
}): number {
  const after = input.afterMs ?? Date.now()

  if (input.recurrence === 'once') {
    return input.startAt
  }

  const { hours, minutes } = parseTimeLocal(input.timeLocal)
  const notBefore = Math.max(after, input.startAt)

  if (input.recurrence === 'daily') {
    const d = new Date(notBefore)
    d.setHours(hours, minutes, 0, 0)
    if (d.getTime() < notBefore) {
      d.setDate(d.getDate() + 1)
    }
    return d.getTime()
  }

  if (input.recurrence === 'weekly') {
    const targetDow = input.dayOfWeek ?? 0
    const d = new Date(notBefore)
    d.setHours(hours, minutes, 0, 0)
    let daysAhead = targetDow - d.getDay()
    if (daysAhead < 0 || (daysAhead === 0 && d.getTime() < notBefore)) {
      daysAhead += 7
    }
    d.setDate(d.getDate() + daysAhead)
    return d.getTime()
  }

  if (input.recurrence === 'monthly') {
    const dom = input.dayOfMonth ?? 1
    const d = new Date(notBefore)
    d.setHours(hours, minutes, 0, 0)
    d.setDate(dom)
    if (d.getTime() < notBefore) {
      d.setMonth(d.getMonth() + 1)
      d.setDate(dom)
    }
    return d.getTime()
  }

  return input.startAt
}

/** True when the schedule has exhausted its run budget or is a completed one-shot. */
export function isScheduleCompleted(input: {
  recurrence: ScheduleRecurrence
  run_count: number
  max_runs: number | null
  enabled: number
}): boolean {
  if (!input.enabled) return true
  if (input.recurrence === 'once' && input.run_count > 0) return true
  if (input.max_runs != null && input.run_count >= input.max_runs) return true
  return false
}
