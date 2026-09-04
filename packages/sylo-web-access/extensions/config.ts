/**
 * Configuration loading and model/host resolution for sylo-web-access.
 *
 * Config is read from a JSON file whose path is provided via the
 * `SYLO_WEB_ACCESS_CONFIG` environment variable (set by the Sylo host when the
 * optional package is enabled). When absent, sane privacy-first defaults apply.
 *
 * Per operator decision (2026-06-03): rank/rewrite default to the operator's
 * *selected main model* (resolved at call time from the Pi extension context),
 * and are overridable per-field in Settings.
 */
import { readFileSync } from 'node:fs'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

export interface WebAccessConfig {
  /** Ollama origin override; empty → derive from the active model's baseUrl. */
  ollamaHost: string
  /** Rank model id; empty → operator's selected main model. */
  rankModel: string
  /** Rewrite model id; empty → operator's selected main model. */
  rewriteModel: string
  rankingEnabled: boolean
  relevancyThreshold: number
  rankMaxRetries: number
  maxSearchResults: number
  maxPagesPerSearch: number
  maxFetchCallsPerTurn: number
  maxSearchCallsPerTurn: number
    /** Operator-ordered S2 rotation; S1 (DDG HTML) is always tried first. */
  searchBackends: string[]
  /** Brave Search API key (free tier 2k q/mo). Enables the keyed `brave_api` S2 backend. */
  braveApiKey: string
  /** When true, escalate to Python S2/F2 on block/inadequate (requires pip deps). */
  heavyTiersEnabled: boolean
  /** F1 og:image / hero previews in tool output when the main model supports vision. */
  previewImagesEnabled: boolean
  maxPreviewImagesPerPage: number
}

const DEFAULT_CONFIG: WebAccessConfig = {
  ollamaHost: '',
  rankModel: '',
  rewriteModel: '',
  rankingEnabled: true,
  relevancyThreshold: 0.55,
  rankMaxRetries: 3,
  maxSearchResults: 10,
  maxPagesPerSearch: 3,
  maxFetchCallsPerTurn: 5,
  maxSearchCallsPerTurn: 3,
    searchBackends: ['duckduckgo', 'brave_api'],
  braveApiKey: '',
  heavyTiersEnabled: true,
  // Default OFF (2026-06-09): the OpenAI/Ollama wire format can't carry images on a
  // role:"tool" message, so pi-ai relocates tool-result images into a synthetic
  // role:"user" turn ("Attached image(s) from tool result:"). Small local models read
  // that as the operator sharing an image / as the turn already being answered. Keep
  // previews off unless a vision workflow explicitly needs them. See
  // issue_tracker/resolved/2026-06-09_web_search_tool_result_image_role_confusion.md.
  previewImagesEnabled: false,
  maxPreviewImagesPerPage: 1,
}

function coerceNumber(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
}

function coerceBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

function coerceString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw.trim() : fallback
}

function coerceStringArray(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback
  const out = raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
  return out.length > 0 ? out : fallback
}

/**
 * Load and validate the web-access config, merging file values over defaults.
 *
 * @returns A fully-populated, normalized {@link WebAccessConfig}.
 */
export function loadConfig(): WebAccessConfig {
  const path = process.env.SYLO_WEB_ACCESS_CONFIG?.trim()
  if (!path) return { ...DEFAULT_CONFIG }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return { ...DEFAULT_CONFIG }
  }
  return {
    ollamaHost: coerceString(raw.ollamaHost, DEFAULT_CONFIG.ollamaHost),
    rankModel: coerceString(raw.rank_model, DEFAULT_CONFIG.rankModel),
    rewriteModel: coerceString(raw.rewrite_model, DEFAULT_CONFIG.rewriteModel),
    rankingEnabled: coerceBoolean(raw.ranking_enabled, DEFAULT_CONFIG.rankingEnabled),
    relevancyThreshold: coerceNumber(raw.relevancy_threshold, DEFAULT_CONFIG.relevancyThreshold),
    rankMaxRetries: coerceNumber(raw.rank_max_retries, DEFAULT_CONFIG.rankMaxRetries),
    maxSearchResults: coerceNumber(raw.max_search_results, DEFAULT_CONFIG.maxSearchResults),
    maxPagesPerSearch: coerceNumber(raw.max_pages_per_search, DEFAULT_CONFIG.maxPagesPerSearch),
    maxFetchCallsPerTurn: coerceNumber(raw.max_fetch_calls_per_turn, DEFAULT_CONFIG.maxFetchCallsPerTurn),
    maxSearchCallsPerTurn: coerceNumber(raw.max_search_calls_per_turn, DEFAULT_CONFIG.maxSearchCallsPerTurn),
        searchBackends: coerceStringArray(raw.searchBackends, DEFAULT_CONFIG.searchBackends),
    braveApiKey: coerceString(raw.brave_api_key, DEFAULT_CONFIG.braveApiKey),
    heavyTiersEnabled: coerceBoolean(raw.heavy_tiers_enabled, DEFAULT_CONFIG.heavyTiersEnabled),
    previewImagesEnabled: coerceBoolean(raw.preview_images_enabled, DEFAULT_CONFIG.previewImagesEnabled),
    maxPreviewImagesPerPage: coerceNumber(
      raw.max_preview_images_per_page,
      DEFAULT_CONFIG.maxPreviewImagesPerPage,
    ),
  }
}

/** Normalize a host string to an `http(s)://host:port` origin with no trailing slash. */
function normalizeOrigin(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  const withScheme = /^https?:\/\//i.test(t) ? t : `http://${t.replace(/^\/*/, '')}`
  return withScheme.replace(/\/+$/, '').replace(/\/v\d+$/i, '')
}

export interface ResolvedModel {
  /** Ollama origin (no trailing slash, no `/v1`). */
  ollamaHost: string
  /** Model id passed to `/api/chat`. */
  modelId: string
}

/**
 * Resolve the Ollama host + model id for a quarantined (rank/rewrite) call.
 *
 * Precedence: explicit config field → active model. The Ollama origin comes
 * from config, else the active model's `baseUrl`, else the local default.
 *
 * @param config - Loaded web-access config.
 * @param ctx - Pi extension context (provides `ctx.model`).
 * @param role - Which model field to resolve.
 * @returns Resolved host + model id, or null when no model is resolvable.
 */
export function resolveModel(
  config: WebAccessConfig,
  ctx: ExtensionContext,
  role: 'rank' | 'rewrite',
): ResolvedModel | null {
  const configured = role === 'rank' ? config.rankModel : config.rewriteModel
  const modelId = configured || ctx.model?.id || ''
  if (!modelId) return null

  const host =
    normalizeOrigin(config.ollamaHost) ||
    normalizeOrigin(ctx.model?.baseUrl ?? '') ||
    normalizeOrigin(process.env.OLLAMA_HOST ?? '') ||
    'http://127.0.0.1:11434'

  return { ollamaHost: host, modelId }
}
