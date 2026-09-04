/**
 * Normalize tool-result images for Pi → Ollama vision.
 *
 * Ollama rejects WebP/AVIF/HTML blobs, data-URL prefixes, and oversized payloads
 * with 400 "Failed to load image or audio file".
 */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

/** Max images attached to a single tool result (across all pages). */
export const MAX_TOOL_RESULT_IMAGES = 2

/** Max decoded bytes per image in tool results (Ollama-safe). */
export const MAX_TOOL_IMAGE_BYTES = 900_000

export type ToolImageBlock = { type: 'image'; data: string; mimeType: string }

export function isOllamaProvider(ctx: ExtensionContext): boolean {
  const m = ctx.model as { provider?: string; baseUrl?: string; id?: string } | undefined
  const p = (m?.provider ?? '').toLowerCase()
  const u = (m?.baseUrl ?? process.env.OLLAMA_HOST ?? '').toLowerCase()
  return p === 'ollama' || u.includes('ollama') || /:11434\b/.test(u)
}

/** Strip `data:image/...;base64,` and whitespace from a payload. */
export function stripBase64Payload(data: string): string {
  const t = data.trim()
  const m = /^data:image\/[a-z0-9+.-]+;base64,(.+)$/is.exec(t)
  const raw = (m ? m[1] : t).replace(/\s/g, '')
  const pad = raw.length % 4
  if (pad === 0) return raw
  return raw + '='.repeat(4 - pad)
}

export function sniffImageFormat(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif'
  }
  return null
}

/**
 * Validate and normalize one image block for tool results.
 *
 * @returns A Pi-safe block, or null when bytes are not Ollama-compatible PNG/JPEG/GIF.
 */
export function prepareImageForToolResult(
  data: string,
  declaredMime?: string,
): ToolImageBlock | null {
  const raw = stripBase64Payload(data)
  if (!raw || raw.length < 128) return null
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) return null

  let buf: Buffer
  try {
    buf = Buffer.from(raw, 'base64')
  } catch {
    return null
  }
  if (buf.length < 256 || buf.length > MAX_TOOL_IMAGE_BYTES) return null

  const sniffed = sniffImageFormat(buf)
  if (!sniffed) return null

  // Declared MIME can lie (AVIF served as image/jpeg); magic bytes win.
  void declaredMime
  return { type: 'image', data: buf.toString('base64'), mimeType: sniffed }
}

/**
 * Append image blocks up to {@link MAX_TOOL_RESULT_IMAGES}, skipping invalid payloads.
 */
export function appendSanitizedImages(
  content: Array<{ type: 'text'; text: string } | ToolImageBlock>,
  label: string,
  data: string,
  mimeType: string,
  imageCount: { n: number },
): void {
  if (imageCount.n >= MAX_TOOL_RESULT_IMAGES) return
  const block = prepareImageForToolResult(data, mimeType)
  if (!block) return
  content.push({ type: 'text', text: label })
  content.push(block)
  imageCount.n++
}
