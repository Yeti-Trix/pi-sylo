/**
 * User chat messages that include dropped files append a structured block so Pi/tools
 * receive absolute paths. The renderer parses the same shape to show chips in the bubble.
 */

import {
  stripImageDeliveryBlock,
  type ImageDeliverySummary,
} from '../../shared/chat-image-delivery.js'
import {
  formatUserMessageWithAttachments as formatAttachmentBlock,
  TEXT_AFTER_ATTACHMENTS_SEP,
  USER_ATTACHMENT_PREAMBLE,
} from '../../shared/chat-user-attachment-prompt.js'

export { USER_ATTACHMENT_PREAMBLE }

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
])

export function isImageAttachmentPath(name: string, path: string): boolean {
  const fromName = extname(name).toLowerCase()
  if (fromName && IMAGE_ATTACHMENT_EXTENSIONS.has(fromName)) return true
  return IMAGE_ATTACHMENT_EXTENSIONS.has(extname(path).toLowerCase())
}

function extname(filePath: string): string {
  const base = filePath.replace(/^.*[/\\]/, '')
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot) : ''
}

export function formatUserMessageWithAttachments(
  trimmed: string,
  attachments: { path: string; name: string }[],
): string {
  const resolved = attachments.filter((a) => a.path.trim())
  if (resolved.length === 0) return trimmed
  const lines = resolved.map((a) => `- ${a.path}  (name: ${a.name})`)
  // Attachments first so the model sees full paths before the question (reduces “search project for image.png”).
  return formatAttachmentBlock(trimmed, lines)
}

export function splitUserMessageAttachments(content: string): {
  text: string
  attachments: { path: string; name: string }[]
  delivery: ImageDeliverySummary | null
} {
  const { text: stripped, delivery } = stripImageDeliveryBlock(content)
  const idxSep = stripped.indexOf(TEXT_AFTER_ATTACHMENTS_SEP)
  if (idxSep !== -1) {
    const head = stripped.slice(0, idxSep)
    const tail = stripped.slice(idxSep + TEXT_AFTER_ATTACHMENTS_SEP.length).trimEnd()
    if (head.startsWith(USER_ATTACHMENT_PREAMBLE)) {
      return { text: tail, attachments: parseAttachmentLines(head), delivery }
    }
  }

  if (stripped.startsWith(USER_ATTACHMENT_PREAMBLE)) {
    return { text: '', attachments: parseAttachmentLines(stripped), delivery }
  }

  return { text: stripped, attachments: [], delivery }
}

function parseAttachmentLines(tail: string): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = []
  for (const line of tail.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const parsed = parseAttachmentLine(t)
    if (parsed) out.push(parsed)
  }
  return out
}

/** `- <path>  (name: <name>)` — path may contain spaces; split on last `  (name: `. */
function parseAttachmentLine(line: string): { path: string; name: string } | null {
  if (!line.startsWith('- ')) return null
  const marker = '  (name: '
  const mi = line.lastIndexOf(marker)
  if (mi < 2 || !line.endsWith(')')) return null
  const path = line.slice(2, mi)
  const name = line.slice(mi + marker.length, -1)
  if (!path || !name) return null
  return { path, name }
}

export type PastedImageWriter = {
  pathFromWebFile: (file: File) => string
  writePastedImage: (data: ArrayBuffer, mimeType: string) => Promise<{ path: string; name: string }>
}

/**
 * Resolve an on-disk path for a File, or persist clipboard/in-memory image bytes under userData.
 * Clipboard pastes often have no backing path — `getPathForFile` returns "" instead of throwing.
 */
export async function resolveImageAttachmentFromFile(
  file: File,
  io: PastedImageWriter,
): Promise<{ path: string; name: string }> {
  let path = ''
  try {
    path = io.pathFromWebFile(file).trim()
  } catch {
    /* in-memory / clipboard file */
  }
  if (path) {
    const name = file.name?.trim() || path.replace(/^.*[/\\]/, '') || 'image'
    return { path, name }
  }
  const written = await io.writePastedImage(
    await file.arrayBuffer(),
    file.type || 'image/png',
  )
  return written
}

/** First image file on the clipboard (screenshot paste, copied image from an app, etc.). */
export function firstClipboardImageFile(dt: DataTransfer | null): File | null {
  if (!dt) return null
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files.item(i)
      if (f?.type.startsWith('image/')) return f
    }
  }
  for (let i = 0; i < (dt.items?.length ?? 0); i++) {
    const it = dt.items[i]
    if (it?.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) return f
    }
  }
  return null
}
