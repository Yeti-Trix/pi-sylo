/**
 * Installed-build concerns: keeping user data where it already is, and
 * refreshing the bundled skills that `npm run prepare:dev` normally installs.
 *
 * Sylo ships two ways. A dev clone runs `electron-vite dev` against
 * apps/host, so Electron reads apps/host/package.json and names the app
 * "@sylo/host". The NSIS build runs against a staged payload whose manifest is
 * named "sylo" (see scripts/stage-package.mjs). Electron derives userData from
 * the app name, so that rename alone would move every chat, credential, and
 * preference to a fresh empty directory. Both builds therefore pin userData
 * explicitly to the historical location.
 */
import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Where Sylo has always kept its user data: %APPDATA%\@sylo\host on Windows,
 * ~/Library/Application Support/@sylo/host on macOS. Derived historically from
 * the "@sylo/host" package name, now stated outright so packaging changes can
 * never move it.
 */
export function syloUserDataDir(): string {
  // Escape hatch for running an isolated instance against throwaway data —
  // smoke-testing an installer build without touching the real chat history,
  // or keeping Sylo's data on another drive. Unset for normal use.
  const override = process.env.SYLO_USER_DATA_DIR?.trim()
  if (override) return resolve(override)
  return join(app.getPath('appData'), '@sylo', 'host')
}

/**
 * Pin userData before anything reads it. Must be called before `app.whenReady`
 * and before the first `app.getPath('userData')` — Electron caches the value
 * and Chromium creates its own subdirectories there during startup.
 *
 * A no-op on dev clones, where the app name already resolves to the same path.
 */
export function pinSyloUserDataDir(): void {
  const desired = syloUserDataDir()
  try {
    if (app.getPath('userData') === desired) return
    app.setPath('userData', desired)
    console.info(`[sylo] userData pinned to ${desired}`)
  } catch (err) {
    // Losing this would strand the user's chats in a new directory, so it is
    // worth a loud warning even though there is nothing to fall back to.
    console.error('[sylo] could not pin the userData directory:', err)
  }
}

/** Pref key holding the app version whose bundled skills are already installed. */
const BOOTSTRAP_VERSION_PREF = 'sylo.packaged.bootstrap_version'

type PrefStore = {
  getPref: <T>(key: string, fallback: T) => T
  setPref: (key: string, value: unknown) => void
}

/**
 * Install the bundled skills into the Pi agent directory after a fresh install
 * or an upgrade.
 *
 * On a dev clone this is `npm run prepare:dev`'s bootstrap-pi step. An
 * installed build has no npm and no build step, so the app runs the same
 * script itself — through `process.execPath` with ELECTRON_RUN_AS_NODE, the
 * way the broker child is spawned.
 *
 * Gated on the app version rather than run every launch: the script rewrites
 * every bundled SKILL.md and route asset, and there is no reason to spend those
 * writes when the payload has not changed. Only app-owned skill directories are
 * touched — user-authored skills live under their own names and are untouched.
 */
export function syncBundledSkills(repoRoot: string, agentDir: string, prefs: PrefStore): void {
  if (!app.isPackaged) return
  const version = app.getVersion()
  if (prefs.getPref<string>(BOOTSTRAP_VERSION_PREF, '') === version) return

  const script = join(repoRoot, 'scripts', 'bootstrap-pi.mjs')
  if (!existsSync(script)) {
    console.warn(`[sylo] bundled-skill bootstrap skipped — ${script} is not in the payload`)
    return
  }
  const started = Date.now()
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SYLO_PI_AGENT_DIR: agentDir },
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
  if (result.status === 0) {
    prefs.setPref(BOOTSTRAP_VERSION_PREF, version)
    console.info(`[sylo] bundled skills installed for ${version} in ${Date.now() - started}ms`)
    return
  }
  // Leave the pref unset so the next launch retries. The app still runs —
  // missing bundled skills degrade features rather than blocking startup.
  console.error(
    `[sylo] bundled-skill bootstrap failed (status ${String(result.status)}): ` +
      `${(result.stderr || result.stdout || '').trim().slice(-2000)}`,
  )
}
