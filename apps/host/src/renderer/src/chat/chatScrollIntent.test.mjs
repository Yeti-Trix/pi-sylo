/**
 * Run: npm run test:chat-scroll -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  chatMessagesMatchConversation,
  chatVirtualizerNeedsViewportRetry,
  isUserDrivenScrollUp,
  isUserScrollUpWheel,
  readChatScrollRect,
  shouldAdjustChatRowOnSizeChange,
  shouldRepinChatToEnd,
  shouldUnpinChatFromEnd,
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

describe('readChatScrollRect', () => {
  test('ignores an unmeasured or collapsed scrollport', () => {
    assert.equal(readChatScrollRect(null), undefined)
    assert.equal(readChatScrollRect({ clientWidth: 800, clientHeight: 0 }), undefined)
  })

  test('returns the viewport once it has a real height', () => {
    assert.deepEqual(readChatScrollRect({ clientWidth: 800, clientHeight: 640 }), {
      width: 800,
      height: 640,
    })
  })
})

describe('chatVirtualizerNeedsViewportRetry', () => {
  test('retries while the virtualizer would still yield no rows', () => {
    assert.equal(chatVirtualizerNeedsViewportRetry(0, 0), true)
    assert.equal(chatVirtualizerNeedsViewportRetry(0, 29), true)
    assert.equal(chatVirtualizerNeedsViewportRetry(0, 30), false)
    assert.equal(chatVirtualizerNeedsViewportRetry(640, 0), false)
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

describe('shouldRepinChatToEnd', () => {
  test('stays pinned while already at the true end', () => {
    assert.equal(
      shouldRepinChatToEnd({
        atEnd: true,
        alreadyPinned: true,
        scrollTop: 800,
        lastScrollTop: 820,
      }),
      true,
    )
  })

  test('an upward read-back that is still near the end does not re-pin', () => {
    // User message sits just above a short reply. Scrolling up to it used
    // to trip isAtEnd and yank the pane back to Latest.
    assert.equal(
      shouldRepinChatToEnd({
        atEnd: true,
        alreadyPinned: false,
        scrollTop: 780,
        lastScrollTop: 820,
      }),
      false,
    )
  })

  test('scrolling down onto the true end re-pins', () => {
    assert.equal(
      shouldRepinChatToEnd({
        atEnd: true,
        alreadyPinned: false,
        scrollTop: 840,
        lastScrollTop: 800,
      }),
      true,
    )
  })

  test('away from the end never re-pins', () => {
    assert.equal(
      shouldRepinChatToEnd({
        atEnd: false,
        alreadyPinned: false,
        scrollTop: 400,
        lastScrollTop: 200,
      }),
      false,
    )
  })
})

describe('shouldUnpinChatFromEnd', () => {
  const base = {
    atEnd: false,
    scrollTop: 200,
    lastScrollTop: 400,
    now: 5_000,
    suppressUntil: 0,
  }

  test('leaving the end on an upward step unpins even when height also changed', () => {
    assert.equal(shouldUnpinChatFromEnd(base), true)
  })

  test('staying at the true end never unpins', () => {
    assert.equal(shouldUnpinChatFromEnd({ ...base, atEnd: true }), false)
  })

  test('programmatic pins inside the suppress window are ignored', () => {
    assert.equal(shouldUnpinChatFromEnd({ ...base, now: 900, suppressUntil: 1000 }), false)
  })
})

describe('shouldAdjustChatRowOnSizeChange', () => {
  const entirelyAbove = {
    pinnedToEnd: false,
    itemStart: 100,
    itemSize: 200,
    scrollOffset: 800,
    isFirstMeasure: true,
    scrollDirection: 'backward',
  }

  test('an older row entirely above the fold is compensated while reading history', () => {
    // Without this, a 64k estimate shrinking to 200px flings the pane upward.
    assert.equal(shouldAdjustChatRowOnSizeChange(entirelyAbove), true)
  })

  test('the on-screen user message is not compensated while reading history', () => {
    assert.equal(
      shouldAdjustChatRowOnSizeChange({
        ...entirelyAbove,
        itemStart: 700,
        itemSize: 240,
        scrollOffset: 800,
      }),
      false,
    )
  })

  test('while pinned, a first measure that starts above the fold still compensates', () => {
    assert.equal(
      shouldAdjustChatRowOnSizeChange({
        ...entirelyAbove,
        pinnedToEnd: true,
        itemStart: 700,
        itemSize: 240,
        scrollOffset: 800,
      }),
      true,
    )
  })
})
