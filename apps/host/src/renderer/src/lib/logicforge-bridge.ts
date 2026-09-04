/** Resolve LogicForge IPC from preload (full app restart required after host updates). */

type BridgeFn<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>

function resolveBridge<TArgs extends unknown[], TResult>(
  direct: BridgeFn<TArgs, TResult> | undefined,
  viaSkillSurface: BridgeFn<TArgs, TResult> | undefined,
): BridgeFn<TArgs, TResult> {
  return async (...args: TArgs) => {
    if (direct) return direct(...args)
    if (viaSkillSurface) return viaSkillSurface(...args)
    throw new Error(
      'LogicForge bridge not loaded. Quit Sylo completely (Restart broker is not enough) and run full-build-run-sylo.cmd again.',
    )
  }
}

export async function logicforgeParseRulesGet(): Promise<{
  ok: true
  parse_config_path: string
  settings_path: string
  parse_config: unknown
  settings: unknown
}> {
  const sylo = window.sylo
  return resolveBridge(sylo.logicforge?.parseRulesGet, sylo.skillSurface?.logicforgeParseRulesGet)()
}

export async function logicforgeParseRulesSave(payload: {
  parse_config?: unknown
  settings?: unknown
}): Promise<{ ok: true; parse_config_path: string; settings_path: string }> {
  const sylo = window.sylo
  return resolveBridge(sylo.logicforge?.parseRulesSave, sylo.skillSurface?.logicforgeParseRulesSave)(
    payload,
  )
}

export async function logicforgeParseRulesReset(): Promise<{
  ok: true
  parse_config_path: string
  settings_path: string
  parse_config: unknown
  settings: unknown
}> {
  const sylo = window.sylo
  return resolveBridge(sylo.logicforge?.parseRulesReset, sylo.skillSurface?.logicforgeParseRulesReset)()
}

export async function logicforgeIoReviewGet(payload: { run_dir: string }): Promise<{
  ok: true
  run_dir: string
  path: string
  review: unknown
}> {
  const sylo = window.sylo
  return resolveBridge(sylo.logicforge?.ioReviewGet, sylo.skillSurface?.logicforgeIoReviewGet)(payload)
}

export async function logicforgeIoReviewReseed(payload: {
  run_dir: string
  overwrite?: boolean
}): Promise<{
  ok: true
  run_dir: string
  path: string
  review: unknown
}> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.logicforge?.ioReviewReseed,
    sylo.skillSurface?.logicforgeIoReviewReseed,
  )(payload)
}

export async function logicforgeIoReviewSave(payload: {
  run_dir: string
  review?: unknown
}): Promise<{
  ok: true
  run_dir: string
  path: string
  review: unknown
}> {
  const sylo = window.sylo
  return resolveBridge(sylo.logicforge?.ioReviewSave, sylo.skillSurface?.logicforgeIoReviewSave)(
    payload,
  )
}

export async function logicforgeIoReviewApproveBuild(payload: {
  run_dir: string
  review?: unknown
}): Promise<{
  ok: true
  run_dir: string
  review_path: string
  scaffold: unknown
}> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.logicforge?.ioReviewApproveBuild,
    sylo.skillSurface?.logicforgeIoReviewApproveBuild,
  )(payload)
}

export async function logicforgeDownloadAllowlistGet(): Promise<{
  ok: true
  path: string
  allowlist: unknown
}> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.logicforge?.downloadAllowlistGet,
    sylo.skillSurface?.logicforgeDownloadAllowlistGet,
  )()
}

export async function logicforgeDownloadAllowlistSave(payload: {
  allow_downloads?: boolean
  post_download_mode?: 'program' | 'run'
  ips?: Array<{ ip: string; label?: string; enabled?: boolean }>
  notes?: string
}): Promise<{ ok: true; path: string }> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.logicforge?.downloadAllowlistSave,
    sylo.skillSurface?.logicforgeDownloadAllowlistSave,
  )(payload)
}

export async function logicforgeDownloadPlcStatus(ip: string): Promise<{
  ok: true
  reachable: boolean
  ip: string
  error?: string | null
  keyswitch?: string | null
  mode?: string | null
  key_position?: string | null
  product_name?: string | null
  vendor?: string | null
  in_allowlist?: boolean
}> {
  const sylo = window.sylo
  return resolveBridge(
    sylo.logicforge?.downloadPlcStatus,
    sylo.skillSurface?.logicforgeDownloadPlcStatus,
  )(ip)
}

export async function logicforgeTemplates(
  op: string,
  payload?: Record<string, unknown>,
): Promise<{ ok: true; [key: string]: unknown }> {
  const sylo = window.sylo
  return resolveBridge(sylo.logicforge?.templates, sylo.skillSurface?.logicforgeTemplates)(op, payload)
}
