import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import {
  isPiBuiltinToolAllowed,
  isPiBuiltinToolId,
} from '../shared/pi-builtin-tools.js'
import { readPiBuiltinToolsPrefFromEnv } from '../shared/pi-builtin-tools-broker.js'
import {
  ingestSyloDisabledExtensionPaths,
  ingestSyloDisabledToolKeys,
  makeSyloDisabledToolKey,
  normalizeSyloCapabilityPath,
  readJsonEnv,
  syloToolBlockReason,
} from '../shared/sylo-capability-paths.js'

/**
 * Blocks tool execution when the operator disabled capabilities in Sylo Capability manager
 * (Pi built-in toggles, per-extension tool toggles, whole-extension toggles).
 */
export default function syloCapabilityGuard(pi: ExtensionAPI): void {
  const piBuiltinPref = readPiBuiltinToolsPrefFromEnv(process.env.SYLO_PI_BUILTIN_TOOLS)
  const disabledToolKeys = ingestSyloDisabledToolKeys(readJsonEnv('SYLO_DISABLED_TOOLS'))
  const disabledExtensionPaths = ingestSyloDisabledExtensionPaths(
    readJsonEnv('SYLO_DISABLED_EXTENSION_PATHS'),
  )

  pi.on('tool_call', async (event) => {
    const toolName = event.toolName
    const registered = pi.getAllTools().find((t) => t.name === toolName)
    if (!registered) return

    const source = registered.sourceInfo?.source ?? ''
    const contribPath = normalizeSyloCapabilityPath(registered.sourceInfo?.path ?? '')

    if (source === 'builtin' && isPiBuiltinToolId(toolName)) {
      if (!isPiBuiltinToolAllowed(piBuiltinPref, toolName)) {
        return { block: true, reason: syloToolBlockReason(toolName, 'pi-builtin') }
      }
      return
    }

    if (source === 'builtin') return

    if (contribPath && disabledExtensionPaths.has(contribPath)) {
      return { block: true, reason: syloToolBlockReason(toolName, 'extension') }
    }

    if (contribPath && disabledToolKeys.has(makeSyloDisabledToolKey(contribPath, toolName))) {
      return { block: true, reason: syloToolBlockReason(toolName, 'extension-tool') }
    }
  })
}
