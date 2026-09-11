/**
 * Discover the context window Ollama will actually give a model, so Pi's
 * `models.json` `contextWindow` can be kept honest.
 *
 * Why this exists: Sylo reaches Ollama through its OpenAI-compatible `/v1`
 * endpoint, which by design ignores `num_ctx` (both as a top-level field and
 * inside `options`) — verified against Ollama 0.33. The only things that set the
 * real window are the server's `OLLAMA_CONTEXT_LENGTH` and a model's Modelfile,
 * neither of which Sylo controls. That leaves `models.json` as the one place the
 * two sides can be reconciled, and getting it wrong fails in two directions:
 *
 * - `contextWindow` too HIGH: Pi keeps feeding history until it passes what Ollama
 *   allocated, and Ollama silently truncates from the front — quietly dropping the
 *   system prompt and tool schemas with no error anywhere.
 * - `contextWindow` too LOW: Pi compacts far earlier than it needs to. Because Pi
 *   compacts at `contextWindow - 16384`, declaring 32768 against a real 262144
 *   window throws away history at 16k tokens — 6 % of what was available.
 */

/** Pi's compaction reserve; compaction fires at `contextWindow - RESERVE_TOKENS`. */
const PI_RESERVE_TOKENS = 16384

/**
 * Below this a declared window leaves little usable room after Pi's reserve, so
 * the operator is warned rather than silently put into constant compaction.
 */
const CRAMPED_CONTEXT_WINDOW = 4 * PI_RESERVE_TOKENS

/** Fallback cap when the model is not loaded and the server limit is unknown. */
export const DEFAULT_OLLAMA_CONTEXT_LIMIT = 131072

export type OllamaContextProbe = {
  /** Context the model was trained for, from `/api/show` `model_info`. */
  trained: number | null
  /** `num_ctx` pinned by the model's Modelfile, if any. */
  modelfileNumCtx: number | null
  /** Context Ollama actually allocated, read from `/api/ps` while the model is loaded. */
  loaded: number | null
}

