/**
 * Host-side age GC for the shared OS-temp PDF download cache
 * (`%TEMP%/sylo-pdf-cache`). Same dir as packages/sylo-pdf-reader pdf-cache.ts.
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PDF_CACHE_DIR = join(tmpdir(), 'sylo-pdf-cache')
const PDF_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function pruneStalePdfCacheDir(maxAgeMs: number = PDF_CACHE_MAX_AGE_MS): number {
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
    const full = join(PDF_CACHE_DIR, name)
    try {
      const st = statSync(full)
      if (!st.isFile() || st.mtimeMs >= cutoff) continue
      unlinkSync(full)
      removed += 1
    } catch {
      /* skip */
    }
  }
  return removed
}
