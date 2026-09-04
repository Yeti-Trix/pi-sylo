import type {
  AgentSession,
  AgentSessionRuntime,
  ExtensionCommandContextActions,
} from '@earendil-works/pi-coding-agent'

import type { PiBuiltinToolsPref } from '../shared/pi-builtin-tools.js'
import { resolveSyloActiveToolNames } from '../shared/pi-builtin-tools-broker.js'
import { createSyloExtensionUIContext } from './sylo-extension-ui.js'

export type SyloExtensionBrokerEmit = (payload: Record<string, unknown>) => void

export type BindPiSessionExtensionsOptions = {
  session: AgentSession
  runtime: AgentSessionRuntime
  emit: SyloExtensionBrokerEmit
  getActiveTurnId: () => string | undefined
  piBuiltinPref: PiBuiltinToolsPref
  disabledExtensionPaths: ReadonlySet<string>
  disabledToolKeys: ReadonlySet<string>
  chatOnly?: boolean
}

export function applySyloActiveToolsFromBrokerPolicy(
  session: AgentSession,
  options: Pick<
    BindPiSessionExtensionsOptions,
    'piBuiltinPref' | 'disabledExtensionPaths' | 'disabledToolKeys' | 'chatOnly'
  >,
): void {
  if (options.chatOnly) {
    session.setActiveToolsByName([])
    return
  }
  const activeToolNames = resolveSyloActiveToolNames(
    options.piBuiltinPref,
    session.getAllTools(),
    options.disabledExtensionPaths,
    options.disabledToolKeys,
  )
  if (activeToolNames.length > 0) {
    session.setActiveToolsByName(activeToolNames)
  }
}

export async function bindPiSessionExtensions(
  options: BindPiSessionExtensionsOptions,
): Promise<void> {
  const { session, runtime, emit, getActiveTurnId } = options
  const policy = {
    piBuiltinPref: options.piBuiltinPref,
    disabledExtensionPaths: options.disabledExtensionPaths,
    disabledToolKeys: options.disabledToolKeys,
  }

  const commandContextActions: ExtensionCommandContextActions = {
    waitForIdle: () => session.agent.waitForIdle(),
    newSession: async (newSessionOptions) => runtime.newSession(newSessionOptions),
    fork: async (entryId, forkOptions) => {
      const result = await runtime.fork(entryId, forkOptions)
      return { cancelled: result.cancelled }
    },
    navigateTree: async (targetId, navigateOptions) => {
      const result = await session.navigateTree(targetId, {
        summarize: navigateOptions?.summarize,
        customInstructions: navigateOptions?.customInstructions,
        replaceInstructions: navigateOptions?.replaceInstructions,
        label: navigateOptions?.label,
      })
      return { cancelled: result.cancelled }
    },
    switchSession: async (sessionPath, switchOptions) => {
      return runtime.switchSession(sessionPath, switchOptions)
    },
    reload: async () => {
      await session.reload()
      applySyloActiveToolsFromBrokerPolicy(session, policy)
    },
  }

  await session.bindExtensions({
    uiContext: createSyloExtensionUIContext({ emit, getActiveTurnId }),
    commandContextActions,
    onError: (err) => {
      emit({
        type: 'extension_error',
        turnId: getActiveTurnId(),
        extensionPath: err.extensionPath,
        event: err.event,
        error: err.error,
      })
    },
  })

  applySyloActiveToolsFromBrokerPolicy(session, policy)
}
