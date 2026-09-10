/**
 * Run: npm run test:chat-scroll -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  chatMessagesMatchConversation,
  isUserDrivenScrollUp,
  isUserScrollUpWheel,
} from '../../../../out/test/chatScrollIntent.mjs'

describe('chatMessagesMatchConversation', () => {
  test('holds the pending pin until the new conversation actually loaded', () => {
    // Switching A → B keeps A's messages on screen for one frame. Scrolling
    // that frame (or treating length-only updates as "ready") leaves B at top
    // when A and B have the same number of rows.
    assert.equal(chatMessagesMatchConversation('conv-b', 'conv-a'), false)
    assert.equal(chatMessagesMatchConversation('conv-b', 'conv-b'), true)
  })

  test('an empty or unknown conversation is not ready to pin', () => {
    assert.equal(chatMessagesMatchConversation(undefined, 'conv-a'), false)
    assert.equal(chatMessagesMatchConversation('conv-b', undefined), false)
    assert.equal(chatMessagesMatchConversation('conv-b', ''), false)
  })
})

describe('isUserDrivenScrollUp', () => {
  const base = {
    scrollTop: 200,
    lastScrollTop: 400,
    scrollHeight: 2000,
    lastScrollHeight: 2000,
    now: 5_000,
    suppressUntil: 0,
  }

  test('a scrollbar drag on a stable list is a real opt-out', () => {
    assert.equal(isUserDrivenScrollUp(base), true)
  })

  test('a measurement or conversation swap that also changes height is not', () => {
    // Virtual rows replacing estimates, or a shorter/longer chat taking over,
    // move scrollTop down. That used to clear stick-to-bottom and strand the
    // user near the top of a growing reply.
    assert.equal(
      isUserDrivenScrollUp({ ...base, scrollHeight: 2600, lastScrollHeight: 2000 }),
      false,
    )
  })

  test('programmatic pins inside the suppress window are ignored', () => {
    assert.equal(isUserDrivenScrollUp({ ...base, now: 900, suppressUntil: 1000 }), false)
  })

  test('scrolling down never opts out', () => {
    assert.equal(isUserDrivenScrollUp({ ...base, scrollTop: 500, lastScrollTop: 400 }), false)
  })
})

describe('isUserScrollUpWheel', () => {
  test('ignores tiny pixel jitter from a trackpad', () => {
    assert.equal(isUserScrollUpWheel(-4, 0), false)
    assert.equal(isUserScrollUpWheel(-12, 0), true)
  })

  test('a one-notch mouse wheel (line mode) still counts', () => {
    assert.equal(isUserScrollUpWheel(-1, 1), true)
  })

  test('scrolling down never counts', () => {
    assert.equal(isUserScrollUpWheel(40, 0), false)
  })
})
