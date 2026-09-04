const REMOTE_SRC = /^(https?:|data:|sylo-file:)/i

/** Decode `file://` URLs to a filesystem path string. */
export function fileUrlToLocalPath(src: string): string {
  try {
    const u = new URL(src)
    if (u.protocol !== 'file:') return src.replace(/^file:\/\//i, '')

    if (u.hostname) {
      const uncPath = u.pathname.replace(/\//g, '\\')
      return `\\\\${u.hostname}${uncPath}`
    }

    let path = decodeURIComponent(u.pathname)
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
    return path
  } catch {
    return src.replace(/^file:\/\//i, '')
  }
}

/** True when markdown `src` looks like a local filesystem path, not a remote URL. */
export function looksLikeLocalImagePath(src: string): boolean {
  const t = src.trim()
  if (!t || REMOTE_SRC.test(t)) return false
  if (t.startsWith('file://')) return true
  if (/^[A-Za-z]:[\\/]/.test(t)) return true
  if (t.startsWith('\\\\')) return true
  if (t.startsWith('/') && !t.startsWith('//')) return true
  return false
}

export function normalizeLocalImagePath(src: string): string {
  const trimmed = src.trim()
  if (trimmed.startsWith('file://')) return fileUrlToLocalPath(trimmed)
  return trimmed
}

/** Resolve a relative image path (e.g. `images/pic.png`, `../assets/x.svg`) against
 *  the directory of the markdown file that references it, returning an absolute
 *  filesystem path. Uses file:// URL resolution so `..`, `./`, and `/` vs `\`
 *  are handled correctly. Returns null on bad input or a non-file result. */
export function resolveRelativeImagePath(baseDir: string, rel: string): string | null {
  const b = baseDir.trim()
  const r = rel.trim()
  if (!b || !r) return null
  const base = b.replace(/\\/g, '/')
  const baseFileUrl = base.startsWith('//')
    ? `file:${base}`
    : base.startsWith('/')
      ? `file://${base}`
      : `file:///${base}`
  try {
    const u = new URL(r, `${baseFileUrl}/`)
    if (u.protocol !== 'file:') return null
    return fileUrlToLocalPath(u.href)
  } catch {
    return null
  }
}

export function resolveChatMarkdownImageSrc(
  src: string | undefined,
  resolveImageUrl?: (path: string) => string | null,
): string | null {
  if (!src?.trim()) return null
  const trimmed = src.trim()

  if (REMOTE_SRC.test(trimmed)) return trimmed

  if (looksLikeLocalImagePath(trimmed)) {
    const localPath = normalizeLocalImagePath(trimmed)
    const resolved = resolveImageUrl?.(localPath)
    if (resolved) return resolved

    const fallback =
      typeof window !== 'undefined' ? window.sylo?.files?.localImageUrl(localPath) : null
    return fallback || null
  }

  // Not remote and not an absolute local path — typically a relative reference
  // like `images/pic.png`. Give the resolver a chance (the canvas resolves these
  // against the .md file's directory). If it declines, fall back to the raw
  // string so prior behavior (browser resolves relative to the page) holds.
  const resolved = resolveImageUrl?.(trimmed)
  return resolved || trimmed
}
