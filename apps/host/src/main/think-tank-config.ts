import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'

import { join } from 'node:path'



import {

  isSyloOptionalPackageEnabled,

  type SyloOptionalPackage,

} from '../shared/sylo-optional-packages.js'



import {
  defaultDebaterPersona,
  DEFAULT_MODERATOR_PERSONA,
  resolveThinkTankPersonaId,
} from '../../../../packages/sylo-think-tank/extensions/personas.ts'

/** Mirror of packages/sylo-think-tank/extensions/think-tank-seats.ts for host config I/O. */

const MIN_DEBATERS = 2

const MAX_DEBATERS = 5

const DEBATER_SEAT_IDS = ['seat-a', 'seat-b', 'seat-d', 'seat-e', 'seat-f']

const MODERATOR_SEAT_ID = 'seat-moderator'

const LEGACY_THINK_TANK_SEAT_LABELS: Record<string, string> = {

  'Evidence-first': 'Debater 1',

  Skeptic: 'Debater 2',

  'Synthesis critic': 'Moderator',

  Ref: 'Moderator',

}



function isModeratorSeat(row: { id?: string; label?: string; role?: string }): boolean {

  if (row.role === 'moderator') return true

  if (row.role === 'debater') return false

  const id = String(row.id ?? '')

  if (id === MODERATOR_SEAT_ID || id === 'seat-c') return true

  return /moderator|synthesis|^ref$/i.test(String(row.label ?? ''))

}



function clampDebaterCount(n: unknown): number {

  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : MIN_DEBATERS

  return Math.max(MIN_DEBATERS, Math.min(MAX_DEBATERS, v))

}



function buildSeats(debaterCount: number, existing: unknown): unknown[] {

  const n = clampDebaterCount(debaterCount)

  const list = Array.isArray(existing) ? existing : []

  const byId = new Map(

    list.map((s) => {

      const row = (s ?? {}) as Record<string, unknown>

      return [String(row.id ?? ''), row]

    }),

  )

  const legacyDebaters = list.filter((s) => !isModeratorSeat((s ?? {}) as { id?: string; label?: string; role?: string }))



  const debaters: Record<string, unknown>[] = []

  for (let i = 0; i < n; i++) {

    const id = DEBATER_SEAT_IDS[i] ?? `seat-debater-${i + 1}`

    const prev = (byId.get(id) ?? legacyDebaters[i] ?? {}) as Record<string, unknown>

    const rawLabel = String(prev.label ?? `Debater ${i + 1}`).trim()

    debaters.push({

      id,

      role: 'debater',

      label: LEGACY_THINK_TANK_SEAT_LABELS[rawLabel] ?? (rawLabel || `Debater ${i + 1}`),

      agent: resolveThinkTankPersonaId(String(prev.agent ?? defaultDebaterPersona(i))),

      model_provider: String(prev.model_provider ?? ''),

      model_id: String(prev.model_id ?? prev.model ?? ''),

      persona: typeof prev.persona === 'string' ? prev.persona : undefined,

    })

  }



  const modPrev =

    (byId.get(MODERATOR_SEAT_ID) ??

      byId.get('seat-c') ??

      list.find((s) => isModeratorSeat((s ?? {}) as { id?: string; label?: string; role?: string })) ??

      {}) as Record<string, unknown>



  const modLabelRaw = String(modPrev.label ?? 'Moderator').trim()

  debaters.push({

    id: MODERATOR_SEAT_ID,

    role: 'moderator',

    label: LEGACY_THINK_TANK_SEAT_LABELS[modLabelRaw] ?? (modLabelRaw || 'Moderator'),

    agent: resolveThinkTankPersonaId(String(modPrev.agent ?? DEFAULT_MODERATOR_PERSONA)),

    model_provider: String(modPrev.model_provider ?? ''),

    model_id: String(modPrev.model_id ?? modPrev.model ?? ''),

    persona: typeof modPrev.persona === 'string' ? modPrev.persona : undefined,

  })



  return debaters

}



function normalizeThinkTankConfig(raw: Record<string, unknown>): Record<string, unknown> {

  const debater_count = clampDebaterCount(

    typeof raw.debater_count === 'number' ?

      raw.debater_count

    : Array.isArray(raw.seats) ?

      (raw.seats as unknown[]).filter((s) => !isModeratorSeat((s ?? {}) as { id?: string; label?: string; role?: string }))

        .length

    : MIN_DEBATERS,

  )

  return {

    ...raw,

    debater_count,

    seats: buildSeats(debater_count, raw.seats),

    min_cycles: typeof raw.min_cycles === 'number' ? Math.max(2, raw.min_cycles) : 2,

    max_cycles: typeof raw.max_cycles === 'number' ? Math.min(10, Math.max(2, raw.max_cycles)) : 10,

  }

}



export const THINK_TANK_CONFIG_KEY = 'sylo-think-tank'



export const DEFAULT_THINK_TANK_CONFIG: Record<string, unknown> = normalizeThinkTankConfig({

  debater_count: 2,

  min_cycles: 2,

  max_cycles: 10,

  seats: [],

})



export function thinkTankConfigDir(userDataPath: string): string {

  return join(userDataPath, 'sylo-think-tank')

}



export function thinkTankConfigPath(userDataPath: string): string {

  return join(thinkTankConfigDir(userDataPath), 'config.json')

}



export function readThinkTankConfig(userDataPath: string): Record<string, unknown> {

  const path = thinkTankConfigPath(userDataPath)

  const legacyPath = join(userDataPath, 'sylo-council', 'config.json')

  if (!existsSync(path) && existsSync(legacyPath)) {

    mkdirSync(thinkTankConfigDir(userDataPath), { recursive: true })

    copyFileSync(legacyPath, path)

  }

  if (!existsSync(path)) return { ...DEFAULT_THINK_TANK_CONFIG }

  try {

    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

    return normalizeThinkTankConfig({ ...DEFAULT_THINK_TANK_CONFIG, ...raw })

  } catch {

    return { ...DEFAULT_THINK_TANK_CONFIG }

  }

}



export function writeThinkTankConfig(

  userDataPath: string,

  values: Record<string, unknown>,

): { ok: true } | { ok: false; error: string } {

  try {

    const dir = thinkTankConfigDir(userDataPath)

    mkdirSync(dir, { recursive: true })

    const merged = normalizeThinkTankConfig({ ...DEFAULT_THINK_TANK_CONFIG, ...values })

    writeFileSync(thinkTankConfigPath(userDataPath), JSON.stringify(merged, null, 2), 'utf8')

    return { ok: true }

  } catch (e) {

    return { ok: false, error: e instanceof Error ? e.message : String(e) }

  }

}



export function thinkTankConfigEnvPath(

  userDataPath: string,

  pref: Record<string, boolean>,

  pkg: SyloOptionalPackage | undefined,

): string | undefined {

  if (!pkg || !isSyloOptionalPackageEnabled(pref, pkg.id)) return undefined

  const path = thinkTankConfigPath(userDataPath)

  if (!existsSync(path)) {

    writeThinkTankConfig(userDataPath, DEFAULT_THINK_TANK_CONFIG)

  }

  return path

}



export { MIN_DEBATERS, MAX_DEBATERS }

