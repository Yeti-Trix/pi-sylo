/**
 * Per-workspace SQLite DB manager for workspace-scoped Sylo data.
 *
 * Each workspace gets its own DB at `<pi_cwd>/.sylo/workspace.sqlite`, which rides
 * with that workspace's own folder (and its git sync if linked). Today this holds
 * `scheduled_prompts` (Phase 2 of the scope-based storage refactor). Tasks already
 * use `<workspace>/.sylo/tasks.json` (sylo-tasks) and are unchanged.
 *
 * `journal_mode = DELETE` keeps a single self-contained `.db` file (no `-wal`/`-shm`
 * sidecars) so it commits cleanly to git. See feature tracker
 * 2026-08-02_14-53-03 (scope-based storage refactor).
 */
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import { getWorkspace, listWorkspaces } from './database.js'

const SCHEDULE_DB_FILENAME = 'workspace.sqlite'

/** Cache of open per-workspace DB connections, keyed by workspace id. */
const scheduleDbCache = new Map<string, Database.Database>()

/** The on-disk path for a workspace's per-workspace DB. */
function workspaceScheduleDbPath(piCwd: string): string {
  return path.join(piCwd, '.sylo', SCHEDULE_DB_FILENAME)
}

/**
 * Scheduled-prompt schema for the per-workspace DB. Identical to the legacy main-DB
 * schema except it drops the `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`
 * clause — the per-workspace DB has no `workspaces` table (the workspace is implied
 * by which DB the row lives in). `workspace_id` is kept as a plain column for
 * authorization checks and daemon fan-out.
 */
export function ensureScheduledPromptsSchema(d: Database.Database): void {
  d.exec(`
CREATE TABLE IF NOT EXISTS scheduled_prompts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  prompt_text TEXT NOT NULL,
  recurrence TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  time_local TEXT NOT NULL DEFAULT '09:00',
  day_of_week INTEGER,
  day_of_month INTEGER,
  max_runs INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0,
  catchup_on_startup INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_conversation_id TEXT,
  last_run_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_prompts_workspace ON scheduled_prompts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_prompts_next_run ON scheduled_prompts(enabled, next_run_at);
`)
}

/**
 * Open (and when `create`, create + ensure schema) the per-workspace DB for a
 * workspace, resolving its `pi_cwd`. Cached by workspace id.
 *
 * With `create: false` (used by reads / daemon scans), returns `undefined` when the
 * workspace has no `pi_cwd` or no DB file yet — so reads of a workspace that has
 * never had a schedule simply return empty without littering an empty DB file.
 */
export function getWorkspaceScheduleDb(
  workspaceId: string,
  opts: { create?: boolean } = {},
): Database.Database | undefined {
  const create = opts.create === true
  const wid = workspaceId.trim()
  const cached = scheduleDbCache.get(wid)
  if (cached) return cached

  const ws = getWorkspace(wid)
  if (!ws) throw new Error(`workspace not found: ${wid}`)
  const piCwd = (ws.pi_cwd ?? '').trim()
  if (!piCwd) {
    if (create) throw new Error(`workspace ${wid} (${ws.name}) has no pi_cwd; cannot place per-workspace DB`)
    return undefined
  }

  const fp = workspaceScheduleDbPath(piCwd)
  if (!create && !existsSync(fp)) return undefined

  mkdirSync(path.dirname(fp), { recursive: true })
  const d = new Database(fp)
  d.pragma('journal_mode = DELETE')
  ensureScheduledPromptsSchema(d)
  scheduleDbCache.set(wid, d)
  return d
}

/**
 * All existing per-workspace schedule DBs on disk (for the scheduler daemon's
 * cross-workspace due/catchup scans). Does NOT create new DBs — only opens ones
 * that already exist (so workspaces that never had a schedule are left alone).
 */
export function listExistingWorkspaceScheduleDbs(): Database.Database[] {
  const out: Database.Database[] = []
  for (const ws of listWorkspaces()) {
    const piCwd = (ws.pi_cwd ?? '').trim()
    if (!piCwd) continue
    if (!existsSync(workspaceScheduleDbPath(piCwd))) continue
    const d = getWorkspaceScheduleDb(ws.id, { create: false })
    if (d) out.push(d)
  }
  return out
}

/**
 * Find the per-workspace DB that contains a given schedule id (UUID, globally
 * unique). Used by the by-id ops (get/update/delete/record/skip) which may arrive
 * without a workspace context (e.g. renderer IPC). Returns `undefined` if no
 * workspace DB has the row.
 */
export function findScheduleDbForId(id: string): Database.Database | undefined {
  const trimmed = id.trim()
  if (!trimmed) return undefined
  for (const d of listExistingWorkspaceScheduleDbs()) {
    const row = d.prepare(`SELECT 1 as x FROM scheduled_prompts WHERE id = ?`).get(trimmed) as
      | { x: number }
      | undefined
    if (row) return d
  }
  return undefined
}

/**
 * Close + evict one workspace's cached per-workspace DB connection. Call when
 * the workspace is deleted so a stale handle is never reused (the on-disk file
 * lives inside the workspace folder and may be removed by the operator).
 */
export function closeWorkspaceScheduleDb(workspaceId: string): void {
  const wid = workspaceId.trim()
  const d = scheduleDbCache.get(wid)
  if (!d) return
  try {
    d.close()
  } catch {
    /* ignore */
  }
  scheduleDbCache.delete(wid)
}

/** Close all cached per-workspace DB connections (call on app shutdown). */
export function closeAllWorkspaceScheduleDbs(): void {
  for (const d of scheduleDbCache.values()) {
    try {
      d.close()
    } catch {
      /* ignore */
    }
  }
  scheduleDbCache.clear()
}

/**
 * Drop the legacy `scheduled_prompts` table from the main AppData DB now that
 * schedules live in per-workspace DBs. Only drops when empty — never deletes
 * existing rows. Idempotent. (The operator's scheduled_prompts table is empty,
 * so this just removes the orphaned empty table.)
 */
export function dropLegacyScheduledPromptsFromMainDb(d: Database.Database): void {
  const row = d
    .prepare(`SELECT 1 as x FROM sqlite_master WHERE type='table' AND name='scheduled_prompts'`)
    .get() as { x: number } | undefined
  if (!row) return
  const { c } = d.prepare(`SELECT COUNT(*) as c FROM scheduled_prompts`).get() as { c: number }
  if (c === 0) d.exec(`DROP TABLE IF EXISTS scheduled_prompts`)
}