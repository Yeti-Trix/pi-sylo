/**
 * Run: npm run test:schedule-reuse -w apps/host
 *
 * Truth table for the per-schedule chat-mode reuse decision:
 * "continue in the same chat" fires only when the mode is on, a target pointer
 * exists, and that target still exists, is not archived, and is in the
 * schedule's workspace. Everything else self-heals to a new chat.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { shouldReuseScheduleConversation } from '../../out/test/scheduled-prompts-reuse.mjs'

const WID = 'ws-1'

function schedule(overrides = {}) {
  return {
    reuse_conversation: 1,
    last_conversation_id: 'conv-1',
    workspace_id: WID,
    ...overrides,
  }
}

const liveCandidate = { archived_at: null, workspace_id: WID }

describe('shouldReuseScheduleConversation', () => {
  test('mode off (default) never reuses, even with a valid target', () => {
    assert.equal(shouldReuseScheduleConversation(schedule({ reuse_conversation: 0 }), liveCandidate), false)
  })

  test('mode on but no pointer yet (first run) creates a new chat', () => {
    assert.equal(shouldReuseScheduleConversation(schedule({ last_conversation_id: null }), liveCandidate), false)
    assert.equal(shouldReuseScheduleConversation(schedule({ last_conversation_id: '' }), liveCandidate), false)
    assert.equal(
      shouldReuseScheduleConversation(schedule({ last_conversation_id: '   ' }), liveCandidate),
      false,
    )
  })

  test('deleted target (candidate undefined) falls back to a new chat', () => {
    assert.equal(shouldReuseScheduleConversation(schedule(), undefined), false)
  })

  test('archived target falls back to a new chat', () => {
    assert.equal(
      shouldReuseScheduleConversation(schedule(), { archived_at: 1758000000000, workspace_id: WID }),
      false,
    )
  })

  test('target with null archived_at (legacy row missing the column) is reusable', () => {
    assert.equal(shouldReuseScheduleConversation(schedule(), { archived_at: null, workspace_id: WID }), true)
  })

  test('target missing archived_at field entirely is reusable (undefined == null)', () => {
    assert.equal(shouldReuseScheduleConversation(schedule(), { workspace_id: WID }), true)
  })

  test('cross-workspace target falls back to a new chat', () => {
    assert.equal(
      shouldReuseScheduleConversation(schedule(), { archived_at: null, workspace_id: 'ws-2' }),
      false,
    )
    assert.equal(
      shouldReuseScheduleConversation(schedule(), { archived_at: null, workspace_id: null }),
      false,
    )
  })

  test('valid target reuses: same workspace, not archived', () => {
    assert.equal(shouldReuseScheduleConversation(schedule(), liveCandidate), true)
  })

  test('null workspace on both sides counts as a match', () => {
    assert.equal(
      shouldReuseScheduleConversation(
        schedule({ workspace_id: null }),
        { archived_at: null, workspace_id: null },
      ),
      true,
    )
  })
})