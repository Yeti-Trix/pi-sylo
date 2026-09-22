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

/**
 * The built-ins grouped the way operators reason about them ("can it write?"),
 * used by the per-subagent access controls in Settings. Covers every id in
 * `PI_BUILTIN_TOOL_IDS`, so a group-by-group UI cannot silently omit a tool.
 */
export const PI_TOOL_ACCESS_GROUPS: readonly {
  id: 'read' | 'write' | 'shell'
  label: string
  hint: string
  tools: readonly PiBuiltinToolId[]
}[] = [
  {
    id: 'read',
    label: 'Read access',
    hint: 'Open files, list directories, and search the project.',
    tools: ['read', 'ls', 'find', 'grep'],
  },
  {
    id: 'write',
    label: 'Write access',
    hint: 'Create files and edit them in place.',
    tools: ['write', 'edit'],
  },
  {
    id: 'shell',
    label: 'Shell access',
    hint: 'Run commands — builds, tests, git. Implies it can change things read/write toggles do not cover.',
    tools: ['bash'],
  },
]

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
