import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'

import { describeImagesViaOllamaFallback } from './image-model-fallback.ts'
import { modelSupportsVision } from './model-vision.ts'
import {
  SYLO_IMAGE_MODEL_ID_ENV,
  SYLO_IMAGE_MODEL_PROVIDER_ENV,
  SYLO_OLLAMA_BASE_ORIGIN_ENV,
} from './spawn-seat.ts'

export function readSeatImageFallbackEnv(env: NodeJS.ProcessEnv = process.env): {
  modelId: string
  provider: string
  ollamaOrigin: string
} {
  return {
    modelId: (env[SYLO_IMAGE_MODEL_ID_ENV] ?? '').trim(),
    provider: (env[SYLO_IMAGE_MODEL_PROVIDER_ENV] ?? 'ollama').trim(),
    ollamaOrigin: (env[SYLO_OLLAMA_BASE_ORIGIN_ENV] ?? 'http://127.0.0.1:11434').trim(),
  }
}

function splitToolContent(content: (TextContent | ImageContent)[]): {
  textBlocks: TextContent[]
  images: ImageContent[]
} {
  const textBlocks: TextContent[] = []
  const images: ImageContent[] = []
  for (const block of content) {
    if (block.type === 'image') images.push(block)
    else if (block.type === 'text') textBlocks.push(block)
  }
  return { textBlocks, images }
}

/** Replace image blocks with vision-model prose when the seat model is text-only. */
export async function rewriteToolResultForTextOnlySeat(opts: {
  content: (TextContent | ImageContent)[]
  modelId: string
  provider: string
  ollamaOrigin: string
}): Promise<(TextContent | ImageContent)[] | null> {
  const { textBlocks, images } = splitToolContent(opts.content)
  if (images.length === 0) return null
  if (!opts.modelId || opts.provider !== 'ollama') {
    return [
      ...textBlocks,
      {
        type: 'text',
        text:
          '[Sylo: tool returned image(s) but this seat model is text-only and no Ollama image model is configured in Settings.]',
      },
    ]
  }

  const described = await describeImagesViaOllamaFallback({
    origin: opts.ollamaOrigin,
    modelId: opts.modelId,
    images,
    contextText: textBlocks.map((b) => b.text).join('\n\n'),
  })

  if (!described.ok) {
    return [
      ...textBlocks,
      {
        type: 'text',
        text:
          `[Sylo vision fallback failed (${described.error}). Images omitted for text-only seat model.]`,
      },
    ]
  }

  return [
    ...textBlocks,
    {
      type: 'text',
      text:
        `[Sylo vision fallback — image description from Settings image model (${opts.modelId})]\n\n` +
        described.description,
    },
  ]
}

/** When a think tank seat uses a text-only model, describe tool-result images via Settings image model. */
export default function registerSeatImageFallback(pi: ExtensionAPI): void {
  pi.on('tool_result', async (event, ctx) => {
    if (modelSupportsVision(ctx)) return undefined

    if (splitToolContent(event.content).images.length === 0) return undefined

    const env = readSeatImageFallbackEnv()
    const rewritten = await rewriteToolResultForTextOnlySeat({
      content: event.content,
      modelId: env.modelId,
      provider: env.provider,
      ollamaOrigin: env.ollamaOrigin,
    })
    if (!rewritten) return undefined

    return {
      content: rewritten,
      details: event.details,
      isError: event.isError,
    }
  })
}
