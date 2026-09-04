import assert from 'node:assert/strict'
import test from 'node:test'

import { buildThinkTankSeats, clampDebaterCount, isModeratorSeat } from './think-tank-seats.ts'

test('clampDebaterCount bounds 2..5', () => {
  assert.equal(clampDebaterCount(1), 2)
  assert.equal(clampDebaterCount(3), 3)
  assert.equal(clampDebaterCount(9), 5)
})

test('buildThinkTankSeats adds debaters and moderator last', () => {
  const seats = buildThinkTankSeats(3)
  assert.equal(seats.length, 4)
  assert.equal(seats[0]?.label, 'Debater 1')
  assert.equal(seats[2]?.label, 'Debater 3')
  assert.ok(isModeratorSeat(seats[3]))
  assert.equal(seats[3]?.id, 'seat-moderator')
})

test('buildThinkTankSeats preserves model picks when resizing', () => {
  const existing = buildThinkTankSeats(2)
  existing[0].model_id = 'custom-a'
  existing[1].model_id = 'custom-b'
  const three = buildThinkTankSeats(3, existing)
  assert.equal(three[0]?.model_id, 'custom-a')
  assert.equal(three[1]?.model_id, 'custom-b')
  assert.equal(three[2]?.label, 'Debater 3')
})
