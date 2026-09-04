/**
 * F1 fetch tier — Node `fetch` + Mozilla Readability + Turndown (HTML→markdown).
 *
 * Fast, dependency-light, no JS rendering. Resolves static/SSR/doc pages. When
 * the extracted text is thin or shows SPA-shell markers, {@link fetchReadable}
 * reports `adequate: false` so the caller can deterministically escalate to F2
 * (headless) — no LLM is consulted to make that decision.
 */
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

import { assertFetchableUrl } from './ssrf.ts'

export interface FetchOutcome {
  ok: true
  url: string
  title: string
  markdown: string
  /** Raw HTML (for F1 og:image preview extraction). */
  rawHtml: string
  /** Deterministic F1-adequacy verdict (false → caller may escalate to F2). */
  adequate: boolean
  /** Human-readable reason when `adequate` is false. */
  inadequateReason?: string
}

export interface FetchFailure {
  ok: false
  url: string
  error: string
  /** True when the failure looks like a bot wall / JS requirement (escalate). */
  escalate: boolean
}

const MIN_ADEQUATE_CHARS = 500
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

/** Deterministic SPA-shell / thin-content detection on raw HTML + extracted text. */
function assessAdequacy(html: string, text: string): { adequate: boolean; reason?: string } {
  if (text.length < MIN_ADEQUATE_CHARS) {
    return { adequate: false, reason: `extracted text under ${MIN_ADEQUATE_CHARS} chars` }
  }
  const lower = html.toLowerCase()
  const emptyRoot = /<div[^>]+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i.test(html)
  const nextDataOnly = lower.includes('__next_data__') && text.length < 1500
  if (emptyRoot || nextDataOnly) {
    return { adequate: false, reason: 'unrendered SPA shell detected' }
  }
  return { adequate: true }
}

/**
 * Fetch and extract readable markdown from a URL via the F1 tier.
 *
 * @param rawUrl - Target URL (validated by the SSRF guard first).
 * @param signal - Optional abort signal.
 * @returns Extracted markdown with an adequacy verdict, or a failure.
 */
export async function fetchReadable(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<FetchOutcome | FetchFailure> {
  const guard = assertFetchableUrl(rawUrl)
  if (!guard.ok) return { ok: false, url: rawUrl, error: guard.error, escalate: false }

  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), 20_000)
  const onParentAbort = () => ac.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })

  try {
    const res = await fetch(guard.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: ac.signal,
    })

    if (res.status === 403 || res.status === 429 || res.status === 503) {
      return { ok: false, url: guard.url.href, error: `HTTP ${res.status} (bot wall)`, escalate: true }
    }
    if (!res.ok) {
      return { ok: false, url: guard.url.href, error: `HTTP ${res.status}`, escalate: false }
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return {
        ok: false,
        url: guard.url.href,
        error: `Non-HTML content-type: ${contentType || 'unknown'}`,
        escalate: false,
      }
    }

    const html = await res.text()
    const { document } = parseHTML(html)

    let title = ''
    let articleHtml = ''
    try {
      const article = new Readability(document as unknown as Document).parse()
      if (article) {
        title = article.title ?? ''
        articleHtml = article.content ?? ''
      }
    } catch {
      // Readability can throw on malformed DOM; fall through to body fallback.
    }

    if (!articleHtml) {
      articleHtml = document.querySelector('body')?.innerHTML ?? ''
    }
    if (!title) {
      title = document.querySelector('title')?.textContent?.trim() ?? guard.url.href
    }

    const markdown = turndown.turndown(articleHtml).replace(/\n{3,}/g, '\n\n').trim()
    const adequacy = assessAdequacy(html, markdown)

    return {
      ok: true,
      url: guard.url.href,
      title,
      markdown,
      rawHtml: html,
      adequate: adequacy.adequate,
      inadequateReason: adequacy.reason,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, url: guard.url.href, error: 'Fetch timed out or aborted', escalate: true }
    }
    return {
      ok: false,
      url: guard.url.href,
      error: err instanceof Error ? err.message : String(err),
      escalate: false,
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onParentAbort)
  }
}
