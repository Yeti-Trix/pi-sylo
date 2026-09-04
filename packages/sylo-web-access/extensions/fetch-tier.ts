/**
 * F1 → F2 fetch escalation with adequacy gate before rewrite (caller-side).
 */
import type { WebAccessConfig } from './config.ts'
import { fetchPdfText, urlLooksLikePdf } from './fetch-pdf.ts'
import { fetchHeadless } from './fetch-headless.ts'
import { fetchReadable, type FetchFailure } from './fetch-readability.ts'

export interface FetchedPage {
  url: string
  title: string
  markdown: string
  tier: string
  adequate: boolean
  inadequateReason?: string
  rawHtml?: string
  /** F2 viewport screenshot (base64 PNG), only when headless tier used. */
  screenshotB64?: string
  escalationReason?: string
}

export type FetchPageOutcome = { ok: true; page: FetchedPage } | FetchFailure

function shouldEscalateToF2(
  f1:
    | { ok: true; adequate: boolean; inadequateReason?: string }
    | { ok: false; escalate: boolean },
): string | null {
  if (!f1.ok) return f1.escalate ? 'F1 fetch failed (bot wall / timeout)' : null
  if (!f1.adequate) return f1.inadequateReason ?? 'F1 content inadequate'
  return null
}

/**
 * Fetch a page: F1 Readability first; escalate to F2 headless when inadequate and enabled.
 */
export async function fetchPageWithTiers(
  rawUrl: string,
  config: WebAccessConfig,
  options: { f2Screenshot: boolean },
  signal?: AbortSignal,
): Promise<FetchPageOutcome> {
  if (urlLooksLikePdf(rawUrl)) {
    const pdf = await fetchPdfText(rawUrl, signal)
    if (!pdf.ok) {
      return { ok: false, url: pdf.url, error: pdf.error, escalate: pdf.escalate }
    }
    const adequate = pdf.markdown.length >= 200
    return {
      ok: true,
      page: {
        url: pdf.url,
        title: pdf.title,
        markdown: pdf.markdown,
        tier: pdf.tier,
        adequate,
        inadequateReason: adequate ? undefined : 'PDF text too short',
      },
    }
  }

  const f1 = await fetchReadable(rawUrl, signal)
  if (f1.ok && f1.adequate) {
    return {
      ok: true,
      page: {
        url: f1.url,
        title: f1.title,
        markdown: f1.markdown,
        tier: 'F1',
        adequate: true,
        rawHtml: f1.rawHtml,
      },
    }
  }

  const reason = f1.ok ? (f1.inadequateReason ?? 'F1 inadequate') : shouldEscalateToF2(f1)
  const tryF2 =
    config.heavyTiersEnabled &&
    ((f1.ok && !f1.adequate) || (!f1.ok && f1.escalate))

  if (!tryF2) {
    if (f1.ok) {
      return {
        ok: true,
        page: {
          url: f1.url,
          title: f1.title,
          markdown: f1.markdown,
          tier: f1.adequate ? 'F1' : 'F1-thin',
          adequate: f1.adequate,
          inadequateReason: f1.inadequateReason,
          rawHtml: f1.rawHtml,
          escalationReason: reason ?? undefined,
        },
      }
    }
    return f1
  }

  const f2 = await fetchHeadless(rawUrl, { screenshot: options.f2Screenshot })
  if (!f2.ok) {
    if (f1.ok) {
      return {
        ok: true,
        page: {
          url: f1.url,
          title: f1.title,
          markdown: f1.markdown,
          tier: 'F1-thin',
          adequate: false,
          inadequateReason: f1.inadequateReason,
          rawHtml: f1.rawHtml,
          escalationReason: `${reason}; F2 failed: ${f2.error}`,
        },
      }
    }
    return { ok: false, url: rawUrl, error: `${f1.error}. F2: ${f2.error}`, escalate: true }
  }

  return {
    ok: true,
    page: {
      url: f2.url,
      title: f2.title,
      markdown: f2.markdown,
      tier: f2.tier,
      adequate: f2.adequate,
      inadequateReason: f2.inadequateReason,
      screenshotB64: f2.screenshotB64,
      escalationReason: reason ?? undefined,
    },
  }
}
