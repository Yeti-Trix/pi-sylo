/** Pi agent skills shipped for Sylo authoring — edits require explicit operator confirmation. */
export const SYLO_CORE_AGENT_SKILL_NAMES = ['sylo-extension-author', 'sylo-skill-author'] as const

export type SyloCoreAgentSkillName = (typeof SYLO_CORE_AGENT_SKILL_NAMES)[number]

export function isSyloCoreAgentSkillName(name: string): boolean {
  const n = typeof name === 'string' ? name.trim().toLowerCase() : ''
  return (SYLO_CORE_AGENT_SKILL_NAMES as readonly string[]).some((id) => id === n)
}
