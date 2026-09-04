import { PI_BUILTIN_TOOL_IDS, type PiBuiltinToolsPref } from './pi-builtin-tools.js'

export type SyloBuiltinExtensionKind = 'skill-surface' | 'subagents' | 'scheduler' | 'tools-guard'

export function normalizePathForBuiltinMatch(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

export function classifySyloBuiltinExtension(path: string): SyloBuiltinExtensionKind | null {
  const norm = normalizePathForBuiltinMatch(path)
  if (!norm) return null
  if (
    norm.includes('/packages/skill-surface-extension/') ||
    norm.endsWith('/packages/skill-surface-extension/src/index.ts')
  ) {
    return 'skill-surface'
  }
  if (
    norm.includes('/packages/sylo-subagents/') ||
    norm.endsWith('/packages/sylo-subagents/extensions/index.ts')
  ) {
    return 'subagents'
  }
  if (
    norm.includes('/packages/sylo-scheduler/') ||
    norm.endsWith('/packages/sylo-scheduler/extensions/index.ts')
  ) {
    return 'scheduler'
  }
  if (norm.includes('sylo-builtin-tools-guard')) {
    return 'tools-guard'
  }
  return null
}

export function isSyloBuiltinExtensionPath(path: string): boolean {
  return classifySyloBuiltinExtension(path) !== null
}

export function syloBuiltinExtensionHint(kind: SyloBuiltinExtensionKind): string {
  switch (kind) {
    case 'skill-surface':
      return (
        'Registers show_canvas (native SVG/Mermaid panel) and show_widget (Discussion #317 sandbox iframe). ' +
        'You can disable this extension; widget skills fall back to fallback.md prose.'
      )
    case 'subagents':
      return (
        'Registers subagent — delegate to scout/planner/worker/reviewer child Pi sessions. ' +
        'Sylo chat UI (when enabled) observes sylo_subagent lifecycle events for inline run blocks.'
      )
    case 'scheduler':
      return (
        'Registers schedule_list/create/update/delete - workspace-scoped prompt schedules. ' +
        'Host fires due schedules as new chats; optional startup catchup.'
      )
    case 'tools-guard':
      return (
        'Enforces Pi built-in tool toggles (section above) at execution time. ' +
        'You can disable it, but restrictions above will not be enforced while it is off.'
      )
  }
}

/** True when Pi built-in tool prefs would block at least one built-in tool. */
export function piBuiltinToolsEnforcementActive(pref: PiBuiltinToolsPref): boolean {
  if (!pref.enabled) return true
  return PI_BUILTIN_TOOL_IDS.some((id) => !pref.tools[id])
}

export function findBuiltinToolsGuardExtension(
  extensions: { path: string; resolvedPath?: string; excludedFromAgent?: boolean }[],
): { path: string; excludedFromAgent: boolean } | undefined {
  for (const ext of extensions) {
    const kind = classifySyloBuiltinExtension(ext.resolvedPath ?? ext.path)
    if (kind === 'tools-guard') {
      return { path: ext.path, excludedFromAgent: !!ext.excludedFromAgent }
    }
  }
  return undefined
}
