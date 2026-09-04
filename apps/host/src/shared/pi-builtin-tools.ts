/** Pi built-in tool ids (see pi.dev SDK — Tools section). */
export const PI_BUILTIN_TOOL_IDS = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] as const

export type PiBuiltinToolId = (typeof PI_BUILTIN_TOOL_IDS)[number]

export const PI_BUILTIN_TOOL_LABELS: Record<PiBuiltinToolId, string> = {
  read: 'Read files',
  write: 'Write files',
  edit: 'Edit files',
  bash: 'Run shell commands',
  grep: 'Search file contents (grep)',
  find: 'Find files',
  ls: 'List directories',
}

/** Sylo pref `sylo.pi_builtin_tools` — master switch + per-tool toggles when master is on. */
export type PiBuiltinToolsPref = {
  enabled: boolean
  tools: Record<PiBuiltinToolId, boolean>
}

/** Sylo default: all Pi built-ins on (read, write, edit, bash, grep, find, ls). */
export function defaultPiBuiltinToolsPref(): PiBuiltinToolsPref {
  return {
    enabled: true,
    tools: {
      read: true,
      write: true,
      edit: true,
      bash: true,
      grep: true,
      find: true,
      ls: true,
    },
  }
}

export function normalizePiBuiltinToolsPref(raw: unknown): PiBuiltinToolsPref {
  const def = defaultPiBuiltinToolsPref()
  if (!raw || typeof raw !== 'object') return def
  const o = raw as Record<string, unknown>
  const enabled = typeof o.enabled === 'boolean' ? o.enabled : def.enabled
  const toolsIn = o.tools && typeof o.tools === 'object' ? (o.tools as Record<string, unknown>) : {}
  const tools = { ...def.tools }
  for (const id of PI_BUILTIN_TOOL_IDS) {
    const v = toolsIn[id]
    if (typeof v === 'boolean') tools[id] = v
  }
  return { enabled, tools }
}

export function isPiBuiltinToolId(name: string): name is PiBuiltinToolId {
  return (PI_BUILTIN_TOOL_IDS as readonly string[]).includes(name)
}

/** Whether a Pi built-in tool id may execute (Sylo Settings policy). */
export function isPiBuiltinToolAllowed(pref: PiBuiltinToolsPref, toolName: string): boolean {
  if (!isPiBuiltinToolId(toolName)) return true
  if (!pref.enabled) return false
  return pref.tools[toolName]
}
