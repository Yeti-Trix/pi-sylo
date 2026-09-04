import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  isSyloOptionalPackageEnabled,
  type SyloOptionalPackage,
} from '../shared/sylo-optional-packages.js'

export const TTS_CONFIG_KEY = 'sylo-tts'

export const DEFAULT_TTS_CONFIG: Record<string, unknown> = {
  default_voice_id: 'kokoro-am_michael',
  /** Last voice picked in Speech route UI (persists across reloads). */
  ui_voice_id: '',
  python_path: '',
  kokoro_speed: 1,
  orpheus_temperature: 0.8,
  orpheus_top_p: 0.95,
}

export function ttsConfigDir(userDataPath: string): string {
  return join(userDataPath, 'sylo-tts')
}

export function ttsConfigPath(userDataPath: string): string {
  return join(ttsConfigDir(userDataPath), 'config.json')
}

export function readTtsConfig(userDataPath: string): Record<string, unknown> {
  const path = ttsConfigPath(userDataPath)
  if (!existsSync(path)) return { ...DEFAULT_TTS_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return { ...DEFAULT_TTS_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_TTS_CONFIG }
  }
}

export function writeTtsConfig(
  userDataPath: string,
  values: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  try {
    const dir = ttsConfigDir(userDataPath)
    mkdirSync(dir, { recursive: true })
    const merged = { ...DEFAULT_TTS_CONFIG, ...values }
    writeFileSync(ttsConfigPath(userDataPath), JSON.stringify(merged, null, 2), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function ensureTtsConfigSchema(agentDir: string): void {
  const dir = join(agentDir, 'extensions-config')
  mkdirSync(dir, { recursive: true })
  const schemaPath = join(dir, `${TTS_CONFIG_KEY}.schema.json`)
  if (existsSync(schemaPath)) return
  const schema = {
    type: 'object',
    properties: {
      default_voice_id: {
        type: 'string',
        description: 'Default catalog voice id (e.g. kokoro-am_michael)',
      },
      ui_voice_id: {
        type: 'string',
        description: 'Speech route UI — last selected voice (empty = use default_voice_id)',
      },
      python_path: {
        type: 'string',
        description: 'Python executable override (empty = python / python3 on PATH)',
      },
      kokoro_speed: {
        type: 'number',
        description: 'Kokoro speech rate (0.5–2.0; 1.0 = normal)',
        minimum: 0.5,
        maximum: 2,
      },
      orpheus_temperature: {
        type: 'number',
        description: 'Orpheus sampling temperature (0.3–1.2; lower = steadier)',
        minimum: 0.3,
        maximum: 1.2,
      },
      orpheus_top_p: {
        type: 'number',
        description: 'Orpheus nucleus sampling top_p (0.7–1.0)',
        minimum: 0.7,
        maximum: 1,
      },
    },
  }
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf8')
}

export function ttsConfigEnvPath(
  userDataPath: string,
  pref: Record<string, boolean>,
  pkg: SyloOptionalPackage | undefined,
): string | undefined {
  if (!pkg || !isSyloOptionalPackageEnabled(pref, pkg.id)) return undefined
  const path = ttsConfigPath(userDataPath)
  if (!existsSync(path)) {
    writeTtsConfig(userDataPath, DEFAULT_TTS_CONFIG)
  }
  return path
}
