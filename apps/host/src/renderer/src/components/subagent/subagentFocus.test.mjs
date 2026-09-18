/**
 * Run: npm run test:subagent-focus -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { batchWorstStatus, pickFocusTask } from '../../../../../out/test/subagentFocus.mjs'

const T0 = 1_000_000

/** One chain step, in the shape the block reads. */
function step(index, status, overrides = {}) {
  const startedAt = T0 + index * 10_000
  return {
    id: `step-${index}`,
    group_run_id: 'group-1',
    mode: 'chain',
    agent_name: index === 1 ? 'planner' : 'worker',
    status,
    step_index: index,
    started_at: startedAt,
    ended_at: status === 'running' ? null : startedAt + 5000,
    created_at: startedAt,
    ...overrides,
  }
}

describe('pickFocusTask', () => {
  test('opens on the running step', () => {
    assert.equal(pickFocusTask([step(1, 'running')], null), 'step-1')
  })

  test('follows the chain as it advances', () => {
    // The complaint this fixes: the pane stayed on step 1 and every later step had
    // to be clicked. Step 2 only exists once it starts, so it arrives mid-watch.
    let focus = pickFocusTask([step(1, 'running')], null)
    assert.equal(focus, 'step-1')

    focus = pickFocusTask([step(1, 'succeeded'), step(2, 'running')], focus)
    assert.equal(focus, 'step-2')

    focus = pickFocusTask([step(1, 'succeeded'), step(2, 'succeeded'), step(3, 'running')], focus)
    assert.equal(focus, 'step-3')
  })

  test('holds the gap between steps on the step that just ended', () => {
    // Nothing runs while the chain hands off; the pane should not jump backwards.
    const tasks = [step(1, 'succeeded'), step(2, 'succeeded')]
    assert.equal(pickFocusTask(tasks, 'step-2'), 'step-2')
  })

  test('does not yank a step that is still streaming', () => {
    // Two live children (parallel): whichever one the operator is on keeps the pane.
    const tasks = [step(1, 'running'), step(2, 'running')]
    assert.equal(pickFocusTask(tasks, 'step-1'), 'step-1')
  })

  test('leaves a finished selection alone', () => {
    const tasks = [step(1, 'succeeded'), step(2, 'succeeded')]
    assert.equal(pickFocusTask(tasks, 'step-1'), 'step-1')
  })

  test('a finished chain opens on the step that failed', () => {
    const tasks = [step(1, 'succeeded'), step(2, 'failed'), step(3, 'cancelled')]
    assert.equal(pickFocusTask(tasks, null), 'step-2')
  })

  test('a clean finished chain opens on its final output, not the preamble', () => {
    const tasks = [step(1, 'succeeded'), step(2, 'succeeded')]
    assert.equal(pickFocusTask(tasks, null), 'step-2')
  })

  test('re-picks when the selected row is gone', () => {
    assert.equal(pickFocusTask([step(2, 'running')], 'step-1'), 'step-2')
  })

  test('handles an empty batch', () => {
    assert.equal(pickFocusTask([], null), null)
    assert.equal(pickFocusTask([], 'step-1'), null)
  })
})

describe('batchWorstStatus', () => {
  test('a late failure speaks for the chain', () => {
    // The badge used to read step 1 and call a broken chain succeeded.
    const tasks = [step(1, 'succeeded'), step(2, 'succeeded'), step(3, 'failed')]
    assert.equal(batchWorstStatus(tasks), 'failed')
  })

  test('ranks failed over orphaned over cancelled over succeeded', () => {
    assert.equal(batchWorstStatus([step(1, 'cancelled'), step(2, 'orphaned')]), 'orphaned')
    assert.equal(batchWorstStatus([step(1, 'succeeded'), step(2, 'cancelled')]), 'cancelled')
    assert.equal(batchWorstStatus([step(1, 'succeeded')]), 'succeeded')
  })
})
