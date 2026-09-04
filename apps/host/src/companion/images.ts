/** Companion HTTP URL for a local image path served by the desktop host. */
export function companionLocalImageUrl(path: string): string | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  return `/api/files/local-image?path=${encodeURIComponent(trimmed)}`
}
