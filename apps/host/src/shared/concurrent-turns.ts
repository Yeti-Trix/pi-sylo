/**
 * Chat-concurrency limits shared by the main process (broker pool) and the
 * renderer (Settings UI), so both sides agree on bounds and the default.
 */

/** Max in-flight agent turns when concurrent mode is enabled and the user has not overridden it. */
export const DEFAULT_MAX_CONCURRENT_TURNS = 4

/** Bounds for the user-configurable "max concurrent turns" setting. */
export const MIN_CONCURRENT_TURNS = 1
export const MAX_CONCURRENT_TURNS_LIMIT = 16

/** Pref key for the user-configurable max in-flight turns. */
export const SYLO_MAX_CONCURRENT_TURNS_PREF = 'sylo.chat.max_concurrent_turns'

/**
 * Coerce any user input (number or numeric string) into a valid max: a finite
 * integer clamped to [MIN_CONCURRENT_TURNS, MAX_CONCURRENT_TURNS_LIMIT], with
 * garbage falling back to the default.
 */
export function clampMaxConcurrentTurns(value: unknown): number {
  const n =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(n)) return DEFAULT_MAX_CONCURRENT_TURNS
  return Math.min(MAX_CONCURRENT_TURNS_LIMIT, Math.max(MIN_CONCURRENT_TURNS, Math.round(n)))
}