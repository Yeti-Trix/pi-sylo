/** Mirrors `skill-routes.ts` — keep aligned (ADR-35). Renderer cannot import main sources. */
export type SkillRouteNavSection = 'domain' | 'tools' | 'library' | 'dev'

export type SkillRouteRowLite = {
  skillFolderName: string
  routeId: string
  nav_section: SkillRouteNavSection
}

export type SkillNavLayoutState = {
  hidden: string[]
  /** Route keys (`skillFolder:routeId`) and builtin tabs (`tab:<id>`) pinned to the sidebar. */
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

/** Builtin Tools/Developer tabs that can be pinned next to skill routes. */
export const PINNABLE_BUILTIN_TABS = [
  { tab: 'schedules', title: 'Schedules' },
  { tab: 'proposals', title: 'Proposals' },
  { tab: 'evals', title: 'Testing' },
  { tab: 'skills', title: 'Capability manager' },
  { tab: 'settings', title: 'Settings' },
] as const

export type PinnedNavEntry =
  | { kind: 'route'; key: string; title: string }
  | { kind: 'tab'; key: string; title: string; tab: string }

export function tabNavKey(tab: string): string {
  return `tab:${tab}`
}

export function togglePinnedKey(layout: SkillNavLayoutState, key: string): SkillNavLayoutState {
  const k = key.trim()
  if (!k) return layout
  const pinned = layout.pinned.includes(k)
    ? layout.pinned.filter((x) => x !== k)
    : [...layout.pinned, k]
  return { ...layout, pinned }
}

export function isPinnedKey(layout: SkillNavLayoutState, key: string): boolean {
  return layout.pinned.includes(key)
}

/** Resolve saved pin keys to currently available routes/tabs, preserving pin order. */
export function resolvePinnedNavEntries<T extends SkillRouteRowLite & { title: string }>(
  pinned: readonly string[],
  routes: readonly T[],
  tabs: readonly { tab: string; title: string }[] = PINNABLE_BUILTIN_TABS,
): PinnedNavEntry[] {
  const byRouteKey = new Map(routes.map((r) => [skillRouteRowKey(r), r] as const))
  const byTabKey = new Map(tabs.map((t) => [tabNavKey(t.tab), t] as const))
  const out: PinnedNavEntry[] = []
  for (const key of pinned) {
    const route = byRouteKey.get(key)
    if (route) {
      out.push({ kind: 'route', key, title: route.title })
      continue
    }
    const tab = byTabKey.get(key)
    if (tab) out.push({ kind: 'tab', key, title: tab.title, tab: tab.tab })
  }
  return out
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
