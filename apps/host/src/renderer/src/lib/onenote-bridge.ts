/** Resolve OneNote IPC from preload (full app restart required after host updates). */

type BridgeFn<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>

function resolveBridge<TArgs extends unknown[], TResult>(
  direct: BridgeFn<TArgs, TResult> | undefined,
  viaSkillSurface: BridgeFn<TArgs, TResult> | undefined,
): BridgeFn<TArgs, TResult> {
  return async (...args: TArgs) => {
    if (direct) return direct(...args)
    if (viaSkillSurface) return viaSkillSurface(...args)
    throw new Error(
      'OneNote bridge not loaded. Quit Sylo completely and run full-build-run-sylo.cmd again.',
    )
  }
}

export async function onenoteAuthStatus(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.authStatus, sylo.skillSurface?.onenoteAuthStatus)()
}

export async function onenoteAuthStart(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.authStart, sylo.skillSurface?.onenoteAuthStart)()
}

export async function onenoteAuthComplete(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.authComplete, sylo.skillSurface?.onenoteAuthComplete)()
}

export async function onenoteAuthLogout(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.authLogout, sylo.skillSurface?.onenoteAuthLogout)()
}

export async function onenoteSettingsGet(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.settingsGet, sylo.skillSurface?.onenoteSettingsGet)()
}

export async function onenoteSettingsSave(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.settingsSave, sylo.skillSurface?.onenoteSettingsSave)(payload)
}

export async function onenoteNotebookList(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.notebookList, sylo.skillSurface?.onenoteNotebookList)()
}

export async function onenoteIndexSync(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.indexSync, sylo.skillSurface?.onenoteIndexSync)()
}

export async function onenoteIndexProgress(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.onenote?.indexProgress, sylo.skillSurface?.onenoteIndexProgress)()
}

export async function onenoteImportLegacyCache(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.onenote?.importLegacyCache,
    sylo.skillSurface?.onenoteImportLegacyCache,
  )()
}
