import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { parseFrontmatter } from '@earendil-works/pi-coding-agent'

import { normalizeRouteNavSection } from './skill-routes.js'
import { skillDirFromReportedPath } from '../shared/sylo-capability-paths.js'

export type SkillSurfaceLintSurface =
  | {
      kind: 'widget'
      id: string
      title?: string
      fallbackPath: string
      ok: boolean
    }
  | {
      kind: 'route'
      id: string
      title?: string
      nav_section?: string
      required_capabilities?: string[]
      fallbackPath: string
      ok: boolean
    }

export type SkillSurfaceLintReport = {
  skillMdPath: string
  surfaces: SkillSurfaceLintSurface[]
  /** Missing fallback.md or missing frontmatter fallback path */
  errors: string[]
  hasParamsSchema: boolean
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function readJsonIfExists(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(v) ? v : null
  } catch {
    return null
  }
}

export { skillDirFromReportedPath } from '../shared/sylo-capability-paths.js'

function skillHasParamsSchema(dir: string, fm: Record<string, unknown>): boolean {
  let schemaRel = 'params.schema.json'
  const meta = fm.metadata
  if (isRecord(meta) && isRecord(meta.sylo)) {
    const ps = meta.sylo.paramsSchema
    if (typeof ps === 'string' && ps.trim()) schemaRel = ps.trim()
  }
  const schemaPath = isAbsolute(schemaRel) ? schemaRel : join(dir, schemaRel.replace(/^\.\//, ''))
  return existsSync(schemaPath)
}

export function lintSkillSurfacesAtDir(skillDir: string): SkillSurfaceLintReport | null {
  const dir = skillDir.trim()
  if (!dir) return null
  const skillMd = join(dir, 'SKILL.md')
  if (!existsSync(skillMd)) {
    return {
      skillMdPath: skillMd,
      surfaces: [],
      errors: [`SKILL.md not found under ${dir}`],
      hasParamsSchema: false,
    }
  }
  let text: string
  try {
    text = readFileSync(skillMd, 'utf8')
  } catch {
    return {
      skillMdPath: skillMd,
      surfaces: [],
      errors: ['Could not read SKILL.md'],
      hasParamsSchema: false,
    }
  }
  let fm: Record<string, unknown>
  try {
    fm = parseFrontmatter(text).frontmatter as Record<string, unknown>
  } catch {
    return {
      skillMdPath: skillMd,
      surfaces: [],
      errors: ['SKILL.md frontmatter parse failed'],
      hasParamsSchema: false,
    }
  }

  const surfaces: SkillSurfaceLintSurface[] = []
  const errors: string[] = []
  const hasParamsSchema = skillHasParamsSchema(dir, fm)

  const widgetsRaw = fm.widgets
  if (Array.isArray(widgetsRaw)) {
    for (const w of widgetsRaw) {
      const id = typeof w === 'string' ? w.trim() : ''
      if (!id) continue
      const widgetRoot = join(dir, 'assets', 'widgets', id)
      const fallbackPath = join(widgetRoot, 'fallback.md')
      const manifest = readJsonIfExists(join(widgetRoot, 'manifest.json'))
      const title =
        manifest && typeof manifest.title === 'string' ? manifest.title.trim() : undefined
      const ok = existsSync(fallbackPath)
      surfaces.push({ kind: 'widget', id, title, fallbackPath, ok })
      if (!ok) {
        errors.push(`Widget "${id}": missing fallback at ${fallbackPath}`)
      }
    }
  }

  const routesRaw = fm.routes
  if (Array.isArray(routesRaw)) {
    for (const row of routesRaw) {
      if (!isRecord(row)) continue
      const routeId = typeof row.id === 'string' ? row.id.trim() : ''
      const title = typeof row.title === 'string' ? row.title.trim() : undefined
      const fallbackRel = typeof row.fallback === 'string' ? row.fallback.trim() : ''
      const nav_section = normalizeRouteNavSection(row.nav_section)
      const reqRaw = row.required_capabilities
      const required_capabilities = Array.isArray(reqRaw)
        ? reqRaw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        : undefined
      if (!routeId) continue
      if (!fallbackRel) {
        surfaces.push({
          kind: 'route',
          id: routeId,
          title,
          nav_section,
          required_capabilities,
          fallbackPath: '',
          ok: false,
        })
        errors.push(`Route "${routeId}": no fallback path in SKILL.md frontmatter`)
        continue
      }
      const abs = isAbsolute(fallbackRel) ? fallbackRel : join(dir, fallbackRel.replace(/^\.\//, ''))
      const ok = existsSync(abs)
      surfaces.push({
        kind: 'route',
        id: routeId,
        title,
        nav_section,
        required_capabilities,
        fallbackPath: abs,
        ok,
      })
      if (!ok) {
        errors.push(`Route "${routeId}": missing fallback file ${abs}`)
      }
    }
  }

  return { skillMdPath: skillMd, surfaces, errors, hasParamsSchema }
}

export function lintSkillSurfacesBatch(paths: string[]): Record<string, SkillSurfaceLintReport> {
  const raw = Array.isArray(paths) ? paths : []
  const out: Record<string, SkillSurfaceLintReport> = {}
  const seen = new Set<string>()
  for (const p of raw) {
    if (typeof p !== 'string' || !p.trim()) continue
    if (seen.has(p)) continue
    seen.add(p)
    const dir = skillDirFromReportedPath(p)
    const r = lintSkillSurfacesAtDir(dir)
    if (r) out[p] = r
  }
  return out
}
