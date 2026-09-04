import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export const COMPANION_UPLOAD_DIR_NAME = 'sylo-companion-uploads'
export const MAX_COMPANION_UPLOAD_BYTES = 25 * 1024 * 1024

export function companionUploadDir(userDataPath: string): string {
  return join(userDataPath, COMPANION_UPLOAD_DIR_NAME)
}

export function companionUploadRoot(userDataPath: string): string {
  const dir = companionUploadDir(userDataPath)
  mkdirSync(dir, { recursive: true })
  return dir
}

function resolvedUploadRoot(userDataPath: string): string {
  return resolve(companionUploadDir(userDataPath))
}

export function isCompanionManagedUploadPath(userDataPath: string, filePath: string): boolean {
  const trimmed = filePath.trim()
  if (!trimmed) return false
  try {
    const abs = resolve(trimmed)
    const root = resolvedUploadRoot(userDataPath)
    return abs === root || abs.startsWith(root + sep)
  } catch {
    return false
  }
}

export function sanitizeCompanionUploadBasename(name: string): string {
  const base = basename(name.replace(/\\/g, '/'))
  const cleaned = base.replace(/[^\w.\- ()+\[\]]+/g, '_').slice(0, 180)
  return cleaned || 'upload'
}

export function writeCompanionUpload(
  userDataPath: string,
  buf: Buffer,
  originalName: string,
): { path: string; name: string } {
  if (buf.length === 0) throw new Error('empty_file')
  if (buf.length > MAX_COMPANION_UPLOAD_BYTES) throw new Error('file_too_large')

  const dir = companionUploadRoot(userDataPath)
  const safeName = sanitizeCompanionUploadBasename(originalName)
  const ext = extname(safeName)
  const stem = ext ? basename(safeName, ext) : safeName
  const stored = `${stem || 'upload'}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`
  const full = join(dir, stored)
  writeFileSync(full, buf)
  return { path: full, name: safeName }
}

export function filterCompanionSendAttachments(
  userDataPath: string,
  raw: unknown,
): { path: string; name: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { path: string; name: string }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const path = typeof (item as { path?: unknown }).path === 'string' ? (item as { path: string }).path.trim() : ''
    if (!path || !isCompanionManagedUploadPath(userDataPath, path)) continue
    const nameRaw = (item as { name?: unknown }).name
    const name =
      typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : basename(path)
    out.push({ path, name })
  }
  return out
}
