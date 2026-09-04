/**
 * S1 → S2 search escalation (DDG HTML, then ddgs multi-backend).
 */
import type { WebAccessConfig } from './config.ts'
import { asRecord, runPythonScript } from './python-runner.ts'
import { searchDuckDuckGo, type SearchResultItem } from './search-ddg.ts'

export type SearchTierOutcome =
  | { ok: true; results: SearchResultItem[]; tier: string; braveQuota?: BraveQuota }
  | { ok: false; rateLimited: boolean; error: string; tier?: string }

/** Latest Brave Search API monthly quota snapshot (from X-RateLimit-* headers). */
export interface BraveQuota {
  limit: number | null
  remaining: number | null
  resetSeconds: number | null
  fetchedAt: number
}

let s1Inflight = 0
const MAX_S1_CONCURRENT = 2

async function withS1Slot<T>(fn: () => Promise<T>): Promise<T> {
  while (s1Inflight >= MAX_S1_CONCURRENT) {
    await new Promise((r) => setTimeout(r, 200))
  }
  s1Inflight++
  try {
    return await fn()
  } finally {
    s1Inflight--
  }
}

/** S2 default when config lists nothing useful (S1 already tried DDG HTML). */
const DEFAULT_S2_BACKENDS = ['duckduckgo']

/**
 * Backends for S2 after S1 DDG HTML fails.
 *
 * We keep `duckduckgo` in the rotation: the ddgs library's `duckduckgo` backend
 * hits a different DDG endpoint (the `d.duckduckgo.com` API) than S1's
 * `/html` scraper, so it is NOT the same request and often still works when
 * only `/html` is anomaly-challenged (HTTP 202). See issue tracker
 * 2026-08-13_web_search_ddg_202_no_s2_rescue.
 *
 * When a Brave Search API key is configured, `brave_api` is injected right
 * after `duckduckgo` (if not already present). The keyless scrapers
 * (mojeek/brave/startpage) are no longer in the default rotation — they bot-wall
 * headless clients and rarely return results — but remain selectable in config
 * for advanced users.
 */
export function s2BackendsAfterS1Failure(config: WebAccessConfig): string[] {
  const base = config.searchBackends
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean)
  const out = base.length > 0 ? base : [...DEFAULT_S2_BACKENDS]
  if (config.braveApiKey && !out.includes('brave_api')) {
    const ddgIdx = out.indexOf('duckduckgo')
    if (ddgIdx >= 0 && ddgIdx < out.length - 1) {
      out.splice(ddgIdx + 1, 0, 'brave_api')
    } else {
      out.unshift('brave_api')
    }
  }
  return out
}

function parseBraveQuota(raw: unknown): BraveQuota | undefined {
  const r = asRecord(raw)
  if (!r) return undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    limit: num(r.limit),
    remaining: num(r.remaining),
    resetSeconds: num(r.reset_seconds),
    fetchedAt: num(r.fetched_at) ?? Date.now(),
  }
}

/**
 * Run web search with S1 first; on any S1 failure with heavy tiers, rotate S2 backends from config.
 */
export async function searchWithTiers(
  query: string,
  maxResults: number,
  config: WebAccessConfig,
  signal?: AbortSignal,
): Promise<SearchTierOutcome> {
  const s1 = await withS1Slot(() => searchDuckDuckGo(query, maxResults, signal))
  if (s1.ok) return { ok: true, results: s1.results, tier: 'S1-ddg' }

  if (!config.heavyTiersEnabled) {
    return { ok: false, rateLimited: s1.rateLimited, error: s1.error, tier: 'S1-ddg' }
  }

    const backends = s2BackendsAfterS1Failure(config).join(',')
  const py = await runPythonScript(
    'search_ddgs.py',
    [
      '--query',
      query,
      '--max-results',
      String(maxResults),
      '--backends',
      backends,
    ],
    config.braveApiKey ? { SYLO_BRAVE_API_KEY: config.braveApiKey } : undefined,
  )
  if (!py.ok) {
    return {
      ok: false,
      rateLimited: s1.rateLimited,
      error: `S1 (DuckDuckGo): ${s1.error}. S2 unavailable: ${py.error}`,
      tier: 'S1-ddg',
    }
  }
  const data = asRecord(py.data)
  if (!data?.ok) {
    return {
      ok: false,
      rateLimited: s1.rateLimited,
      error: `S1 (DuckDuckGo): ${s1.error}. S2 (${backends}): ${String(data?.error ?? 'search failed')}`,
      tier: 'S2',
    }
  }
  const rawResults = data.results
  const braveQuota = parseBraveQuota(data.brave_quota)
  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    return {
      ok: false,
      rateLimited: s1.rateLimited,
      error: `S1 (DuckDuckGo): ${s1.error}. S2 (${backends}): no parseable results`,
      tier: String(data.tier ?? 'S2'),
    }
  }
  const results: SearchResultItem[] = []
  for (const row of rawResults) {
    const r = asRecord(row)
    if (!r) continue
    const url = String(r.url ?? '').trim()
    if (!url.startsWith('http')) continue
    results.push({
      title: String(r.title ?? '').trim(),
      url,
      snippet: String(r.snippet ?? '').trim(),
    })
    if (results.length >= maxResults) break
  }
  if (results.length === 0) {
    return {
      ok: false,
      rateLimited: s1.rateLimited,
      error: `S1 (DuckDuckGo): ${s1.error}. S2 (${backends}): empty after parse`,
      tier: String(data.tier ?? 'S2'),
    }
  }
  return { ok: true, results, tier: String(data.tier ?? 'S2'), braveQuota }
}
