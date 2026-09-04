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
    }
  | { ok: false; error: string }

const PI_DEV_PACKAGES = 'https://pi.dev/packages'

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
  if (!countMatch) {
    return { ok: false, error: 'Could not find package count on pi.dev (page layout changed?)' }
  }
  const rangeStart = Number(countMatch[1])
  const rangeEnd = Number(countMatch[2])
  const total = countMatch[4] ? Number(countMatch[4]) : Number(countMatch[3])
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

  if (packages.length === 0 && total > 0) {
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

export async function fetchPiDevCatalog(q: PiDevCatalogQuery): Promise<PiDevCatalogResult> {
  const sourceUrl = buildCatalogUrl(q)
  try {
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
    return parsePiDevPackagesHtml(html, sourceUrl)
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ok: false, error: 'pi.dev request timed out after 30s' }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
