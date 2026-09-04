/**
 * S1 search tier — DuckDuckGo HTML endpoint (keyless, no tracking).
 *
 * Scrapes the lightweight `html.duckduckgo.com/html/` SERP. DuckDuckGo applies
 * server-side, IP-based anomaly detection (HTTP 202 / 403) rather than a
 * published rate limit, so callers treat a 202/403/empty result as the signal
 * to back off and escalate to S2 (handled by the caller). Ported from legacy
 * Sylo `search_tool.py`.
 */
import { parseHTML } from 'linkedom'

export interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

export type SearchOutcome =
  | { ok: true; results: SearchResultItem[] }
  | { ok: false; rateLimited: boolean; error: string }

const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** DDG wraps outbound links in `/l/?uddg=<encoded>`; recover the real target. */
function decodeDdgRedirect(href: string): string {
  if (!href) return ''
  try {
    const u = new URL(href, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
    if (u.hostname.endsWith('duckduckgo.com') && u.pathname === '/l/') return ''
    return u.href
  } catch {
    return href.startsWith('http') ? href : ''
  }
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Run a single DuckDuckGo HTML search.
 *
 * @param query - Search query.
 * @param maxResults - Cap on returned items.
 * @param signal - Optional abort signal.
 * @returns Parsed results, or a failure flagging whether DDG rate-limited us.
 */
export async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), 15_000)
  const onParentAbort = () => ac.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })

  try {
    const res = await fetch(DDG_HTML_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
      body: new URLSearchParams({ q: query, kl: 'us-en' }).toString(),
      signal: ac.signal,
    })

    if (res.status === 202 || res.status === 403 || res.status === 429 || res.status >= 500) {
      return {
        ok: false,
        rateLimited: true,
        error:
          res.status >= 500 ?
            `DuckDuckGo server error (HTTP ${res.status})`
          : `DuckDuckGo blocked request (HTTP ${res.status})`,
      }
    }
    if (!res.ok) {
      return { ok: false, rateLimited: true, error: `DuckDuckGo HTTP ${res.status}` }
    }

    const html = await res.text()
    // Anomaly pages return 200 with an interstitial and no results.
    if (/anomaly|unusual traffic|DDG\.deep\.anomalyDetectionBlock/i.test(html)) {
      return { ok: false, rateLimited: true, error: 'DuckDuckGo anomaly interstitial' }
    }

    const { document } = parseHTML(html)
    const results: SearchResultItem[] = []
    const nodes = document.querySelectorAll('div.result, div.web-result')
    for (const node of Array.from(nodes)) {
      const anchor = node.querySelector('a.result__a') as { getAttribute(name: string): string | null; textContent: string | null } | null
      if (!anchor) continue
      const url = decodeDdgRedirect(anchor.getAttribute('href') ?? '')
      if (!url) continue
      const title = cleanText(anchor.textContent)
      const snippetNode = node.querySelector('a.result__snippet, .result__snippet')
      const snippet = cleanText(snippetNode?.textContent)
      results.push({ title, url, snippet })
      if (results.length >= maxResults) break
    }

    if (results.length === 0) {
      return { ok: false, rateLimited: true, error: 'No results parsed (possible silent block)' }
    }
    return { ok: true, results }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, rateLimited: true, error: 'DuckDuckGo request timed out or aborted' }
    }
    return { ok: false, rateLimited: true, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onParentAbort)
  }
}
