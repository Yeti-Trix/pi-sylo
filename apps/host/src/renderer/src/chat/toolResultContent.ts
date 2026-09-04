/**
 * Parse Pi tool results persisted in workflow telemetry (`resultSummary`).
 */

export type ToolResultImageSource = 'web' | 'document'

export type ToolResultImage = {
  mimeType: string
  /** Inline base64 data URL (legacy / pre-persist). */
  dataUrl?: string
  /** Absolute path on disk, resolved to a `sylo-file://` URL by the renderer. */
  localPath?: string
  caption: string
  /** Originating article/page URL parsed from the caption (for click-through). */
  sourceUrl?: string
  /** PDF or other operator document path when the image was rendered locally. */
  documentPath?: string
  source: ToolResultImageSource
}

export type ToolResultAudio = {
  mimeType: string
  dataUrl?: string
  localPath?: string
  label: string
}

/** Matches the text block that precedes a web-access preview/screenshot image. */
const IMAGE_CAPTION_RE =
  /^(?:web search preview image|web search viewport screenshot|preview image \(untrusted\)|viewport screenshot)/i

/** Matches captions for PDF page/region renders (schematic reader, etc.). */
const DOCUMENT_IMAGE_CAPTION_RE = /^pdf (?:page|region) preview/i

const DOCUMENT_RENDER_TOOLS = new Set([
  'render_schematic_page',
  'render_schematic_region',
  'search_schematic_pdf',
])

/** Pull the originating http(s) URL out of an image caption, if present. */
function captionSourceUrl(caption: string): string | undefined {
  const m = /https?:\/\/[^\s)]+/i.exec(caption)
  return m ? m[0] : undefined
}

function captionDocumentPath(caption: string): string | undefined {
  const m = /(?:^|\s)source:\s*(.+)$/i.exec(caption.trim())
  if (!m) return undefined
  const path = m[1].trim()
  return /^https?:\/\//i.test(path) ? undefined : path
}

function classifyImageCaption(caption: string): ToolResultImageSource {
  if (IMAGE_CAPTION_RE.test(caption)) return 'web'
  if (DOCUMENT_IMAGE_CAPTION_RE.test(caption)) return 'document'
  if (captionSourceUrl(caption)) return 'web'
  return 'web'
}

function buildToolResultImage(mime: string, caption: string, payload: { localPath?: string; dataUrl?: string }): ToolResultImage {
  const trimmed = caption.trim()
  const source = classifyImageCaption(trimmed)
  return {
    mimeType: mime,
    ...payload,
    caption: trimmed || (source === 'web' ? 'Web preview' : 'Document preview'),
    sourceUrl: source === 'web' ? captionSourceUrl(trimmed) : undefined,
    documentPath: source === 'document' ? captionDocumentPath(trimmed) : undefined,
    source,
  }
}

export type ToolResultImageGalleryCopy = {
  heading: string
  footnote: string
}

/** Heading and disclaimer for inline galleries above assistant text. */
export function toolResultImageGalleryCopy(
  images: ToolResultImage[],
  toolName?: string,
): ToolResultImageGalleryCopy {
  const forceDocument = toolName ? DOCUMENT_RENDER_TOOLS.has(toolName) : false
  const sources = images.map((img) => (forceDocument ? 'document' : img.source))
  const allWeb = sources.every((s) => s === 'web')
  const allDocument = sources.every((s) => s === 'document')

  if (allDocument) {
    return {
      heading: 'PDF page preview',
      footnote: 'Rendered from your uploaded PDF while the assistant analyzes that page.',
    }
  }
  if (allWeb) {
    return {
      heading: 'Images from web sources',
      footnote: 'Previews fetched from article pages (untrusted). Click to open the source page.',
    }
  }
  return {
    heading: 'Tool result images',
    footnote: 'Previews from tool output. Expand the tool row for details.',
  }
}

export type ParsedToolResult = {
  texts: string[]
  images: ToolResultImage[]
  audios: ToolResultAudio[]
}

