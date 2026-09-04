import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

function resolveSyloSqlitePath(dbPathOrUserData: string): string | null {
  const raw = dbPathOrUserData.trim()
  if (!raw) return null
  if (raw.endsWith('.sqlite')) return raw
  return join(raw, 'sylo-data', 'sylo.sqlite')
}

/** @internal test hook */
export function resolveSyloSqlitePathForTest(dbPathOrUserData: string): string | null {
  return resolveSyloSqlitePath(dbPathOrUserData)
}

function readSyloPrefRaw(
  dbPathOrUserData: string | undefined,
  key: string,
): unknown | undefined {
  const fp = resolveSyloSqlitePath(typeof dbPathOrUserData === 'string' ? dbPathOrUserData : '')
  if (!fp || !existsSync(fp)) return undefined
  try {
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(fp, { readonly: true, fileMustExist: true })
    try {
      const row = db.prepare('SELECT value_json FROM prefs WHERE key = ?').get(key) as
        | { value_json: string }
        | undefined
      if (!row) return undefined
      return JSON.parse(row.value_json) as unknown
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

/** Read a boolean Sylo pref from `sylo-data/sylo.sqlite` (broker-safe; no main-process DB handle). */
export function readSyloPrefBool(
  dbPathOrUserData: string | undefined,
  key: string,
  fallback = false,
): boolean {
  const parsed = readSyloPrefRaw(dbPathOrUserData, key)
  if (parsed === undefined) return fallback
  return parsed === true
}

/** Read a string Sylo pref from `sylo-data/sylo.sqlite` (broker-safe). */
export function readSyloPrefString(
  dbPathOrUserData: string | undefined,
  key: string,
  fallback: string,
): string {
  const parsed = readSyloPrefRaw(dbPathOrUserData, key)
  if (typeof parsed !== 'string') return fallback
  const trimmed = parsed.trim()
  return trimmed || fallback
}
