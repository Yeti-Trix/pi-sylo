/**
 * Fetch and parse https://pi.dev/packages (public HTML) for Sylo Capability Manager.
 * No official JSON API — structure matches pi.dev markup as of 2026-05; may need updates if the site changes.
 */

export type PiDevCatalogSort = 'downloads' | 'recent' | 'name'

export type PiDevCatalogType = '' | 'extension' | 'skill' | 'theme' | 'prompt'

export type PiDevCatalogQuery = {
  page?: number
  /** Mirrors pi.dev `name` filter (server-side). */
  name?: string
  type?: PiDevCatalogType
  sort?: PiDevCatalogSort
}

export type PiDevPackageRow = {
  name: string
  description: string
  /** e.g. npm:pi-subagents — ready for `pi install` / Sylo installSpec */
  installSpec: string
  types: string[]
  downloadsMonthly: number
  publishedMs: number
}

export type PiDevCatalogResult =
  | {
      ok: true
      packages: PiDevPackageRow[]
      rangeStart: number
      rangeEnd: number
      total: number
      page: number
      pageSize: number
      sourceUrl: string
      /** sylo-* packages pinned above the list. Sylo-UI-only client boost: fetched
       * straight from the npm registry (source of record pi.dev mirrors), filtered to
       * `sylo-*` names carrying the `pi-package` keyword. Empty when the operator is
       * filtering by name/type — the boost only shapes the default browse view.
       * Optional: parsePiDevPackagesHtml returns results without it; only fetchPiDevCatalog attaches it. */
      syloPinned?: PiDevPackageRow[]
    }
  | { ok: false; error: string }

const PI_DEV_PACKAGES = 'https://pi.dev/packages'
const NPM_SEARCH = 'https://registry.npmjs.org/-/v1/search'
const SYLO_PINNED_CAP = 8

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
}

function buildCatalogUrl(q: PiDevCatalogQuery): string {
  const u = new URL(PI_DEV_PACKAGES)
  const page = q.page ?? 1
  if (q.name?.trim()) u.searchParams.set('name', q.name.trim())
  const type = q.type ?? ''
  if (type) u.searchParams.set('type', type)
  const sort = q.sort ?? 'downloads'
  if (sort && sort !== 'downloads') u.searchParams.set('sort', sort)
  if (page > 1) u.searchParams.set('page', String(page))
  return u.toString()
}

type NpmSearchObject = {
  package: {
    name: string
    description?: string
    date?: string
    keywords?: string[]
    links?: { repository?: string }
  }
}

/**
 * First-party boost: find `sylo-*` pi packages on npm directly (the registry of
 * record pi.dev mirrors) so Sylo’s own packages pin to the top of the catalog
 * regardless of pi.dev ranking or its npm-indexing lag. Read-only; purely a
 * Sylo UI concern — never touches pi.dev or npm. Any failure → empty list.
 *
 * 2026-09-11: npm’s search index misses freshly published packages (upstream
 * pi issues #7885/#7849) while the registry itself serves them instantly. So
 * alongside search we probe the registry directly for a curated first-party
 * name list; a probe only pins a package whose manifest declares it a pi
 * package (pi-package keyword or pi.sylo block), so name-squatters can never
 * work themselves into Sylo’s UI.
 */
const SYLO_KNOWN_PACKAGE_NAMES = ['sylo-news', 'sylo-reddit']

type SyloCandidate = { name: string; description: string; publishedMs: number }

