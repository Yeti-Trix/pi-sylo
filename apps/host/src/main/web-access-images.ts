/**
 * Persist tool-result images (web search, PDF renders, etc.) to disk so the
 * chat UI can render them via the `sylo-file://` protocol without bloating
 * SQLite with base64. Files live under a per-conversation folder and are removed
 * when the conversation is deleted (or after the 30-day retention purge).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

function imagesRoot(userDataPath: string): string {
  return join(userDataPath, 'sylo-web-images')
}

function conversationImageDir(userDataPath: string, conversationId: string): string {
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(imagesRoot(userDataPath), safe)
}

function isImageBlock(b: unknown): b is { type: 'image'; data: string; mimeType?: string } {
  if (!b || typeof b !== 'object') return false
  const r = b as Record<string, unknown>
  return r.type === 'image' && typeof r.data === 'string' && r.data.length > 0
}

/**
 * Walk a persisted tool event, write any base64 image blocks to disk, and
 * replace the `data` field with `_localPath` (absolute) so SQLite stays small.
 * Mutates a shallow-cloned copy; returns the event to persist.
 *
 * @param userDataPath - Electron `userData` dir.
 * @param conversationId - Owning conversation (folder name).
 * @param event - Slim tool event (`tool_execution_end` with `resultSummary`).
 */
export function persistToolResultImages(
  userDataPath: string,
  conversationId: string,
  event: unknown,
): unknown {
  if (!event || typeof event !== 'object') return event
  const ev = event as Record<string, unknown>
  if (ev.type !== 'tool_execution_end') return event

  const result = ev.resultSummary
  if (!result || typeof result !== 'object') return event
  const resultObj = result as Record<string, unknown>
  const content = resultObj.content
  if (!Array.isArray(content)) return event

  let wroteAny = false
  let dir = ''
  const newContent = content.map((block) => {
    if (!isImageBlock(block)) return block
    const raw = block.data.replace(/\s/g, '')
    let buf: Buffer
    try {
      buf = Buffer.from(raw, 'base64')
    } catch {
      return block
    }
    if (buf.length < 128) return block
    const mime = (block.mimeType ?? 'image/jpeg').toLowerCase()
    const ext = EXT_BY_MIME[mime] ?? '.jpg'
    const hash = createHash('sha1').update(buf).digest('hex').slice(0, 16)
    if (!dir) {
      dir = conversationImageDir(userDataPath, conversationId)
      mkdirSync(dir, { recursive: true })
    }
    const filePath = join(dir, `${hash}${ext}`)
    try {
      if (!existsSync(filePath)) writeFileSync(filePath, buf)
      wroteAny = true
      return { type: 'image', mimeType: mime, _localPath: filePath }
    } catch {
      return block
    }
  })

  if (!wroteAny) return event
  return {
    ...ev,
    resultSummary: { ...resultObj, content: newContent },
  }
}

/** Remove all stored images for a conversation (called on conversation delete). */
export function deleteWebAccessImagesForConversation(
  userDataPath: string,
  conversationId: string,
): void {
  const dir = conversationImageDir(userDataPath, conversationId)
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
}
