// Resolve skill folders that live inside operator-installed local-path packages
// (Custom/ bundles). Pi records those packages in settings.json; Sylo's sidebar
// menus only scanned ~/.pi/agent/skills, so an import that skipped `pi install`
// never produced Dashboards / Tools entries.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

function readPackageJson(dir: string): { pi?: { skills?: unknown } } | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      pi?: { skills?: unknown }
    }
  } catch {
    return null
  }
}

export function skillDirsInPackage(pkgDir: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (dir: string): void => {
    const abs = resolve(dir)
    const key = abs.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) return
    if (!existsSync(join(abs, 'SKILL.md'))) return
    seen.add(key)
    out.push(abs)
  }
  const skillsRoot = join(pkgDir, 'skills')
  if (existsSync(skillsRoot) && statSync(skillsRoot).isDirectory()) {
    for (const ent of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (ent.isDirectory()) add(join(skillsRoot, ent.name))
    }
  }
  const declared = readPackageJson(pkgDir)?.pi?.skills
  if (Array.isArray(declared)) {
    for (const raw of declared) {
      if (typeof raw !== 'string' || !raw.trim()) continue
      add(resolve(pkgDir, raw.trim()))
    }
  }
  return out
}

/** Bundle root plus packages/<id> sub-packages. */
export function skillDirsInPackageTree(rootDir: string): string[] {
  const dirs = skillDirsInPackage(rootDir)
  const packages = join(rootDir, 'packages')
  if (!existsSync(packages) || !statSync(packages).isDirectory()) return dirs
  const seen = new Set(dirs.map((d) => d.replace(/\\/g, '/').toLowerCase()))
  for (const ent of readdirSync(packages, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const pkg = join(packages, ent.name)
    if (!existsSync(join(pkg, 'package.json'))) continue
    for (const dir of skillDirsInPackage(pkg)) {
      const key = dir.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      dirs.push(dir)
    }
  }
  return dirs
}

export function listSettingsLocalPackageDirs(agentDir: string): string[] {
  const settingsPath = join(agentDir, 'settings.json')
  if (!existsSync(settingsPath)) return []
  let packages: unknown
  try {
    packages = (JSON.parse(readFileSync(settingsPath, 'utf8')) as { packages?: unknown }).packages
  } catch {
    return []
  }
  if (!Array.isArray(packages)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const spec of packages) {
    if (typeof spec !== 'string') continue
    const trimmed = spec.trim()
    if (!trimmed || /^(npm:|git:|https?:|ssh:|file:)/i.test(trimmed)) continue
    const abs = resolve(agentDir, trimmed)
    const key = abs.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key) || !existsSync(abs) || !statSync(abs).isDirectory()) continue
    seen.add(key)
    out.push(abs)
  }
  return out
}

export function listLocalPackageSkillDirs(agentDir: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const pkgDir of listSettingsLocalPackageDirs(agentDir)) {
    for (const dir of skillDirsInPackageTree(pkgDir)) {
      const key = dir.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(dir)
    }
  }
  return out
}

export function skillFolderName(skillDir: string): string {
  return basename(skillDir)
}
