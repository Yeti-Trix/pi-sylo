/** Parsed Pi slash input (`/name args`). Skill invocations (`/skill:…`) are excluded. */
export type ParsedPiSlashCommand = {
  name: string
  args: string
}

/**
 * Parse user chat input that starts with `/`.
 * Returns null for normal messages and `/skill:…` (skill body expansion, not a command).
 */
export function parsePiSlashInput(text: string): ParsedPiSlashCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('/skill:')) return null

  const spaceIndex = trimmed.indexOf(' ')
  const name = spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1)
  if (!name) return null
  return { name, args }
}

/** True when chat input should be treated as a Pi slash command (not sent to the LLM as-is). */
export function isPiUserSlashCommand(text: string): boolean {
  return parsePiSlashInput(text) !== null
}

export function isPiBuiltinReloadCommand(text: string): boolean {
  return parsePiSlashInput(text)?.name === 'reload'
}
