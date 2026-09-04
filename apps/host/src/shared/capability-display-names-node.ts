import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { resolvePackageRootFromExtensionPath } from './bundled-skill-discovery.js'
import { deriveExtensionDisplayName as deriveExtensionDisplayNameFromPath } from './capability-display-names.js'

function displayNameFromPackageJsonName(name: string): string {
  const slash = name.lastIndexOf('/')
  if (name.startsWith('@') && slash > 0) return name.slice(slash + 1)
  return name
}

function packageDisplayNameFromRoot(packageRoot: string): string | null {
  try {
    const pkgJson = join(packageRoot, 'package.json')
    if (!existsSync(pkgJson)) return null
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8')) as { name?: string }
    if (typeof pkg.name === 'string' && pkg.name.trim()) {
      return displayNameFromPackageJsonName(pkg.name.trim())
    }
  } catch {
    /* unreadable package.json */
  }
  return null
}

/**
 * Broker-side extension label: path heuristics first, then package.json walk for
 * monorepo / dev paths that omit `/node_modules/` in the reported path.
 */
export function deriveExtensionDisplayName(path: string): string {
  const fromPath = deriveExtensionDisplayNameFromPath(path)
  if (fromPath !== 'index' && fromPath !== 'extension' && fromPath !== '(unknown)') {
    return fromPath
  }

  const packageRoot = resolvePackageRootFromExtensionPath(path)
  if (!packageRoot) return fromPath

  const fromPkg = packageDisplayNameFromRoot(packageRoot)
  if (fromPkg) return fromPkg

  const folder = basename(packageRoot)
  return folder || fromPath
}
