import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'

import type { SyloExtensionBrokerEmit } from './bind-pi-extensions.js'

type CreateSyloExtensionUIContextOptions = {
  emit: SyloExtensionBrokerEmit
  getActiveTurnId: () => string | undefined
}

/**
 * Headless ExtensionUIContext for Sylo chat — forwards notify/status to the Electron host.
 * Mirrors Pi RPC mode: interactive dialogs/widgets are no-ops.
 */
export function createSyloExtensionUIContext(
  options: CreateSyloExtensionUIContextOptions,
): ExtensionUIContext {
  const { emit, getActiveTurnId } = options

  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify(message, type) {
      emit({
        type: 'extension_notify',
        turnId: getActiveTurnId(),
        message,
        notifyType: type ?? 'info',
      })
    },
    onTerminalInput: () => () => {},
    setStatus(key, text) {
      if (!text) return
      emit({
        type: 'extension_notify',
        turnId: getActiveTurnId(),
        message: text,
        notifyType: 'info',
        statusKey: key,
      })
    },
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    async custom<T>(): Promise<T> {
      return undefined as T
    },
    pasteToEditor(text) {
      this.setEditorText(text)
    },
    setEditorText() {},
    getEditorText: () => '',
    async editor() {
      return undefined
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent: () => undefined,
    get theme() {
      return {} as ExtensionUIContext['theme']
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Theme switching is not supported in Sylo chat mode' }),
    getToolsExpanded: () => false,
    setToolsExpanded() {},
  }
}
