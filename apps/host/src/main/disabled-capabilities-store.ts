import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  mergeDisabledToolsLists,
  normalizeDisabledToolsJson,
  normalizePathListForDisabledJson,
  normalizeSkillCapabilityPath,
  normalizeSyloCapabilityPath,
  type SyloDisabledToolRef,
} from '../shared/sylo-capability-paths.js'

export type SyloDisabledCapabilities = {
  skillPaths: string[]
  extensionPaths: string[]
  disabledTools: SyloDisabledToolRef[]
}

export function syloDisabledCapabilitiesFilePath(): string {
  return join(homedir(), '.sylo', 'disabled.json')
}

export function readSyloDisabledCapabilities(): SyloDisabledCapabilities {
  const p = syloDisabledCapabilitiesFilePath()
  if (!existsSync(p)) {
    return { skillPaths: [], extensionPaths: [], disabledTools: [] }
  }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    return {
      skillPaths: normalizePathListForDisabledJson(j.skillPaths),
      extensionPaths: normalizePathListForDisabledJson(j.extensionPaths),
      disabledTools: normalizeDisabledToolsJson(j.disabledTools),
    }
  } catch {
    return { skillPaths: [], extensionPaths: [], disabledTools: [] }
  }
}

export function writeSyloDisabledCapabilities(next: SyloDisabledCapabilities): void {
  const skillPaths = normalizePathListForDisabledJson(next.skillPaths)
  const extensionPaths = normalizePathListForDisabledJson(next.extensionPaths)
  const disabledTools = mergeDisabledToolsLists(next.disabledTools, [])
  const fp = syloDisabledCapabilitiesFilePath()
  mkdirSync(dirname(fp), { recursive: true })
  writeFileSync(
    fp,
    JSON.stringify({ skillPaths, extensionPaths, disabledTools }, null, 2),
    'utf8',
  )
}

export function patchSyloDisabledCapability(
  opts:
    | { kind: 'skill'; path: string; excluded: boolean }
    | { kind: 'extension'; path: string; excluded: boolean }
    | { kind: 'tool'; extensionPath: string; toolName: string; excluded: boolean },
): SyloDisabledCapabilities {
  const cur = readSyloDisabledCapabilities()
  if (opts.kind === 'tool') {
    const ep = normalizeSyloCapabilityPath(opts.extensionPath)
    const tn = typeof opts.toolName === 'string' ? opts.toolName.trim() : ''
    if (!ep || !tn) return cur
    const set = new Map<string, SyloDisabledToolRef>()
    for (const t of cur.disabledTools) {
      const e = normalizeSyloCapabilityPath(t.extensionPath)
      const n = t.toolName.trim()
      if (!e || !n) continue
      set.set(`${e}\0${n}`, { extensionPath: e, toolName: n })
    }
    const k = `${ep}\0${tn}`
    if (opts.excluded) set.set(k, { extensionPath: ep, toolName: tn })
    else set.delete(k)
    const disabledTools = mergeDisabledToolsLists(Array.from(set.values()), [])
    const next = { ...cur, disabledTools }
    writeSyloDisabledCapabilities(next)
    return next
  }

  if (opts.kind === 'skill') {
    const set = new Set(cur.skillPaths.map((p) => normalizeSkillCapabilityPath(p)))
    const skillKey = normalizeSkillCapabilityPath(opts.path)
    if (!skillKey) return cur
    if (opts.excluded) set.add(skillKey)
    else set.delete(skillKey)
    const skillPaths = Array.from(set).sort((a, b) => a.localeCompare(b))
    const next = { ...cur, skillPaths }
    writeSyloDisabledCapabilities(next)
    return next
  }

  const key = normalizeSyloCapabilityPath(opts.path)
  if (!key) return cur

  const set = new Set(cur.extensionPaths)
  if (opts.excluded) set.add(key)
  else set.delete(key)
  const extensionPaths = Array.from(set).sort((a, b) => a.localeCompare(b))
  const next = { ...cur, extensionPaths }
  writeSyloDisabledCapabilities(next)
  return next
}
