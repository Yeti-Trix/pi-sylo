import assert from 'node:assert/strict'
import test from 'node:test'

import { capReasoningTrace, extractThinkingFromWorkflow } from './seat-workflow.ts'

test('extractThinkingFromWorkflow concatenates thinking deltas', () => {
  const json = JSON.stringify([
    { ts: 1, event: { type: 'thinking_delta', delta: 'First thought. ' } },
    { ts: 2, event: { type: 'text_delta', delta: 'ignore' } },
    { ts: 3, event: { type: 'thinking_delta', delta: 'Second thought.' } },
  ])
  assert.equal(extractThinkingFromWorkflow(json), 'First thought. Second thought.')
})

test('capReasoningTrace truncates from the start', () => {
  const long = 'abcdefghijklmnopqrstuvwxyz'.repeat(20)
  const capped = capReasoningTrace(long, 50)
  assert.ok(capped.includes('truncated'))
  assert.ok(capped.length <= 50 + 80)
})
