import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'

const IMAGE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

export function isCompanionLocalImagePath(filePath: string): boolean {
  return IMAGE_FILE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

export function resolveCompanionLocalImagePath(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const filePath = resolve(trimmed)
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return null
    if (!isCompanionLocalImagePath(filePath)) return null
    return filePath
  } catch {
    return null
  }
}

export function mimeForLocalImagePath(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

export function openCompanionLocalImageStream(filePath: string): ReturnType<typeof createReadStream> {
  return createReadStream(filePath)
}