export async function fetchSyloPinned(sort: PiDevCatalogSort): Promise<PiDevPackageRow[]> {
  try {
    const candidates = new Map<string, SyloCandidate>()

    // 1) npm text search (subject to the upstream indexing gap).
    try {
      const u = new URL(NPM_SEARCH)
      u.searchParams.set('text', '"sylo-"')
      u.searchParams.set('size', '100')
      const res = await fetch(u, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const json = (await res.json()) as { objects?: NpmSearchObject[] }
        for (const o of json.objects ?? []) {
          if (
            o.package?.name?.startsWith('sylo-') &&
            Array.isArray(o.package.keywords) &&
            o.package.keywords.includes('pi-package') &&
            !candidates.has(o.package.name)
          ) {
            candidates.set(o.package.name, {
              name: o.package.name,
              description: o.package.description ?? '',
              publishedMs: o.package.date ? Date.parse(o.package.date) || 0 : 0,
            })
          }
        }
      }
    } catch {
      /* search is best-effort; the registry probes below still run */
    }

    // 2) Registry probes for curated first-party names (immune to the search
    //    index gap — the registry serves packages the moment they publish).
    await Promise.all(
      SYLO_KNOWN_PACKAGE_NAMES.map(async (name) => {
        if (candidates.has(name)) return
        try {
          const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
            signal: AbortSignal.timeout(5000),
          })
          if (!r.ok) return
          const j = (await r.json()) as {
            name?: string
            description?: string
            'dist-tags'?: { latest?: string }
            versions?: Record<string, { keywords?: string[]; 'pi.sylo'?: unknown }>
            time?: Record<string, string>
          }
          const latest = j['dist-tags']?.latest
          const v = latest ? j.versions?.[latest] : undefined
          if (!v) return
          const isPiPackage =
            (Array.isArray(v.keywords) && v.keywords.includes('pi-package')) || !!v['pi.sylo']
          if (!isPiPackage) return
          candidates.set(j.name ?? name, {
            name: j.name ?? name,
            description: j.description ?? '',
            publishedMs: latest && j.time?.[latest] ? Date.parse(j.time[latest]) || 0 : 0,
          })
        } catch {
          /* probe failure — skip this name */
        }
      }),
    )

    const rows = [...candidates.values()].slice(0, SYLO_PINNED_CAP)
    if (rows.length === 0) return []

    // Monthly downloads per pinned row (search + registry payloads lack them);
    // 0 on failure.
    const dl = await Promise.all(
      rows.map(async (c) => {
        try {
          const r = await fetch(`https://api.npmjs.org/downloads/point/last-month/${c.name}`, {
            signal: AbortSignal.timeout(5000),
          })
          if (!r.ok) return 0
          const j = (await r.json()) as { downloads?: number }
          return typeof j.downloads === 'number' ? j.downloads : 0
        } catch {
          return 0
        }
      }),
    )
    const pinned: PiDevPackageRow[] = rows.map((c, i) => ({
      name: c.name,
      description: c.description,
      installSpec: `npm:${c.name}`,
      types: [],
      downloadsMonthly: dl[i] ?? 0,
      publishedMs: c.publishedMs,
    }))
    if (sort === 'recent') pinned.sort((a, b) => b.publishedMs - a.publishedMs)
    else if (sort === 'name') pinned.sort((a, b) => a.name.localeCompare(b.name))
    else pinned.sort((a, b) => b.downloadsMonthly - a.downloadsMonthly)
    return pinned
  } catch {
    return []
  }
}

function parseTypesFromAttrs(attrs: string, body: string): string[] {
  const raw = attrs.match(/data-package-types="([^"]*)"/)?.[1]?.trim()
  if (raw) {
    const t = raw.split(/\s+/).filter(Boolean)
    if (t.length) return [...new Set(t)]
  }
  const badges: string[] = []
  const badgeRe = /class="meta-chip packages-badge"[^>]*data-type="([^"]+)"/g
  let bm: RegExpExecArray | null
  while ((bm = badgeRe.exec(body)) !== null) {
    badges.push(bm[1]!)
  }
  return [...new Set(badges)]
}

