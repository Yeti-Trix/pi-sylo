import { dirname, normalize, resolve } from 'node:path'

/**
 * Canonical absolute path for Sylo disable-key comparisons (stable separators on Windows via resolve).
 */
export function normalizeSyloCapabilityPath(p: string): string {
  const t = typeof p === 'string' ? p.trim() : ''
  if (!t) return ''
  try {
    return resolve(normalize(t))
  } catch {
    try {
      return normalize(t)
    } catch {
      return t
    }
  }
}

/** Pi may report either the skill folder or `…/SKILL.md` — collapse to the folder path. */
export function skillDirFromReportedPath(reported: string): string {
  const s = typeof reported === 'string' ? reported.trim() : ''
  if (!s) return s
  const norm = s.replace(/\\/g, '/')
  if (norm.endsWith('/SKILL.md') || norm.endsWith('SKILL.md')) return dirname(s)
  return s
}

/** Canonical skill identity for merge, disable keys, and workspace policy comparisons. */
export function normalizeSkillCapabilityPath(p: string): string {
  return normalizeSyloCapabilityPath(skillDirFromReportedPath(p))
}

/** Like {@link normalizePathListForDisabledJson} but keys skills by folder, not file path. */
export function normalizeSkillPathListForPolicyJson(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of paths) {
    if (typeof raw !== 'string') continue
    const n = normalizeSkillCapabilityPath(raw)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

/** Normalize, dedupe, and sort paths for `~/.sylo/disabled.json`. */
export function normalizePathListForDisabledJson(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of paths) {
    if (typeof raw !== 'string') continue
    const n = normalizeSyloCapabilityPath(raw)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

/** One disabled Pi tool id for a specific extension file (canonical path + tool name). */
export type SyloDisabledToolRef = { extensionPath: string; toolName: string }

export function makeSyloDisabledToolKey(extensionPathNorm: string, toolName: string): string {
  return `${extensionPathNorm}\0${toolName.trim()}`
}

/** Normalize `disabledTools` from ~/.sylo/disabled.json (or workspace JSON column). */
export function normalizeDisabledToolsJson(raw: unknown): SyloDisabledToolRef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SyloDisabledToolRef[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const ep = normalizeSyloCapabilityPath(String((row as { extensionPath?: unknown }).extensionPath ?? ''))
    const tnRaw = (row as { toolName?: unknown }).toolName
    const tn = typeof tnRaw === 'string' ? tnRaw.trim() : ''
    if (!ep || !tn) continue
    const k = makeSyloDisabledToolKey(ep, tn)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ extensionPath: ep, toolName: tn })
  }
  out.sort(
    (a, b) => a.extensionPath.localeCompare(b.extensionPath) || a.toolName.localeCompare(b.toolName),
  )
  return out
}

export function mergeDisabledToolsLists(a: SyloDisabledToolRef[], b: SyloDisabledToolRef[]): SyloDisabledToolRef[] {
  const seen = new Set<string>()
  const out: SyloDisabledToolRef[] = []
  for (const t of [...a, ...b]) {
    const ep = normalizeSyloCapabilityPath(t.extensionPath)
    const tn = typeof t.toolName === 'string' ? t.toolName.trim() : ''
    if (!ep || !tn) continue
    const k = makeSyloDisabledToolKey(ep, tn)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ extensionPath: ep, toolName: tn })
  }
  out.sort(
    (a, b) => a.extensionPath.localeCompare(b.extensionPath) || a.toolName.localeCompare(b.toolName),
  )
  return out
}

export type SyloCapabilityBlockKind = 'pi-builtin' | 'extension-tool' | 'extension'

/** Tool result text when Sylo blocks a call the operator disabled in Capability manager. */
export function syloToolBlockReason(toolName: string, kind: SyloCapabilityBlockKind): string {
  const section =
    kind === 'pi-builtin' ? 'Pi built-in tools'
    : kind === 'extension-tool' ? 'Extensions (per-tool toggle)'
    : 'Extensions (whole extension disabled)'
  return (
    `Tool "${toolName}" was blocked: the operator disabled it in Sylo Capability manager ` +
    `(Developer → Capability manager → ${section}). ` +
    `Do not retry this tool until the operator enables it and restarts the broker. ` +
    `Ask the operator whether they want to enable it for this task, or ask how to proceed without using this tool.`
  )
}

export function ingestSyloDisabledToolKeys(raw: unknown): Set<string> {
  const set = new Set<string>()
  for (const t of normalizeDisabledToolsJson(raw)) {
    set.add(makeSyloDisabledToolKey(t.extensionPath, t.toolName))
  }
  return set
}

export function ingestSyloDisabledExtensionPaths(raw: unknown): Set<string> {
  return new Set(normalizePathListForDisabledJson(raw))
}

export function readJsonEnv(name: string): unknown {
  const raw = process.env[name]
  if (!raw?.trim()) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}
