import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveToolsPackageDir } from './tools-bundles.js'

const hostMainDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(hostMainDir, '..', '..', '..', '..')
// Package moved to the sylo-tools-controls bundle (2026-09-02); in-repo path kept as fallback.
const packageRoot = resolveToolsPackageDir(repoRoot, 'sylo-tools-controls', 'sylo-logicforge')
const parseDir = join(packageRoot, 'assets', 'parse')
const parseConfigPath = join(parseDir, 'parse_config.json')
const settingsPath = join(parseDir, 'settings.json')
const parseDefaultsDir = join(parseDir, '_defaults')
const vendorDefaultsDir = join(packageRoot, 'vendor', 'logicforge', 'backend', 'db')

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function writeJsonFile(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export type LogicForgeParseRulesPayload = {
  parse_config?: unknown
  settings?: unknown
}

export function logicforgeParseRulesGet(): {
  ok: true
  parse_config_path: string
  settings_path: string
  parse_config: unknown
  settings: unknown
} {
  const parse_config = readJsonFile(parseConfigPath)
  const settings = readJsonFile(settingsPath)
  if (parse_config == null && settings == null) {
    throw new Error(
      'parse rules not seeded — restore packages/sylo-logicforge/assets/parse from git or enable sylo-logicforge',
    )
  }
  return {
    ok: true,
    parse_config_path: parseConfigPath,
    settings_path: settingsPath,
    parse_config,
    settings,
  }
}

export function logicforgeParseRulesSave(payload: LogicForgeParseRulesPayload): {
  ok: true
  parse_config_path: string
  settings_path: string
} {
  if (payload.parse_config !== undefined) {
    writeJsonFile(parseConfigPath, payload.parse_config)
  }
  if (payload.settings !== undefined) {
    writeJsonFile(settingsPath, payload.settings)
  }
  if (payload.parse_config === undefined && payload.settings === undefined) {
    throw new Error('provide parse_config and/or settings')
  }
  return {
    ok: true,
    parse_config_path: parseConfigPath,
    settings_path: settingsPath,
  }
}

export function logicforgeParseRulesReset(): ReturnType<typeof logicforgeParseRulesGet> {
  const defaultParse = join(vendorDefaultsDir, 'parse_config.json')
  const defaultSettings = join(vendorDefaultsDir, 'settings.json')
  const fallbackParse = join(parseDefaultsDir, 'parse_config.json')
  const fallbackSettings = join(parseDefaultsDir, 'settings.json')
  const srcParse = existsSync(defaultParse) ? defaultParse : fallbackParse
  const srcSettings = existsSync(defaultSettings) ? defaultSettings : fallbackSettings
  if (!existsSync(srcParse) && !existsSync(srcSettings)) {
    throw new Error(
      'parse rule defaults missing — restore packages/sylo-logicforge/assets/parse/_defaults from git',
    )
  }
  if (existsSync(srcParse)) {
    cpSync(srcParse, parseConfigPath, { force: true })
  }
  if (existsSync(srcSettings)) {
    cpSync(srcSettings, settingsPath, { force: true })
  }
  return logicforgeParseRulesGet()
}
