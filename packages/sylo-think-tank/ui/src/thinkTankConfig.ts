import {
  MAX_DEBATERS,
  MIN_DEBATERS,
  buildThinkTankSeats,
  clampDebaterCount,
  countDebatersInSeats,
  isModeratorSeat,
  type ThinkTankSeatConfig,
} from '../../extensions/think-tank-seats.ts'

export {
  MAX_DEBATERS,
  MIN_DEBATERS,
  buildThinkTankSeats,
  clampDebaterCount,
  isModeratorSeat,
}

export type ThinkTankSeatRow = ThinkTankSeatConfig

export type ThinkTankConfig = {
  debater_count: number
  seats: ThinkTankSeatRow[]
  min_cycles: number
  max_cycles: number
}

export function normalizeThinkTankUiConfig(raw: Record<string, unknown>): ThinkTankConfig {
  const debater_count = clampDebaterCount(
    typeof raw.debater_count === 'number' ? raw.debater_count : countDebatersInSeats(raw.seats),
  )
  const seats = buildThinkTankSeats(debater_count, raw.seats as Partial<ThinkTankSeatConfig>[] | undefined)
  return {
    debater_count,
    seats,
    min_cycles: typeof raw.min_cycles === 'number' ? Math.max(2, raw.min_cycles) : 2,
    max_cycles: typeof raw.max_cycles === 'number' ? Math.min(10, Math.max(2, raw.max_cycles)) : 10,
  }
}

export function setDebaterCount(prev: ThinkTankConfig, count: number): ThinkTankConfig {
  const debater_count = clampDebaterCount(count)
  return {
    ...prev,
    debater_count,
    seats: buildThinkTankSeats(debater_count, prev.seats),
  }
}
