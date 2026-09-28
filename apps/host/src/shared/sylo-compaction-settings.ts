/**
 * Per-model compaction trigger settings (Settings → Model (Pi) → Compaction).
 *
 * Pi auto-compacts when context tokens exceed `contextWindow - compaction.reserveTokens`
 * (default reserve: 16,384 — `DEFAULT_COMPACTION_SETTINGS` in
 * `@earendil-works/pi-agent-core` harness/compaction/compaction.ts). The same default
 * applies to every model; Sylo lets the operator override the trigger **per model** as
 * a percentage of that model's context window ("compact at 85% full").
 *
 * Storage is a Sylo pref (JSON object) keyed by `<provider>:<modelId>` so an override
 * persists when the operator switches models and comes back. The host resolves the
 * stored percentage to Pi's `reserveTokens` against the model's declared context
 * window (`~/.pi/agent/models.json`) and applies it to the broker session — see
 * `apps/host/src/broker/entry.ts`.
 */

/** Pi's `DEFAULT_COMPACTION_SETTINGS.reserveTokens` — the default headroom before compaction fires. */
export const PI_DEFAULT_COMPACTION_RESERVE_TOKENS = 16384

/** Pi's assumed context window when `models.json` does not declare one for the model. */
export const PI_FALLBACK_CONTEXT_WINDOW_TOKENS = 128000

/** Sylo pref key: `"<provider>:<modelId>"` → compaction trigger % of context window (0 < pct ≤ 100). */
export const SYLO_COMPACTION_RESERVE_PREF = 'sylo.compaction.reserve_by_model'

export type CompactionReserveOverrides = Record<string, number>

/** Stable per-model key used in the override map — main and renderer must agree on this. */
export function compactionModelKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`
}

/** Sanitize one stored override; invalid entries fall back to Pi's default. */
export function normalizeCompactionOverridePct(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  if (raw <= 0 || raw > 100) return null
  return Math.round(raw * 100) / 100
}

export function normalizeCompactionOverrides(raw: unknown): CompactionReserveOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: CompactionReserveOverrides = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const pct = normalizeCompactionOverridePct(value)
    if (pct != null) out[key] = pct
  }
  return out
}

/**
 * Trigger percentage implied by Pi's default reserve for a context window
 * (e.g. 200,000-token window → compact at ~91.8% full).
 */
export function defaultCompactionTriggerPct(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0
  return Math.max(0, ((contextWindow - PI_DEFAULT_COMPACTION_RESERVE_TOKENS) / contextWindow) * 100)
}

/** Pi `reserveTokens` for a trigger percentage ("compact when context reaches pct% of the window"). */
export function reserveTokensForTriggerPct(contextWindow: number, pct: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0
  return Math.max(0, Math.round(contextWindow * (1 - pct / 100)))
}

/**
 * Resolve Pi's compaction `reserveTokens` for a model: the operator's override
 * percentage resolved against the model's declared context window (Pi fallback when
 * undeclared), or null → Pi default (16,384 reserve).
 */
export function resolveCompactionReserveTokens(
  overrides: CompactionReserveOverrides,
  provider: string,
  modelId: string,
  contextWindow: number | null,
): number | null {
  const pct = normalizeCompactionOverridePct(overrides[compactionModelKey(provider, modelId)])
  if (pct == null) return null
  return reserveTokensForTriggerPct(contextWindow ?? PI_FALLBACK_CONTEXT_WINDOW_TOKENS, pct)
}

/**
 * Write a `reserveTokens` override into a Pi SettingsManager's merged settings view.
 * `settings` is the global+project merge Pi consults on every auto-compaction check
 * (`getCompactionSettings()`), so mutating it takes effect immediately without a
 * broker restart. Live-only: nothing is persisted to settings.json, and `null`
 * removes the override (restoring Pi's 16,384-token default).
 *
 * `target` stays structural (no Pi type import) — the broker passes its live
 * `session.settingsManager`.
 */
export function applyCompactionReserveToSettings(
  target: unknown,
  reserveTokens: number | null,
): void {
  const sm = target as { settings?: { compaction?: Record<string, unknown> } } | undefined
  if (!sm?.settings) return
  const compaction: Record<string, unknown> = { ...(sm.settings.compaction ?? {}) }
  if (reserveTokens == null) delete compaction.reserveTokens
  else compaction.reserveTokens = reserveTokens
  sm.settings.compaction = compaction
}