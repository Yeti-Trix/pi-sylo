/**
 * Download and extract text from remote PDFs (F1 Readability cannot parse application/pdf).
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { assertFetchableUrl } from './ssrf.ts'
import { PDF_CACHE_DIR, pruneStalePdfCache } from '../../sylo-pdf-reader/extensions/pdf-cache.ts'

const execFileAsync = promisify(execFile)

const WEB_ACCESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMATIC_SCRIPTS = path.resolve(WEB_ACCESS_ROOT, '../sylo-pdf-reader/scripts')
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function resolvePython(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function urlLooksLikePdf(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return /\.pdf($|[?#])/i.test(u.pathname + u.search)
  } catch {
    return false
  }
}

function cachePathForUrl(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 24)
  return path.join(PDF_CACHE_DIR, `${hash}.pdf`)
}

async function downloadPdf(
  url: string,
  dest: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> {
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
      return { ok: false, error: `HTTP ${res.status} (host blocked download)` }
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return { ok: false, error: `Response is not a PDF (${res.headers.get('content-type') ?? 'unknown'})` }
    }
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onParentAbort)
  }
}

export async function fetchPdfText(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; url: string; title: string; markdown: string; tier: string; localPath: string }
  | { ok: false; url: string; error: string; escalate: boolean }
> {
  const guard = assertFetchableUrl(rawUrl)
  if (!guard.ok) return { ok: false, url: rawUrl, error: guard.error, escalate: false }

  const scriptPath = path.join(SCHEMATIC_SCRIPTS, 'extract_pdf_text.py')
  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      url: guard.url.href,
      error:
        'PDF extract unavailable — enable **Schematic reader** in Capability manager, restart broker, ' +
        'or save the PDF locally and use search_schematic_pdf.',
      escalate: false,
    }
  }

  pruneStalePdfCache()

  const cached = cachePathForUrl(guard.url.href)
  if (!existsSync(cached)) {
    const dl = await downloadPdf(guard.url.href, cached, signal)
    if (!dl.ok) {
      return {
        ok: false,
        url: guard.url.href,
        error: `PDF download failed: ${dl.error}`,
        escalate: dl.error.includes('403') || dl.error.includes('blocked'),
      }
    }
  }

  try {
    const { stdout } = await execFileAsync(resolvePython(), [scriptPath, cached], {
      maxBuffer: 24 * 1024 * 1024,
      windowsHide: true,
      timeout: 90_000,
    })
    const data = JSON.parse(stdout.trim()) as { ok?: boolean; error?: string; markdown?: string }
    if (!data.ok) {
      return { ok: false, url: guard.url.href, error: String(data.error ?? 'PDF extract failed'), escalate: false }
    }
    const markdown = String(data.markdown ?? '').trim()
    if (markdown.length < 40) {
      return {
        ok: false,
        url: guard.url.href,
        error:
          'PDF has little embedded text — use search_schematic_pdf with use_ocr: true after saving locally',
        escalate: false,
      }
    }
    let title = 'PDF document'
    try {
      title = decodeURIComponent(path.basename(new URL(guard.url.href).pathname)).replace(/\.pdf$/i, '') || title
    } catch {
      /* default */
    }
    return {
      ok: true,
      url: guard.url.href,
      title,
      markdown,
      tier: 'PDF-extract',
      localPath: cached,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      url: guard.url.href,
      error: `${message} (Schematic reader / PyMuPDF required)`,
      escalate: false,
    }
  }
}