const MAX_TEXT_IN_TELEMETRY = 12_000
const MAX_IMAGE_B64_IN_TELEMETRY = 500_000
const MAX_AUDIO_B64_IN_TELEMETRY = 2_000_000

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseContentBlocks(content: unknown[]): ParsedToolResult {
  const texts: string[] = []
  const images: ToolResultImage[] = []
  const audios: ToolResultAudio[] = []
  let pendingCaption = ''
  let pendingAudioLabel = ''

  for (const block of content) {
    const b = asRecord(block)
    if (!b) continue
    if (b.type === 'text' && typeof b.text === 'string') {
      const t = b.text.trim()
      if (!t) continue
      if (IMAGE_CAPTION_RE.test(t) || DOCUMENT_IMAGE_CAPTION_RE.test(t)) {
        pendingCaption = t
        continue
      }
      if (/^Speech \(/i.test(t)) {
        pendingAudioLabel = t
        continue
      }
      if (/^\(Attached \d+ image\(s\)|images were omitted/i.test(t)) {
        texts.push(t)
        continue
      }
      texts.push(t)
      pendingCaption = ''
      pendingAudioLabel = ''
      continue
    }
    if (b.type === 'image') {
      const mime =
        typeof b.mimeType === 'string' && b.mimeType.startsWith('image/') ?
          b.mimeType
        : 'image/jpeg'
      if (typeof b._localPath === 'string' && b._localPath.length > 0) {
        images.push(buildToolResultImage(mime, pendingCaption, { localPath: b._localPath }))
        pendingCaption = ''
        continue
      }
      if (typeof b.data === 'string' && b.data.length > 0) {
        const raw = b.data.replace(/\s/g, '')
        images.push(
          buildToolResultImage(mime, pendingCaption, { dataUrl: `data:${mime};base64,${raw}` }),
        )
        pendingCaption = ''
      }
    }
    if (b.type === 'audio') {
      const mime =
        typeof b.mimeType === 'string' && b.mimeType.startsWith('audio/') ?
          b.mimeType
        : 'audio/wav'
      const label = pendingAudioLabel.trim() || 'Speech'
      if (typeof b._localPath === 'string' && b._localPath.length > 0) {
        audios.push({ mimeType: mime, localPath: b._localPath, label })
        pendingAudioLabel = ''
        continue
      }
      if (typeof b.data === 'string' && b.data.length > 0) {
        const raw = b.data.replace(/\s/g, '')
        audios.push({
          mimeType: mime,
          dataUrl: `data:${mime};base64,${raw}`,
          label,
        })
        pendingAudioLabel = ''
      }
    }
  }

  return { texts, images, audios }
}

/** Extract displayable text and images from a stored tool result preview. */
export function parseToolResultBlocks(preview: unknown): ParsedToolResult {
  if (preview === null || preview === undefined) {
    return { texts: [], images: [], audios: [] }
  }

  if (typeof preview === 'string') {
    const t = preview.trim()
    if (!t) return { texts: [], images: [], audios: [] }
    try {
      return parseToolResultBlocks(JSON.parse(t) as unknown)
    } catch {
      return { texts: [t.length > 2000 ? t.slice(0, 2000) + '…' : t], images: [], audios: [] }
    }
  }

  const root = asRecord(preview)
  if (!root) return { texts: [String(preview)], images: [], audios: [] }

  if (Array.isArray(root.content)) {
    return parseContentBlocks(root.content)
  }

  try {
    const flat = JSON.stringify(preview)
    return {
      texts: [flat.length > 2000 ? flat.slice(0, 2000) + '…' : flat],
      images: [],
      audios: [],
    }
  } catch {
    return { texts: [String(preview)], images: [], audios: [] }
  }
}

/**
 * Resolve a displayable `src` for a tool-result image. Disk-backed images go
 * through the `sylo-file://` protocol; legacy inline images use their data URL.
 */
export function toolImageSrc(
  img: ToolResultImage,
  resolveImageUrl?: (path: string) => string | null,
): string | null {
  if (img.localPath) {
    const resolved =
      resolveImageUrl?.(img.localPath) ??
      (typeof window !== 'undefined' ?
        (window.sylo?.files?.localImageUrl(img.localPath) ?? null)
      : null)
    return resolved ?? null
  }
  return img.dataUrl ?? null
}

export function toolAudioSrc(
  audio: ToolResultAudio,
  resolveFileUrl?: (path: string) => string | null,
): string | null {
  if (audio.localPath) {
    const resolved =
      resolveFileUrl?.(audio.localPath) ??
      (typeof window !== 'undefined' ?
        (window.sylo?.files?.localImageUrl(audio.localPath) ?? null)
      : null)
    return resolved ?? null
  }
  return audio.dataUrl ?? null
}

/** Collect every image across a set of tool-result previews (e.g. all tool segments). */
export function collectToolResultImages(previews: unknown[]): ToolResultImage[] {
  const out: ToolResultImage[] = []
  const seen = new Set<string>()
  for (const preview of previews) {
    for (const img of parseToolResultBlocks(preview).images) {
      const key = img.localPath ?? img.dataUrl ?? ''
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(img)
    }
  }
  return out
}

export function collectToolResultAudios(previews: unknown[]): ToolResultAudio[] {
  const out: ToolResultAudio[] = []
  const seen = new Set<string>()
  for (const preview of previews) {
    for (const audio of parseToolResultBlocks(preview).audios) {
      const key = audio.localPath ?? audio.dataUrl ?? ''
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(audio)
    }
  }
  return out
}

/** One-line summary for collapsed tool row header. */
export function toolResultSummaryLine(preview: unknown): string {
  const { texts, images, audios } = parseToolResultBlocks(preview)
  if (audios.length > 0) {
    return `${audios.length} audio clip(s) — expand to play`
  }
  if (images.length > 0) {
    const textNote = texts.length > 0 ? `, ${texts.length} text section(s)` : ''
    return `${images.length} image preview(s)${textNote} — expand to view`
  }
  if (texts.length === 0) return ''
  const joined = texts.join(' ').replace(/\s+/g, ' ').trim()
  return joined.length > 140 ? joined.slice(0, 140) + '…' : joined
}

/** Shrink tool result for workflow telemetry while keeping image payloads for the UI. */
export function shrinkToolResultForTelemetry(result: unknown): unknown {
  if (result === null || result === undefined) return result
  if (typeof result === 'string') {
    return result.length > MAX_TEXT_IN_TELEMETRY ?
        result.slice(0, MAX_TEXT_IN_TELEMETRY) + '…'
      : result
  }

  const root = asRecord(result)
  if (!root) return result

  if (Array.isArray(root.content)) {
    const out: unknown[] = []
    let imageCount = 0
    let audioCount = 0
    for (const block of root.content) {
      const b = asRecord(block)
      if (!b) continue
      if (b.type === 'audio') {
        if (typeof b._localPath === 'string' && b._localPath.length > 0) {
          out.push({ type: 'audio', mimeType: b.mimeType ?? 'audio/wav', _localPath: b._localPath })
          audioCount++
          continue
        }
        if (typeof b.data === 'string' && audioCount < 2) {
          audioCount++
          const data =
            b.data.length > MAX_AUDIO_B64_IN_TELEMETRY ?
              b.data.slice(0, MAX_AUDIO_B64_IN_TELEMETRY)
            : b.data
          out.push({ type: 'audio', mimeType: b.mimeType ?? 'audio/wav', data })
        }
        continue
      }
      if (b.type === 'image' && typeof b.data === 'string') {
        if (imageCount >= 4) continue
        imageCount++
        const data =
          b.data.length > MAX_IMAGE_B64_IN_TELEMETRY ?
            b.data.slice(0, MAX_IMAGE_B64_IN_TELEMETRY)
          : b.data
        out.push({ type: 'image', mimeType: b.mimeType ?? 'image/jpeg', data })
        continue
      }
      if (b.type === 'text' && typeof b.text === 'string') {
        const text =
          b.text.length > MAX_TEXT_IN_TELEMETRY ?
            b.text.slice(0, MAX_TEXT_IN_TELEMETRY) + '…'
          : b.text
        out.push({ type: 'text', text })
      }
    }
    return {
      content: out,
      ...(root.details !== undefined ? { details: root.details } : {}),
      ...(root.isError !== undefined ? { isError: root.isError } : {}),
    }
  }

  try {
    const s = JSON.stringify(result)
    return s.length > 4000 ? s.slice(0, 4000) + '…' : (JSON.parse(s) as unknown)
  } catch {
    return String(result).slice(0, 2000)
  }
}
