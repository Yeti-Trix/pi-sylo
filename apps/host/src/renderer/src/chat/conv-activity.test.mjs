/**
 * Run: npm run test:conv-activity -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { convActivityStatus } from '../../../../out/test/conv-activity.mjs'

const conv = 'conv-1'

describe('convActivityStatus precedence', () => {
  test('unanswered question outranks everything — attention needed', () => {
    // Question while the turn is still running (spinner would be wrong).
    assert.equal(
      convActivityStatus(conv, new Set([conv]), new Set(), new Set([conv])),
      'question',
    )
    // Question after the turn finished (turn-end cleanup normally clears it, but
    // attention must still win if a reading races the clear).
    assert.equal(
      convActivityStatus(conv, new Set(), new Set([conv]), new Set([conv])),
      'question',
    )
  })

  test('running turn (no question) → spinner', () => {
    assert.equal(convActivityStatus(conv, new Set([conv]), new Set([conv]), new Set()), 'running')
    assert.equal(convActivityStatus(conv, new Set([conv]), new Set(), new Set()), 'running')
  })

  test('finished turn → unread dot', () => {
    assert.equal(convActivityStatus(conv, new Set(), new Set([conv]), new Set()), 'unread')
  })

  test('quiet chat → read dot', () => {
    assert.equal(convActivityStatus(conv, new Set(), new Set(), new Set()), 'read')
  })

  test('sets are per conversation — other chats do not bleed in', () => {
    assert.equal(
      convActivityStatus(conv, new Set(['other']), new Set(['other']), new Set(['other'])),
      'read',
    )
  })
})