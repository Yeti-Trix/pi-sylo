/** Custom scheme so compiled `file://` windows can fetch skill-surface fixtures. */
export const SYLO_SURFACE_SCHEME = 'sylo-surface'
export const SYLO_SURFACE_HOST = 'renderer'

/**
 * Resolve a skill-surface fixture path against the renderer document URL.
 *
 * Vite serves `/skill-surface/...` from origin root in dev. In the compiled
 * `file://` build, a leading slash is treated as the drive/filesystem root
 * (`file:///D:/skill-surface/...`), and Chromium also blocks `fetch(file://)`.
 * Map those loads onto `sylo-surface://` instead.
 */
export function resolveWidgetFetchUrl(path: string, baseHref: string): string {
  const t = path.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  const withSlash = t.startsWith('/') ? t : `/${t}`
  const base = new URL(baseHref)
  if (base.protocol === 'file:') {
    return `${SYLO_SURFACE_SCHEME}://${SYLO_SURFACE_HOST}${withSlash}`
  }
  return new URL(withSlash, base).href
}

/**
 * Posix-relative path under the renderer directory, or null if the request
 * is not a confined skill-surface fixture.
 */
export function syloSurfaceRelativePath(requestUrl: string): string | null {
  let pathname = ''
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${SYLO_SURFACE_SCHEME}:`) return null
    if (url.hostname !== SYLO_SURFACE_HOST) return null
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  const rel = pathname.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!rel.startsWith('skill-surface/')) return null
  if (rel.split('/').some((part) => part === '' || part === '.' || part === '..')) return null
  return rel
}
