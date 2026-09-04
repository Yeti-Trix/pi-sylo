/** Bundled think-tank Pi agent personas (markdown under ../agents/). */
export const THINK_TANK_PERSONA_EVIDENCE = 'think-tank-evidence'
export const THINK_TANK_PERSONA_SKEPTIC = 'think-tank-skeptic'
export const THINK_TANK_PERSONA_MODERATOR = 'think-tank-moderator'

export type ThinkTankPersonaOption = {
  id: string
  label: string
  description: string
}

export const BUNDLED_THINK_TANK_PERSONAS: readonly ThinkTankPersonaOption[] = [
  {
    id: THINK_TANK_PERSONA_EVIDENCE,
    label: 'Evidence-first',
    description: 'Facts, measurable criteria, cites sources',
  },
  {
    id: THINK_TANK_PERSONA_SKEPTIC,
    label: 'Skeptic',
    description: 'Stress-tests claims, failure modes, overconfidence',
  },
  {
    id: THINK_TANK_PERSONA_MODERATOR,
    label: 'Moderator',
    description: 'Synthesizes findings, surfaces gaps, decision brief',
  },
] as const

const DEFAULT_DEBATER_PERSONA_CYCLE = [
  THINK_TANK_PERSONA_EVIDENCE,
  THINK_TANK_PERSONA_SKEPTIC,
  THINK_TANK_PERSONA_EVIDENCE,
  THINK_TANK_PERSONA_SKEPTIC,
  THINK_TANK_PERSONA_EVIDENCE,
] as const

export const DEFAULT_MODERATOR_PERSONA = THINK_TANK_PERSONA_MODERATOR

export function defaultDebaterPersona(index: number): string {
  return DEFAULT_DEBATER_PERSONA_CYCLE[index] ?? THINK_TANK_PERSONA_EVIDENCE
}

/** Map legacy model-branded and council ids to current persona ids. */
const LEGACY_PERSONA_ALIASES: Record<string, string> = {
  'think-tank-glm': THINK_TANK_PERSONA_EVIDENCE,
  'think-tank-kimi': THINK_TANK_PERSONA_SKEPTIC,
  'think-tank-deepseek': THINK_TANK_PERSONA_MODERATOR,
  'council-glm': THINK_TANK_PERSONA_EVIDENCE,
  'council-kimi': THINK_TANK_PERSONA_SKEPTIC,
  'council-deepseek': THINK_TANK_PERSONA_MODERATOR,
  'council-evidence': THINK_TANK_PERSONA_EVIDENCE,
  'council-skeptic': THINK_TANK_PERSONA_SKEPTIC,
  'council-moderator': THINK_TANK_PERSONA_MODERATOR,
}

export function resolveThinkTankPersonaId(agent: string): string {
  const trimmed = agent.trim()
  if (!trimmed) return trimmed
  const councilMigrated = trimmed.replace(/^council-/, 'think-tank-')
  return LEGACY_PERSONA_ALIASES[councilMigrated] ?? LEGACY_PERSONA_ALIASES[trimmed] ?? councilMigrated
}

export function thinkTankPersonaLabel(personaId: string): string {
  const id = resolveThinkTankPersonaId(personaId)
  return BUNDLED_THINK_TANK_PERSONAS.find((p) => p.id === id)?.label ?? personaId
}
