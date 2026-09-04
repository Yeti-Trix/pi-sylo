import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

// `@earendil-works/pi-ai` is a transitive type-only dependency of pi-coding-agent
// that is not installed directly (these imports are erased by esbuild at build
// time). Define the two content-block shapes locally so tsc can resolve them;
// they are structurally identical to pi-ai's `TextContent` / `ImageContent`.
type TextContent = { type: 'text'; text: string }
type ImageContent = { type: 'image'; data: string; mimeType: string }

const SYLO_IMAGE_MODEL_ID = 'SYLO_IMAGE_MODEL_ID'
const SYLO_IMAGE_MODEL_PROVIDER = 'SYLO_IMAGE_MODEL_PROVIDER'
const SYLO_OLLAMA_BASE_ORIGIN = 'SYLO_OLLAMA_BASE_ORIGIN'

const VISION_MODEL_ID =
  /vl|vision|llava|gemini|gpt-4o|claude-3|claude-4|pixtral|minicpm-v|qwen[\d.]*vl|qwen3\.[56]|moondream|llama3\.2-vision|bakllava|kimi/i

const PI_IMAGE_OMITTED = /Current model does not support images/i

type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

function toolError(text: string): { content: ToolContentBlock[]; details: undefined } {
  return { content: [{ type: 'text', text }], details: undefined }
}

function modelSupportsVision(ctx: ExtensionContext): boolean {
  const m = ctx.model as { id?: string; input?: string[]; capabilities?: string[] } | undefined
  if (!m) return false
  const id = (m.id ?? '').toLowerCase()
  if (VISION_MODEL_ID.test(id)) return true
  if (Array.isArray(m.capabilities) && m.capabilities.includes('vision')) return true
  if (Array.isArray(m.input) && m.input.includes('image')) return true
  return false
}

function readImageFallbackEnv(): { modelId: string; provider: string; ollamaOrigin: string } {
  return {
    modelId: (process.env[SYLO_IMAGE_MODEL_ID] ?? '').trim(),
    provider: (process.env[SYLO_IMAGE_MODEL_PROVIDER] ?? 'ollama').trim(),
    ollamaOrigin: (process.env[SYLO_OLLAMA_BASE_ORIGIN] ?? 'http://127.0.0.1:11434').trim(),
  }
}

/** True if a tool result includes image content (bytes) a text-only model can't see. */
function hasImageContent(content: (TextContent | ImageContent)[]): boolean {
  return content.some((b) => b.type === 'image')
}

/** Keep text blocks but drop image bytes and Pi's "image omitted" boilerplate. */
function keepTextOnly(content: (TextContent | ImageContent)[]): TextContent[] {
  const out: TextContent[] = []
  for (const b of content) {
    if (b.type !== 'text') continue
    const text = (b as TextContent).text ?? ''
    if (PI_IMAGE_OMITTED.test(text)) continue
    out.push(b as TextContent)
  }
  return out
}

/**
 * Resolve which vision model `analyze_image` should call, following the existing
 * Settings "supports vision" checkbox (Pi `model.input` includes "image"):
 *  - main model vision-capable → route to the main model (ignore the backup)
 *  - otherwise                  → route to the Settings image (backup) model
 * Both are reached via the configured Ollama origin using Ollama `/api/chat`.
 */
function resolveVisionTarget(
  ctx: ExtensionContext,
): { id: string; origin: string; source: 'main' | 'backup' } | { error: string } {
  const env = readImageFallbackEnv()
  const m = ctx.model as { id?: string; input?: string[]; provider?: string; baseUrl?: string } | undefined
  const mainVision = !!(m && Array.isArray(m.input) && m.input.includes('image'))
  if (mainVision && m && m.id) {
    const baseUrl = (m.baseUrl ?? '').toLowerCase()
    const providerOk =
      (typeof m.provider === 'string' && m.provider.toLowerCase() === 'ollama') ||
      baseUrl.includes('127.0.0.1:11434') ||
      baseUrl.includes('localhost:11434')
    if (!providerOk) {
      return {
        error:
          `Main model "${m.id}" is vision-capable but is not served by the Ollama origin ` +
          `(${env.ollamaOrigin}); the image was already delivered to the main model in-context. ` +
          `Re-paste the image to reload it, or configure an Ollama-hosted vision model.`,
      }
    }
    return { id: m.id, origin: env.ollamaOrigin, source: 'main' }
  }
  if (!env.modelId) {
    return {
      error:
        'No vision model configured. Enable "supports vision" on the main model in Settings, ' +
        'or set an Image model (fallback) — then call analyze_image again.',
    }
  }
  if (env.provider !== 'ollama') {
    return { error: `Backup image model provider "${env.provider}" is not supported by analyze_image (Ollama only).` }
  }
  return { id: env.modelId, origin: env.ollamaOrigin, source: 'backup' }
}

