/** Mirrors `skill-routes.ts` — keep aligned (ADR-35). Renderer cannot import main sources. */
export type SkillRouteNavSection = 'domain' | 'tools' | 'library' | 'dev'

export type SkillRouteRowLite = {
  skillFolderName: string
  routeId: string
  nav_section: SkillRouteNavSection
}

export type SkillNavLayoutState = {
  hidden: string[]
  pinned: string[]
  /** Per-section route keys (`skillFolder:routeId`); establishes order among unpinned routes in that section. */
  order: Partial<Record<SkillRouteNavSection, string[]>>
}

export const DEFAULT_SKILL_NAV_LAYOUT: SkillNavLayoutState = {
  hidden: [],
  pinned: [],
  order: {},
}

export const ROUTE_NAV_SECTION_SEQUENCE: SkillRouteNavSection[] = ['domain', 'tools', 'library', 'dev']

export function skillRouteRowKey(r: SkillRouteRowLite): string {
  return `${r.skillFolderName}:${r.routeId}`
}

/** Sort routes for one sidebar section: pinned first, then ordered list + discovery tail. */
export function sortedRoutesForNavSection<T extends SkillRouteRowLite>(
  section: SkillRouteNavSection,
  allRoutes: readonly T[],
  layout: SkillNavLayoutState,
): T[] {
  const hidden = new Set(layout.hidden)
  const key = (r: T) => skillRouteRowKey(r)
  const inSection = allRoutes.filter((r) => r.nav_section === section && !hidden.has(key(r)))
  const rank = new Map(inSection.map((r, i) => [key(r), i]))
  const pinned = layout.pinned.filter((k) => inSection.some((r) => key(r) === k))
  const pinnedSet = new Set(pinned)
  const unpinned = inSection.filter((r) => !pinnedSet.has(key(r)))

  const explicit = layout.order[section] ?? []
  const unpinnedKeys = unpinned.map(key)
  const orderedUnpinned: string[] = []
  for (const k of explicit) {
    if (unpinnedKeys.includes(k) && !orderedUnpinned.includes(k)) orderedUnpinned.push(k)
  }
  const rest = unpinnedKeys.filter((k) => !orderedUnpinned.includes(k))
  rest.sort((a, b) => (rank.get(a)! - rank.get(b)!))
  orderedUnpinned.push(...rest)

  const byKey = new Map(inSection.map((r) => [key(r), r]))
  const out: T[] = []
  for (const k of pinned) {
    const r = byKey.get(k)
    if (r) out.push(r)
  }
  for (const k of orderedUnpinned) {
    const r = byKey.get(k)
    if (r) out.push(r)
  }
  return out
}
