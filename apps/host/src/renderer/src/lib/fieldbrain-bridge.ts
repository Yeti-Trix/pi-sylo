/** Resolve FieldBrain IPC from preload (full app restart required after host updates). */

type BridgeFn<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>

function resolveBridge<TArgs extends unknown[], TResult>(
  direct: BridgeFn<TArgs, TResult> | undefined,
  viaSkillSurface: BridgeFn<TArgs, TResult> | undefined,
): BridgeFn<TArgs, TResult> {
  return async (...args: TArgs) => {
    if (direct) return direct(...args)
    if (viaSkillSurface) return viaSkillSurface(...args)
    throw new Error(
      'FieldBrain bridge not loaded. Quit Sylo completely (Restart broker is not enough) and run full-build-run-sylo.cmd again.',
    )
  }
}

export type FieldBrainConfigPayload = {
  dbMode?: 'local' | 'remote'
  postgresHost?: string
  postgresPort?: number
  postgresDatabase?: string
  postgresUsername?: string
  postgresPassword?: string
  ollamaUrl?: string
}

export async function fieldbrainConfigGet(): Promise<{
  ok: true
  config: FieldBrainConfigPayload & { postgresPassword: string }
  databaseConfigPath: string
  guidedSetup: string[]
}> {
  const sylo = window.sylo
  return resolveBridge(sylo.fieldbrain?.configGet, sylo.skillSurface?.fieldbrainConfigGet)() as Promise<{
    ok: true
    config: FieldBrainConfigPayload & { postgresPassword: string }
    databaseConfigPath: string
    guidedSetup: string[]
  }>
}

export async function fieldbrainConfigSave(payload: FieldBrainConfigPayload): Promise<
  | {
      ok: true
      config: FieldBrainConfigPayload & { postgresPassword: string }
      databaseConfigPath: string
    }
  | { ok: false; error: string }
> {
  const sylo = window.sylo
  return resolveBridge(sylo.fieldbrain?.configSave, sylo.skillSurface?.fieldbrainConfigSave)(
    payload,
  ) as Promise<
    | {
        ok: true
        config: FieldBrainConfigPayload & { postgresPassword: string }
        databaseConfigPath: string
      }
    | { ok: false; error: string }
  >
}

export async function fieldbrainDbCheck(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.fieldbrain?.dbCheck, sylo.skillSurface?.fieldbrainDbCheck)()
}

export async function fieldbrainDbMigrate(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.fieldbrain?.dbMigrate, sylo.skillSurface?.fieldbrainDbMigrate)()
}

export async function fieldbrainLogList(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.fieldbrain?.logList, sylo.skillSurface?.fieldbrainLogList)()
}

export async function fieldbrainDocumentList(
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.fieldbrain?.documentList,
    sylo.skillSurface?.fieldbrainDocumentList,
  )(payload ?? {})
}

export async function fieldbrainBrainList(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.fieldbrain?.brainList, sylo.skillSurface?.fieldbrainBrainList)(
    payload,
  )
}

export async function fieldbrainProjectList(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.fieldbrain?.projectList,
    sylo.skillSurface?.fieldbrainProjectList,
  )()
}

export async function fieldbrainProjectCreate(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.fieldbrain?.projectCreate,
    sylo.skillSurface?.fieldbrainProjectCreate,
  )(payload)
}

export type FieldBrainBootstrapPayload = FieldBrainConfigPayload & {
  adminUsername?: string
  adminPassword: string
  appPassword?: string
}

export async function fieldbrainDbBootstrap(
  payload: FieldBrainBootstrapPayload,
): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(sylo.fieldbrain?.dbBootstrap, sylo.skillSurface?.fieldbrainDbBootstrap)(
    payload,
  )
}

export async function fieldbrainPgvectorGuide(): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.fieldbrain?.pgvectorGuide,
    sylo.skillSurface?.fieldbrainPgvectorGuide,
  )()
}

export type FieldBrainPgvectorInstallPayload = FieldBrainBootstrapPayload & {
  sourcePath?: string
  skipFileCopy?: boolean
}

export async function fieldbrainPgvectorInstallFromFolder(
  payload: FieldBrainPgvectorInstallPayload,
): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.fieldbrain?.pgvectorInstallFromFolder,
    sylo.skillSurface?.fieldbrainPgvectorInstallFromFolder,
  )(payload)
}

export async function fieldbrainPgvectorEnable(
  payload: FieldBrainBootstrapPayload,
): Promise<Record<string, unknown>> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.fieldbrain?.pgvectorEnable,
    sylo.skillSurface?.fieldbrainPgvectorEnable,
  )(payload)
}
