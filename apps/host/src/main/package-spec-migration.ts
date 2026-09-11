// Per-package Capability manager cards: expand local-path monorepo bundle
// entries in ~/.pi/agent/settings.json (packages[]) into one entry per
// sub-package.
//
// Why: Pi's packages[] is spec-granular — one entry for a bundle like
// sylo-tools-controls loads/unloads/uninstalls every sub-package together, so
// the Capability manager's per-package cards all flipped together. Each
// sub-package ships its own package.json (pi.extensions / pi.skills), so Pi
// can load each one directly from its own directory; one entry per sub-package
// gives every card independent Enable / Update / Uninstall. Uninstall is safe
// for local paths — Pi's remove() returns early for type "local" (entry
// removal only, files stay on disk).
//
// Runs before every broker spawn; idempotent — sub-package manifests don't
// match the monorepo pattern, so expanded entries are never re-expanded.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/** A monorepo bundle entry only expands when its manifest groups ≥2 sub-packages. */
const MONOREPO_EXPAND_MIN_SUBPACKAGES = 2

/**
 * Sub-package spec strings for a local-path monorepo packages[] entry, or null
 * when the entry is not one. A monorepo entry is a local path whose package.json
 * lists every pi.extensions/pi.skills path under `packages/<id>/` with ≥2
 * distinct sub-packages (e.g. the operator's sylo-tools-controls). npm:/git:
 * specs and single-package bundles are left alone — Pi installs those as one
 * unit.
 */
export function monorepoSubPackageSpecs(agentDir: string, raw: string): string[] | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^(npm:|git:|https?:|ssh:)/i.test(trimmed)) return null
  const abs = resolve(agentDir, trimmed)
  const manifestPath = join(abs, 'package.json')
  if (!existsSync(manifestPath)) return null
  let manifest: { pi?: { extensions?: unknown; skills?: unknown } }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pi?: { extensions?: unknown; skills?: unknown }
    }
  } catch {
    return null
  }
  const paths = [
    ...(Array.isArray(manifest.pi?.extensions) ? manifest.pi.extensions.map(String) : []),
    ...(Array.isArray(manifest.pi?.skills) ? manifest.pi.skills.map(String) : []),
  ]
  if (paths.length === 0) return null
  const subIds = new Set<string>()
  for (const p of paths) {
    const segs = p.replace(/\\/g, '/').split('/')
    let sub: string | null = null
    for (let i = 0; i < segs.length - 1; i++) {
      if (segs[i] === 'packages' && segs[i + 1]) {
        sub = segs[i + 1]
        break
      }
    }
    // Any capability outside packages/<id>/ means this is not a pure monorepo
    // bundle — grouping would strand that capability, so leave the entry alone.
    if (!sub) return null
    subIds.add(sub)
  }
  if (subIds.size < MONOREPO_EXPAND_MIN_SUBPACKAGES) return null
  // Keep the original entry's separator style and relative prefix — Pi resolves
  // entries against the agent dir, so relative sub-package entries behave the
  // same as the bundle entry they replace.
  const sep = trimmed.includes('\\') ? '\\' : '/'
  const base = trimmed.replace(/[\\/]+$/, '')
  return Array.from(subIds)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const spec = `${base}${sep}packages${sep}${id}`
      return existsSync(resolve(agentDir, spec)) ? spec : null
    })
    .filter((s): s is string => s !== null)
}

/**
 * Expand monorepo bundle entries into per-sub-package packages[] entries.
 * Returns true when settings.json was rewritten.
 */
export function migrateMonorepoPackageSpecs(agentDir: string): boolean {
  const settingsPath = join(agentDir, 'settings.json')
  if (!existsSync(settingsPath)) return false
  let settings: Record<string, unknown>
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
  } catch {
    return false
  }
  const packages = Array.isArray(settings.packages)
    ? settings.packages.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    : []
  if (packages.length === 0) return false
  const next: string[] = []
  const seen = new Set<string>()
  const expanded: string[] = []
  let changed = false
  for (const raw of packages) {
    const subs = monorepoSubPackageSpecs(agentDir, raw)
    const add = (spec: string): void => {
      const key = spec.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      next.push(spec)
    }
    if (subs && subs.length >= MONOREPO_EXPAND_MIN_SUBPACKAGES) {
      changed = true
      for (const s of subs) add(s)
      expanded.push(basename(raw.replace(/\\/g, '/')))
    } else {
      add(raw)
    }
  }
  if (!changed) return false
  settings.packages = next
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  console.log(
    `[sylo] packages: expanded monorepo bundle entries into per-package entries (${expanded.join(', ')})`,
  )
  return true
}