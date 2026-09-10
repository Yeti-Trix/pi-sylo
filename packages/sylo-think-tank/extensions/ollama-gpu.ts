/**
 * Local Ollama serves one generate at a time and keeps every loaded model's
 * KV cache in VRAM. Think tank seats often use a different model than the
 * host chat; if both stay loaded, a 27B + 12B pair at 131k context starves
 * the active seat (measured: ping to /api/generate timed out at 8s while
 * Debater 1 sat on "Preparing tool call" for 12 minutes).
 */

export function ollamaModelIdFromPiModel(model: string | undefined): string | null {
  const raw = model?.trim() ?? ''
  if (!raw) return null
  const stripped = raw.replace(/^ollama\//i, '').trim()
  return stripped || null
}

export function modelsToUnload(loadedNames: string[], keepModelId: string): string[] {
  const keep = keepModelId.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of loadedNames) {
    const id = name.trim()
    if (!id) continue
    if (id.toLowerCase() === keep) continue
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(id)
  }
  return out
}

function ollamaOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SYLO_OLLAMA_BASE_ORIGIN?.trim() || env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434'
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, '')
  return `http://${raw.replace(/^\/*/, '')}`.replace(/\/$/, '')
}

async function postOllama(origin: string, path: string, body: unknown, timeoutMs: number): Promise<unknown | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function namesFromPs(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const models = (payload as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const names: string[] = []
  for (const row of models) {
    if (!row || typeof row !== 'object') continue
    const name = (row as { name?: unknown }).name
    if (typeof name === 'string' && name.trim()) names.push(name.trim())
  }
  return names
}

/**
 * Unload every Ollama model except the one this seat will call.
 * Never throws — a failed unload must not block the debate turn.
 */
export async function freeOllamaVramForSeat(
  piModel: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const keep = ollamaModelIdFromPiModel(piModel)
  if (!keep) return []
  const origin = ollamaOrigin(env)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 4_000)
  let loaded: string[] = []
  try {
    const res = await fetch(`${origin}/api/ps`, { signal: ac.signal })
    if (res.ok) loaded = namesFromPs(await res.json())
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }

  const unload = modelsToUnload(loaded, keep)
  for (const name of unload) {
    await postOllama(origin, '/api/generate', { model: name, keep_alive: 0 }, 8_000)
  }
  return unload
}
