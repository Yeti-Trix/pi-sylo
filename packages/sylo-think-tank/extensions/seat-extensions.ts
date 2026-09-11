import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function normPath(p: string): string {
  return resolve(p.trim()).replace(/\\/g, '/').toLowerCase()
}

function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
  } catch {
    return []
  }
}

function disabledExtensionSet(env: NodeJS.ProcessEnv): Set<string> {
  const out = new Set<string>()
  for (const p of parseJsonStringArray(env.SYLO_DISABLED_EXTENSION_PATHS)) {
    out.add(normPath(p))
  }
  return out
}

function pushExtension(paths: string[], candidate: string | undefined, disabled: Set<string>): void {
  const trimmed = candidate?.trim()
  if (!trimmed || !existsSync(trimmed)) return
  if (disabled.has(normPath(trimmed))) return
  paths.push(trimmed)
}

/**
 * Same extension paths the Sylo broker loads (Capability manager enabled set),
 * passed to seat Pi subprocesses via `pi --extension`.
 *
 * Do not prune this list by package. Every seat prompt embeds the Moderator
 * assignment board, and `sylo-think-tank` is what registers the tools that act
 * on it (plus the vision fallback for text-only seat models) when
 * SYLO_THINK_TANK_SEAT_RUN=1. Dropping it leaves the Moderator describing a
 * board it cannot touch, which degenerates into emitting empty table rows.
 * Recursion is already prevented by that env flag, not by withholding the path.
 */
export function resolveSeatExtensionPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const disabled = disabledExtensionSet(env)
  const paths: string[] = []

  pushExtension(paths, env.SYLO_SKILL_SURFACE_EXTENSION, disabled)
  pushExtension(paths, env.SYLO_SUBAGENTS_EXTENSION, disabled)
  pushExtension(paths, env.SYLO_BUILTIN_TOOLS_GUARD_EXTENSION, disabled)

  for (const p of parseJsonStringArray(env.SYLO_OPTIONAL_EXTENSION_PATHS)) {
    pushExtension(paths, p, disabled)
  }

  return [...new Set(paths)]
}
