import { classifySyloBuiltinExtension } from './sylo-builtin-extensions.js'
import { classifySyloOptionalPackageId } from './sylo-optional-packages.js'

function lastRegexCaptureGlobal(haystack: string, re: RegExp): string | null {
  const g = new RegExp(re.source, 'g')
  let last: string | null = null
  let m: RegExpExecArray | null
  while ((m = g.exec(haystack)) !== null) last = m[1]!
  return last
}

/** Strip @semver suffix Pi uses under agent/npm mirrors (pi-subagents@0.24.0 → pi-subagents). */
function normalizeNpmMirrorFolderSegment(segment: string): string {
  if (!segment) return segment
  const at = segment.lastIndexOf('@')
  if (at <= 0) return segment
  if (segment.startsWith('@')) {
    const slash = segment.indexOf('/')
    if (slash === -1 || at <= slash) return segment
    const ver = segment.slice(at + 1)
    return /^\d/.test(ver) ? segment.slice(0, at) : segment
  }
  const ver = segment.slice(at + 1)
  return /^\d/.test(ver) ? segment.slice(0, at) : segment
}

/**
 * Innermost npm package folder after `/node_modules/`, Pi `/npm/` mirror, or `/git/`.
 * Matches Capability manager grouping (e.g. `pi-docparser`, not `index`).
 */
export function npmPackageFolderFromPath(filePath: string): string | null {
  if (!filePath) return null
  const norm = filePath.replace(/\\/g, '/')
  const raw =
    lastRegexCaptureGlobal(norm, /\/node_modules\/((?:@[^/]+\/[^/]+|[^/]+))/) ??
    lastRegexCaptureGlobal(norm, /\/npm\/((?:@[^/]+\/[^/]+|[^/]+))/) ??
    lastRegexCaptureGlobal(norm, /\/git\/((?:@[^/]+\/[^/]+|[^/]+))/)
  return raw ? normalizeNpmMirrorFolderSegment(raw) : null
}

function fileStemFromPath(path: string): string {
  if (!path) return '(unknown)'
  const slash = path.replace(/\\/g, '/')
  const last = slash.substring(slash.lastIndexOf('/') + 1)
  return last.replace(/\.(ts|tsx|js|mjs|cjs)$/i, '') || '(unknown)'
}

function parentFolderFallback(path: string, stem: string): string | null {
  if (stem !== 'index' && stem !== 'extension') return null
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 2) return null
  const parent = parts[parts.length - 2]
  if (!parent || parent === 'src' || parent === 'dist' || parent === 'extensions') return null
  return parent
}

/**
 * Human-friendly extension label from path heuristics only (renderer-safe).
 * Prefer npm/git package id over entry filenames like `index.ts`.
 */
export function deriveExtensionDisplayName(path: string): string {
  const builtin = classifySyloBuiltinExtension(path)
  if (builtin === 'skill-surface') return 'sylo-skill-surface'
  if (builtin === 'subagents') return 'sylo-subagents'
  if (builtin === 'tools-guard') return 'sylo-builtin-tools-guard'

  const optional = classifySyloOptionalPackageId(path)
  if (optional) return optional

  const npmFolder = npmPackageFolderFromPath(path)
  if (npmFolder) return npmFolder

  const stem = fileStemFromPath(path)
  const parent = parentFolderFallback(path, stem)
  if (parent) return parent

  return stem || '(extension)'
}

/** Capability manager row title — same rules as {@link deriveExtensionDisplayName}. */
export function extensionDisplayTitle(name: string, pathStr: string): string {
  const fromPath = deriveExtensionDisplayName(pathStr)
  const folder = npmPackageFolderFromPath(pathStr)
  if (folder) return folder
  const n = name.trim()
  if (n && n !== 'index' && n !== 'extension') return n
  return fromPath || '(extension)'
}
