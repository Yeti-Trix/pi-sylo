/**
 * sylo-image-gen extension config (§2.7 / plan §8 step 4).
 *
 * Load chain (coerced like the sylo-tts config chain — packages/sylo-tts/extensions/config.ts):
 *   1. `SYLO_IMAGEGEN_CONFIG` env (broker-supervisor.ts injects the host-owned
 *      `<userData>/sylo-image-gen/config.json` path when the package is enabled —
 *      the injection itself lands with §8 step 5's host plumbing, NOT in this step).
 *   2. Vanilla Pi fallback: `<agentDir>/extensions-config/sylo-image-gen.json`
 *      (same extensions-config dir the host writes its JSON-schema sidecar into;
 *      agentDir resolution mirrors workflows-engine.ts resolveAgentDir).
 *   3. Defaults.
 *
 * Keys are the §2.7 snake_case names (single source of truth with host main's
 * config.json — shared/types.ts ImagegenConfig). Anything invalid falls back to
 * its default and yields a plain-language note the doctor echoes verbatim.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ImagegenConfig } from '../shared/types.ts'
import { findModelEntry, DEFAULT_DRAFT_MODEL, DEFAULT_FINAL_MODEL, ASPECT_RATIOS } from '../shared/models.ts'

export const IMAGEGEN_CONFIG_ENV = 'SYLO_IMAGEGEN_CONFIG'

export const DEFAULT_IMAGEGEN_CONFIG: ImagegenConfig = {
  comfyui_url: 'http://127.0.0.1:8188',
  draft_model: DEFAULT_DRAFT_MODEL,
  final_model: DEFAULT_FINAL_MODEL,
  default_aspect: '1:1',
  auto_tag_preset: true,
  image_format: 'png',
  upscale_model: '4x-ultrasharp',
  caption_backend: 'off',
  comfyui_exe_path: '',
}

/** Resolved config + why any value was replaced (doctor echoes these). */
export interface LoadedImagegenConfig {
  config: ImagegenConfig
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

/** <agentDir>/extensions-config/sylo-image-gen.json (vanilla Pi config location). */
export function vanillaPiConfigPath(agentDir?: string): string {
  return join(agentDir?.trim() || resolveAgentDir(), 'extensions-config', 'sylo-image-gen.json')
}

function coerceString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw.trim() : fallback
}

function coerceBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return fallback
}

function baseUrlCoerced(raw: unknown, note: (m: string) => void): string {
  const url = coerceString(raw, DEFAULT_IMAGEGEN_CONFIG.comfyui_url)
  if (!url) return DEFAULT_IMAGEGEN_CONFIG.comfyui_url
  if (!/^https?:\/\//i.test(url)) {
    note(`comfyui_url "${url}" does not start with http:// or https:// — using "${DEFAULT_IMAGEGEN_CONFIG.comfyui_url}".`)
    return DEFAULT_IMAGEGEN_CONFIG.comfyui_url
  }
  return url
}

function modelCoerced(
  raw: unknown,
  preset: 'draft_model' | 'final_model',
  note: (m: string) => void,
): string {
  const value = coerceString(raw, DEFAULT_IMAGEGEN_CONFIG[preset])
  if (typeof raw !== 'string' || !value) return DEFAULT_IMAGEGEN_CONFIG[preset]
  if (!findModelEntry(value)) {
    note(
      `${preset} "${raw}" is not in the image-model catalog — using "${DEFAULT_IMAGEGEN_CONFIG[preset]}". ` +
        'Valid ids: ' + [DEFAULT_DRAFT_MODEL, DEFAULT_FINAL_MODEL, 'flux2-klein', 'flux1-dev', 'flux2-dev'].join(', ') + '.',
    )
    return DEFAULT_IMAGEGEN_CONFIG[preset]
  }
  return findModelEntry(value)!.id
}

