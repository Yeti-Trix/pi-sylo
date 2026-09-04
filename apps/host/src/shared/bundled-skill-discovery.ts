import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { normalizeSyloCapabilityPath } from './sylo-capability-paths.js'

const CONFIG_DIR = '.pi'

/** Workspace / SDK packages we walk through when resolving an extension file path. */
const TRANSPARENT_PACKAGE_PREFIXES = ['@earendil-works/']

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

function readPackagesFromSettingsFile(path: string): string[] {
  if (!existsSync(path)) return []
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8')) as { packages?: unknown }
    if (!Array.isArray(j.packages)) return []
    return j.packages.map(String).filter((s) => s.trim().length > 0)
  } catch {
    return []
  }
}

/** Enabled Pi package specs from agent + project settings (deduped). */
export function readPiPackageSpecs(agentDir: string, projectCwd: string): string[] {
  const agent = expandHome(agentDir)
  const cwd = expandHome(projectCwd)
  const merged = [
    ...readPackagesFromSettingsFile(join(agent, 'settings.json')),
    ...readPackagesFromSettingsFile(join(cwd, CONFIG_DIR, 'settings.json')),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const spec of merged) {
    const key = spec.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(spec.trim())
  }
  return out
}

function npmPackageNameFromSpec(spec: string): string | null {
  const t = spec.trim()
  if (!t.toLowerCase().startsWith('npm:')) return null
  const name = t.slice('npm:'.length).trim()
  return name.length > 0 ? name : null
}

function globalNpmNodeModulesRoot(): string | null {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData) return join(appData, 'npm', 'node_modules')
  }
  const home = homedir()
  return join(home, '.npm-global', 'lib', 'node_modules')
}

/** Candidate install roots for `npm:packageName` (first existing wins). */
export function resolveNpmPackageRoots(
  packageName: string,
  agentDir: string,
  projectCwd: string,
): string[] {
  const agent = expandHome(agentDir)
  const cwd = expandHome(projectCwd)
  const candidates = [
    join(agent, 'npm', 'node_modules', packageName),
    join(cwd, CONFIG_DIR, 'npm', 'node_modules', packageName),
  ]
  const globalRoot = globalNpmNodeModulesRoot()
  if (globalRoot) candidates.push(join(globalRoot, packageName))
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of candidates) {
    const abs = resolve(c)
    const norm = abs.toLowerCase()
    if (seen.has(norm)) continue
    seen.add(norm)
    if (existsSync(abs)) out.push(abs)
  }
  return out
}

function isTransparentPackageName(name: string): boolean {
  return TRANSPARENT_PACKAGE_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * Walk up from an extension entry file to the npm/git package root (first package.json
 * whose name is not a workspace-internal @earendil-works/* shim).
 */
export function resolvePackageRootFromExtensionPath(extensionPath: string): string | null {
  let dir = dirname(resolve(expandHome(extensionPath)))
  const root = resolve(dir, '..') === dir ? dir : undefined
  while (true) {
    const pkgJson = join(dir, 'package.json')
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8')) as { name?: string }
        const name = typeof pkg.name === 'string' ? pkg.name : ''
        if (name && isTransparentPackageName(name)) {
          const parent = dirname(dir)
          if (parent === dir) return null
          dir = parent
          continue
        }
        return dir
      } catch {
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
    if (root !== undefined && dir === root) break
  }
  return null
}

/** `<pkgRoot>/skills/<name>/SKILL.md` for each immediate child folder. */
export function discoverBundledSkillPathsFromPackageRoot(packageRoot: string): string[] {
  const skillsDir = join(resolve(packageRoot), 'skills')
  if (!existsSync(skillsDir)) return []
  const out: string[] = []
  for (const ent of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const skillMd = join(skillsDir, ent.name, 'SKILL.md')
    if (existsSync(skillMd)) out.push(resolve(skillMd))
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function dedupeNormalizedPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const norm = normalizeSyloCapabilityPath(p)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push(resolve(p))
  }
  return out
}

export function discoverBundledSkillPathsFromExtensionPaths(extensionPaths: string[]): string[] {
  const collected: string[] = []
  for (const extPath of extensionPaths) {
    const root = resolvePackageRootFromExtensionPath(extPath)
    if (!root) continue
    collected.push(...discoverBundledSkillPathsFromPackageRoot(root))
  }
  return dedupeNormalizedPaths(collected)
}

/** Skills shipped under packageRoot/skills for each enabled npm package in Pi settings. */
export function discoverBundledSkillPathsFromPiPackages(
  agentDir: string,
  projectCwd: string,
): string[] {
  const collected: string[] = []
  for (const spec of readPiPackageSpecs(agentDir, projectCwd)) {
    const npmName = npmPackageNameFromSpec(spec)
    if (!npmName) continue
    for (const root of resolveNpmPackageRoots(npmName, agentDir, projectCwd)) {
      collected.push(...discoverBundledSkillPathsFromPackageRoot(root))
    }
  }
  return dedupeNormalizedPaths(collected)
}

export function discoverBundledSkillPaths(
  extensionPaths: string[],
  agentDir: string,
  projectCwd: string,
): string[] {
  return dedupeNormalizedPaths([
    ...discoverBundledSkillPathsFromExtensionPaths(extensionPaths),
    ...discoverBundledSkillPathsFromPiPackages(agentDir, projectCwd),
  ])
}
