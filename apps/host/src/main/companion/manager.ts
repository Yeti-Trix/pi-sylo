import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, shell } from 'electron'

import { clearCompanionSessions } from './auth.js'
import {
  companionPublicUrls,
  startCompanionServer,
  type CompanionServerHandle,
} from './server.js'
import {
  ensureCompanionTlsMaterial,
  getCompanionTlsTrustInfo,
  readCompanionPublicFqdn,
  type CompanionTlsTrustInfo,
} from './tls.js'
import {
  hasCompanionCredentials,
  readCompanionPrefs,
  setCompanionCredentials,
  writeCompanionPrefs,
  type CompanionBindMode,
  type CompanionPrefs,
} from './prefs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let active: CompanionServerHandle | undefined
let personalAppRootFn: (() => string) | null = null

/** Resolved at request time so agent dir changes apply without restart. */
export function setPersonalAppRoot(fn: () => string): void {
  personalAppRootFn = fn
}

/** Built UI from `npm run build:companion` → `apps/host/out/companion/`. Main is a single bundle at `out/main/index.js`, so resolve from host package root — not `../../companion` (that misses `out/`). */
function companionStaticRoot(): string {
  const fromMainBundle = join(__dirname, '..', 'companion')
  if (existsSync(join(fromMainBundle, 'index.html'))) return fromMainBundle
  const hostRoot = join(__dirname, '..', '..')
  return join(hostRoot, 'out', 'companion')
}

export type CompanionStatus = {
  enabled: boolean
  running: boolean
  port: number
  bind: CompanionBindMode
  username: string
  hasCredentials: boolean
  staticRoot: string
  staticBuilt: boolean
  urls: ReturnType<typeof companionPublicUrls>
  tls: CompanionTlsTrustInfo
}

export function getCompanionStatus(): CompanionStatus {
  const prefs = readCompanionPrefs()
  const staticRoot = companionStaticRoot()
  return {
    enabled: prefs.enabled,
    running: active !== undefined,
    port: prefs.port,
    bind: prefs.bind,
    username: prefs.username,
    hasCredentials: hasCompanionCredentials(prefs),
    staticRoot,
    staticBuilt: existsSync(join(staticRoot, 'index.html')),
        urls: companionPublicUrls(
      prefs.port,
      prefs.bind,
      readCompanionPublicFqdn(app.getPath('userData')),
    ),
    tls: getCompanionTlsTrustInfo(app.getPath('userData')),
  }
}

export function openCompanionCertsFolder(): void {
  const info = getCompanionTlsTrustInfo(app.getPath('userData'))
  void shell.openPath(info.certsDir)
}

export async function applyCompanionConfig(patch: {
  enabled?: boolean
  bind?: CompanionBindMode
  port?: number
}): Promise<CompanionStatus | { ok: false; error: string }> {
  const current = readCompanionPrefs()
  if (patch.enabled === true && !hasCompanionCredentials(current)) {
    return { ok: false, error: 'credentials_required' }
  }
  const next = writeCompanionPrefs(patch)
  await restartCompanionServer(next)
  return getCompanionStatus()
}

export async function saveCompanionCredentials(
  username: string,
  password: string,
): Promise<CompanionStatus | { ok: false; error: string }> {
  try {
    setCompanionCredentials(username, password)
    clearCompanionSessions()
    await restartCompanionServer(readCompanionPrefs())
    return getCompanionStatus()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'username_required' || msg === 'password_required') {
      return { ok: false, error: msg }
    }
    throw e
  }
}

export async function restartCompanionServer(prefs?: CompanionPrefs): Promise<void> {
  if (active) {
    await active.close()
    active = undefined
  }
  const cfg = prefs ?? readCompanionPrefs()
  if (!cfg.enabled) return
  if (!hasCompanionCredentials(cfg)) {
    console.warn('[sylo companion] enabled but login not configured — set username/password in Settings')
    return
  }
  const staticRoot = companionStaticRoot()
  if (!existsSync(join(staticRoot, 'index.html'))) {
    console.warn('[sylo companion] UI not built at', staticRoot, '— run npm run build:companion')
    return
  }
  try {
    const tls = await ensureCompanionTlsMaterial(app.getPath('userData'), cfg.bind)
    active = startCompanionServer({
      staticRoot,
      prefs: cfg,
      tls,
      userDataPath: app.getPath('userData'),
      personalAppRoot: personalAppRootFn ?? undefined,
    })
        const urls = companionPublicUrls(
      cfg.port,
      cfg.bind,
      readCompanionPublicFqdn(app.getPath('userData')),
    )
    console.info(
      '[sylo companion] listening',
      urls.loopback,
      urls.fqdn ?? '',
      cfg.bind === 'lan' ? urls.lan.join(' ') : '',
    )
  } catch (e) {
    console.error('[sylo companion] failed to start:', e)
  }
}

export async function stopCompanionServer(): Promise<void> {
  if (!active) return
  await active.close()
  active = undefined
}
