/**
 * Toolless quarantined-LLM transport.
 *
 * Rank and rewrite both run as plain Ollama `/api/chat` completions with NO
 * tools registered and `stream: false`. This is the structural core of the
 * dual-LLM injection defense (Willison pattern): the model that touches
 * untrusted web text has no ability to act — it can only return text.
 *
 * We deliberately call Ollama's native `/api/chat` rather than going through
 * the Pi provider stack so the quarantine boundary is explicit and auditable,
 * and so no tool definitions can ever leak into these requests.
 */
import type { ResolvedModel } from './config.ts'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  ok: true
  text: string
}

export interface ChatError {
  ok: false
  error: string
}

/**
 * Run a single toolless chat completion against Ollama.
 *
 * @param model - Resolved host + model id.
 * @param messages - System/user messages (no tools, ever).
 * @param options - Optional context window hint, temperature, and abort signal.
 * @returns The assistant text on success, or a structured error.
 */
export async function chat(
  model: ResolvedModel,
  messages: ChatMessage[],
  options: { numCtx?: number; temperature?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ChatResult | ChatError> {
  let url: URL
  try {
    url = new URL('/api/chat', `${model.ollamaHost}/`)
  } catch {
    return { ok: false, error: `Invalid Ollama host: ${model.ollamaHost}` }
  }

  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), options.timeoutMs ?? 60_000)
  const onParentAbort = () => ac.abort()
  options.signal?.addEventListener('abort', onParentAbort, { once: true })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: model.modelId,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0,
          ...(options.numCtx ? { num_ctx: options.numCtx } : {}),
        },
      }),
    })
    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status} from ${url.host}` }
    }
    const data = (await res.json()) as { message?: { content?: unknown } }
    const text = typeof data.message?.content === 'string' ? data.message.content : ''
    if (!text.trim()) return { ok: false, error: 'Ollama returned empty content' }
    return { ok: true, text }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'LLM request timed out or was aborted' }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onParentAbort)
  }
}

/**
 * Extract the first JSON array/object from a model response.
 *
 * Quarantined models sometimes wrap JSON in prose or code fences; this pulls
 * the first balanced `[...]` or `{...}` span and parses it.
 *
 * @param text - Raw model output.
 * @returns Parsed value, or null when no valid JSON is found.
 */
export function extractJson(text: string): unknown | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced ? fenced[1]! : text
  const start = candidate.search(/[[{]/)
  if (start === -1) return null
  const open = candidate[start]!
  const close = open === '[' ? ']' : '}'
  let depth = 0
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}
