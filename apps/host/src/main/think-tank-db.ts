import type Database from 'better-sqlite3'

import type { ThinkTankSessionStatus, ThinkTankStance } from '../shared/think-tank-events.js'
import { getDb } from './database.js'

function tableExists(d: Database.Database, name: string): boolean {
  const row = d
    .prepare(`SELECT 1 as x FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { x: number } | undefined
  return !!row
}

function columnExists(d: Database.Database, table: string, column: string): boolean {
  const rows = d.pragma(`table_info(${table})`) as Array<{ name: string }>
  return rows.some((r) => r.name === column)
}

function migrateLegacyCouncilTables(d: Database.Database): void {
  const renames: Array<[string, string]> = [
    ['council_sessions', 'think_tank_sessions'],
    ['council_messages', 'think_tank_messages'],
    ['council_final_reports', 'think_tank_final_reports'],
    ['council_leaderboard', 'think_tank_leaderboard'],
  ]
  for (const [from, to] of renames) {
    if (tableExists(d, from) && !tableExists(d, to)) {
      d.exec(`ALTER TABLE ${from} RENAME TO ${to}`)
    }
  }
  if (tableExists(d, 'council_search_fts') && !tableExists(d, 'think_tank_search_fts')) {
    d.exec(`ALTER TABLE council_search_fts RENAME TO think_tank_search_fts`)
  }
}

export function migrateThinkTankSchema(): void {
  const d = getDb()
  migrateLegacyCouncilTables(d)
  if (!tableExists(d, 'think_tank_sessions')) {
  d.exec(`
CREATE TABLE think_tank_sessions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  min_cycles INTEGER NOT NULL,
  max_cycles INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  selected_report_id TEXT,
  source_conversation_id TEXT,
  source_message_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (source_conversation_id) REFERENCES conversations(id)
);
CREATE TABLE think_tank_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  seat_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'debate',
  body TEXT NOT NULL,
  stance TEXT NOT NULL,
  summary TEXT NOT NULL,
  model TEXT,
  tool_calls_json TEXT,
  debug_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES think_tank_sessions(id)
);
CREATE TABLE think_tank_final_reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  seat_label TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES think_tank_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_think_tank_messages_session ON think_tank_messages(session_id, cycle);
CREATE INDEX IF NOT EXISTS idx_think_tank_reports_session ON think_tank_final_reports(session_id);
CREATE VIRTUAL TABLE think_tank_search_fts USING fts5(
  session_id UNINDEXED,
  kind UNINDEXED,
  topic,
  body,
  tokenize='porter'
);
`)
  } else if (!columnExists(d, 'think_tank_messages', 'debug_json')) {
    d.exec(`ALTER TABLE think_tank_messages ADD COLUMN debug_json TEXT`)
  }
  if (!columnExists(d, 'think_tank_messages', 'reasoning_trace')) {
    d.exec(`ALTER TABLE think_tank_messages ADD COLUMN reasoning_trace TEXT`)
  }
  dropLegacyThinkTankLeaderboard(d)
}

/** Leaderboard was removed — drop orphaned tables on existing installs. */
function dropLegacyThinkTankLeaderboard(d: Database.Database): void {
  if (tableExists(d, 'think_tank_leaderboard')) {
    d.exec('DROP TABLE think_tank_leaderboard')
  }
  if (tableExists(d, 'council_leaderboard')) {
    d.exec('DROP TABLE council_leaderboard')
  }
}

function isModeratorSeatRef(seatId: string, label: string, role?: string): boolean {
  if (role === 'moderator') return true
  if (role === 'debater') return false
  if (seatId === 'seat-moderator' || seatId === 'seat-c') return true
  return /moderator|synthesis|^ref$/i.test(label)
}

function isDebateCompetitorSeatRef(seatId: string, label: string, role?: string): boolean {
  return !isModeratorSeatRef(seatId, label, role)
}

export function insertThinkTankSessionStart(args: {
  id: string
  topic: string
  minCycles: number
  maxCycles: number
  configJson: string
  sourceConversationId?: string | null
  sourceMessageId?: string | null
}): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO think_tank_sessions (
        id, topic, status, min_cycles, max_cycles, config_json,
        source_conversation_id, source_message_id, created_at
      ) VALUES (?, ?, 'debating', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      args.topic,
      args.minCycles,
      args.maxCycles,
      args.configJson,
      args.sourceConversationId ?? null,
      args.sourceMessageId ?? null,
      now,
    )
}

export function insertThinkTankTurn(args: {
  id: string
  sessionId: string
  cycle: number
  seatId: string
  body: string
  stance: ThinkTankStance
  summary: string
  model?: string
  toolCallsJson?: string | null
  debugJson?: string | null
  reasoningTrace?: string | null
}): void {
  const now = Date.now()
  // The completed turn carries the full merged workflow; drop the streaming tail so a
  // pending flush cannot overwrite it afterwards.
  finalizeWorkflowBuffer(args.id, args.toolCallsJson != null)
  getDb()
    .prepare(
      `INSERT INTO think_tank_messages (
        id, session_id, cycle, seat_id, role, body, stance, summary, model, tool_calls_json, debug_json, reasoning_trace, created_at
      ) VALUES (?, ?, ?, ?, 'debate', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        body = excluded.body,
        stance = excluded.stance,
        summary = excluded.summary,
        model = excluded.model,
        tool_calls_json = COALESCE(excluded.tool_calls_json, think_tank_messages.tool_calls_json),
        debug_json = COALESCE(excluded.debug_json, think_tank_messages.debug_json),
        reasoning_trace = COALESCE(excluded.reasoning_trace, think_tank_messages.reasoning_trace)`,
    )
    .run(
      args.id,
      args.sessionId,
      args.cycle,
      args.seatId,
      args.body,
      args.stance,
      args.summary,
      args.model ?? null,
      args.toolCallsJson ?? null,
      args.debugJson ?? null,
      args.reasoningTrace ?? null,
      now,
    )
}

export function upsertThinkTankTurnDraft(args: {
  id: string
  sessionId: string
  cycle: number
  seatId: string
  model?: string
}): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO think_tank_messages (
        id, session_id, cycle, seat_id, role, body, stance, summary, model, tool_calls_json, created_at
      ) VALUES (?, ?, ?, ?, 'debate', '', 'continue', '(in progress)', ?, '[]', ?)
      ON CONFLICT(id) DO NOTHING`,
    )
    .run(args.id, args.sessionId, args.cycle, args.seatId, args.model ?? null, now)
}

