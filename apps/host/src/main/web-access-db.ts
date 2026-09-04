import type Database from 'better-sqlite3'

import type { WebAccessRunRow, WebAccessStats, WebAccessToolKind } from '../shared/web-access-types.js'
import { getDb } from './database.js'

const RUN_COLUMNS = `id, conversation_id, turn_id, tool, query, url, status,
  search_tier, result_count, rank_kept, rank_dropped, rank_threshold, rank_scores_json,
  fetches_json, error_stage, error_message, started_at, ended_at`

function tableExists(d: Database.Database, name: string): boolean {
  const row = d
    .prepare(`SELECT 1 as x FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { x: number } | undefined
  return !!row
}

export function migrateWebAccessSchema(): void {
  const d = getDb()
  if (tableExists(d, 'web_access_runs')) return
  d.exec(`
CREATE TABLE web_access_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  turn_id TEXT,
  tool TEXT NOT NULL,
  query TEXT,
  url TEXT,
  status TEXT NOT NULL,
  search_tier TEXT,
  result_count INTEGER,
  rank_kept INTEGER,
  rank_dropped INTEGER,
  rank_threshold REAL,
  rank_scores_json TEXT,
  fetches_json TEXT,
  error_stage TEXT,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_web_access_runs_started ON web_access_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_access_runs_conversation ON web_access_runs(conversation_id);
`)
}

function rowFromDb(r: Record<string, unknown>): WebAccessRunRow {
  return {
    id: String(r.id),
    conversation_id: r.conversation_id != null ? String(r.conversation_id) : null,
    turn_id: r.turn_id != null ? String(r.turn_id) : null,
    tool: String(r.tool) as WebAccessToolKind,
    query: r.query != null ? String(r.query) : null,
    url: r.url != null ? String(r.url) : null,
    status: String(r.status) as WebAccessRunRow['status'],
    search_tier: r.search_tier != null ? String(r.search_tier) : null,
    result_count: typeof r.result_count === 'number' ? r.result_count : null,
    rank_kept: typeof r.rank_kept === 'number' ? r.rank_kept : null,
    rank_dropped: typeof r.rank_dropped === 'number' ? r.rank_dropped : null,
    rank_threshold: typeof r.rank_threshold === 'number' ? r.rank_threshold : null,
    rank_scores_json: r.rank_scores_json != null ? String(r.rank_scores_json) : null,
    fetches_json: r.fetches_json != null ? String(r.fetches_json) : null,
    error_stage: r.error_stage != null ? String(r.error_stage) : null,
    error_message: r.error_message != null ? String(r.error_message) : null,
    started_at: Number(r.started_at),
    ended_at: typeof r.ended_at === 'number' ? r.ended_at : null,
  }
}

export function insertWebAccessRunStart(args: {
  id: string
  conversationId: string | null
  turnId: string | null
  tool: WebAccessToolKind
  query?: string
  url?: string
  startedAt?: number
}): void {
  const now = args.startedAt ?? Date.now()
  getDb()
    .prepare(
      `INSERT INTO web_access_runs (
        id, conversation_id, turn_id, tool, query, url, status, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
    )
    .run(
      args.id,
      args.conversationId,
      args.turnId,
      args.tool,
      args.query ?? null,
      args.url ?? null,
      now,
    )
}

export function patchWebAccessRun(
  id: string,
  patch: Partial<{
    status: WebAccessRunRow['status']
    search_tier: string
    result_count: number
    rank_kept: number
    rank_dropped: number
    rank_threshold: number
    rank_scores_json: string
    fetches_json: string
    error_stage: string
    error_message: string
    ended_at: number
  }>,
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    sets.push(`${k} = ?`)
    vals.push(v)
  }
  if (sets.length === 0) return
  vals.push(id)
  getDb().prepare(`UPDATE web_access_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function appendFetchToRun(
  id: string,
  entry: { url: string; tier: string; bytes: number; adequate: boolean; relevant?: boolean },
): void {
  const d = getDb()
  const row = d.prepare(`SELECT fetches_json FROM web_access_runs WHERE id = ?`).get(id) as
    | { fetches_json: string | null }
    | undefined
  const list: unknown[] = []
  if (row?.fetches_json) {
    try {
      const parsed = JSON.parse(row.fetches_json) as unknown
      if (Array.isArray(parsed)) list.push(...parsed)
    } catch {
      /* reset */
    }
  }
  list.push(entry)
  patchWebAccessRun(id, { fetches_json: JSON.stringify(list) })
}

/** Remove audit rows when a conversation is deleted (FK → conversations). */
export function deleteWebAccessRunsForConversation(
  conversationId: string,
  dbHandle?: Database.Database,
): void {
  const d = dbHandle ?? getDb()
  if (!tableExists(d, 'web_access_runs')) return
  d.prepare('DELETE FROM web_access_runs WHERE conversation_id = ?').run(conversationId)
}

/**
 * Prune web-access run rows older than the retention cutoff (transient fetch/search
 * cache). Called on startup alongside purgeStaleConversations (30-day fixed retention).
 * See feature tracker 2026-08-02_14-53-03 (scope-based storage refactor, Phase 4).
 */
export function pruneStaleWebAccessRuns(cutoffMs: number): number {
  const d = getDb()
  if (!tableExists(d, 'web_access_runs')) return 0
  const result = d.prepare('DELETE FROM web_access_runs WHERE started_at < ?').run(cutoffMs)
  return result.changes
}

export function listWebAccessRuns(limit = 100): WebAccessRunRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM web_access_runs ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[]
  return rows.map(rowFromDb)
}

export function getWebAccessStats(): WebAccessStats {
  const d = getDb()
  const total = (d.prepare('SELECT COUNT(*) as c FROM web_access_runs').get() as { c: number }).c
  const searchRuns = (
    d.prepare(`SELECT COUNT(*) as c FROM web_access_runs WHERE tool = 'search'`).get() as {
      c: number
    }
  ).c
  const fetchRuns = (
    d.prepare(`SELECT COUNT(*) as c FROM web_access_runs WHERE tool = 'fetch'`).get() as {
      c: number
    }
  ).c
  const errorRuns = (
    d.prepare(`SELECT COUNT(*) as c FROM web_access_runs WHERE status = 'error'`).get() as {
      c: number
    }
  ).c
  const since = Date.now() - 86_400_000
  const last24h = (
    d.prepare('SELECT COUNT(*) as c FROM web_access_runs WHERE started_at >= ?').get(since) as {
      c: number
    }
  ).c

  const tierCounts: Record<string, number> = {}
  const tiers = d
    .prepare(
      `SELECT search_tier as t, COUNT(*) as c FROM web_access_runs
       WHERE search_tier IS NOT NULL AND search_tier != ''
       GROUP BY search_tier`,
    )
    .all() as { t: string; c: number }[]
  for (const row of tiers) {
    tierCounts[row.t] = row.c
  }

  const fetchTierRows = d
    .prepare(`SELECT fetches_json FROM web_access_runs WHERE fetches_json IS NOT NULL`)
    .all() as { fetches_json: string }[]
  for (const fr of fetchTierRows) {
    try {
      const arr = JSON.parse(fr.fetches_json) as { tier?: string }[]
      if (!Array.isArray(arr)) continue
      for (const f of arr) {
        const t = typeof f.tier === 'string' ? f.tier : 'F1'
        tierCounts[`fetch:${t}`] = (tierCounts[`fetch:${t}`] ?? 0) + 1
      }
    } catch {
      /* skip */
    }
  }

  return { totalRuns: total, searchRuns, fetchRuns, errorRuns, last24h, tierCounts }
}
