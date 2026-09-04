import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { parseFrontmatter } from '@earendil-works/pi-coding-agent'

import { npmPackageFolderFromPath } from '../shared/capability-display-names.js'
import { skillDirFromReportedPath } from '../shared/sylo-capability-paths.js'

export type JsonSchemaObject = Record<string, unknown>

export type SkillParamsMeta = {
  skillPath: string
  schemaPath: string
  valuesPath: string
}

export type ExtensionConfigMeta = {
  configKey: string
  schemaPath: string
  valuesPath: string
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function resolveRelative(baseDir: string, rel: string): string {
  const t = rel.trim()
  if (!t) return ''
  return isAbsolute(t) ? t : join(baseDir, t.replace(/^\.\//, ''))
}

export function extensionsConfigDir(agentDir: string): string {
  return join(agentDir, 'extensions-config')
}

/** Config keys with a `<key>.schema.json` sidecar (written by `@sylo/pi-helpers` `syloConfig` at extension init). */
export function listExtensionConfigSchemaKeys(agentDir: string): string[] {
  const dir = extensionsConfigDir(agentDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => f.slice(0, -'.schema.json'.length))
    .sort((a, b) => a.localeCompare(b))
}

/** Match an extension filesystem path to an extensions-config schema key, if any. */
export function resolveExtensionConfigKey(extensionPath: string, agentDir: string): string | null {
  const keys = new Set(listExtensionConfigSchemaKeys(agentDir))
  if (keys.size === 0) return null

  const candidates: string[] = []
  const pkg = npmPackageFolderFromPath(extensionPath)
  if (pkg) candidates.push(pkg)

  const file = basename(extensionPath.replace(/\\/g, '/'))
  const stem = file.replace(/\.(ts|tsx|js|mjs|cjs)$/i, '')
  if (stem && stem !== 'index') {
    candidates.push(stem)
    if (stem.startsWith('sylo-')) candidates.push(stem.slice('sylo-'.length))
  }

  const parts = extensionPath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length >= 2) {
    const parent = parts[parts.length - 2]!
    candidates.push(parent)
    if (parent.startsWith('sylo-')) candidates.push(parent.slice('sylo-'.length))
  }

  for (const c of candidates) {
    if (keys.has(c)) return c
  }
  return null
}

export function extensionConfigMeta(
  extensionPath: string,
  agentDir: string,
): ExtensionConfigMeta | null {
  const configKey = resolveExtensionConfigKey(extensionPath, agentDir)
  if (!configKey) return null
  const schemaPath = join(extensionsConfigDir(agentDir), `${configKey}.schema.json`)
  if (!existsSync(schemaPath)) return null
  return {
    configKey,
    schemaPath,
    valuesPath: join(extensionsConfigDir(agentDir), `${configKey}.json`),
  }
}

export function resolveSkillParamsMeta(skillReportedPath: string): SkillParamsMeta | null {
  const skillDir = skillDirFromReportedPath(skillReportedPath)
  if (!skillDir) return null
  const skillMd = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMd)) return null

  let schemaRel = 'params.schema.json'
  let valuesRel = 'params.local.json'

  try {
    const text = readFileSync(skillMd, 'utf8')
    const fm = parseFrontmatter(text).frontmatter as Record<string, unknown>
    const meta = fm.metadata
    if (isRecord(meta) && isRecord(meta.sylo)) {
      const sylo = meta.sylo
      if (typeof sylo.paramsSchema === 'string' && sylo.paramsSchema.trim()) {
        schemaRel = sylo.paramsSchema.trim()
      }
      if (typeof sylo.paramsValues === 'string' && sylo.paramsValues.trim()) {
        valuesRel = sylo.paramsValues.trim()
      }
    }
  } catch {
    /* use defaults */
  }

  const schemaPath = resolveRelative(skillDir, schemaRel)
  if (!schemaPath || !existsSync(schemaPath)) return null

  return {
    skillPath: skillReportedPath,
    schemaPath,
    valuesPath: resolveRelative(skillDir, valuesRel),
  }
}

export function readConfigPair(
  schemaPath: string,
  valuesPath: string,
): { ok: true; schema: JsonSchemaObject; values: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const schemaRaw = readJsonFile(schemaPath)
    if (!isRecord(schemaRaw)) return { ok: false, error: 'Schema is not a JSON object' }
    let values: Record<string, unknown> = {}
    if (existsSync(valuesPath)) {
      const v = readJsonFile(valuesPath)
      if (!isRecord(v)) return { ok: false, error: 'Values file is not a JSON object' }
      values = v
    }
    return { ok: true, schema: schemaRaw, values }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function writeValuesFile(valuesPath: string, values: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(dirname(valuesPath), { recursive: true })
    writeFileSync(valuesPath, `${JSON.stringify(values, null, 2)}\n`, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function readSkillParams(skillReportedPath: string) {
  const meta = resolveSkillParamsMeta(skillReportedPath)
  if (!meta) return { ok: false as const, error: 'No params.schema.json for this skill' }
  const r = readConfigPair(meta.schemaPath, meta.valuesPath)
  if (!r.ok) return r
  return { ok: true as const, meta, schema: r.schema, values: r.values }
}

export function saveSkillParams(skillReportedPath: string, values: Record<string, unknown>) {
  const meta = resolveSkillParamsMeta(skillReportedPath)
  if (!meta) return { ok: false as const, error: 'No params schema for this skill' }
  if (!isRecord(values)) return { ok: false as const, error: 'Values must be a JSON object' }
  return writeValuesFile(meta.valuesPath, values)
}

export function readExtensionConfig(configKey: string, agentDir: string) {
  const key = configKey.trim()
  if (!key) return { ok: false as const, error: 'Missing config key' }
  const schemaPath = join(extensionsConfigDir(agentDir), `${key}.schema.json`)
  if (!existsSync(schemaPath)) {
    return { ok: false as const, error: `No schema for extension config "${key}"` }
  }
  const valuesPath = join(extensionsConfigDir(agentDir), `${key}.json`)
  const r = readConfigPair(schemaPath, valuesPath)
  if (!r.ok) return r
  return {
    ok: true as const,
    meta: { configKey: key, schemaPath, valuesPath } satisfies ExtensionConfigMeta,
    schema: r.schema,
    values: r.values,
  }
}

export function saveExtensionConfig(
  configKey: string,
  agentDir: string,
  values: Record<string, unknown>,
) {
  const key = configKey.trim()
  if (!key) return { ok: false as const, error: 'Missing config key' }
  const schemaPath = join(extensionsConfigDir(agentDir), `${key}.schema.json`)
  if (!existsSync(schemaPath)) {
    return { ok: false as const, error: `No schema for extension config "${key}"` }
  }
  if (!isRecord(values)) return { ok: false as const, error: 'Values must be a JSON object' }
  const valuesPath = join(extensionsConfigDir(agentDir), `${key}.json`)
  return writeValuesFile(valuesPath, values)
}
