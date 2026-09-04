import {
  defaultDebaterPersona,
  DEFAULT_MODERATOR_PERSONA,
  resolveThinkTankPersonaId,
} from './personas.ts'

export type ThinkTankSeatRole = 'debater' | 'moderator'

export type ThinkTankSeatConfig = {
  id: string
  label: string
  role?: ThinkTankSeatRole
  agent: string
  model_provider?: string
  model_id?: string
  /** @deprecated use model_id */
  model?: string
  persona?: string
}

export const MIN_DEBATERS = 2
export const MAX_DEBATERS = 5

export const MODERATOR_SEAT_ID = 'seat-moderator'
export const LEGACY_MODERATOR_SEAT_ID = 'seat-c'

const DEBATER_SEAT_IDS = ['seat-a', 'seat-b', 'seat-d', 'seat-e', 'seat-f'] as const

export const LEGACY_THINK_TANK_SEAT_LABELS: Record<string, string> = {
  'Evidence-first': 'Debater 1',
  Skeptic: 'Debater 2',
  'Synthesis critic': 'Moderator',
  Ref: 'Moderator',
}

export function debaterSeatId(index: number): string {
  return DEBATER_SEAT_IDS[index] ?? `seat-debater-${index + 1}`
}

export function defaultDebaterLabel(index: number): string {
  return `Debater ${index + 1}`
}

export function clampDebaterCount(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : MIN_DEBATERS
  return Math.max(MIN_DEBATERS, Math.min(MAX_DEBATERS, v))
}

export function isModeratorSeat(seat: Pick<ThinkTankSeatConfig, 'id' | 'label' | 'role'>): boolean {
  if (seat.role === 'moderator') return true
  if (seat.role === 'debater') return false
  if (seat.id === MODERATOR_SEAT_ID || seat.id === LEGACY_MODERATOR_SEAT_ID) return true
  return /moderator|synthesis|^ref$/i.test(seat.label)
}

export function isDebateCompetitorSeat(seat: Pick<ThinkTankSeatConfig, 'id' | 'label' | 'role'>): boolean {
  return !isModeratorSeat(seat)
}

export function countDebatersInSeats(seats: unknown): number {
  if (!Array.isArray(seats)) return MIN_DEBATERS
  const debaters = seats.filter((s) => s && typeof s === 'object' && isDebateCompetitorSeat(s as ThinkTankSeatConfig))
  return clampDebaterCount(debaters.length || MIN_DEBATERS)
}

function migrateAgentId(agent: string): string {
  return resolveThinkTankPersonaId(agent)
}

function mergeSeatFields(
  base: ThinkTankSeatConfig,
  prev: Partial<ThinkTankSeatConfig> | undefined,
): ThinkTankSeatConfig {
  const rawLabel = String(prev?.label ?? base.label).trim()
  const label = LEGACY_THINK_TANK_SEAT_LABELS[rawLabel] ?? (rawLabel || base.label)
  return {
    id: base.id,
    role: base.role,
    label,
    agent: migrateAgentId(String(prev?.agent ?? base.agent)),
    model_provider: (prev?.model_provider ?? base.model_provider ?? '').trim(),
    model_id: (prev?.model_id ?? prev?.model ?? base.model_id ?? '').trim(),
    persona: prev?.persona?.trim() || base.persona,
  }
}

/** Build debater seats + one moderator (last). Preserves operator model picks when resizing. */
export function buildThinkTankSeats(
  debaterCount: number,
  existing?: Partial<ThinkTankSeatConfig>[] | null,
): ThinkTankSeatConfig[] {
  const n = clampDebaterCount(debaterCount)
  const list = Array.isArray(existing) ? existing : []
  const byId = new Map(list.map((s) => [String(s.id ?? ''), s]))
  const legacyDebaters = list.filter((s) => isDebateCompetitorSeat(s as ThinkTankSeatConfig))

  const debaters: ThinkTankSeatConfig[] = []
  for (let i = 0; i < n; i++) {
    const id = debaterSeatId(i)
    const prev = byId.get(id) ?? legacyDebaters[i]
    debaters.push(
      mergeSeatFields(
        {
          id,
          role: 'debater',
          label: defaultDebaterLabel(i),
          agent: defaultDebaterPersona(i),
          model_provider: '',
          model_id: '',
        },
        prev,
      ),
    )
  }

  const modPrev =
    byId.get(MODERATOR_SEAT_ID) ??
    byId.get(LEGACY_MODERATOR_SEAT_ID) ??
    list.find((s) => isModeratorSeat(s as ThinkTankSeatConfig))

  const moderator = mergeSeatFields(
    {
      id: MODERATOR_SEAT_ID,
      role: 'moderator',
      label: 'Moderator',
      agent: DEFAULT_MODERATOR_PERSONA,
      model_provider: '',
      model_id: '',
    },
    modPrev,
  )

  return [...debaters, moderator]
}

export function validateThinkTankSeats(seats: ThinkTankSeatConfig[]): void {
  const debaters = seats.filter(isDebateCompetitorSeat)
  if (debaters.length < MIN_DEBATERS) {
    throw new Error(`Think tank requires at least ${MIN_DEBATERS} debaters`)
  }
  if (debaters.length > MAX_DEBATERS) {
    throw new Error(`Think tank supports at most ${MAX_DEBATERS} debaters`)
  }
  const moderators = seats.filter(isModeratorSeat)
  if (moderators.length !== 1) {
    throw new Error('Think tank requires exactly one Moderator seat')
  }
  const last = seats[seats.length - 1]
  if (!last || !isModeratorSeat(last)) {
    throw new Error('Moderator must be the last seat in debate order')
  }
}
