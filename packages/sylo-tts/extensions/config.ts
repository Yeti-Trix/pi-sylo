/**
 * sylo-tts extension config (SYLO_TTS_CONFIG JSON path from Sylo host).
 */
import { readFileSync } from 'node:fs'

export interface TtsConfig {
  defaultVoiceId: string
  pythonPath: string
  kokoroSpeed: number
  orpheusTemperature: number
  orpheusTopP: number
}

const DEFAULT_CONFIG: TtsConfig = {
  defaultVoiceId: 'kokoro-am_michael',
  pythonPath: '',
  kokoroSpeed: 1,
  orpheusTemperature: 0.8,
  orpheusTopP: 0.95,
}

function coerceString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw.trim() : fallback
}

function coerceNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function loadTtsConfig(): TtsConfig {
  const path = process.env.SYLO_TTS_CONFIG?.trim()
  if (!path) return { ...DEFAULT_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return {
      defaultVoiceId: coerceString(raw.default_voice_id, DEFAULT_CONFIG.defaultVoiceId),
      pythonPath: coerceString(raw.python_path, ''),
      kokoroSpeed: coerceNumber(raw.kokoro_speed, DEFAULT_CONFIG.kokoroSpeed, 0.5, 2),
      orpheusTemperature: coerceNumber(
        raw.orpheus_temperature,
        DEFAULT_CONFIG.orpheusTemperature,
        0.3,
        1.2,
      ),
      orpheusTopP: coerceNumber(raw.orpheus_top_p, DEFAULT_CONFIG.orpheusTopP, 0.7, 1),
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export type TtsSynthOverrides = {
  kokoroSpeed?: number
  orpheusTemperature?: number
  orpheusTopP?: number
}

export function resolveSynthOptions(
  config: TtsConfig,
  overrides?: TtsSynthOverrides,
): Required<TtsSynthOverrides> {
  return {
    kokoroSpeed: coerceNumber(
      overrides?.kokoroSpeed,
      config.kokoroSpeed,
      0.5,
      2,
    ),
    orpheusTemperature: coerceNumber(
      overrides?.orpheusTemperature,
      config.orpheusTemperature,
      0.3,
      1.2,
    ),
    orpheusTopP: coerceNumber(overrides?.orpheusTopP, config.orpheusTopP, 0.7, 1),
  }
}
