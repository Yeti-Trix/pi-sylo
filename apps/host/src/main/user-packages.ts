// Generic user-installed Pi packages — the "personal packages" card surface.
//
// Reads the operator's user-level `packages[]` from ~/.pi/agent/settings.json
// (exactly what `pi install <path|npm:...>` appends) and resolves each entry to
// on-disk metadata from its package.json. The host owns no package names: any
// package the operator installs — personal bundles, community tools, npm
// packages — shows up here. Always-on by design: Pi loads them in every
// workspace at broker start; there is no per-package toggle.
//
// Sylo builtin/optional packages are NOT listed — they ship in the Sylo repo
// and are toggled in Capability manager → Sylo optional packages, never via
// settings.json.
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export type UserPackageInfo = {
  /** Raw settings.json entry, e.g. `npm:pi-mcp-adapter` or a relative/absolute path. */
  spec: string
  /** From the resolved package.json (falls back to the spec's basename). */
  name: string
  version: string | null
  description: string | null
  /** Absolute on-disk directory, or null when unresolvable. */
  resolvedPath: string | null
  /** True when resolvedPath exists on disk. */
  exists: boolean
}

type SettingsJson = { packages?: string[] }

/** Resolve one settings.json packages[] entry to an on-disk directory, or null. */
function resolvePackageDir(agentDir: string, spec: string): string | null {
  const trimmed = spec.trim()
  if (!trimmed) return null
  // npm:<name> — pi installs globals under <agentDir>/npm/node_modules/<name>
  if (trimmed.toLowerCase().startsWith('npm:')) {
    const name = trimmed.slice(4).trim()
    if (!name) return null
    return join(agentDir, 'npm', 'node_modules', ...name.split('/'))
  }
  // Local paths — relative entries resolve against the settings dir (same rule Pi uses).
  return resolve(agentDir, trimmed)
}

function readPackageMeta(dir: string): { name: string | null; version: string | null; description: string | null } {
  try {
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) return { name: null, version: null, description: null }
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: unknown
      version?: unknown
      description?: unknown
    }
    return {
      name: typeof raw.name === 'string' ? raw.name : null,
      version: typeof raw.version === 'string' ? raw.version : null,
      description: typeof raw.description === 'string' ? raw.description : null,
    }
  } catch {
    return { name: null, version: null, description: null }
  }
}

/** List the operator's user-installed Pi packages (empty when none/unreadable). */
export function readUserPackages(agentDir: string): UserPackageInfo[] {
  if (!agentDir) return []
  let settings: SettingsJson
  try {
    const settingsPath = join(agentDir, 'settings.json')
    if (!existsSync(settingsPath)) return []
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as SettingsJson
  } catch {
    return []
  }
  const specs = Array.isArray(settings.packages) ? settings.packages : []
  const out: UserPackageInfo[] = []
  for (const spec of specs) {
    if (typeof spec !== 'string' || !spec.trim()) continue
    const dir = resolvePackageDir(agentDir, spec)
    const exists = !!dir && existsSync(dir)
    const meta = exists && dir ? readPackageMeta(dir) : { name: null, version: null, description: null }
    out.push({
      spec,
      name: meta.name ?? (basename(spec.replace(/\\/g, '/')).replace(/^npm:/, '') || spec),
      version: meta.version,
      description: meta.description,
      resolvedPath: dir,
      exists,
    })
  }
  return out
}