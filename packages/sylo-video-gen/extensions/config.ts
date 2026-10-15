/**
 * sylo-video-gen extension config (§2.7 / plan §8 step 6) — the sylo-image-gen
 * `extensions/config.ts` twin over the SHARED coerce.
 *
 * Load chain (identical shape to the imagegen one):
 *   1. `SYLO_VIDEOGEN_CONFIG` env (broker-supervisor injects the host-owned
 *      `<userData>/sylo-video-gen/config.json` path when the package is enabled;
 *      the injection hook itself is §8.7 host plumbing, NOT this step).
 *   2. Vanilla Pi fallback: `<agentDir>/extensions-config/sylo-video-gen.json`
 *      (same extensions-config dir the host writes its JSON-schema sidecar into;
 *      agentDir resolution mirrors workflows-engine.ts resolveAgentDir).
 *   3. Defaults (shared/types.ts DEFAULT_VIDEOGEN_CONFIG).
 *
 * Keys are the §2.7 snake_case names — the SINGLE source of truth for the shape +
 * coercion is `shared/types.ts` (`coerceVideogenConfig`), which host main's
 * `videogen-config.ts` already imports (§8.1 deviation note in the shared types
 * header — this module is the §8.6 load-chain half of that split). Anything
 * invalid falls back to its default and yields a plain-language note the doctor
 * echoes verbatim (§3.3).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { coerceVideogenConfig, DEFAULT_VIDEOGEN_CONFIG, type VideogenConfig } from '../shared/types.ts'

export const VIDEOGEN_CONFIG_ENV = 'SYLO_VIDEOGEN_CONFIG'

/** Resolved config + why any value was replaced (doctor echoes these). */
export interface LoadedVideogenConfig {
  config: VideogenConfig
  notes: string[]
  /** Where the config was actually read from ('defaults' when none found). */
  source: string
}

function resolveAgentDir(): string {
  const envDir = (process.env.SYLO_PI_AGENT_DIR ?? '').trim()
  if (envDir) return envDir
  const home = process.env.HOME || process.env.USERPROFILE || ''
  return join(home, '.pi', 'agent')
}

/** <agentDir>/extensions-config/sylo-video-gen.json (vanilla Pi config location). */
export function vanillaPiConfigPath(agentDir?: string): string {
  return join(agentDir?.trim() || resolveAgentDir(), 'extensions-config', 'sylo-video-gen.json')
}

/**
 * Load the effective sylo-video-gen config (chain in the file header). Never
 * throws — a broken file falls back to defaults with a plain-language note.
 * `source` tells the doctor (§3.3 config echo) which file the values came from.
 */
export function loadVideogenConfig(): LoadedVideogenConfig {
  const envPath = (process.env[VIDEOGEN_CONFIG_ENV] ?? '').trim()
  const path = envPath || vanillaPiConfigPath()
  if (path && existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
          config: { ...DEFAULT_VIDEOGEN_CONFIG },
          notes: [`${path} is not a JSON object — defaults applied. Fix or delete the file; when running inside Sylo it lives under the host config dir.`],
          source: path,
        }
      }
      const { config, notes } = coerceVideogenConfig(raw as Record<string, unknown>)
      return { config, notes, source: path }
    } catch (err) {
      return {
        config: { ...DEFAULT_VIDEOGEN_CONFIG },
        notes: [
          `${path} exists but is not valid JSON (${err instanceof Error ? err.message : String(err)}) — using defaults. ` +
            'Fix or delete the file; when running inside Sylo it lives under the host config dir.',
        ],
        source: path,
      }
    }
  }
  return {
    config: { ...DEFAULT_VIDEOGEN_CONFIG },
    notes: envPath
      ? [`${VIDEOGEN_CONFIG_ENV} points at ${envPath} but the file does not exist — using defaults.`]
      : [],
    source: envPath || existsSync(vanillaPiConfigPath()) ? path : 'defaults',
  }
}

/** Convenience for tools that only need the values. */
export function loadVideogenConfigValues(): VideogenConfig {
  return loadVideogenConfig().config
}