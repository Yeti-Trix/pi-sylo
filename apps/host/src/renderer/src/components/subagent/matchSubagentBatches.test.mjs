/**
 * Run: npm run test:subagent-batch-match -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildSubagentBatches,
  mapSubagentBatchesToMessage,
} from '../../../../../out/test/matchSubagentBatches.mjs'

const MSG_START = 1_000_000

function task(overrides) {
  return {
    id: 'task-1',
    group_run_id: null,
    mode: 'single',
    agent_name: 'worker',
    status: 'succeeded',
    step_index: null,
    started_at: MSG_START,
    ended_at: MSG_START + 1000,
    created_at: MSG_START,
    ...overrides,
  }
}

function toolSeg(overrides) {
  return {
    kind: 'tool',
    id: 'seg-1',
    toolName: 'subagent',
    toolCallId: 'call-1',
    args: undefined,
    startTs: MSG_START,
    endTs: MSG_START + 1000,
    durationMs: 1000,
    isError: false,
    textOffset: null,
    resultPreview: undefined,
    ...overrides,
  }
}

describe('buildSubagentBatches', () => {
  test('groups a chain under its group run id and orders by step', () => {
    const batches = buildSubagentBatches([
      task({ id: 'b', group_run_id: 'g1', mode: 'chain', step_index: 2, started_at: 2000 }),
      task({ id: 'a', group_run_id: 'g1', mode: 'chain', step_index: 1, started_at: 1000 }),
    ])
    assert.equal(batches.length, 1)
    assert.deepEqual(
      batches[0].tasks.map((t) => t.id),
      ['a', 'b'],
    )
  })
})

describe('mapSubagentBatchesToMessage', () => {
  test('pairs one segment with one batch', () => {
    const seg = toolSeg({})
    const map = mapSubagentBatchesToMessage([seg], [task({ id: 'only' })], MSG_START)
    assert.equal(map.get('seg-1').tasks[0].id, 'only')
  })

  test('a live segment claims the running batch, not an older finished one', () => {
    // The turn's telemetry was trimmed, so only the newest tool segment survived
    // while the DB still holds every batch. Index pairing put the live segment on
    // the first batch and rendered a finished run as if nothing were happening.
    const live = toolSeg({ id: 'seg-live', startTs: MSG_START + 9000, endTs: null })
    const tasks = [
      task({ id: 'old-1', started_at: MSG_START + 1000, ended_at: MSG_START + 2000 }),
      task({ id: 'old-2', started_at: MSG_START + 3000, ended_at: MSG_START + 4000 }),
      task({
        id: 'now',
        status: 'running',
        started_at: MSG_START + 9000,
        ended_at: null,
      }),
    ]
    const map = mapSubagentBatchesToMessage([live], tasks, MSG_START)
    assert.equal(map.get('seg-live').tasks[0].id, 'now')
  })

  test('closed segments anchor on their end time when earlier starts were trimmed', () => {
    // Two orphaned tool_execution_end rows (their starts were trimmed, so the
    // segment collapses to a point) plus the live call, against five batches.
    const segs = [
      toolSeg({ id: 'seg-a', startTs: MSG_START + 4000, endTs: MSG_START + 4000 }),
      toolSeg({ id: 'seg-b', startTs: MSG_START + 6000, endTs: MSG_START + 6000 }),
      toolSeg({ id: 'seg-live', startTs: MSG_START + 7000, endTs: null }),
    ]
    const tasks = [
      task({ id: 'batch-1', started_at: MSG_START, ended_at: MSG_START + 900 }),
      task({ id: 'batch-2', started_at: MSG_START + 1000, ended_at: MSG_START + 1900 }),
      task({ id: 'batch-3', started_at: MSG_START + 3000, ended_at: MSG_START + 4000 }),
      task({ id: 'batch-4', started_at: MSG_START + 5000, ended_at: MSG_START + 6000 }),
      task({ id: 'batch-5', status: 'running', started_at: MSG_START + 7000, ended_at: null }),
    ]
    const map = mapSubagentBatchesToMessage(segs, tasks, MSG_START)
    assert.equal(map.get('seg-a').tasks[0].id, 'batch-3')
    assert.equal(map.get('seg-b').tasks[0].id, 'batch-4')
    assert.equal(map.get('seg-live').tasks[0].id, 'batch-5')
  })

  test('never hands the same batch to two segments', () => {
    const segs = [
      toolSeg({ id: 'seg-a', startTs: MSG_START, endTs: MSG_START + 1000 }),
      toolSeg({ id: 'seg-b', startTs: MSG_START + 1000, endTs: MSG_START + 2000 }),
    ]
    const tasks = [
      task({ id: 'batch-1', started_at: MSG_START, ended_at: MSG_START + 1000 }),
      task({ id: 'batch-2', started_at: MSG_START + 1500, ended_at: MSG_START + 2000 }),
    ]
    const map = mapSubagentBatchesToMessage(segs, tasks, MSG_START)
    assert.notEqual(map.get('seg-a').batchKey, map.get('seg-b').batchKey)
  })

  test('an open segment whose children already ended still gets its run', () => {
    const live = toolSeg({ id: 'seg-live', startTs: MSG_START + 500, endTs: null })
    const map = mapSubagentBatchesToMessage(
      [live],
      [task({ id: 'done', started_at: MSG_START + 500, ended_at: MSG_START + 900 })],
      MSG_START,
    )
    assert.equal(map.get('seg-live').tasks[0].id, 'done')
  })

  test('ignores tasks that predate the message turn', () => {
    const seg = toolSeg({})
    const map = mapSubagentBatchesToMessage(
      [seg],
      [task({ id: 'earlier', started_at: MSG_START - 60_000, ended_at: MSG_START - 50_000 })],
      MSG_START,
    )
    assert.equal(map.size, 0)
  })

  test('no subagent segments yields no pairing work', () => {
    const map = mapSubagentBatchesToMessage(
      [toolSeg({ toolName: 'bash' })],
      [task({ id: 'x' })],
      MSG_START,
    )
    assert.equal(map.size, 0)
  })
})
