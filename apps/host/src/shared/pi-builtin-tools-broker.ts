import {
  makeSyloDisabledToolKey,
  normalizeSyloCapabilityPath,
} from './sylo-capability-paths.js'
import {
  PI_BUILTIN_TOOL_IDS,
  normalizePiBuiltinToolsPref,
  type PiBuiltinToolsPref,
} from './pi-builtin-tools.js'

/**
 * Options for Pi `createAgentSession` / `createAgentSessionFromServices`.
 *
 * Do **not** pass Pi `tools: string[]` from Sylo — Pi treats that as a global allowlist,
 * which drops extension-registered tools. Builtin policy is applied after session creation
 * via {@link resolveSyloActiveToolNames} + `setActiveToolsByName`.
 */
export type PiBuiltinToolsSessionOptions = { noTools?: 'all' | 'builtin' }

export function resolvePiBuiltinToolsSessionOptions(
  pref: PiBuiltinToolsPref,
  chatOnly = false,
): PiBuiltinToolsSessionOptions {
  if (chatOnly) {
    return { noTools: 'all' }
  }
  if (!pref.enabled) {
    return { noTools: 'builtin' }
  }
  const enabledBuiltinCount = PI_BUILTIN_TOOL_IDS.filter((id) => pref.tools[id]).length
  if (enabledBuiltinCount === 0) {
    return { noTools: 'builtin' }
  }
  return {}
}

export type SyloRegisteredToolForActive = {
  name: string
  sourceInfo?: { source?: string; path?: string }
}

/** Model-active tool names: enabled Pi builtins + extension tools (respecting Sylo disables). */
export function resolveSyloActiveToolNames(
  pref: PiBuiltinToolsPref,
  registeredTools: SyloRegisteredToolForActive[],
  disabledExtensionPaths: ReadonlySet<string>,
  disabledToolKeys: ReadonlySet<string>,
): string[] {
  const enabledBuiltins = pref.enabled
    ? PI_BUILTIN_TOOL_IDS.filter((id) => pref.tools[id])
    : []

  const extensionNames: string[] = []
  for (const tool of registeredTools) {
    if (tool.sourceInfo?.source === 'builtin') continue

    const name = tool.name.trim()
    if (!name) continue

    const contribPath = normalizeSyloCapabilityPath(tool.sourceInfo?.path ?? '')
    if (contribPath && disabledExtensionPaths.has(contribPath)) continue
    if (contribPath && disabledToolKeys.has(makeSyloDisabledToolKey(contribPath, name))) continue

    extensionNames.push(name)
  }

  return [...new Set([...enabledBuiltins, ...extensionNames])]
}

export function readPiBuiltinToolsPrefFromEnv(raw: string | undefined): PiBuiltinToolsPref {
  if (!raw?.trim()) return normalizePiBuiltinToolsPref(null)
  try {
    return normalizePiBuiltinToolsPref(JSON.parse(raw) as unknown)
  } catch {
    return normalizePiBuiltinToolsPref(null)
  }
}

export { normalizePiBuiltinToolsPref }
