/**
 * App update checker — informs only, never auto-updates.
 *
 * Sylo is distributed as a git clone of the public repo (Yeti-Trix/pi-sylo);
 * users update with `git pull` + `npm install` + restart. There are no GitHub
 * Releases/installers, so "latest available" = the `version` field of the
 * public repo's root package.json on main (bumped by the publish scripts).
 *
 * Check cadence: once ~30s after launch, then every 12h while running. Each
 * completed check pushes the status to the renderer (`app:update-status`), so
 * the banner reacts without polling. Failures (offline, GitHub down) are
 * recorded in the status and surface only in the manual menu path.
 */
import { app, type BrowserWindow } from 'electron'
import type { AppUpdateStatus } from '../shared/app-update-types.js'

export type { AppUpdateStatus }

const SYLO_PUBLIC_REPO_URL = 'https://github.com/Yeti-Trix/pi-sylo'
const SYLO_PUBLIC_VERSION_URL = 'https://raw.githubusercontent.com/Yeti-Trix/pi-sylo/main/package.json'

/** Launch-time check delay (let broker startup claim the network first). */
const INITIAL_CHECK_DELAY_MS = 30_000
/** Periodic re-check while the app stays open. */
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
/** Per-request timeout for the raw.githubusercontent fetch. */
const FETCH_TIMEOUT_MS = 10_000

let status: AppUpdateStatus = {
  currentVersion: '',
  latestVersion: null,
  isUpdateAvailable: false,
  checkedAt: null,
  error: null,
}

let started = false
let checking = false
let getMainWindow: () => BrowserWindow | null | undefined = () => null

/** Numeric x.y.z compare; ignores a leading `v` and any prerelease suffix
 *  (the publish flow only produces plain x.y.z anyway). Returns >0 when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.+-]/)
  const pb = b.replace(/^v/i, '').split(/[.+-]/)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? '0', 10) || 0
    const nb = Number.parseInt(pb[i] ?? '0', 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

async function fetchLatestVersion(): Promise<{ version: string | null; error: string | null }> {
  try {
    const res = await fetch(SYLO_PUBLIC_VERSION_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json', 'user-agent': 'Sylo-Desktop-Update-Check' },
    })
    if (!res.ok) return { version: null, error: `GitHub responded HTTP ${res.status}` }
    const body = (await res.json()) as { version?: unknown }
    if (typeof body?.version !== 'string' || body.version.length === 0) {
      return { version: null, error: 'public package.json has no version field' }
    }
    return { version: body.version, error: null }
  } catch (err) {
    return { version: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return { ...status, currentVersion: status.currentVersion || app.getVersion() }
}

function notifyRenderer(): void {
  const mw = getMainWindow()
  if (mw && !mw.isDestroyed()) mw.webContents.send('app:update-status', getAppUpdateStatus())
}

/** Run one check now (skips while a check is already in flight). */
export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  if (checking) return getAppUpdateStatus()
  checking = true
  try {
    const { version, error } = await fetchLatestVersion()
    status = {
      currentVersion: app.getVersion(),
      latestVersion: version,
      isUpdateAvailable: !!version && compareVersions(version, app.getVersion()) > 0,
      checkedAt: Date.now(),
      error,
    }
  } finally {
    checking = false
  }
  notifyRenderer()
  return getAppUpdateStatus()
}

/** Start the launch check + 12h interval. Safe to call once at app ready. */
export function startAppUpdateChecker(getMainWin: () => BrowserWindow | null | undefined): void {
  if (started) return
  started = true
  getMainWindow = getMainWin
  const tick = (): void => {
    void checkForAppUpdate().catch(() => {})
  }
  setTimeout(tick, INITIAL_CHECK_DELAY_MS).unref?.()
  setInterval(tick, CHECK_INTERVAL_MS).unref?.()
}