/**
 * Streamed workflow events are buffered in memory and written on an interval.
 *
 * A seat streams one event per token, and the whole `tool_calls_json` blob is rewritten on
 * each write. One measured runaway turn reached 29,242 events and a 1.9 MB blob, so writing
 * per event cost roughly 28 GB of SQLite traffic for a single turn. Batching turns that into
 * one write per interval — a couple hundred writes instead of tens of thousands.
 */
const WORKFLOW_FLUSH_MS = 2_000

type WorkflowBuffer = {
  entries: unknown[]
  dirty: boolean
  timer: ReturnType<typeof setInterval> | null
}

const workflowBuffers = new Map<string, WorkflowBuffer>()

function writeWorkflowBuffer(messageId: string, buffer: WorkflowBuffer): void {
  if (!buffer.dirty) return
  buffer.dirty = false
  getDb()
    .prepare(`UPDATE think_tank_messages SET tool_calls_json = ? WHERE id = ?`)
    .run(JSON.stringify(buffer.entries), messageId)
}

/**
 * Stop buffering a turn. `supersededByCaller` means the caller is about to write its own
 * `tool_calls_json`; otherwise the buffered tail is the only copy and has to be flushed.
 */
function finalizeWorkflowBuffer(messageId: string, supersededByCaller: boolean): void {
  const buffer = workflowBuffers.get(messageId)
  if (!buffer) return
  if (!supersededByCaller) writeWorkflowBuffer(messageId, buffer)
  if (buffer.timer) clearInterval(buffer.timer)
  workflowBuffers.delete(messageId)
}

export function appendThinkTankTurnWorkflow(messageId: string, ts: number, event: unknown): void {
  let buffer = workflowBuffers.get(messageId)
  if (!buffer) {
    const row = getDb()
      .prepare(`SELECT tool_calls_json FROM think_tank_messages WHERE id = ?`)
      .get(messageId) as { tool_calls_json: string | null } | undefined
    if (!row) return
    let prior: unknown[] = []
    if (row.tool_calls_json) {
      try {
        const parsed = JSON.parse(row.tool_calls_json) as unknown
        if (Array.isArray(parsed)) prior = parsed
      } catch {
        prior = []
      }
    }
    buffer = { entries: prior, dirty: false, timer: null }
    workflowBuffers.set(messageId, buffer)
  }

  buffer.entries.push({ ts, event })
  buffer.dirty = true
  if (!buffer.timer) {
    const held = buffer
    buffer.timer = setInterval(() => writeWorkflowBuffer(messageId, held), WORKFLOW_FLUSH_MS)
    buffer.timer.unref?.()
  }
}

/** Persist every buffered workflow tail — call before quit so a crash-free exit loses nothing. */
export function flushThinkTankTurnWorkflow(): void {
  for (const [messageId, buffer] of workflowBuffers) {
    try {
      writeWorkflowBuffer(messageId, buffer)
    } catch {
      /* a closed database on shutdown must not block quit */
    }
    if (buffer.timer) clearInterval(buffer.timer)
  }
  workflowBuffers.clear()
}

