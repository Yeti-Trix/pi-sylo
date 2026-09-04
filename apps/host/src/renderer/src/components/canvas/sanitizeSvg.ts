/** Strip obvious script/event vectors from inline SVG before host render. */
export function sanitizeInlineSvg(raw: string): string {
  let s = raw.trim()
  if (!s) return ''
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
  s = s.replace(/javascript:/gi, '')
  return s
}

export function extractSvgMarkup(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('<svg')) return sanitizeInlineSvg(trimmed)
  const match = trimmed.match(/<svg[\s\S]*<\/svg>/i)
  return match ? sanitizeInlineSvg(match[0]) : null
}
