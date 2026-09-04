/** Probe Ollama `/api/show` for vision capability (used to seed Pi `models.json` `input`). */

export async function probeOllamaVision(
  baseOrigin: string,
  modelName: string,
): Promise<{ ok: true; vision: boolean } | { ok: false; error: string }> {
  const name = modelName.trim()
  if (!name) return { ok: false, error: 'Model name is required' }

  let showUrl: URL
  try {
    showUrl = new URL('/api/show', `${normalizeOllamaOrigin(baseOrigin)}/`)
  } catch {
    return { ok: false, error: 'Invalid Ollama server URL' }
  }
  if (showUrl.protocol !== 'http:' && showUrl.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs are allowed' }
  }

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 12_000)
  try {
    const res = await fetch(showUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: ac.signal,
    })
    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status}` }
    }
    const j = (await res.json()) as { capabilities?: unknown }
    const caps = Array.isArray(j.capabilities) ? j.capabilities : []
    const vision = caps.some((c) => typeof c === 'string' && c.toLowerCase() === 'vision')
    return { ok: true, vision }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof Error && e.name === 'AbortError') return { ok: false, error: 'Request timed out' }
    return { ok: false, error: msg }
  } finally {
    clearTimeout(t)
  }
}

function normalizeOllamaOrigin(raw: string): string {
  const t = raw.trim()
  if (!t) return 'http://127.0.0.1:11434'
  if (/^https?:\/\//i.test(t)) return t.replace(/\/$/, '')
  return `http://${t.replace(/^\/*/, '')}`.replace(/\/$/, '')
}
