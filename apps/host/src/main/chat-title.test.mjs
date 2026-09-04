/**
 * Run: npm run test:chat-title -w apps/host
 *
 * Verifies the deterministic first-message -> chat-title derivation used by
 * the main process on the first user turn. No DB, no broker, no model.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  CHAT_TITLE_MAX_LEN,
  deriveChatTitleFromUserText,
  isAutoTitleEligible,
} from './chat-title.ts'

describe('deriveChatTitleFromUserText', () => {
  test('returns empty string for non-string / empty / whitespace-only input', () => {
    assert.equal(deriveChatTitleFromUserText(undefined), '')
    assert.equal(deriveChatTitleFromUserText(null), '')
    assert.equal(deriveChatTitleFromUserText(123), '')
    assert.equal(deriveChatTitleFromUserText(''), '')
    assert.equal(deriveChatTitleFromUserText('   \n\t  '), '')
  })

  test('returns the first sentence when shorter than the 80-char budget', () => {
    const out = deriveChatTitleFromUserText('How do I add a dark mode toggle? I want it to remember the setting.')
    assert.equal(out, 'How do I add a dark mode toggle?')
  })

  test('handles exclamation and ellipsis-ish punctuation cleanly', () => {
    assert.equal(deriveChatTitleFromUserText('Help! My broker keeps crashing.'), 'Help!')
    assert.equal(
      deriveChatTitleFromUserText('Why does this break? Not sure what to try next.'),
      'Why does this break?',
    )
  })

  test('allows a trailing close-quote or bracket on the sentence terminator', () => {
    assert.equal(
      deriveChatTitleFromUserText('She said "go!" and then left without waiting.'),
      'She said "go!"',
    )
  })

  test('falls back to 80-char smart truncation when no sentence terminator fits in budget', () => {
    const long =
      'this is a single very long question without any punctuation at all that just keeps rambling on and on'
    const out = deriveChatTitleFromUserText(long)
    assert.ok(out.length <= CHAT_TITLE_MAX_LEN, `length ${out.length} > ${CHAT_TITLE_MAX_LEN}`)
    assert.ok(out.endsWith('\u2026'), 'expected horizontal ellipsis')
    assert.ok(!out.endsWith(' \u2026'), 'no space before ellipsis')
  })

  test('80-char truncation cuts on a word boundary, not mid-word', () => {
    const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma'
    const out = deriveChatTitleFromUserText(long)
    assert.ok(out.length <= CHAT_TITLE_MAX_LEN)
    const withoutEllipsis = out.replace(/\u2026$/, '')
    // No partial token left dangling at the end.
    assert.ok(!/[a-z]$/i.test(withoutEllipsis) || long.startsWith(withoutEllipsis + ' '),
      `unexpected mid-word cut: ${out}`)
  })

  test('a sentence longer than 80 chars falls through to truncation, not a partial sentence', () => {
    const long = 'I want to understand exactly why the broker fails to start whenever I rebuild native modules on Windows.'
    const out = deriveChatTitleFromUserText(long)
    assert.ok(out.length <= CHAT_TITLE_MAX_LEN)
    assert.ok(out.endsWith('\u2026'))
  })

  test('collapses newlines and runs of whitespace into single spaces', () => {
    const out = deriveChatTitleFromUserText('hello\n\n  world  \nfrom\tsylo.')
    assert.equal(out, 'hello world from sylo.')
  })

  test('strips a single leading markdown heading marker', () => {
    assert.equal(deriveChatTitleFromUserText('# What is Sylo?'), 'What is Sylo?')
    assert.equal(deriveChatTitleFromUserText('### Deep nested heading question?'), 'Deep nested heading question?')
  })

  test('strips a single leading list marker (bullet and numbered)', () => {
    assert.equal(deriveChatTitleFromUserText('- buy milk on the way home.'), 'buy milk on the way home.')
    assert.equal(deriveChatTitleFromUserText('1. step one is to install Pi.'), 'step one is to install Pi.')
  })

  test('strips an opening fenced code block marker but keeps the question after it', () => {
    const out = deriveChatTitleFromUserText('```python\nWhy does this raise?')
    assert.equal(out, 'Why does this raise?')
  })

  test('hard-caps the result at CHAT_TITLE_MAX_LEN even for inputs that mock the sentence regex', () => {
    // 80-char "sentence" with no whitespace; the sentence regex won't match
    // (no terminator), so smart-truncate runs and adds ellipsis. Result must
    // stay within budget.
    const out = deriveChatTitleFromUserText('x'.repeat(200))
    assert.ok(out.length <= CHAT_TITLE_MAX_LEN, `length ${out.length} > ${CHAT_TITLE_MAX_LEN}`)
  })

  test('an exactly-80-char input without terminator is returned unchanged', () => {
    const exact = 'a'.repeat(80)
    const out = deriveChatTitleFromUserText(exact)
    assert.equal(out.length, 80)
    assert.equal(out, exact)
  })
})

describe('isAutoTitleEligible', () => {
  test('blank, (untitled), and the auto-seed "Chat" are eligible (case- and whitespace-insensitive)', () => {
    assert.equal(isAutoTitleEligible(''), true)
    assert.equal(isAutoTitleEligible('   '), true)
    assert.equal(isAutoTitleEligible('(untitled)'), true)
    assert.equal(isAutoTitleEligible('  (UNTITLED)  '), true)
    assert.equal(isAutoTitleEligible('Chat'), true)
    assert.equal(isAutoTitleEligible('chat'), true)
    assert.equal(isAutoTitleEligible('New chat'), true)
    assert.equal(isAutoTitleEligible('new chat'), true)
    assert.equal(isAutoTitleEligible(undefined), true)
    assert.equal(isAutoTitleEligible(null), true)
  })

  test('any operator-set title (incl. branch chats) is NOT eligible', () => {
    assert.equal(isAutoTitleEligible('My research notes'), false)
    assert.equal(isAutoTitleEligible('How do I add a dark mode toggle?'), false)
    assert.equal(isAutoTitleEligible('Original chat (branch)'), false)
    assert.equal(isAutoTitleEligible('Chat 2'), false)
  })
})
