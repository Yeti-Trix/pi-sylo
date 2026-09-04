/**
 * Run: npm run test:schedule-recurrence -w apps/host
 */
import assert from 'node:assert/strict'
import {
  computeNextRunAt,
  formatTimeLocalFromMs,
  isScheduleCompleted,
  parseTimeLocal,
} from '../../out/shared/schedule-recurrence.mjs'

function localMs(y, mo, d, h, mi) {
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
}

assert.deepEqual(parseTimeLocal('09:30'), { hours: 9, minutes: 30 })

const dailyAfter = localMs(2026, 7, 3, 10, 0)
const dailyNext = computeNextRunAt({
  recurrence: 'daily',
  startAt: localMs(2026, 7, 1, 0, 0),
  timeLocal: '09:00',
  afterMs: dailyAfter,
})
assert.equal(dailyNext, localMs(2026, 7, 4, 9, 0))

const weeklyNext = computeNextRunAt({
  recurrence: 'weekly',
  startAt: localMs(2026, 7, 1, 0, 0),
  timeLocal: '08:00',
  dayOfWeek: 1,
  afterMs: localMs(2026, 7, 3, 12, 0),
})
assert.equal(weeklyNext, localMs(2026, 7, 6, 8, 0))

// Saving a weekly slot still in the future today must not skip to next week.
const weeklySameDay = computeNextRunAt({
  recurrence: 'weekly',
  startAt: localMs(2026, 7, 7, 11, 45),
  timeLocal: '11:45',
  dayOfWeek: 2,
  afterMs: localMs(2026, 7, 7, 11, 44, 10),
})
assert.equal(weeklySameDay, localMs(2026, 7, 7, 11, 45))

assert.equal(
  isScheduleCompleted({ recurrence: 'once', run_count: 1, max_runs: null, enabled: 0 }),
  true,
)
assert.equal(formatTimeLocalFromMs(localMs(2026, 7, 3, 14, 5)), '14:05')

console.log('schedule-recurrence tests ok')
