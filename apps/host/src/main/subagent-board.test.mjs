/**
 * Run: npm run test:subagent-board -w apps/host
 *
 * Workspace board row building (F1/F2): the model must come from spec (dispatch
 * time) before result_json exists, the headline is the first task line, and the
 * owning chat + files ride per row.
 *
 * Kept in plain JS annotations-wise: esbuild parses `.mjs` as JS, so no TS syntax
 * may appear in this file itself (importing `.ts` modules is fine).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import '../shared/subagent-tasks-types.js'
import { rowsFromAgentTaskRows } from './subagent-board.ts'

function row(over = {}) {
  const now = Date.now()
  return {
    id: over.id,
    host_session_id: 'h1',
    conversation_id: 'conv-1',
    parent_task_id: null,
    group_run_id: null,
    depth: 0,
    title: 'truncated task title',
    spec_json: '{}',
    status: 'succeeded',
    status_reason: null,
    mode: 'single',
    agent_name: 'worker',
    step_index: null,
    started_at: now - 60_000,
    ended_at: now,
    result_summary: null,
    result_json: null,
    tokens_used: null,
    created_at: now - 60_000,
    updated_at: now,
    ...over,
  }
}

describe('rowsFromAgentTaskRows', () => {
  test('model comes from spec while running (B4: no more invisible wrong-model runs)', () => {
    const rows = rowsFromAgentTaskRows([
      row({
        id: 'r1',
        status: 'running',
        spec_json: JSON.stringify({ task: 'verify IO mapping UI', model: 'ollama/glm-5.3-flash:cloud' }),
      }),
    ])
    assert.equal(rows[0]?.model, 'ollama/glm-5.3-flash:cloud')
    assert.equal(rows[0]?.title, 'verify IO mapping UI')
    assert.equal(rows[0]?.conversationId, 'conv-1')
  })

  test('result model wins after finish; files + headline + owner chat ride the row', () => {
    const rows = rowsFromAgentTaskRows(
      [
        row({
          id: 'r2',
          spec_json: JSON.stringify({ task: 'line one\nline two', model: 'spec/model', files: ['a.ts', 'b.ts'] }),
          result_json: JSON.stringify({ model: 'result/model' }),
          result_summary: 'did the thing',
        }),
      ],
      new Map([['conv-1', 'IO mapping chat']]),
    )
    assert.equal(rows[0]?.model, 'result/model')
    assert.equal(rows[0]?.title, 'line one')
    assert.deepEqual(rows[0]?.files, ['a.ts', 'b.ts'])
    assert.equal(rows[0]?.conversationTitle, 'IO mapping chat')
    assert.equal(rows[0]?.resultSummary, 'did the thing')
  })

  test('bad spec_json + missing everything still yields a row', () => {
    const rows = rowsFromAgentTaskRows([row({ id: 'r4', spec_json: '{oops' })])
    assert.equal(rows[0]?.model, null)
    assert.deepEqual(rows[0]?.files, [])
    assert.equal(rows[0]?.title, 'truncated task title')
  })

  test('live-first ordering: running before finished, finished newest first', () => {
    const now = Date.now()
    const rows = rowsFromAgentTaskRows([
      row({ id: 'done-old', status: 'succeeded', ended_at: now - 5_000 }),
      row({ id: 'running-1', status: 'running', started_at: now - 1_000 }),
      row({ id: 'done-new', status: 'succeeded', ended_at: now }),
      row({ id: 'running-2', status: 'running', started_at: now - 2_000 }),
    ])
    // Oldest started first among running; finished sorted newest-ended first.
    assert.deepEqual(
      rows.map((r) => r.taskId),
      ['running-2', 'running-1', 'done-new', 'done-old'],
    )
  })
})