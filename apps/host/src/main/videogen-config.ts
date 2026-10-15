/**
 * sylo-video-gen — host-owned config (plan §2.7, §8 step 1). Mirrors
 * imagegen-config.ts: the host owns `<userData>/sylo-video-gen/config.json`
 * and writes a JSON-schema sidecar into `<agentDir>/extensions-config/`
 * (drives the standard extension config form).
 *
 * §8-1 DEVIATION (documented in issue #34 + the tracker) — RESOLVED at §8.7:
 * imagegen-config.ts also exposes imagegenConfigEnvPath() so broker-supervisor.ts can inject
 * SYLO_IMAGEGEN_CONFIG into broker children when the package is enabled (parity hook at
 * main/index.ts:5555-5559). The video twin — SYLO_VIDEOGEN_CONFIG + videogenConfigEnvPath()
 * (below) + the index.ts wiring — landed at §8.7 (host plumbing), which also edits main/index.ts;
 * until §8.7 the extension read the vanilla-Pi fallback (<agentDir>/extensions-config/
 * sylo-video-gen.json, §2.7 chain) — see shared/types.ts's file header.
 *
 * One source of truth (§3): the config SHAPE, defaults, and coercion live in
 * the package (packages/sylo-video-gen/shared/types.ts — §8.1 ships the
 * config subset there; extensions/config.ts moves the load chain beside the
 * tools at §8.6) and are imported here — so agent tools and the sidebar
 * route can never drift apart. The `SYLO_VIDEOGEN_CONFIG` env the §8.7 hook
 * will inject points at the SAME file this module owns.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SyloOptionalPackage } from '../shared/sylo-optional-packages.js'
import { isSyloOptionalPackageEnabled } from '../shared/sylo-optional-packages.js'
import {
  DEFAULT_VIDEOGEN_CONFIG,
  coerceVideogenConfig,
} from '../../../../packages/sylo-video-gen/shared/types.js'
import type { VideogenConfig } from '../../../../packages/sylo-video-gen/shared/types.js'

export const VIDEOGEN_CONFIG_KEY = 'sylo-video-gen'

export type { VideogenConfig }

export function videogenConfigDir(userDataPath: string): string {
  return join(userDataPath, 'sylo-video-gen')
}

export function videogenConfigPath(userDataPath: string): string {
  return join(videogenConfigDir(userDataPath), 'config.json')
}

/** Read + coerce the host config file. Missing/broken file → defaults. */
export function readVideogenConfig(userDataPath: string): VideogenConfig {
  const path = videogenConfigPath(userDataPath)
  if (!existsSync(path)) return { ...DEFAULT_VIDEOGEN_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return coerceVideogenConfig(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}).config
  } catch {
    return { ...DEFAULT_VIDEOGEN_CONFIG }
  }
}

/** Merge + coerce values over defaults, then write atomically-ish (tts parity). */
export function writeVideogenConfig(
  userDataPath: string,
  values: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  try {
    const dir = videogenConfigDir(userDataPath)
    mkdirSync(dir, { recursive: true })
    const { config } = coerceVideogenConfig({ ...values })
    writeFileSync(videogenConfigPath(userDataPath), JSON.stringify(config, null, 2), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Schema sidecar for the standard extension-config form (tts/imagegen parity). */
export function ensureVideogenConfigSchema(agentDir: string): void {
  const dir = join(agentDir, 'extensions-config')
  mkdirSync(dir, { recursive: true })
  const schemaPath = join(dir, `${VIDEOGEN_CONFIG_KEY}.schema.json`)
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
        description: 'Catalog model id for the draft clip preset (default wan22-ti2v-5b, §2.2)',
      },
      final_model: {
        type: 'string',
        description: 'Catalog model id for the final clip preset (default wan22-a14b, §2.2)',
      },
      restyle_model: {
        type: 'string',
        description: 'Catalog model id for the restyle preset (default wan21-vace-14b, §2.2)',
      },
      default_resolution: {
        type: 'string',
        description: 'Default resolution for the Videos composer (480p | 720p)',
      },
      default_orientation: {
        type: 'string',
        description: 'Default orientation (landscape | portrait)',
      },
      default_duration_seconds: {
        type: 'number',
        description: 'Default clip duration in seconds (4 | 5 | 8)',
      },
      default_framerate: {
        type: 'number',
        description: '0 = model default (ti2v-5B 24 fps, A14B 16 fps) — else 16 | 24',
      },
      loop_motion_strength: {
        type: 'number',
        description: 'Living-photo loop motion intensity 0–1 (default 0.5)',
      },
      auto_tag_preset: {
        type: 'boolean',
        description: 'Auto-tag generated records with their preset (draft/final)',
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
 * Broker injection gate (imagegenConfigEnvPath parity, landed at §8.7 — the
 * §8.1 deferral residual, issue #34): the host config path goes to broker
 * children via SYLO_VIDEOGEN_CONFIG only when sylo-video-gen is enabled.
 * Guarantees the file exists so the child never reads a stale-missing path.
 */
export function videogenConfigEnvPath(
  userDataPath: string,
  pref: Record<string, boolean>,
  pkg: SyloOptionalPackage | undefined,
): string | undefined {
  if (!pkg || !isSyloOptionalPackageEnabled(pref, pkg.id)) return undefined
  const path = videogenConfigPath(userDataPath)
  if (!existsSync(path)) {
    writeVideogenConfig(userDataPath, {})
  }
  return path
}