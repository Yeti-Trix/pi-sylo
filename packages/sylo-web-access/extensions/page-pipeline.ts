/**
 * Shared fetch → rewrite → optional vision attachments for search/fetch tools.
 */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

import type { WebAccessConfig } from './config.ts'
import { resolveModel } from './config.ts'
import { fetchPageWithTiers, type FetchedPage } from './fetch-tier.ts'
import { rewriteContent } from './rewrite.ts'
import { extractPreviewImageUrls, fetchPreviewImages } from './preview-images.ts'
import { notifyWebAccess } from './sylo-host.ts'
import { shouldAttachImages } from './tool-content.ts'
import { wrapUntrusted } from './untrusted.ts'

const RAW_FALLBACK_CHAR_CAP = 6000

export interface ProcessedPageSection {
  markdownBlock: string
  url: string
  title: string
  tier: string
  previews: Awaited<ReturnType<typeof fetchPreviewImages>>
  screenshotB64?: string
}

async function rewriteOrFallback(
  config: WebAccessConfig,
  ctx: ExtensionContext,
  runId: string,
  page: { url: string; title: string; markdown: string },
  query: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ relevant: boolean; text: string; rewritten: boolean }> {
  const model = resolveModel(config, ctx, 'rewrite')
  if (!model) {
    const capped = page.markdown.slice(0, RAW_FALLBACK_CHAR_CAP)
    return { relevant: true, text: capped, rewritten: false }
  }
  const outcome = await rewriteContent(model, page.markdown, {
    query,
    title: page.title,
    url: page.url,
    signal,
  })
  if (!outcome.ok) {
    notifyWebAccess({ type: 'error', runId, stage: 'rewrite', message: outcome.error })
    const capped = page.markdown.slice(0, RAW_FALLBACK_CHAR_CAP)
    return { relevant: true, text: capped, rewritten: false }
  }
  if (!outcome.relevant) {
    notifyWebAccess({ type: 'rewrite', runId, url: page.url, relevant: false })
    return { relevant: false, text: '', rewritten: true }
  }
  notifyWebAccess({ type: 'rewrite', runId, url: page.url, relevant: true })
  return { relevant: true, text: outcome.text, rewritten: true }
}

/**
 * Fetch with tier escalation, adequacy gate, rewrite once, optional F1 previews / F2 screenshot.
 */
export async function processPageForTool(
  rawUrl: string,
  config: WebAccessConfig,
  ctx: ExtensionContext,
  runId: string,
  options: { query?: string; relevanceScore?: number },
  signal?: AbortSignal,
): Promise<
  | { ok: true; section: ProcessedPageSection }
  | { ok: false; url: string; error: string; tier?: string }
  | { ok: true; skipped: true; url: string; reason: string; tier: string }
> {
  const attachImages = shouldAttachImages(config, ctx)
  const fetched = await fetchPageWithTiers(
    rawUrl,
    config,
    { f2Screenshot: attachImages },
    signal,
  )
  if (!fetched.ok) {
    notifyWebAccess({ type: 'error', runId, stage: 'fetch', message: `${rawUrl}: ${fetched.error}` })
    return { ok: false, url: rawUrl, error: fetched.error }
  }

  const page = fetched.page
  notifyWebAccess({
    type: 'fetch',
    runId,
    url: page.url,
    tier: page.tier,
    bytes: page.markdown.length,
    adequate: page.adequate,
  })

  if (!page.adequate) {
    return {
      ok: true,
      skipped: true,
      url: page.url,
      reason: page.inadequateReason ?? page.escalationReason ?? 'inadequate',
      tier: page.tier,
    }
  }

  const rw = await rewriteOrFallback(config, ctx, runId, page, options.query, signal)
  if (!rw.relevant) {
    return { ok: true, skipped: true, url: page.url, reason: 'rewrite_not_relevant', tier: page.tier }
  }

  let previews: Awaited<ReturnType<typeof fetchPreviewImages>> = []
  if (attachImages && config.previewImagesEnabled && page.rawHtml && !page.screenshotB64) {
    const urls = extractPreviewImageUrls(
      page.rawHtml,
      page.url,
      config.maxPreviewImagesPerPage,
    )
    if (urls.length > 0) {
      previews = await fetchPreviewImages(urls, signal, config.maxPreviewImagesPerPage)
    }
  }

  const scoreLine =
    options.relevanceScore != null ? ` (relevance ${options.relevanceScore.toFixed(2)})` : ''
  const markdownBlock =
    `## ${page.title || page.url}\n` +
    `Source: ${page.url}${scoreLine} · tier ${page.tier}\n\n` +
    wrapUntrusted(rw.text, page.url)

  return {
    ok: true,
    section: {
      markdownBlock,
      url: page.url,
      title: page.title,
      tier: page.tier,
      previews,
      screenshotB64: page.screenshotB64,
    },
  }
}
