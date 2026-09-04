/**
 * Shared OS-temp PDF download cache for schematic reader + web-access PDF fetch.
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const PDF_CACHE_DIR = path.join(tmpdir(), 'sylo-pdf-cache')
/** Drop cached downloads older than this (age GC; not conversation-scoped). */
export const PDF_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Remove PDF cache files older than maxAgeMs. Returns count removed. */
export function pruneStalePdfCache(maxAgeMs: number = PDF_CACHE_MAX_AGE_MS): number {
  if (!existsSync(PDF_CACHE_DIR)) return 0
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  let entries: string[]
  try {
    entries = readdirSync(PDF_CACHE_DIR)
  } catch {
    return 0
  }
  for (const name of entries) {
    const full = path.join(PDF_CACHE_DIR, name)
    try {
      const st = statSync(full)
      if (!st.isFile()) continue
      if (st.mtimeMs >= cutoff) continue
      unlinkSync(full)
      removed += 1
    } catch {
      /* skip */
    }
  }
  return removed
}
