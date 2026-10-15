/**
 * Unit tests for the subagent orphan-reconcile helpers in subagent-tasks-db.ts
 * (Finding 2 of notes/2026-10-11_subagent-result-truncation-and-plan-file-quirks.md):
 * a child that dies mid-turn without `run_end` must be recoverable — stale-running
 * listing, zombie-aware counting, and per-row orphan finalization.
 *
 * Run via `npm run test:subagent-tasks-db -w apps/host` (esbuild bundle + node --test).
 * NOTE: better-sqlite3 in this checkout is built against Electron's ABI, so when the
 * suite runs under plain node without a matching rebuild it self-skips (openDatabase
 * needs the native binding). Under an ABI-matched build (or electron runtime) it runs.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LOCAL_SUBAGENT_STALL_MS } from '../../../../packages/sylo-subagents/extensions/subagent-timeout.ts'
import {
  SUBAGENT_RUN_QUIET_MS,
  countRunningAgentTasks,
  insertAgentTaskStart,
  listAgentTasksForWorkspaceCwd,
  listAllAgentTasks,
  listStaleRunningAgentTasks,
  orphanAgentTaskById,
} from './subagent-tasks-db.js'

// Probe the native binding once — DB-backed tests are impossible without it.
let sqliteProbe = 'ok'
try {
  const { default: Database } = await import('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
} catch (err) {
  sqliteProbe = err instanceof Error ? err.message : String(err)
}

let openDatabase
if (sqliteProbe === 'ok') ({ openDatabase } = await import('./database.js'))

// Under an electron runtime (ABI-matched) the default app holds the event loop —
// quit once all tests drained so `electron <this file>` exits like `node --test`.
// Skip when the electron import is the run-as-node shim (no `app`; the event
// loop drains on its own and the hook would only fail the suite).
if (typeof process.versions.electron === 'string') {
  const { app } = await import('electron')
  if (app && typeof app.quit === 'function') {
    after(() => {
      setTimeout(() => void app.quit(), 250)
    })
  }
}

// The quiet window is a last-resort sweep AFTER the broker's stall watchdog — it must
// sit comfortably above the local stall kill (10 min) plus the finalize grace (10s),
// so the watchdog's informative failed verdict always lands first.
const LOCAL_STALL_PLUS_GRACE_MS = LOCAL_SUBAGENT_STALL_MS + 10_000

test('orphan reconcile helpers handle a child that died without run_end', { concurrency: false, skip: sqliteProbe === 'ok' ? false : `native better-sqlite3 not loadable under plain node (${sqliteProbe.slice(0, 120)})` }, () => {
  const userDir = mkdtempSync(join(tmpdir(), 'sylo-tasks-db-test-'))
  let d
  try {
    d = openDatabase(userDir)
    d.prepare(`INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run('conv-1', 't', Date.now(), Date.now())
    d.prepare(`INSERT INTO host_sessions (id, started_at, ended_at) VALUES (?, ?, NULL)`)
      .run('host-1', Date.now())

    // (1) The quiet window must never preempt the stall watchdog's verdict.
    assert.ok(SUBAGENT_RUN_QUIET_MS > LOCAL_STALL_PLUS_GRACE_MS)

    const now = Date.now()
    const oldStart = now - (SUBAGENT_RUN_QUIET_MS + 5 * 60_000) // quiet past the window
    const freshStart = now - 5_000 // actively streaming
    const orphanInput = {
      id: 'run-old',
      hostSessionId: 'host-1',
      conversationId: 'conv-1',
      groupRunId: 'group-1',
      mode: 'parallel',
      agent: 'worker',
      task: 'section that dies mid-turn',
      now: oldStart,
    }
    const freshInput = {
      id: 'run-fresh',
      hostSessionId: 'host-1',
      conversationId: 'conv-1',
      groupRunId: 'group-1',
      mode: 'parallel',
      agent: 'worker',
      task: 'healthy section',
      now: freshStart,
    }

    // (2) Stale listing: only rows quiet past the window appear.
    insertAgentTaskStart(orphanInput)
    insertAgentTaskStart(freshInput)
    const stale = listStaleRunningAgentTasks(SUBAGENT_RUN_QUIET_MS, now)
    assert.deepEqual(
      stale.map((r) => r.id),
      ['run-old'],
    )

    // (3) Zombie-aware running count: without the window both rows count; with it,
    // only the row seen alive inside the window counts.
    assert.equal(countRunningAgentTasks(), 2)
    assert.equal(countRunningAgentTasks(undefined, SUBAGENT_RUN_QUIET_MS), 1)
    assert.equal(countRunningAgentTasks('host-1', SUBAGENT_RUN_QUIET_MS), 1)
    assert.equal(countRunningAgentTasks('host-other', SUBAGENT_RUN_QUIET_MS), 0)

    // (4) Per-row orphan finalization: returns the pre-update snapshot, flips the row,
    // records the reason, and is no longer repeatable.
    const snapshot = orphanAgentTaskById('run-old', 'child_died_no_run_end', now)
    assert.ok(snapshot)
    assert.equal(snapshot.id, 'run-old')
    assert.equal(snapshot.status, 'running')
    const flipped = d.prepare(`SELECT status, status_reason FROM agent_tasks WHERE id = ?`).get('run-old')
    assert.equal(flipped.status, 'orphaned')
    assert.equal(flipped.status_reason, 'child_died_no_run_end')
    assert.equal(orphanAgentTaskById('run-old', 'child_died_no_run_end', now), null)
    assert.equal(orphanAgentTaskById('run-unknown', 'child_died_no_run_end', now), null)

    // (5) The fresh row is untouched by all of the above.
    const fresh = d.prepare(`SELECT status FROM agent_tasks WHERE id = ?`).get('run-fresh')
    assert.equal(fresh.status, 'running')
    assert.equal(countRunningAgentTasks(undefined, SUBAGENT_RUN_QUIET_MS), 1)
  } finally {
    // Release the WAL handle before removing the temp dir (Windows EPERM otherwise).
    try {
      d?.close()
    } catch {
      /* already closed */
    }
    try {
      rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
    } catch {
      /* best-effort cleanup */
    }
  }
})

