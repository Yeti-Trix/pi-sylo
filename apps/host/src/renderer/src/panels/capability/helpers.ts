import { npmPackageFolderFromPath } from '../../../../shared/capability-display-names.js'

export function npmSpecsSharingInstall(pkg: string): string[] {
  const row = KNOWN_PACKAGES.find((p) => p.canonical === pkg || p.aliases?.includes(pkg))
  if (row) return [row.canonical, ...(row.aliases ?? [])]
  return [pkg]
}

export function extensionMatchesPackageSpec(extPath: string, npmSpec: string): boolean {
  if (npmSpecsSharingInstall(npmSpec).some((s) => extensionPathMatchesPackageId(extPath, s))) {
    return true
  }
  // Local-path spec (e.g. ..\..\Documents\GitHub\sylo-tools-personal, as `pi install <path>`
  // persists into settings.json): the package's extensions live under its own directory,
  // not under node_modules — match on the spec's folder name as a path segment.
  const norm = npmSpec.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^(npm:|git:|https?:|ssh:)/i.test(norm) || !norm.includes('/')) return false
  const folder = norm.split('/').pop()?.trim().toLowerCase()
  if (!folder) return false
  return extPath.replace(/\\/g, '/').toLowerCase().includes(`/${folder}/`)
}

/** True when extension path looks like it belongs to an npm package id (global node_modules or Pi agent npm mirror). */
export function extensionPathMatchesPackageId(extPath: string, npmSpec: string): boolean {
  const id = npmSpec.replace(/^npm:/i, '').trim()
  if (!id) return false
  const norm = extPath.replace(/\\/g, '/')
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const verSuffix = String.raw`(?:@[^/]+)?`
  return (
    new RegExp(`/node_modules/${escaped}${verSuffix}(/|$)`, 'i').test(norm) ||
    new RegExp(`/npm/${escaped}${verSuffix}(/|$)`, 'i').test(norm)
  )
}

export function packageBundleOriginFromPath(samplePath: string): CapabilityOrigin {
  const n = samplePath.replace(/\\/g, '/').toLowerCase()
  if (n.includes('/git/')) return 'git-package'
  return 'npm-package'
}

export const ORIGIN_LABELS: Record<CapabilityOrigin, string> = {
  'pi-agent': 'Pi agent',
  'pi-cwd': 'Pi cwd',
  'cursor-skills': 'Cursor skills',
  'sylo-repo': 'Sylo repo',
  'npm-package': 'npm package',
  'git-package': 'git package',
  'sylo-builtin': 'built-in (Sylo)',
  'sylo-optional': 'Sylo optional package',
}

export const KNOWN_PACKAGES: { canonical: string; aliases?: string[]; hint: string }[] = [
  { canonical: 'npm:pi-subagents', hint: 'Multi-step / subagent tooling' },
  { canonical: 'npm:pi-smart-fetch', hint: 'HTTP fetch-style tools (often used like web_fetch)' },
  {
    canonical: 'npm:pi-web-access',
    aliases: ['npm:@ollama/pi-web-search', 'npm:pi-web-search'],
    hint: 'Web search and page fetch (web_search, fetch_content, …)',
  },
]

export function specsEquivalentTo(source: string): string[] {
  const row = KNOWN_PACKAGES.find((p) => p.canonical === source || p.aliases?.includes(source))
  if (row) return [row.canonical, ...(row.aliases ?? [])]
  return [source]
}

/** Id under node_modules/… or Pi inventory source (strip npm:/git: prefix and @version). */
export function folderIdFromSpec(spec: string): string {
  const bare = spec.replace(/^npm:/i, '').replace(/^git:/i, '').trim()
  const match = bare.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/)
  return match?.[1] ?? bare
}

export function knownPackagePrimarySpec(source: string): string {
  const row = KNOWN_PACKAGES.find((p) => p.canonical === source || p.aliases?.includes(source))
  return row?.canonical ?? source
}

export function alsoStripForPackageToggle(primary: string): string[] {
  return specsEquivalentTo(primary).filter((s) => s !== primary)
}

type SkillRow = CapabilitiesView['skills'][number]

/** Standalone skills are operator-owned folders — not bundled inside a downloaded Pi package. */
export function isStandaloneSkill(skill: SkillRow, installedFolderIds: Set<string>): boolean {
  if (
    skill.origin === 'npm-package' ||
    skill.origin === 'git-package' ||
    skill.origin === 'sylo-builtin' ||
    skill.origin === 'sylo-repo'
  ) {
    return false
  }
  const pkgFolder = npmPackageFolderFromPath(skill.path)
  if (pkgFolder && installedFolderIds.has(pkgFolder)) return false
  return true
}

export type PackageBundleSlice = {
  skills: CapabilitiesView['skills']
  extensions: NonNullable<CapabilitiesView['extensions']>
}

/** Union live broker paths with last-seen snapshot so rows do not vanish after unload until we have nothing cached. */
export function mergeInstalledPackageBundle(
  live: PackageBundleSlice,
  stored: PackageBundleSlice | undefined,
): {
  skills: { row: PackageBundleSlice['skills'][number]; brokerLoaded: boolean }[]
  extensions: { row: PackageBundleSlice['extensions'][number]; brokerLoaded: boolean }[]
} {
  const skillKey = (s: PackageBundleSlice['skills'][number]) => s.path || s.name
  const skillMap = new Map<
    string,
    { row: PackageBundleSlice['skills'][number]; brokerLoaded: boolean }
  >()
  for (const s of stored?.skills ?? []) {
    skillMap.set(skillKey(s), { row: s, brokerLoaded: false })
  }
  for (const s of live.skills) {
    skillMap.set(skillKey(s), { row: s, brokerLoaded: true })
  }
  const skills = Array.from(skillMap.values()).sort((a, b) => a.row.name.localeCompare(b.row.name))

  const extMap = new Map<
    string,
    { row: PackageBundleSlice['extensions'][number]; brokerLoaded: boolean }
  >()
  for (const e of stored?.extensions ?? []) {
    extMap.set(e.path, { row: e, brokerLoaded: false })
  }
  for (const e of live.extensions) {
    extMap.set(e.path, { row: e, brokerLoaded: true })
  }
  const extensions = Array.from(extMap.values()).sort((a, b) => a.row.name.localeCompare(b.row.name))

  return { skills, extensions }
}

export function normalizeNpmInstallSpec(input: string): string {
  const t = input.trim()
  if (!t) return ''
  if (/^(npm:|git:)/i.test(t)) return t
  return `npm:${t}`
}

/** React 19 may null `currentTarget` on `<details onToggle>`; prefer nativeEvent.target. */
export function detailsOpenFromToggleEvent(e: React.SyntheticEvent<HTMLDetailsElement>): boolean {
  const t = e.nativeEvent.target
  if (t instanceof HTMLDetailsElement) return t.open
  const c = e.currentTarget
  if (c instanceof HTMLDetailsElement) return c.open
  return false
}