function normalizeOllamaOrigin(raw: string): string {
  const t = raw.trim()
  if (!t) return 'http://127.0.0.1:11434'
  if (/^https?:\/\//i.test(t)) return t.replace(/\/$/, '')
  return `http://${t.replace(/^\/*/, '')}`.replace(/\/$/, '')
}

function endpoint(baseOrigin: string, path: string): URL | null {
  try {
    const url = new URL(path, `${normalizeOllamaOrigin(baseOrigin)}/`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

async function postJson(url: URL, body: unknown, timeoutMs: number): Promise<unknown | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
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

async function getJson(url: URL, timeoutMs: number): Promise<unknown | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `model_info` keys are architecture-prefixed (`qwen3.context_length`,
 * `gemma3.context_length`, …), so match on the suffix rather than guessing the
 * architecture.
 */
function trainedContextFromShow(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const info = (payload as { model_info?: unknown }).model_info
  if (!info || typeof info !== 'object') return null
  for (const [key, value] of Object.entries(info as Record<string, unknown>)) {
    if (!key.endsWith('.context_length') && key !== 'context_length') continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return null
}

/** `parameters` is the Modelfile's PARAMETER block as raw text, e.g. "num_ctx 8192". */
function modelfileNumCtxFromShow(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const params = (payload as { parameters?: unknown }).parameters
  if (typeof params !== 'string') return null
  const match = /^\s*num_ctx\s+(\d+)\s*$/m.exec(params)
  if (!match) return null
  const parsed = Number.parseInt(match[1]!, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function loadedContextFromPs(payload: unknown, modelId: string): number | null {
  if (!payload || typeof payload !== 'object') return null
  const models = (payload as { models?: unknown }).models
  if (!Array.isArray(models)) return null
  const wanted = modelId.trim()
  for (const entry of models) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as { name?: unknown; model?: unknown; context_length?: unknown }
    const matches = row.name === wanted || row.model === wanted
    if (!matches) continue
    if (typeof row.context_length === 'number' && row.context_length > 0) return row.context_length
  }
  return null
}

/** Ask Ollama what this model's context looks like. Never throws. */
export async function probeOllamaContext(
  baseOrigin: string,
  modelId: string,
): Promise<{ ok: true; probe: OllamaContextProbe } | { ok: false; error: string }> {
  const name = modelId.trim()
  if (!name) return { ok: false, error: 'Model name is required' }

  const showUrl = endpoint(baseOrigin, '/api/show')
  const psUrl = endpoint(baseOrigin, '/api/ps')
  if (!showUrl || !psUrl) return { ok: false, error: 'Invalid Ollama server URL' }

  const [show, ps] = await Promise.all([
    postJson(showUrl, { name }, 12_000),
    getJson(psUrl, 8_000),
  ])
  if (show === null) return { ok: false, error: 'Ollama did not answer /api/show' }

  return {
    ok: true,
    probe: {
      trained: trainedContextFromShow(show),
      modelfileNumCtx: modelfileNumCtxFromShow(show),
      loaded: loadedContextFromPs(ps, name),
    },
  }
}

/** Ollama tags remotely served models `:cloud`; those never occupy local VRAM. */
export function isCloudHostedOllamaModel(modelId: string): boolean {
  return /:cloud$/i.test(modelId.trim())
}

/**
 * Context Ollama will hand this model. A loaded model is ground truth because it
 * already reflects the server limit, the Modelfile, and any VRAM-driven shrink.
 * Otherwise take the smallest ceiling that applies.
 */
export function resolveEffectiveOllamaContext(
  probe: OllamaContextProbe,
  serverLimit: number,
  cloudHosted = false,
): number | null {
  if (probe.loaded != null) return probe.loaded
  if (probe.trained == null) return null
  // `OLLAMA_CONTEXT_LENGTH` exists to size the KV cache in local VRAM, so it says nothing
  // about a model served remotely. Applying it to a cloud model under-declares the window
  // and makes Pi compact early for no reason — measured on glm-5.3-flash:cloud, whose
  // 1,048,576-token window would be clamped to a local 131,072 limit it never obeys.
  if (cloudHosted) return probe.modelfileNumCtx ?? probe.trained
  const ceiling = probe.modelfileNumCtx ?? serverLimit
  return Math.min(probe.trained, ceiling)
}

export type ContextWindowVerdict =
  | { kind: 'unknown' }
  | { kind: 'ok'; effective: number; declared: number }
  | { kind: 'missing'; effective: number }
  | { kind: 'truncating'; effective: number; declared: number }
  | { kind: 'wasting'; effective: number; declared: number }
  | { kind: 'cramped'; effective: number; declared: number }

/**
 * Compare what Pi is told against what Ollama will give.
 *
 * `truncating` is the dangerous one and is reported whenever the declared window
 * exceeds what Ollama allocated, because the loss is silent. `wasting` uses a 2x
 * margin so ordinary rounding does not nag, while still catching the 32768-vs-262144
 * case that costs most of the usable context.
 */
export function judgeContextWindow(
  effective: number | null,
  declared: number | null,
): ContextWindowVerdict {
  if (effective == null) return { kind: 'unknown' }
  if (declared == null) return { kind: 'missing', effective }
  if (declared > effective) return { kind: 'truncating', effective, declared }
  // `wasting` outranks `cramped`: a small window with a much larger one available is
  // a fixable misconfiguration, whereas `cramped` means there is nothing better to be had.
  if (declared * 2 <= effective) return { kind: 'wasting', effective, declared }
  if (declared <= CRAMPED_CONTEXT_WINDOW) return { kind: 'cramped', effective, declared }
  return { kind: 'ok', effective, declared }
}

/** One-line explanation for the settings UI. */
export function describeContextWindowVerdict(verdict: ContextWindowVerdict, modelId: string): string {
  const fmt = (n: number) => n.toLocaleString('en-US')
  switch (verdict.kind) {
    case 'unknown':
      return `Could not read the context length for ${modelId} from Ollama.`
    case 'missing':
      return `Ollama gives ${modelId} ${fmt(verdict.effective)} tokens, but models.json does not declare a context window, so Pi assumes 128,000.`
    case 'truncating':
      return `models.json declares ${fmt(verdict.declared)} tokens for ${modelId} but Ollama only allocates ${fmt(verdict.effective)}. Ollama will silently drop the oldest tokens — including the system prompt — once a conversation passes that point.`
    case 'wasting':
      return `models.json declares ${fmt(verdict.declared)} tokens for ${modelId} but Ollama allocates ${fmt(verdict.effective)}. Pi compacts at ${fmt(Math.max(0, verdict.declared - PI_RESERVE_TOKENS))} tokens, discarding history far earlier than needed.`
    case 'cramped':
      return `models.json declares only ${fmt(verdict.declared)} tokens for ${modelId}. Pi reserves ${fmt(PI_RESERVE_TOKENS)} of that, so compaction starts at ${fmt(Math.max(0, verdict.declared - PI_RESERVE_TOKENS))} tokens.`
    case 'ok':
      return `${modelId}: ${fmt(verdict.declared)} tokens declared, ${fmt(verdict.effective)} available from Ollama.`
  }
}
