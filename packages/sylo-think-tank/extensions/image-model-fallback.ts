import type { ImageContent } from '@earendil-works/pi-ai'

export type ImageFallbackDescribeResult =
  | { ok: true; description: string }
  | { ok: false; error: string }

function normalizeOllamaOrigin(raw: string): string {
  const t = raw.trim()
  if (!t) return 'http://127.0.0.1:11434'
  if (/^https?:\/\//i.test(t)) return t.replace(/\/$/, '')
  return `http://${t.replace(/^\/*/, '')}`.replace(/\/$/, '')
}

/** Toolless Ollama `/api/chat` with base64 images — for text-only seat models. */
export async function describeImagesViaOllamaFallback(opts: {
  origin: string
  modelId: string
  images: ImageContent[]
  contextText?: string
  timeoutMs?: number
}): Promise<ImageFallbackDescribeResult> {
  const modelId = opts.modelId.trim()
  if (!modelId) return { ok: false, error: 'empty_image_model_id' }
  if (opts.images.length === 0) return { ok: false, error: 'no_images' }

  let url: URL
  try {
    url = new URL('/api/chat', `${normalizeOllamaOrigin(opts.origin)}/`)
  } catch {
    return { ok: false, error: 'invalid_ollama_origin' }
  }

  const context = (opts.contextText ?? '').trim() || '(tool result — describe visible pixels only)'
  const prompt = [
    'Describe every attached image in detail for a coding assistant that cannot see pixels.',
    `Tool result context (for orientation only — describe what is visible in the images):\n${context}`,
    'Be factual. Do not invent text you cannot read.',
  ].join('\n\n')

  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), opts.timeoutMs ?? 90_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: opts.images.map((img) => img.data),
          },
        ],
        stream: false,
        options: { temperature: 0.1 },
      }),
    })
    if (!res.ok) {
      return { ok: false, error: `ollama_http_${res.status}` }
    }
    const data = (await res.json()) as { message?: { content?: unknown } }
    const text = typeof data.message?.content === 'string' ? data.message.content.trim() : ''
    if (!text) return { ok: false, error: 'ollama_empty_content' }
    return { ok: true, description: text }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, error: 'ollama_timeout' }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timeout)
  }
}
