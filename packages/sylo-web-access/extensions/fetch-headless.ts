/**
 * F2 fetch tier — Crawl4AI via `scripts/fetch_headless.py`.
 */
import { asRecord, runPythonScript } from './python-runner.ts'

export interface HeadlessFetchOutcome {
  ok: true
  url: string
  title: string
  markdown: string
  adequate: boolean
  inadequateReason?: string
  tier: string
  screenshotB64?: string
}

export interface HeadlessFetchFailure {
  ok: false
  url: string
  error: string
}

/**
 * Headless render + markdown extraction; optional viewport screenshot (base64).
 */
export async function fetchHeadless(
  url: string,
  options: { screenshot: boolean },
): Promise<HeadlessFetchOutcome | HeadlessFetchFailure> {
  const args = ['--url', url]
  if (options.screenshot) args.push('--screenshot')
  const py = await runPythonScript('fetch_headless.py', args)
  if (!py.ok) return { ok: false, url, error: py.error }
  const data = asRecord(py.data)
  if (!data?.ok) {
    return { ok: false, url, error: String(data?.error ?? 'F2 fetch failed') }
  }
  const markdown = String(data.markdown ?? '').trim()
  return {
    ok: true,
    url: String(data.url ?? url),
    title: String(data.title ?? url),
    markdown,
    adequate: data.adequate === true,
    inadequateReason:
      typeof data.inadequate_reason === 'string' ? data.inadequate_reason : undefined,
    tier: String(data.tier ?? 'F2'),
    screenshotB64:
      typeof data.screenshot_b64 === 'string' && data.screenshot_b64.length > 0 ?
        data.screenshot_b64
      : undefined,
  }
}
