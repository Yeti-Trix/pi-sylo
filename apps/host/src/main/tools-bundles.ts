// Resolve operator-installed tools bundles (sylo-tools-controls, sylo-tools-
// onenote) — same pattern as personal-plugin.ts, minus the plugin contract.
//
// Some extracted packages still have host main-process handlers that reach
// into their package dirs (LogicForge parse rules + download allowlist,
// FieldBrain config/scripts, OneNote scripts). Those handlers resolve the
// package through this module so the bundle can live outside the sylo-dev
// repo. Resolution order per bundle:
//   1. env override (SYLO_TOOLS_CONTROLS_DIR / SYLO_TOOLS_ONENOTE_DIR)
//   2. ~/.pi/agent/settings.json packages[] entry matching the bundle name
//   3. Default dev location: ~/Documents/GitHub/<bundle>
// resolveToolsPackageDir() then falls back to the legacy in-repo layout
// (<sylo-dev repo>/packages/<name>) for any install that hasn't migrated.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const BUNDLE_ENV: Record<string, string> = {
  'sylo-tools-controls': 'SYLO_TOOLS_CONTROLS_DIR',
  'sylo-tools-onenote': 'SYLO_TOOLS_ONENOTE_DIR',
}

/** Find an installed tools bundle dir, or null when not installed. */
export function resolveToolsBundleDir(bundleName: string): string | null {
  const envName = BUNDLE_ENV[bundleName]
  const env = envName ? process.env[envName]?.trim() : ''
  if (env) {
    const abs = resolve(env)
    if (existsSync(abs)) return abs
  }
  try {
    const settingsPath = join(homedir(), '.pi', 'agent', 'settings.json')
    if (existsSync(settingsPath)) {
      const req = createRequire(import.meta.url)
      const raw = req(settingsPath) as { packages?: string[] }
      const entry = raw.packages?.find((p) => basename(p.replace(/\\/g, '/')) === bundleName)
      if (entry) {
        const abs = resolve(settingsPath, '..', entry)
        if (existsSync(abs)) return abs
      }
    }
  } catch {
    /* settings unreadable — fall through */
  }
  const fallback = join(homedir(), 'Documents', 'GitHub', bundleName)
  return existsSync(fallback) ? fallback : null
}

/**
 * Resolve a tool package dir: prefer the installed external bundle
 * (<bundle>/packages/<name>), fall back to the legacy in-repo path.
 */
export function resolveToolsPackageDir(
  repoRoot: string,
  bundleName: string,
  packageName: string,
): string {
  const bundle = resolveToolsBundleDir(bundleName)
  if (bundle) {
    const pkg = join(bundle, 'packages', packageName)
    if (existsSync(pkg)) return pkg
  }
  return join(repoRoot, 'packages', packageName)
}