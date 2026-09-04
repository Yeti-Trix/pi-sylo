import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  isSyloOptionalPackageEnabled,
  type SyloOptionalPackage,
} from '../shared/sylo-optional-packages.js'

export const WEB_ACCESS_CONFIG_KEY = 'web-access'

export const DEFAULT_WEB_ACCESS_CONFIG: Record<string, unknown> = {
  ollamaHost: '',
  rank_model: '',
  rewrite_model: '',
  ranking_enabled: true,
  relevancy_threshold: 0.55,
  rank_max_retries: 3,
  max_search_results: 10,
  max_pages_per_search: 3,
  max_fetch_calls_per_turn: 5,
  max_search_calls_per_turn: 3,
    searchBackends: ['duckduckgo', 'brave_api'],
  brave_api_key: '',
  heavy_tiers_enabled: true,
  // Default OFF (2026-06-09): tool-result images get relocated into a synthetic role:"user"
  // turn by the OpenAI/Ollama wire transform, confusing small local models into thinking the
  // user shared an image / that the turn was already answered. See
  // issue_tracker/resolved/2026-06-09_web_search_tool_result_image_role_confusion.md.
  preview_images_enabled: false,
  max_preview_images_per_page: 1,
}

const PRIVACY_BACKENDS = ['duckduckgo', 'brave_api'] as const
const TRACKING_BACKENDS = ['google', 'bing', 'yahoo', 'yandex'] as const

export function webAccessConfigDir(userDataPath: string): string {
  return join(userDataPath, 'web-access')
}

export function webAccessConfigPath(userDataPath: string): string {
  return join(webAccessConfigDir(userDataPath), 'config.json')
}

/** Path to the latest Brave API quota snapshot (written by the broker, read by the host IPC). */
export function webAccessBraveQuotaPath(userDataPath: string): string {
  return join(webAccessConfigDir(userDataPath), 'brave-quota.json')
}

/** Read the latest Brave API quota snapshot, or null if none has been recorded yet. */
export function readWebAccessBraveQuota(userDataPath: string): Record<string, unknown> | null {
  const path = webAccessBraveQuotaPath(userDataPath)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function readWebAccessConfig(userDataPath: string): Record<string, unknown> {
  const path = webAccessConfigPath(userDataPath)
  if (!existsSync(path)) return { ...DEFAULT_WEB_ACCESS_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return { ...DEFAULT_WEB_ACCESS_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_WEB_ACCESS_CONFIG }
  }
}

export function writeWebAccessConfig(
  userDataPath: string,
  values: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  try {
    const dir = webAccessConfigDir(userDataPath)
    mkdirSync(dir, { recursive: true })
    const merged = { ...DEFAULT_WEB_ACCESS_CONFIG, ...values }
    if (!Array.isArray(merged.searchBackends) || (merged.searchBackends as unknown[]).length === 0) {
      merged.searchBackends = [...PRIVACY_BACKENDS]
    }
    writeFileSync(webAccessConfigPath(userDataPath), JSON.stringify(merged, null, 2), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** JSON schema sidecar for Capability manager extension config (optional). */
/** Canonical web-access config schema properties (Capability Manager → Configure modal). */
const WEB_ACCESS_SCHEMA_PROPERTIES: Record<string, Record<string, unknown>> = {
  ollamaHost: { type: 'string', description: 'Ollama origin override (empty = from model)' },
  rank_model: { type: 'string', description: 'Rank model id (empty = main model)' },
  rewrite_model: { type: 'string', description: 'Rewrite model id (empty = main model)' },
  ranking_enabled: { type: 'boolean' },
  relevancy_threshold: { type: 'number', minimum: 0, maximum: 1 },
  rank_max_retries: { type: 'number', minimum: 1, maximum: 10 },
  max_search_results: { type: 'number', minimum: 1, maximum: 25 },
  max_pages_per_search: { type: 'number', minimum: 1, maximum: 10 },
  max_fetch_calls_per_turn: { type: 'number', minimum: 1, maximum: 20 },
  max_search_calls_per_turn: { type: 'number', minimum: 1, maximum: 10 },
  brave_api_key: {
    type: 'string',
    format: 'password',
    description:
      'Brave Search API key. Free credit ≈ 1,000 queries/mo, then $5/1k billed. Enables the keyed brave_api S2 backend — the reliable non-DDG fallback when DuckDuckGo IP-blocks the S1 HTML endpoint.',
  },
  heavy_tiers_enabled: {
    type: 'boolean',
    description: 'Enable S2 (ddgs) and F2 (Crawl4AI headless) escalation',
  },
  preview_images_enabled: {
    type: 'boolean',
    description: 'Attach F1 og:image previews when the main model supports vision',
  },
  max_preview_images_per_page: { type: 'number', minimum: 0, maximum: 4 },
}

export function ensureWebAccessConfigSchema(agentDir: string): void {
  const dir = join(agentDir, 'extensions-config')
  mkdirSync(dir, { recursive: true })
  const schemaPath = join(dir, `${WEB_ACCESS_CONFIG_KEY}.schema.json`)

  // Self-heal: installs that enabled web-access before a canonical field was
  // added (e.g. brave_api_key) keep a stale schema that never gains the new
  // entry, because the file already existed. Merge any missing canonical
  // property back in so the Configure modal always surfaces it. Existing
  // property descriptors (including user-added ones) are preserved.
  let existing: Record<string, unknown> | null = null
  if (existsSync(schemaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') existing = parsed
    } catch {
      existing = null
    }
  }

  const props =
    existing && typeof existing.properties === 'object' && existing.properties !== null
      ? { ...(existing.properties as Record<string, unknown>) }
      : {}

  let changed = existing === null
  for (const [key, descriptor] of Object.entries(WEB_ACCESS_SCHEMA_PROPERTIES)) {
    if (props[key] === undefined) {
      props[key] = descriptor
      changed = true
    }
  }
  if (!changed) return
  const schema = { type: 'object', properties: props }
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf8')
}

export function webAccessConfigEnvPath(
  userDataPath: string,
  pref: Record<string, boolean>,
  pkg: SyloOptionalPackage | undefined,
): string | undefined {
  if (!pkg || !isSyloOptionalPackageEnabled(pref, pkg.id)) return undefined
  const path = webAccessConfigPath(userDataPath)
  if (!existsSync(path)) {
    writeWebAccessConfig(userDataPath, DEFAULT_WEB_ACCESS_CONFIG)
  }
  return path
}

export { PRIVACY_BACKENDS, TRACKING_BACKENDS }
