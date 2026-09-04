/**
 * Resolve local PDF paths or download http(s) PDF URLs to a cache file for PyMuPDF tools.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { PDF_CACHE_DIR, pruneStalePdfCache } from './pdf-cache.ts'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export { pruneStalePdfCache } from './pdf-cache.ts'

export function isPdfUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    const u = new URL(trimmed)
    return /\.pdf($|[?#])/i.test(u.pathname) || u.pathname.toLowerCase().includes('/pdf')
  } catch {
    return false
  }
}

function cachePathForUrl(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 24)
  let name = 'document.pdf'
  try {
    const base = path.basename(new URL(url).pathname)
    if (base.toLowerCase().endsWith('.pdf') && base.length <= 120) {
      name = base.replace(/[^\w.\-()+@ ]+/g, '_')
    }
  } catch {
    /* keep default */
  }
  return path.join(PDF_CACHE_DIR, `${hash}-${name}`)
}

async function downloadPdf(url: string, dest: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), 45_000)
  const onParentAbort = () => ac.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf,*/*' },
      redirect: 'follow',
      signal: ac.signal,
    })
    if (res.status === 403 || res.status === 429) {
      return { ok: false, error: `HTTP ${res.status} (host blocked download — try saving the PDF locally)` }
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      const ct = res.headers.get('content-type') ?? ''
      return {
        ok: false,
        error: `Response is not a PDF (${ct || 'unknown content-type'}, ${buf.length} bytes)`,
      }
    }
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onParentAbort)
  }
}

/**
 * @param input - Local path or http(s) URL to a PDF.
 * @param cwd - Pi cwd for relative paths.
 */
export async function resolvePdfInput(
  input: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; path: string; source: string; downloaded: boolean }
  | { ok: false; error: string }
> {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'pdf_path is empty' }

  pruneStalePdfCache()

  if (isPdfUrl(raw)) {
    const cached = cachePathForUrl(raw)
    if (existsSync(cached)) {
      return { ok: true, path: cached, source: raw, downloaded: false }
    }
    const dl = await downloadPdf(raw, cached, signal)
    if (!dl.ok) {
      return {
        ok: false,
        error: `Could not download PDF from URL: ${dl.error}. Save the file locally and pass an absolute path.`,
      }
    }
    return { ok: true, path: cached, source: raw, downloaded: true }
  }

  const resolved = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw)
  if (!existsSync(resolved)) {
    return { ok: false, error: `PDF not found: ${resolved}` }
  }
  return { ok: true, path: resolved, source: resolved, downloaded: false }
}