/** Exported for tests; parses one HTML response body. */
export function parsePiDevPackagesHtml(html: string, sourceUrl: string): PiDevCatalogResult {
  // pi.dev variants (2026): "1-50 / 2525", "51-100 / 2525", or filtered "1-25 / 25 (of 2525)"
  const countMatch = html.match(
    /<span class="packages-count">(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)(?:\s*\(of\s*(\d+)\))?<\/span>/,
  )
  // Empty filtered state (seen 2026-09-11): the count span loses its range
  // part entirely, e.g. "0 / 5423" when a name filter matches nothing.
  const emptyMatch = countMatch
    ? null
    : html.match(/<span class="packages-count">(\d+)\s*\/\s*(\d+)<\/span>/)
  if (!countMatch && !emptyMatch) {
    return { ok: false, error: 'Could not find package count on pi.dev (page layout changed?)' }
  }
  const rangeStart = countMatch ? Number(countMatch[1]) : Number(emptyMatch![1])
  const rangeEnd = countMatch ? Number(countMatch[2]) : rangeStart
  const total = countMatch
    ? countMatch[4]
      ? Number(countMatch[4])
      : Number(countMatch[3])
    : Number(emptyMatch![2])
  const pageSize = Math.max(1, rangeEnd - rangeStart + 1)

  const articleRe = /<article\b([^>]*\bdata-package-card="true"[^>]*)>([\s\S]*?)<\/article>/g
  const packages: PiDevPackageRow[] = []
  let m: RegExpExecArray | null
  while ((m = articleRe.exec(html)) !== null) {
    const attrs = m[1]!
    const body = m[2]!
    const name = attrs.match(/\bdata-package-name="([^"]*)"/)?.[1]
    if (!name) continue
    const installFull = body.match(/data-copy-text="pi install (npm:[^"]+)"/)?.[1]
    if (!installFull) continue
    const descRaw =
      body.match(/<p class="packages-desc">([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, '') ?? ''
    const downloads = Number(attrs.match(/\bdata-package-downloads="(\d+)"/)?.[1] ?? '0')
    const publishedMs = Number(attrs.match(/\bdata-package-date="(\d+)"/)?.[1] ?? '0')
    packages.push({
      name,
      description: decodeHtmlEntities(descRaw.trim()),
      installSpec: installFull,
      types: parseTypesFromAttrs(attrs, body),
      downloadsMonthly: downloads,
      publishedMs,
    })
  }

  if (packages.length === 0 && total > 0 && !html.includes(String.fromCharCode(112,97,99,107,97,103,101,115,45,101,109,112,116,121))) {
    return { ok: false, error: 'pi.dev returned no package cards (markup may have changed)' }
  }

  const page = pageSize > 0 ? Math.max(1, Math.floor((rangeStart - 1) / pageSize) + 1) : 1

  return {
    ok: true,
    packages,
    rangeStart,
    rangeEnd,
    total,
    page,
    pageSize,
    sourceUrl,
  }
}

/**
 * Fetch one pi.dev catalog page. When the operator is NOT filtering (no name, no
 * type), also fetch Sylo's own `sylo-*` npm packages and return them pinned
 * separately so the UI can raise them above the pi.dev ranking.
 */
export async function fetchPiDevCatalog(q: PiDevCatalogQuery): Promise<PiDevCatalogResult> {
  const sourceUrl = buildCatalogUrl(q)
  const filtering = Boolean(q.name?.trim()) || Boolean(q.type)
  try {
    // Pinned sylo-* rows are fetched in parallel with the page itself; the main
    // result never waits longer than its own timeout because of it.
    const pinnedPromise = filtering ? Promise.resolve([]) : fetchSyloPinned(q.sort ?? 'downloads')
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 30_000)
    const res = await fetch(sourceUrl, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Sylo/0.1.0 (+https://github.com/) pi.dev catalog mirror',
      },
    })
    clearTimeout(t)
    if (!res.ok) {
      return { ok: false, error: `pi.dev responded ${res.status}` }
    }
    const html = await res.text()
    const parsed = parsePiDevPackagesHtml(html, sourceUrl)
    if (!parsed.ok) return parsed
    const syloPinned = await pinnedPromise
    return { ...parsed, syloPinned }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ok: false, error: 'pi.dev request timed out after 30s' }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