test('workspace-wide run listing joins every chat of the workspace, not just the newest slice', { concurrency: false, skip: sqliteProbe === 'ok' ? false : `native better-sqlite3 not loadable under plain node (${sqliteProbe.slice(0, 120)})` }, () => {
  const userDir = mkdtempSync(join(tmpdir(), 'sylo-tasks-db-ws-test-'))
  let d
  try {
    d = openDatabase(userDir)
    const now = Date.now()
    d.prepare(`INSERT INTO host_sessions (id, started_at, ended_at) VALUES (?, ?, NULL)`)
      .run('host-ws', now)
    // Two chats in workspace A, one chat in workspace B. A workspace with many
    // chats must keep listing EVERY chat's runs (the Agent panel used to ask by
    // the newest 30 conversation ids and silently dropped older chats' runs).
    d.prepare(`INSERT INTO workspaces (id, name, pi_cwd, path_segment, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('ws-a', 'A', 'C:/tmp/ws-a', 'ws-a', now)
    d.prepare(`INSERT INTO workspaces (id, name, pi_cwd, path_segment, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('ws-b', 'B', 'C:/tmp/ws-b', 'ws-b', now)
    for (const convId of ['conv-a1', 'conv-a2', 'conv-b1']) {
      const wsId = convId === 'conv-b1' ? 'ws-b' : 'ws-a'
      d.prepare(`INSERT INTO conversations (id, title, created_at, updated_at, workspace_id) VALUES (?, ?, ?, ?, ?)`)
        .run(convId, convId, now, now, wsId)
    }
    const t0 = { hostSessionId: 'host-ws', groupRunId: null, mode: 'single', agent: 'worker' }
    const start = (id, convId, task, ts) =>
      insertAgentTaskStart({ ...t0, id, conversationId: convId, task, now: ts })
    start('run-a1', 'conv-a1', 'first chat of ws-a', now - 30_000)
    start('run-a2', 'conv-a2', 'second chat of ws-a', now - 20_000)
    start('run-b1', 'conv-b1', 'the other workspace', now - 10_000)

    const a = listAgentTasksForWorkspaceCwd('C:/tmp/ws-a')
    assert.deepEqual(
      a.map((r) => r.id).sort(),
      ['run-a1', 'run-a2'],
    )
    assert.equal(listAgentTasksForWorkspaceCwd('C:/tmp/ws-b').at(0)?.id, 'run-b1')
    // The global Agent board's query returns every workspace's rows, newest created first.
    assert.deepEqual(
      listAllAgentTasks().map((r) => r.id),
      ['run-b1', 'run-a2', 'run-a1'],
    )
    // Trimmed/case-mismatched keys return nothing (the key is a cwd, always full).
    assert.equal(listAgentTasksForWorkspaceCwd('').length, 0)
    assert.equal(listAgentTasksForWorkspaceCwd('C:/tmp/nowhere').length, 0)
  } finally {
    try {
      d?.close()
    } catch {
      /* already closed */
    }
    try {
      rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
    } catch {
      /* best-effort cleanup */
    }
  }
})