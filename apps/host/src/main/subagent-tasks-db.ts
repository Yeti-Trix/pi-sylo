import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import type { AgentTaskRow, AgentTaskSpec, SubagentRunMode, SubagentTaskStatus } from '../shared/subagent-tasks-types.js'
import { getDb } from './database.js'

const TASK_COLUMNS = `id, host_session_id, conversation_id, parent_task_id, group_run_id, depth,
  title, spec_json, status, status_reason, mode, agent_name, step_index,
  started_at, ended_at, result_summary, result_json, tokens_used, created_at, updated_at`

function tableExists(d: Database.Database, name: string): boolean {
  const row = d
    .prepare(`SELECT 1 as x FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { x: number } | undefined
  return !!row
}

function tableHasColumn(d: Database.Database, table: string, col: string): boolean {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((r) => r.name === col)
}

function createAgentTasksTable(d: Database.Database): void {
  d.exec(`
CREATE TABLE agent_tasks (
  id TEXT PRIMARY KEY,
  host_session_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  parent_task_id TEXT,
  group_run_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  mode TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  step_index INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  result_summary TEXT,
  result_json TEXT,
  tokens_used INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (host_session_id) REFERENCES host_sessions(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);`)
}

function createAgentTasksIndexes(d: Database.Database): void {
  d.exec(`
CREATE INDEX IF NOT EXISTS idx_agent_tasks_conversation ON agent_tasks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_host_session ON agent_tasks(host_session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_group ON agent_tasks(group_run_id);
`)
}

function backfillAgentTaskConversationIds(d: Database.Database): void {
  if (!tableHasColumn(d, 'agent_tasks', 'conversation_id')) return
  const missing = (
    d.prepare('SELECT COUNT(*) as c FROM agent_tasks WHERE conversation_id IS NULL').get() as {
      c: number
    }
  ).c
  if (missing === 0) return
  const conv = d
    .prepare('SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1')
    .get() as { id: string } | undefined
  if (conv) {
    d.prepare('UPDATE agent_tasks SET conversation_id = ? WHERE conversation_id IS NULL').run(conv.id)
  } else {
    d.exec('DELETE FROM agent_tasks WHERE conversation_id IS NULL')
  }
}

export function migrateSubagentTasksSchema(): void {
  const d = getDb()
  d.exec(`
CREATE TABLE IF NOT EXISTS host_sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);`)

  if (tableExists(d, 'agent_tasks') && !tableHasColumn(d, 'agent_tasks', 'conversation_id')) {
    // Pre-conversation_id dev schema — task telemetry only; safe to replace.
    d.exec('DROP TABLE agent_tasks')
  }

  if (!tableExists(d, 'agent_tasks')) {
    createAgentTasksTable(d)
  } else if (!tableHasColumn(d, 'agent_tasks', 'conversation_id')) {
    d.exec('ALTER TABLE agent_tasks ADD COLUMN conversation_id TEXT')
    backfillAgentTaskConversationIds(d)
  }

  createAgentTasksIndexes(d)
}

function truncateTitle(task: string): string {
  const t = task.replace(/\s+/g, ' ').trim()
  if (t.length <= 200) return t || '(subagent task)'
  return `${t.slice(0, 197)}...`
}

export function closeOpenHostSessions(now = Date.now()): void {
  getDb()
    .prepare(
      `UPDATE host_sessions SET ended_at = ?
       WHERE ended_at IS NULL`,
    )
    .run(now)
}

/**
 * Prune host_sessions (and their agent_tasks) older than the retention cutoff. A
 * session is stale when it ended before `cutoffMs`, or when it never recorded an
 * end but started before `cutoffMs` (stuck/abandoned). Called on startup alongside
 * purgeStaleConversations (30-day fixed retention). See feature tracker
 * 2026-08-02_14-53-03 (scope-based storage refactor, Phase 3).
 */
export function pruneStaleHostSessions(cutoffMs: number): number {
  const d = getDb()
  const staleIds = d
    .prepare(
      `SELECT id FROM host_sessions
       WHERE (ended_at IS NOT NULL AND ended_at < ?)
          OR (ended_at IS NULL AND started_at < ?)`,
    )
    .all(cutoffMs, cutoffMs) as { id: string }[]
  if (staleIds.length === 0) return 0
  const ids = staleIds.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  // Clean agent_tasks referencing these sessions first (foreign_keys pragma is off,
  // but keep the table tidy — no dangling host_session_id refs).
  if (tableExists(d, 'agent_tasks')) {
    d.prepare(`DELETE FROM agent_tasks WHERE host_session_id IN (${placeholders})`).run(...ids)
  }
  const result = d.prepare(`DELETE FROM host_sessions WHERE id IN (${placeholders})`).run(...ids)
  return result.changes
}

export function orphanAllRunningAgentTasks(reason: string, now = Date.now()): number {
  const result = getDb()
    .prepare(
      `UPDATE agent_tasks
       SET status = 'orphaned', status_reason = ?, ended_at = ?, updated_at = ?
       WHERE status = 'running'`,
    )
    .run(reason, now, now)
  return result.changes
}

export function orphanRunningTasksForOpenHostSessions(reason: string, now = Date.now()): number {
  const d = getDb()
  const result = d
    .prepare(
      `UPDATE agent_tasks
       SET status = 'orphaned', status_reason = ?, ended_at = ?, updated_at = ?
       WHERE status = 'running'
       AND host_session_id IN (SELECT id FROM host_sessions WHERE ended_at IS NULL)`,
    )
    .run(reason, now, now)
  return result.changes
}

export function beginHostSession(now = Date.now()): string {
  closeOpenHostSessions(now)
  orphanAllRunningAgentTasks('host_restart', now)
  const id = randomUUID()
  getDb()
    .prepare('INSERT INTO host_sessions (id, started_at, ended_at) VALUES (?, ?, NULL)')
    .run(id, now)
  return id
}

export function endHostSession(hostSessionId: string, now = Date.now()): void {
  getDb()
    .prepare('UPDATE host_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL')
    .run(now, hostSessionId)
}

export function orphanRunningTasksForHostSession(
  hostSessionId: string,
  reason: string,
  now = Date.now(),
): number {
  const result = getDb()
    .prepare(
      `UPDATE agent_tasks
       SET status = 'orphaned', status_reason = ?, ended_at = ?, updated_at = ?
       WHERE host_session_id = ? AND status = 'running'`,
    )
    .run(reason, now, now, hostSessionId)
  return result.changes
}

export function insertAgentTaskStart(input: {
  id: string
  hostSessionId: string
  conversationId: string
  parentTaskId?: string
  groupRunId: string
  mode: SubagentRunMode
  agent: string
  task: string
  stepIndex?: number
  now?: number
}): AgentTaskRow {
  const now = input.now ?? Date.now()
  const depth = input.parentTaskId ? 1 : 0
  const spec: AgentTaskSpec = {
    task: input.task,
    mode: input.mode,
    agent: input.agent,
    groupRunId: input.groupRunId,
    ...(input.stepIndex !== undefined ? { stepIndex: input.stepIndex } : {}),
  }
  const row: AgentTaskRow = {
    id: input.id,
    host_session_id: input.hostSessionId,
    conversation_id: input.conversationId,
    parent_task_id: input.parentTaskId ?? null,
    group_run_id: input.groupRunId,
    depth,
    title: truncateTitle(input.task),
    spec_json: JSON.stringify(spec),
    status: 'running',
    status_reason: null,
    mode: input.mode,
    agent_name: input.agent,
    step_index: input.stepIndex ?? null,
    started_at: now,
    ended_at: null,
    result_summary: null,
    result_json: null,
    tokens_used: null,
    created_at: now,
    updated_at: now,
  }
  getDb()
    .prepare(
      `INSERT INTO agent_tasks (
        id, host_session_id, conversation_id, parent_task_id, group_run_id, depth,
        title, spec_json, status, status_reason, mode, agent_name, step_index,
        started_at, ended_at, result_summary, result_json, tokens_used, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.host_session_id,
      row.conversation_id,
      row.parent_task_id,
      row.group_run_id,
      row.depth,
      row.title,
      row.spec_json,
      row.status,
      row.status_reason,
      row.mode,
      row.agent_name,
      row.step_index,
      row.started_at,
      row.ended_at,
      row.result_summary,
      row.result_json,
      row.tokens_used,
      row.created_at,
      row.updated_at,
    )
  return row
}

export function updateAgentTaskProgress(
  id: string,
  patch: {
    partialText?: string
    toolName?: string
    toolPreview?: string
  },
  now = Date.now(),
): void {
  const existing = getAgentTask(id)
  if (!existing) return
  let spec: AgentTaskSpec
  try {
    spec = JSON.parse(existing.spec_json) as AgentTaskSpec
  } catch {
    spec = {
      task: existing.title,
      mode: existing.mode,
      agent: existing.agent_name,
      groupRunId: existing.group_run_id ?? id,
    }
  }
  if (patch.partialText !== undefined) spec.lastPartialText = patch.partialText
  if (patch.toolName !== undefined) spec.lastToolName = patch.toolName
  if (patch.toolPreview !== undefined) spec.lastToolPreview = patch.toolPreview

  getDb()
    .prepare(
      `UPDATE agent_tasks SET spec_json = ?, updated_at = ? WHERE id = ? AND status = 'running'`,
    )
    .run(JSON.stringify(spec), now, id)
}

export function finalizeAgentTask(
  id: string,
  input: {
    status: SubagentTaskStatus
    statusReason?: string
    resultSummary?: string
    resultJson?: Record<string, unknown>
    tokensUsed?: number
  },
  now = Date.now(),
): void {
  getDb()
    .prepare(
      `UPDATE agent_tasks
       SET status = ?, status_reason = ?, ended_at = ?, result_summary = ?,
           result_json = ?, tokens_used = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.status,
      input.statusReason ?? null,
      now,
      input.resultSummary ?? null,
      input.resultJson ? JSON.stringify(input.resultJson) : null,
      input.tokensUsed ?? null,
      now,
      id,
    )
}

export function getAgentTask(id: string): AgentTaskRow | undefined {
  return getDb()
    .prepare(`SELECT ${TASK_COLUMNS} FROM agent_tasks WHERE id = ?`)
    .get(id) as AgentTaskRow | undefined
}

export function listAgentTasksForConversation(conversationId: string): AgentTaskRow[] {
  return getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM agent_tasks
       WHERE conversation_id = ?
       ORDER BY created_at DESC`,
    )
    .all(conversationId) as AgentTaskRow[]
}

export function countOrphanedAgentTasks(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM agent_tasks WHERE status = 'orphaned'`)
    .get() as { c: number }
  return row.c
}

export function deleteOrphanedAgentTasks(): number {
  const result = getDb().prepare(`DELETE FROM agent_tasks WHERE status = 'orphaned'`).run()
  return result.changes
}

export function countRunningAgentTasks(hostSessionId?: string): number {
  if (hostSessionId) {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) as c FROM agent_tasks WHERE status = 'running' AND host_session_id = ?`,
      )
      .get(hostSessionId) as { c: number }
    return row.c
  }
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM agent_tasks WHERE status = 'running'`)
    .get() as { c: number }
  return row.c
}
