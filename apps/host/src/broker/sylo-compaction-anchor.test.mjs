/**
 * Run: npm run test:compaction-anchor -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  applyCompactionAnchor,
  COMPACTION_ANCHOR_MARKER,
  extractUserTexts,
  formatCompactionAnchor,
  isCompactionAnchorMessage,
  isCompactionSummaryMessage,
  lastUserText,
  uniquePreservedRequests,
} from '../../out/test/compaction-anchor.mjs'

function user(text) {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistant(text) {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function summary(text = '## Goal\nShip the feature\n\n## Next Steps\n1. Keep editing foo.ts') {
  return {
    role: 'compactionSummary',
    summary: text,
  }
}

describe('compaction anchor helpers', () => {
  test('extracts user texts and skips non-user roles', () => {
    assert.deepEqual(
      extractUserTexts([user('one'), assistant('nope'), user('two')]),
      ['one', 'two'],
    )
  })

  test('lastUserText ignores the injected anchor', () => {
    const live = user('fix the tests')
    const anchor = user(`${COMPACTION_ANCHOR_MARKER}\nbackground`)
    assert.equal(lastUserText([user('old'), live, anchor]), 'fix the tests')
  })

  test('detects compaction summaries by role or converted prefix', () => {
    assert.equal(isCompactionSummaryMessage(summary()), true)
    assert.equal(
      isCompactionSummaryMessage(
        user(
          'The conversation history before this point was compacted into the following summary:\n\n<summary>\nGoal\n</summary>',
        ),
      ),
      true,
    )
    assert.equal(isCompactionSummaryMessage(user('please continue')), false)
  })

  test('uniquePreservedRequests drops the live request and keeps the last two', () => {
    assert.deepEqual(
      uniquePreservedRequests(['a', 'b', 'c', 'live'], 'live'),
      ['b', 'c'],
    )
  })

  test('formatCompactionAnchor restates the live request and older task', () => {
    const text = formatCompactionAnchor({
      liveUserRequest: 'now add retry',
      preservedUserRequests: ['implement login'],
    })
    assert.match(text, new RegExp(COMPACTION_ANCHOR_MARKER.replace(/[[\]]/g, '\\$&')))
    assert.match(text, /now add retry/)
    assert.match(text, /implement login/)
    assert.match(text, /BACKGROUND only/)
    assert.match(text, /ignore the Next Steps/)
  })

  test('applyCompactionAnchor inserts once after the summary and restates the live request', () => {
    const messages = [
      summary(),
      assistant('kept tail'),
      user('ship the retry helper now'),
    ]
    const once = applyCompactionAnchor(messages, ['older task: implement login'])
    assert.equal(once.length, 4)
    assert.equal(isCompactionSummaryMessage(once[0]), true)
    assert.equal(isCompactionAnchorMessage(once[1]), true)
    const anchorText = once[1].content[0].text
    assert.match(anchorText, /ship the retry helper now/)
    assert.match(anchorText, /older task: implement login/)
    assert.equal(once[3].content[0].text, 'ship the retry helper now')

    const twice = applyCompactionAnchor(once, ['older task: implement login'])
    assert.equal(twice, once)
  })

  test('applyCompactionAnchor is a no-op without a summary', () => {
    const messages = [user('hello'), assistant('hi')]
    assert.equal(applyCompactionAnchor(messages, ['x']), messages)
  })
})
