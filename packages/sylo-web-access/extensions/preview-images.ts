/**
 * F1 preview images — Open Graph / hero `<img>` URLs from raw HTML (no JS).
 */
import { parseHTML } from 'linkedom'

import { assertFetchableUrl } from './ssrf.ts'
import { MAX_TOOL_IMAGE_BYTES, sniffImageFormat } from './image-sanitize.ts'

const MAX_IMAGE_BYTES = MAX_TOOL_IMAGE_BYTES
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export interface EmbeddedPreviewImage {
  sourceUrl: string
  data: string
  mimeType: string
}

function resolveUrl(base: string, raw: string): string | null {
  const t = raw.trim()
  if (!t || t.startsWith('data:')) return null
  try {
    return new URL(t, base).href
  } catch {
    return null
  }
}

/**
 * Extract up to `max` candidate image URLs from HTML (og/twitter, then article imgs).
 */
export function extractPreviewImageUrls(html: string, pageUrl: string, max: number): string[] {
  const { document } = parseHTML(html)
  const candidates: string[] = []

  const metaPairs: Array<[string, string]> = [
    ['property', 'og:image'],
    ['name', 'twitter:image'],
    ['property', 'og:image:url'],
  ]
  for (const [attr, key] of metaPairs) {
    const el = document.querySelector(`meta[${attr}="${key}"]`) as {
      getAttribute(n: string): string | null
    } | null
    const content = el?.getAttribute('content')
    const abs = content ? resolveUrl(pageUrl, content) : null
    if (abs) candidates.push(abs)
  }

  const imgs = document.querySelectorAll('article img, main img, img')
  for (const img of Array.from(imgs)) {
    const src =
      img.getAttribute('src') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src')
    const abs = src ? resolveUrl(pageUrl, src) : null
    if (!abs) continue
    const w = Number(img.getAttribute('width') || 0)
    const h = Number(img.getAttribute('height') || 0)
    if (w > 0 && h > 0 && (w < 120 || h < 120)) continue
    candidates.push(abs)
    if (candidates.length >= max * 4) break
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const u of candidates) {
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
    if (out.length >= max) break
  }
  return out
}

function isOllamaSafeImage(bytes: Buffer): boolean {
  return sniffImageFormat(bytes) !== null
}

/**
 * Fetch preview images for vision-capable tool results (SSRF-guarded).
 */
export async function fetchPreviewImages(
  urls: string[],
  signal?: AbortSignal,
  max = 2,
): Promise<EmbeddedPreviewImage[]> {
  const out: EmbeddedPreviewImage[] = []
  for (const raw of urls) {
    if (out.length >= max) break
    const guard = assertFetchableUrl(raw)
    if (!guard.ok) continue

    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 12_000)
    const onParentAbort = () => ac.abort()
    signal?.addEventListener('abort', onParentAbort, { once: true })
    try {
      const res = await fetch(guard.url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
        redirect: 'follow',
        signal: ac.signal,
      })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') ?? ''
      if (!/image\//i.test(ct) && !ct.includes('octet-stream')) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 512 || buf.length > MAX_IMAGE_BYTES) continue
      const format = sniffImageFormat(buf)
      if (!format) continue
      out.push({
        sourceUrl: guard.url.href,
        data: buf.toString('base64'),
        mimeType: format,
      })
    } catch {
      // skip failed preview
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onParentAbort)
    }
  }
  return out
}
