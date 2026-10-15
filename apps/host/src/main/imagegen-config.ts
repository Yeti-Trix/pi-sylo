/**
 * sylo-image-gen — host-owned config (plan §2.7, §8 step 5). Mirrors tts-config.ts:
 * the host owns `<userData>/sylo-image-gen/config.json`, writes a JSON-schema
 * sidecar into `<agentDir>/extensions-config/` (drives the standard extension
 * config form), and exposes `imagegenConfigEnvPath()` so broker-supervisor.ts
 * can inject `SYLO_IMAGEGEN_CONFIG` into broker children when the package is
 * enabled (ttsConfigEnvPath parity, §0.7).
 *
 * One source of truth (§3.3): the config SHAPE, defaults, and coercion live in
 * the package (`packages/sylo-image-gen/extensions/config.ts` + `shared/types.ts`)
 * and are imported here — the extension reads this same file through the env
 * path (`loadImagegenConfig` → `SYLO_IMAGEGEN_CONFIG`), so agent tools and the
 * sidebar route can never drift apart.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SyloOptionalPackage } from '../shared/sylo-optional-packages.js'
import { isSyloOptionalPackageEnabled } from '../shared/sylo-optional-packages.js'
import {
  DEFAULT_IMAGEGEN_CONFIG,
  coerceImagegenConfig,
} from '../../../../packages/sylo-image-gen/extensions/config.js'
import type { ImagegenConfig } from '../../../../packages/sylo-image-gen/shared/types.js'

export const IMAGEGEN_CONFIG_KEY = 'sylo-image-gen'

export type { ImagegenConfig }

export function imagegenConfigDir(userDataPath: string): string {
  return join(userDataPath, 'sylo-image-gen')
}

export function imagegenConfigPath(userDataPath: string): string {
  return join(imagegenConfigDir(userDataPath), 'config.json')
}

/** Read + coerce the host config file. Missing/broken file → defaults. */
export function readImagegenConfig(userDataPath: string): ImagegenConfig {
  const path = imagegenConfigPath(userDataPath)
  if (!existsSync(path)) return { ...DEFAULT_IMAGEGEN_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return coerceImagegenConfig(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}).config
  } catch {
    return { ...DEFAULT_IMAGEGEN_CONFIG }
  }
}

/** Merge + coerce values over defaults, then write atomically-ish (tts parity). */
export function writeImagegenConfig(
  userDataPath: string,
  values: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  try {
    const dir = imagegenConfigDir(userDataPath)
    mkdirSync(dir, { recursive: true })
    const { config } = coerceImagegenConfig({ ...values })
    writeFileSync(imagegenConfigPath(userDataPath), JSON.stringify(config, null, 2), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Schema sidecar for the standard extension-config form (tts parity). */
export function ensureImagegenConfigSchema(agentDir: string): void {
  const dir = join(agentDir, 'extensions-config')
  mkdirSync(dir, { recursive: true })
  const schemaPath = join(dir, `${IMAGEGEN_CONFIG_KEY}.schema.json`)
  if (existsSync(schemaPath)) return
  const schema = {
    type: 'object',
    properties: {
      comfyui_url: {
        type: 'string',
        description: 'ComfyUI API base URL (default http://127.0.0.1:8188)',
      },
      draft_model: {
        type: 'string',
        description: 'Catalog model id for the draft preset (default z-image-turbo)',
      },
      final_model: {
        type: 'string',
        description: 'Catalog model id for the final preset (default qwen-image-2)',
      },
      default_aspect: {
        type: 'string',
        description: 'Default aspect for the Images route composer (1:1 | 16:9 | 9:16 | 3:2 | 2:3 | 4:3 | 3:4)',
      },
      auto_tag_preset: {
        type: 'boolean',
        description: 'Auto-tag generated records with their preset (draft/final)',
      },
      image_format: {
        type: 'string',
        description: 'Library image format (v1: png only)',
      },
      upscale_model: {
        type: 'string',
        description: 'Upscaler model id for sylo_image_gen_upscale (v2)',
      },
      caption_backend: {
        type: 'string',
        description: 'Auto-captioning backend (v2: florence2; off = disabled)',
      },
      comfyui_exe_path: {
        type: 'string',
        description: 'Path to a ComfyUI executable for a future launch button (empty = detect only)',
      },
    },
  }
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf8')
}

/**
 * Broker injection gate (ttsConfigEnvPath parity): the host config path goes to
 * broker children via SYLO_IMAGEGEN_CONFIG only when sylo-image-gen is enabled.
 * Guarantees the file exists so the child never reads a stale-missing path.
 */
export function imagegenConfigEnvPath(
  userDataPath: string,
  pref: Record<string, boolean>,
  pkg: SyloOptionalPackage | undefined,
): string | undefined {
  if (!pkg || !isSyloOptionalPackageEnabled(pref, pkg.id)) return undefined
  const path = imagegenConfigPath(userDataPath)
  if (!existsSync(path)) {
    writeImagegenConfig(userDataPath, {})
  }
  return path
}