function mimeForPath(p: string): string {
  const ext = extname(p).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

/** Call Ollama native `/api/chat` with a base64 image and a model-written prompt. */
async function analyzeImageViaOllama(opts: {
  origin: string
  modelId: string
  imageBase64: string
  prompt: string
  timeoutMs?: number
  /** Run abort signal (from the tool executor) — aborts the fetch immediately on Stop. */
  signal?: AbortSignal
}): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  let url: URL
  try {
    url = new URL('/api/chat', `${opts.origin.replace(/\/$/, '')}/`)
  } catch {
    return { ok: false, error: 'invalid_ollama_origin' }
  }
  const ac = new AbortController()
  // Honor the run's abort signal (Stop) in addition to the timeout, so a vision
  // call can't keep the agent in `isStreaming` after the operator hits Stop.
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort()
    else opts.signal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  const timeout = setTimeout(() => ac.abort(), opts.timeoutMs ?? 120_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: opts.modelId,
        messages: [
          {
            role: 'user',
            content: opts.prompt,
            images: [opts.imageBase64],
          },
        ],
        stream: false,
        options: { temperature: 0.1 },
      }),
    })
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 300)
      } catch {
        /* ignore */
      }
      return { ok: false, error: `ollama_http_${res.status}${detail ? `: ${detail}` : ''}` }
    }
    const data = (await res.json()) as { message?: { content?: unknown } }
    const text = typeof data.message?.content === 'string' ? data.message.content.trim() : ''
    if (!text) return { ok: false, error: 'ollama_empty_content' }
    return { ok: true, content: text }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return { ok: false, error: 'ollama_timeout' }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * When the main chat model is text-only, describe tool-result images via Settings → image model.
 * Think-tank seats use the same hook in sylo-think-tank (seat subprocess only); this covers main chat.
 */
export default function syloImageFallback(pi: ExtensionAPI): void {
  pi.on('tool_result', (event, ctx) => {
    // Vision-capable main model: let image bytes through unchanged.
    if (modelSupportsVision(ctx)) return undefined
    // Text-only main model: a tool (e.g. read, extract_docx_images) returned image content the
    // model can't see. Don't auto-describe with a fixed prompt — steer the model to analyze_image
    // so it writes its own targeted prompt for the same path it already has.
    if (!hasImageContent(event.content)) return undefined
    const textBlocks = keepTextOnly(event.content)
    return {
      content: [
        ...textBlocks,
        {
          type: 'text',
          text:
            'This tool returned image content, but the current model cannot see pixels directly. ' +
            'To inspect the image, call the `analyze_image` tool with the image path (the same path ' +
            'you used here, or the path reported by the tool) and a specific prompt ' +
            '(e.g. "read the value in the highlighted box").',
        },
      ],
      details: event.details,
      isError: event.isError,
    }
  })

  /**
   * `analyze_image` — let the main model direct image analysis with its own prompt.
   * Routes to the main model when its "supports vision" checkbox is on, else to the Settings
   * image (backup) model. Always available so the workflow is identical whether or not the main
   * model sees pixels in-context; only the routing target differs.
   */
  pi.registerTool({
    name: 'analyze_image',
    label: 'Analyze image',
    description:
      'Analyze an image file by sending it to the configured vision model with a prompt you write. ' +
      'Use this for any attached image path when you need to read text, values, or details you cannot see directly ' +
      '(the main chat model may be text-only). Routing follows Settings: if the main model has "supports vision" checked, ' +
      'the image is sent to the main model; otherwise it is sent to the Settings image (fallback) model. ' +
      'Returns the vision model\'s answer, or an error if no vision model is configured / the model cannot process images.',
    parameters: Type.Object({
      path: Type.String({
        description: 'Absolute or cwd-relative path to a local image file (png, jpg, gif, webp).',
      }),
      prompt: Type.String({
        description:
          'The question/instruction for the vision model about the image, written by you. ' +
          'Be specific (e.g. "read the rung label in the lower-left box", "what is the value of the highlighted tag").',
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const rawPath = String(params.path ?? '').trim()
      if (!rawPath) return toolError('analyze_image requires a path.')
      if (/^https?:\/\//i.test(rawPath)) {
        return toolError('analyze_image supports local file paths only (got a URL).')
      }
      const prompt = String(params.prompt ?? '').trim()
      if (!prompt) return toolError('analyze_image requires a prompt.')
      if (!existsSync(rawPath)) return toolError(`Image not found: ${rawPath}`)

      let base64: string
      try {
        base64 = readFileSync(rawPath).toString('base64')
      } catch (e) {
        return toolError(`Failed to read image: ${e instanceof Error ? e.message : String(e)}`)
      }

      const target = resolveVisionTarget(ctx)
      if ('error' in target) return toolError(target.error)

      const result = await analyzeImageViaOllama({
        origin: target.origin,
        modelId: target.id,
        imageBase64: base64,
        prompt,
        signal,
      })
      if (!result.ok) {
        return toolError(
          `analyze_image failed (${result.error}). ` +
            (target.source === 'main'
              ? 'The main model was used (vision checkbox on).'
              : 'The Settings image (fallback) model was used.'),
        )
      }
      return {
        content: [
          {
            type: 'text',
            text:
              `[analyze_image — ${target.source === 'main' ? 'main model' : 'fallback model'} ${target.id}]\n\n` +
              result.content,
          },
        ],
        details: undefined,
      }
    },
  })
}