function aspectCoerced(raw: unknown, note: (m: string) => void): ImagegenConfig['default_aspect'] {
  const value = coerceString(raw, DEFAULT_IMAGEGEN_CONFIG.default_aspect)
  if (typeof raw !== 'string' || !value) return DEFAULT_IMAGEGEN_CONFIG.default_aspect
  if (!(ASPECT_RATIOS as readonly string[]).includes(value)) {
    note(`default_aspect "${raw}" is not one of ${ASPECT_RATIOS.join(' | ')} — using "1:1".`)
    return DEFAULT_IMAGEGEN_CONFIG.default_aspect
  }
  return value as ImagegenConfig['default_aspect']
}

/**
 * Read + coerce one config source (§2.7 shape). Returns the effective config
 * and a list of plain-language notes for any coerced/ignored value.
 */
export function coerceImagegenConfig(raw: Record<string, unknown>): { config: ImagegenConfig; notes: string[] } {
  const notes: string[] = []
  const note = (m: string): void => {
    notes.push(m)
  }
  let format = coerceString(raw.image_format, DEFAULT_IMAGEGEN_CONFIG.image_format)
  if (format !== 'png') {
    note(`image_format "${raw.image_format ?? ''}" is not supported in v1 (PNG only) — using "png".`)
    format = 'png'
  }
  let captionBackend = coerceString(raw.caption_backend, DEFAULT_IMAGEGEN_CONFIG.caption_backend)
  if (captionBackend !== 'off') {
    note(`caption_backend "${raw.caption_backend ?? ''}" — auto-captions (Florence-2) land in v2; keeping "off".`)
    captionBackend = 'off'
  }
  const config: ImagegenConfig = {
    comfyui_url: baseUrlCoerced(raw.comfyui_url, note),
    draft_model: modelCoerced(raw.draft_model, 'draft_model', note),
    final_model: modelCoerced(raw.final_model, 'final_model', note),
    default_aspect: aspectCoerced(raw.default_aspect, note),
    auto_tag_preset: coerceBoolean(raw.auto_tag_preset, DEFAULT_IMAGEGEN_CONFIG.auto_tag_preset),
    image_format: 'png',
    upscale_model: coerceString(raw.upscale_model, DEFAULT_IMAGEGEN_CONFIG.upscale_model) || '4x-ultrasharp',
    caption_backend: 'off',
    comfyui_exe_path: coerceString(raw.comfyui_exe_path, ''),
  }
  return { config, notes }
}

/**
 * Load the effective sylo-image-gen config (chain in the file header). Never
 * throws — a broken file falls back to defaults with a note. `source` tells
 * the doctor (§3.3 config echo) which file the values came from.
 */
export function loadImagegenConfig(): LoadedImagegenConfig {
  const envPath = (process.env[IMAGEGEN_CONFIG_ENV] ?? '').trim()
  const path = envPath || vanillaPiConfigPath()
  if (path && existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      const { config, notes } = coerceImagegenConfig(raw && typeof raw === 'object' ? raw : {})
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        notes.push(`config file ${path} is not a JSON object — defaults applied for missing keys.`)
      return { config, notes, source: path }
    } catch (err) {
      return {
        config: { ...DEFAULT_IMAGEGEN_CONFIG },
        notes: [`${path} exists but is not valid JSON (${err instanceof Error ? err.message : String(err)}) — using defaults. Fix or delete the file; when running inside Sylo it lives under the host config dir.`],
        source: path,
      }
    }
  }
  return {
    config: { ...DEFAULT_IMAGEGEN_CONFIG },
    notes: envPath
      ? [`${IMAGEGEN_CONFIG_ENV} points at ${envPath} but the file does not exist — using defaults.`]
      : [],
    source: envPath || existsSync(vanillaPiConfigPath()) ? path : 'defaults',
  }
}

/** Convenience for tools that only need the values. */
export function loadImagegenConfigValues(): ImagegenConfig {
  return loadImagegenConfig().config
}