/**
 * Operator tool policy for subagent children.
 *
 * A subagent runs as its own `pi` process, so it never loads the host's
 * capability-guard extension — whatever the operator switched off in Sylo's
 * Capability manager would otherwise still be available inside a subagent. The
 * host publishes that policy in the broker env, which the child's parent (this
 * extension) can read and turn into a `--tools` allowlist.
 *
 * Kept free of `apps/host` imports so the package stays standalone under plain
 * Pi; `pi-tool-policy.test.mjs` asserts the tool id list has not drifted from
 * the host's.
 */

/** Pi built-in tool ids, mirroring `apps/host/src/shared/pi-builtin-tools.ts`. */
export const PI_BUILTIN_TOOL_IDS = [
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'find',
  'ls',
] as const

export type PiBuiltinToolId = (typeof PI_BUILTIN_TOOL_IDS)[number]

export type SubagentToolPolicy =
  | { kind: 'allow'; tools: PiBuiltinToolId[] }
  /** Nothing the agent could use is permitted; the caller should refuse the run. */
  | { kind: 'blocked'; reason: string }

function isToolId(value: string): value is PiBuiltinToolId {
  return (PI_BUILTIN_TOOL_IDS as readonly string[]).includes(value)
}

/**
 * Built-ins the operator currently permits, from `SYLO_PI_BUILTIN_TOOLS`.
 * Absent or unparseable env means "not running under Sylo" — no restriction.
 */
export function operatorAllowedBuiltins(
  raw: string | undefined = process.env.SYLO_PI_BUILTIN_TOOLS,
): readonly PiBuiltinToolId[] | null {
  if (!raw?.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const pref = parsed as { enabled?: unknown; tools?: unknown }
  if (pref.enabled === false) return []
  const tools =
    pref.tools && typeof pref.tools === 'object' ? (pref.tools as Record<string, unknown>) : {}
  // Unlisted ids default to on, matching the host's normalizer.
  return PI_BUILTIN_TOOL_IDS.filter((id) => tools[id] !== false)
}

/**
 * Intersect an agent's own `tools:` frontmatter with the operator's policy.
 *
 * Neither side can widen the other: the persona cannot reach a tool the operator
 * disabled, and the operator's switches do not hand a read-only persona `write`.
 */
export function resolveSubagentToolPolicy(opts: {
  /** Frontmatter `tools:`, or undefined for an unrestricted persona. */
  agentTools?: readonly string[]
  /** Defaults to reading the broker env. */
  allowedBuiltins?: readonly PiBuiltinToolId[] | null
  chatOnly?: boolean
}): SubagentToolPolicy {
  const chatOnly = opts.chatOnly ?? process.env.SYLO_CHAT_ONLY === '1'
  if (chatOnly) {
    return {
      kind: 'blocked',
      reason: 'Chat-only mode is on, so subagents have no tools to work with.',
    }
  }

  const allowed =
    opts.allowedBuiltins === undefined ? operatorAllowedBuiltins() : opts.allowedBuiltins

  const requested =
    opts.agentTools && opts.agentTools.length > 0
      ? opts.agentTools.map((t) => t.trim()).filter(isToolId)
      : PI_BUILTIN_TOOL_IDS

  if (allowed === null) return { kind: 'allow', tools: [...requested] }

  const allowedSet = new Set(allowed)
  const effective = PI_BUILTIN_TOOL_IDS.filter(
    (id) => requested.includes(id) && allowedSet.has(id),
  )

  if (effective.length === 0) {
    const blockedByOperator = requested.filter((id) => !allowedSet.has(id))
    return {
      kind: 'blocked',
      reason:
        blockedByOperator.length > 0
          ? `Every tool this agent needs (${blockedByOperator.join(', ')}) is disabled in Sylo's Capability manager.`
          : 'This agent has no usable tools.',
    }
  }
  return { kind: 'allow', tools: effective }
}

/**
 * `--tools` arguments for a resolved policy.
 *
 * Omitted when everything is permitted: passing the full list would be
 * equivalent, and leaving it off keeps the child's own defaults intact.
 */
export function toolCliArgs(tools: readonly PiBuiltinToolId[]): string[] {
  if (tools.length === 0 || tools.length === PI_BUILTIN_TOOL_IDS.length) return []
  return ['--tools', tools.join(',')]
}
