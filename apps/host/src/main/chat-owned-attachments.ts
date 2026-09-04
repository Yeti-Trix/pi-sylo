/**
 * Sylo-owned chat attachments (paste images + companion uploads) live in flat
 * userData dirs; paths are embedded in message text. Clean on conversation
 * delete when no other chat still references the file; age-GC unreferenced leftovers.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join, resolve, sep } from 'node:path'

import * as db from './database.js'
import {
  COMPANION_UPLOAD_DIR_NAME,
  isCompanionManagedUploadPath,
} from './companion/companion-upload.js'

export const PASTE_IMAGES_DIR_NAME = 'sylo-paste-images'
/** Unreferenced paste/companion files older than this are removed on startup. */
export const CHAT_ATTACHMENT_ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function pasteImagesRoot(userDataPath: string): string {
  return join(userDataPath, PASTE_IMAGES_DIR_NAME)
}

function resolvedPasteRoot(userDataPath: string): string {
  return resolve(pasteImagesRoot(userDataPath))
}

export function isPasteManagedUploadPath(userDataPath: string, filePath: string): boolean {
  const trimmed = filePath.trim()
  if (!trimmed) return false
  try {
    const abs = resolve(trimmed)
    const root = resolvedPasteRoot(userDataPath)
    return abs === root || abs.startsWith(root + sep)
  } catch {
    return false
  }
}

export function isManagedChatAttachmentPath(userDataPath: string, filePath: string): boolean {
  return (
    isPasteManagedUploadPath(userDataPath, filePath) ||
    isCompanionManagedUploadPath(userDataPath, filePath)
  )
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function pathSearchVariants(filePath: string): string[] {
  const abs = resolve(filePath.trim())
  const fwd = abs.replace(/\\/g, '/')
  const back = abs.replace(/\//g, '\\')
  return [...new Set([abs, fwd, back])]
}

/** True if any message (optionally excluding one conversation) still mentions this path. */
export function anyMessageReferencesPath(
  filePath: string,
  excludeConversationId?: string,
): boolean {
  const trimmed = filePath.trim()
  if (!trimmed) return false
  const d = db.getDb()
  const exclude = excludeConversationId?.trim() || ''
  for (const variant of pathSearchVariants(trimmed)) {
    const like = `%${escapeLike(variant)}%`
    const row =
      exclude ?
        (d
          .prepare(
            `SELECT 1 as x FROM messages
             WHERE conversation_id != ? AND content LIKE ? ESCAPE '\\'
             LIMIT 1`,
          )
          .get(exclude, like) as { x: number } | undefined)
      : (d
          .prepare(`SELECT 1 as x FROM messages WHERE content LIKE ? ESCAPE '\\' LIMIT 1`)
          .get(like) as { x: number } | undefined)
    if (row) return true
  }
  return false
}

function collectPathsFromAttachmentLines(userDataPath: string, content: string): string[] {
  const out: string[] = []
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('- ')) continue
    const marker = '  (name: '
    const mi = t.lastIndexOf(marker)
    if (mi < 2 || !t.endsWith(')')) continue
    const p = t.slice(2, mi).trim()
    if (p && isManagedChatAttachmentPath(userDataPath, p)) out.push(resolve(p))
  }
  return out
}

function collectPathsFromJsonPathFields(userDataPath: string, content: string): string[] {
  const out: string[] = []
  const re = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    let raw = m[1] ?? ''
    try {
      raw = JSON.parse(`"${raw}"`) as string
    } catch {
      raw = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    const p = raw.trim()
    if (p && isManagedChatAttachmentPath(userDataPath, p)) out.push(resolve(p))
  }
  return out
}

export function collectManagedChatAttachmentPaths(
  userDataPath: string,
  contents: readonly string[],
): string[] {
  const found = new Set<string>()
  for (const content of contents) {
    if (!content) continue
    for (const p of collectPathsFromAttachmentLines(userDataPath, content)) found.add(p)
    for (const p of collectPathsFromJsonPathFields(userDataPath, content)) found.add(p)
  }
  return [...found]
}

function bestEffortUnlink(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {
    /* best-effort */
  }
}

/**
 * Remove paste/companion files referenced only by this conversation.
 * Call before deleting the conversation's messages.
 */
export function deleteOwnedChatAttachmentsForConversation(
  userDataPath: string,
  conversationId: string,
): void {
  const id = conversationId.trim()
  if (!id) return
  const messages = db.listMessages(id)
  const paths = collectManagedChatAttachmentPaths(
    userDataPath,
    messages.map((m) => m.content ?? ''),
  )
  for (const filePath of paths) {
    if (anyMessageReferencesPath(filePath, id)) continue
    bestEffortUnlink(filePath)
  }
}

function pruneDirOrphans(
  userDataPath: string,
  dir: string,
  maxAgeMs: number,
  isManaged: (userDataPath: string, filePath: string) => boolean,
): number {
  if (!existsSync(dir)) return 0
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of entries) {
    const full = join(dir, name)
    try {
      const st = statSync(full)
      if (!st.isFile()) continue
      if (st.mtimeMs >= cutoff) continue
      if (!isManaged(userDataPath, full)) continue
      if (anyMessageReferencesPath(full)) continue
      unlinkSync(full)
      removed += 1
    } catch {
      /* skip */
    }
  }
  return removed
}

/** Startup: drop old unreferenced paste/companion files (never-sent or already-orphaned). */
export function pruneOrphanChatAttachments(
  userDataPath: string,
  maxAgeMs: number = CHAT_ATTACHMENT_ORPHAN_MAX_AGE_MS,
): number {
  const pasteDir = pasteImagesRoot(userDataPath)
  const companionDir = join(userDataPath, COMPANION_UPLOAD_DIR_NAME)
  return (
    pruneDirOrphans(userDataPath, pasteDir, maxAgeMs, isPasteManagedUploadPath) +
    pruneDirOrphans(userDataPath, companionDir, maxAgeMs, isCompanionManagedUploadPath)
  )
}

/** Ensure paste dir exists (clipboard / canvas write path). */
export function ensurePasteImagesDir(userDataPath: string): string {
  const dir = pasteImagesRoot(userDataPath)
  mkdirSync(dir, { recursive: true })
  return dir
}