export function insertThinkTankReport(args: {
  id: string
  sessionId: string
  seatId: string
  seatLabel: string
  body: string
  metadataJson?: string | null
}): void {
  getDb()
    .prepare(
      `INSERT INTO think_tank_final_reports (
        id, session_id, seat_id, seat_label, body, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(args.id, args.sessionId, args.seatId, args.seatLabel, args.body, args.metadataJson ?? '{}', Date.now())
}

export function setThinkTankSessionStatus(sessionId: string, status: ThinkTankSessionStatus): void {
  getDb().prepare(`UPDATE think_tank_sessions SET status = ? WHERE id = ?`).run(status, sessionId)
}

/** Statuses that mean a run is still expected to produce turns. */
const THINK_TANK_LIVE_STATUSES = ['debating', 'final_reports'] as const

/**
 * Close draft turn rows for a session that has stopped.
 *
 * `turn_start` inserts a placeholder with an empty body that the matching `turn` fills in.
 * When a seat never returns — cancel, error, crash — the placeholder survives, and an empty
 * body is indistinguishable from a turn that is still streaming, so the chat keeps rendering
 * it as live with a timer that ticks for as long as the row exists.
 */
export function finalizeThinkTankDraftTurns(sessionId: string, note: string): number {
  const drafts = getDb()
    .prepare(`SELECT id FROM think_tank_messages WHERE session_id = ? AND trim(body) = ''`)
    .all(sessionId) as Array<{ id: string }>
  for (const draft of drafts) finalizeWorkflowBuffer(draft.id, false)
  const info = getDb()
    .prepare(
      `UPDATE think_tank_messages
         SET body = ?, summary = ?
       WHERE session_id = ? AND trim(body) = ''`,
    )
    .run(`_(${note})_`, note, sessionId)
  return info.changes
}

/**
 * Close sessions left mid-run by a crash or restart.
 *
 * Runs live in the broker child, so nothing survives a host restart to resume them; a session
 * still marked `debating` at startup is by definition abandoned.
 */
export function finalizeOrphanThinkTankSessions(note: string): number {
  const orphans = getDb()
    .prepare(
      `SELECT id FROM think_tank_sessions WHERE status IN (${THINK_TANK_LIVE_STATUSES.map(() => '?').join(', ')})`,
    )
    .all(...THINK_TANK_LIVE_STATUSES) as Array<{ id: string }>
  for (const { id } of orphans) {
    setThinkTankSessionError(id, note)
  }
  return orphans.length
}

/**
 * Finalize a think tank session without recording a selected debater report.
 *
 * Used when final reports are ready and no operator pick is required — the
 * Moderator final report is the decision brief. `pickThinkTankReport` remains
 * available as an optional programmatic API to mark a debater report as selected.
 */
export function finalizeThinkTankSession(sessionId: string): void {
  finalizeThinkTankDraftTurns(sessionId, 'No output')
  getDb()
    .prepare(
      `UPDATE think_tank_sessions SET status = 'complete', completed_at = ? WHERE id = ?`,
    )
    .run(Date.now(), sessionId)
}

export function pickThinkTankReport(sessionId: string, reportId: string): Record<string, unknown> {
  const report = getDb()
    .prepare(
      `SELECT id, seat_id, seat_label FROM think_tank_final_reports WHERE id = ? AND session_id = ?`,
    )
    .get(reportId, sessionId) as { id: string; seat_id: string; seat_label: string } | undefined
  if (!report) throw new Error(`Report ${reportId} not found for session ${sessionId}`)

  if (!isDebateCompetitorSeatRef(report.seat_id, report.seat_label)) {
    throw new Error(
      'Pick a debater report only. Moderator reports are advisory (research/tests), not selectable winners.',
    )
  }

  const session = getDb()
    .prepare(`SELECT topic FROM think_tank_sessions WHERE id = ?`)
    .get(sessionId) as { topic: string } | undefined
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const now = Date.now()
  getDb()
    .prepare(
      `UPDATE think_tank_sessions SET status = 'complete', selected_report_id = ?, completed_at = ? WHERE id = ?`,
    )
    .run(reportId, now, sessionId)

  return {
    selectedReportId: reportId,
    seat: {
      seatId: report.seat_id,
      label: report.seat_label,
      reportId,
    },
    topic: session.topic,
  }
}

export function setThinkTankSessionError(sessionId: string, message: string): void {
  finalizeThinkTankDraftTurns(sessionId, 'Interrupted')
  getDb()
    .prepare(`UPDATE think_tank_sessions SET status = 'error', error_message = ?, completed_at = ? WHERE id = ?`)
    .run(message.slice(0, 2000), Date.now(), sessionId)
}

export function setThinkTankSessionCancelled(sessionId: string, message: string): void {
  finalizeThinkTankDraftTurns(sessionId, 'Stopped')
  getDb()
    .prepare(`UPDATE think_tank_sessions SET status = 'cancelled', error_message = ?, completed_at = ? WHERE id = ?`)
    .run(message.slice(0, 2000), Date.now(), sessionId)
}

/** Cascade-delete one think-tank session and its child rows (messages, reports, FTS). */
function deleteThinkTankSessionById(d: Database.Database, sessionId: string): void {
  if (tableExists(d, 'think_tank_messages')) {
    d.prepare('DELETE FROM think_tank_messages WHERE session_id = ?').run(sessionId)
  }
  if (tableExists(d, 'think_tank_final_reports')) {
    d.prepare('DELETE FROM think_tank_final_reports WHERE session_id = ?').run(sessionId)
  }
  if (tableExists(d, 'think_tank_search_fts')) {
    d.prepare('DELETE FROM think_tank_search_fts WHERE session_id = ?').run(sessionId)
  }
  d.prepare('DELETE FROM think_tank_sessions WHERE id = ?').run(sessionId)
}

/**
 * Remove think-tank sessions spawned from a chat before deleting the conversation row.
 * Required when foreign key enforcement is on (`think_tank_sessions.source_conversation_id`).
 */
export function deleteThinkTankSessionsForConversation(
  conversationId: string,
  dbHandle?: Database.Database,
): void {
  const d = dbHandle ?? getDb()
  if (!tableExists(d, 'think_tank_sessions')) return
  const sessions = d
    .prepare('SELECT id FROM think_tank_sessions WHERE source_conversation_id = ?')
    .all(conversationId) as { id: string }[]
  for (const { id } of sessions) {
    deleteThinkTankSessionById(d, id)
  }
}

export function getThinkTankSessionConversationId(sessionId: string): string | null {
  const row = getDb()
    .prepare(`SELECT source_conversation_id FROM think_tank_sessions WHERE id = ?`)
    .get(sessionId) as { source_conversation_id: string | null } | undefined
  const id = row?.source_conversation_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export function getThinkTankSessionDetail(sessionId: string): Record<string, unknown> | null {
  const session = getDb()
    .prepare(
      `SELECT id, topic, status, min_cycles, max_cycles, config_json, selected_report_id,
        source_conversation_id, source_message_id, error_message, created_at, completed_at
       FROM think_tank_sessions WHERE id = ?`,
    )
    .get(sessionId) as Record<string, unknown> | undefined
  if (!session) return null
  const messages = getDb()
    .prepare(
      `SELECT id, cycle, seat_id, body, stance, summary, model, tool_calls_json, debug_json, created_at
       FROM think_tank_messages WHERE session_id = ? ORDER BY cycle, created_at`,
    )
    .all(sessionId)
  const reports = getDb()
    .prepare(
      `SELECT id, seat_id, seat_label, substr(body, 1, 500) as preview, created_at
       FROM think_tank_final_reports WHERE session_id = ? ORDER BY created_at`,
    )
    .all(sessionId)
  const latestStances = getDb()
    .prepare(
      `SELECT seat_id, stance FROM think_tank_messages m
       WHERE session_id = ? AND cycle = (SELECT MAX(cycle) FROM think_tank_messages WHERE session_id = ?)
       ORDER BY created_at`,
    )
    .all(sessionId, sessionId)
  return { ...session, messages, reports, latest_stances: latestStances }
}

export function listThinkTankSessionsForConversation(conversationId: string): Array<Record<string, unknown>> {
  const sessions = getDb()
    .prepare(
      `SELECT id, topic, status, min_cycles, max_cycles, config_json, selected_report_id,
        source_conversation_id, source_message_id, error_message, created_at, completed_at
       FROM think_tank_sessions WHERE source_conversation_id = ?
       ORDER BY created_at ASC`,
    )
    .all(conversationId) as Array<Record<string, unknown>>

  return sessions.map((session) => {
    const sessionId = String(session.id)
    const messages = getDb()
      .prepare(
        `SELECT id, cycle, seat_id, body, stance, summary, model, tool_calls_json, debug_json, created_at
         FROM think_tank_messages WHERE session_id = ? ORDER BY cycle, created_at`,
      )
      .all(sessionId)
    const reports = getDb()
      .prepare(
        `SELECT id, seat_id, seat_label, body, metadata_json, created_at
         FROM think_tank_final_reports WHERE session_id = ? ORDER BY created_at`,
      )
      .all(sessionId)
    return { ...session, messages, reports }
  })
}
