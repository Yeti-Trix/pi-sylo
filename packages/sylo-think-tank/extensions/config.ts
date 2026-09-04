import { existsSync, readFileSync } from 'node:fs'

import {
  buildThinkTankSeats,
  clampDebaterCount,
  countDebatersInSeats,
  type ThinkTankSeatConfig,
  validateThinkTankSeats,
} from './think-tank-seats.ts'

export type { ThinkTankSeatConfig, ThinkTankSeatRole } from './think-tank-seats.ts'
export {
  MIN_DEBATERS,
  MAX_DEBATERS,
  MODERATOR_SEAT_ID,
  isModeratorSeat,
  isDebateCompetitorSeat,
  buildThinkTankSeats,
  clampDebaterCount,
  debaterSeatId,
  defaultDebaterLabel,
  LEGACY_THINK_TANK_SEAT_LABELS,
  validateThinkTankSeats,
} from './think-tank-seats.ts'

export type ThinkTankConfig = {
  debater_count: number
  seats: ThinkTankSeatConfig[]
  min_cycles: number
  max_cycles: number
}

export const DEFAULT_THINK_TANK_CONFIG: ThinkTankConfig = {
  debater_count: 2,
  seats: buildThinkTankSeats(2),
  min_cycles: 3,
  max_cycles: 5,
}

export function normalizeThinkTankConfig(raw: Partial<ThinkTankConfig> & { seats?: Partial<ThinkTankSeatConfig>[] }): ThinkTankConfig {
  const debater_count = clampDebaterCount(
    typeof raw.debater_count === 'number' ? raw.debater_count : countDebatersInSeats(raw.seats),
  )
  const seats = buildThinkTankSeats(debater_count, raw.seats)
  validateThinkTankSeats(seats)
  const min = typeof raw.min_cycles === 'number' ? Math.max(2, raw.min_cycles) : DEFAULT_THINK_TANK_CONFIG.min_cycles
  const max =
    typeof raw.max_cycles === 'number' ?
      Math.min(10, Math.max(min, raw.max_cycles))
    : DEFAULT_THINK_TANK_CONFIG.max_cycles
  return {
    debater_count,
    seats,
    min_cycles: min,
    max_cycles: max,
  }
}

export function readThinkTankConfigFromEnv(): ThinkTankConfig {
  const path = process.env.SYLO_THINK_TANK_CONFIG?.trim()
  if (!path || !existsSync(path)) {
    return { ...DEFAULT_THINK_TANK_CONFIG, seats: [...DEFAULT_THINK_TANK_CONFIG.seats] }
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ThinkTankConfig>
    return normalizeThinkTankConfig(raw)
  } catch {
    return { ...DEFAULT_THINK_TANK_CONFIG, seats: [...DEFAULT_THINK_TANK_CONFIG.seats] }
  }
}

export function clampCycleBounds(min?: number, max?: number): { minCycles: number; maxCycles: number } {
  let minCycles = typeof min === 'number' ? Math.floor(min) : DEFAULT_THINK_TANK_CONFIG.min_cycles
  let maxCycles = typeof max === 'number' ? Math.floor(max) : DEFAULT_THINK_TANK_CONFIG.max_cycles
  minCycles = Math.max(2, minCycles)
  maxCycles = Math.min(10, Math.max(minCycles, maxCycles))
  return { minCycles, maxCycles }
}

/** Build Pi `--model` value from seat overrides (provider/id same semantics as Sylo Settings). */
export function resolveSeatPiModel(seat: ThinkTankSeatConfig): string | undefined {
  const modelId = seat.model_id?.trim() || seat.model?.trim()
  if (!modelId) return undefined
  const provider = seat.model_provider?.trim()
  if (provider) return `${provider}/${modelId}`
  return modelId
}
