import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseFrontmatter } from '@earendil-works/pi-coding-agent'
import { normalizeSkillCapabilityPath } from '../shared/sylo-capability-paths.js'
import { isSkillVisibleForOptionalPackages } from '../shared/sylo-optional-packages.js'
import { listLocalPackageSkillDirs } from './local-package-skills.js'

/** Host sidebar grouping; unknown frontmatter → `domain` (ADR-35). */
export type SkillRouteNavSection = 'domain' | 'tools' | 'library' | 'dev'

const KNOWN_NAV_SECTION = new Set<SkillRouteNavSection>([
  'domain',
  'tools',
  'library',
  'dev',
])

export function normalizeRouteNavSection(v: unknown): SkillRouteNavSection {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (KNOWN_NAV_SECTION.has(s as SkillRouteNavSection)) return s as SkillRouteNavSection
  return 'domain'
}

export type DiscoveredSkillRoute = {
  skillName: string
  skillFolderName: string
  skillDir: string
  routeId: string
  title: string
  entry: string
  fallback: string
  nav_section: SkillRouteNavSection
  /** Path served from renderer publicDir (Vite), e.g. /skill-surface/routes/<skill>/<route-id>/index.html */
  fixturePath: string
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function fixturePathForRoute(skillFolderName: string, entry: string): string {
  const normalized = entry.replace(/^\.?\//, '')
  if (normalized.startsWith('routes/')) {
    const rest = normalized.slice('routes/'.length)
    return `/skill-surface/routes/${skillFolderName}/${rest}`
  }
  return `/skill-surface/routes/${skillFolderName}/${normalized}`
}

function collectSkillDirs(agentDir: string): string[] {
  const out: string[] = []
  const seenFolders = new Set<string>()
  const add = (skillDir: string): void => {
    const folder = basename(skillDir).trim().toLowerCase()
    if (!folder || seenFolders.has(folder)) return
    if (!existsSync(join(skillDir, 'SKILL.md'))) return
    seenFolders.add(folder)
    out.push(skillDir)
  }
  const skillsRoot = join(agentDir, 'skills')
  if (existsSync(skillsRoot)) {
    for (const ent of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (ent.isDirectory()) add(join(skillsRoot, ent.name))
    }
  }
  // Local-path packages (Custom/ import) — agent/skills wins when both exist.
  for (const dir of listLocalPackageSkillDirs(agentDir)) add(dir)
  return out
}

export function discoverSkillRoutes(agentDir: string): DiscoveredSkillRoute[] {
  const out: DiscoveredSkillRoute[] = []

  for (const skillDir of collectSkillDirs(agentDir)) {
    const md = join(skillDir, 'SKILL.md')
    if (!existsSync(md)) continue
    let text: string
    try {
      text = readFileSync(md, 'utf8')
    } catch {
      continue
    }
    let fm: Record<string, unknown>
    try {
      fm = parseFrontmatter(text).frontmatter as Record<string, unknown>
    } catch {
      continue
    }
    const routesRaw = fm.routes
    if (!Array.isArray(routesRaw)) continue
    for (const row of routesRaw) {
      if (!isRecord(row)) continue
      const routeId = typeof row.id === 'string' ? row.id.trim() : ''
      const title = typeof row.title === 'string' ? row.title.trim() : routeId
      const entry = typeof row.entry === 'string' ? row.entry.trim() : ''
      const fallback = typeof row.fallback === 'string' ? row.fallback.trim() : ''
      const navSection = normalizeRouteNavSection(row.nav_section)
      if (!routeId || !entry) continue
      const skillFolderName = basename(skillDir)
      out.push({
        skillName: typeof fm.name === 'string' ? fm.name : skillFolderName,
        skillFolderName,
        skillDir,
        routeId,
        title: title || routeId,
        entry,
        fallback,
        nav_section: navSection,
        fixturePath: fixturePathForRoute(skillFolderName, entry),
      })
    }
  }
  return out
}

export type SkillRouteVisibilityContext = {
  optionalPackagesPref: Record<string, boolean>
  disabledSkillPaths: readonly string[]
}

function isSkillDirExcludedFromAgent(skillDir: string, disabledSkillPaths: readonly string[]): boolean {
  const key = normalizeSkillCapabilityPath(skillDir)
  if (!key) return false
  for (const entry of disabledSkillPaths) {
    if (normalizeSkillCapabilityPath(entry) === key) return true
  }
  return false
}

/** Drop routes for disabled optional packages and workspace/global excluded skills. */
export function filterSkillRoutesForSidebar(
  routes: readonly DiscoveredSkillRoute[],
  ctx: SkillRouteVisibilityContext,
): DiscoveredSkillRoute[] {
  return routes.filter((route) => {
    if (!isSkillVisibleForOptionalPackages(route.skillFolderName, ctx.optionalPackagesPref)) {
      return false
    }
    if (isSkillDirExcludedFromAgent(route.skillDir, ctx.disabledSkillPaths)) {
      return false
    }
    return true
  })
}
