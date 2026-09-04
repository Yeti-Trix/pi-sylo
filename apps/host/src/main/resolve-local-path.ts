import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

function normalizeSlashes(p: string): string {
  return p.replace(/\//g, sep)
}

export function expandTildePath(p: string): string {
  const t = typeof p === 'string' ? p.trim() : ''
  if (!t) return p
  if (t === '~') return homedir()
  if (t.startsWith('~/') || t.startsWith('~\\')) {
    return join(homedir(), t.slice(2))
  }
  return t
}

function fileUrlToLocalPath(src: string): string {
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

/** Candidate absolute paths to probe for a user- or model-supplied path string. */
export function buildLocalPathCandidates(raw: string, piCwd: string): string[] {
  const expanded = expandTildePath(raw.trim())
  if (!expanded) return []

  const candidates: string[] = []
  const push = (p: string) => {
    const n = normalize(normalizeSlashes(p))
    if (n && !candidates.includes(n)) candidates.push(n)
  }

  if (expanded.startsWith('file://')) {
    push(fileUrlToLocalPath(expanded))
  }

  if (isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded) || expanded.startsWith('\\\\')) {
    push(expanded)
  }

  push(resolve(piCwd, normalizeSlashes(expanded)))

  const home = homedir()
  push(join(home, normalizeSlashes(expanded)))

  if (/^OneDrive/i.test(expanded)) {
    try {
      for (const name of readdirSync(home)) {
        if (/^OneDrive/i.test(name)) {
          const suffix = expanded.replace(/^OneDrive(?:\s*-\s*[^/\\]+)?[\\/]?/i, '')
          if (suffix) push(join(home, name, normalizeSlashes(suffix)))
        }
      }
    } catch {
      /* home unreadable */
    }
  }

  return candidates
}

export function resolveLocalPathOnDisk(
  raw: string,
  piCwd: string,
): { ok: true; path: string } | { ok: false; tried: string[] } {
  const tried = buildLocalPathCandidates(raw, piCwd)
  for (const c of tried) {
    if (existsSync(c)) return { ok: true, path: c }
  }
  return { ok: false, tried }
}
