/**
 * Turn-pause ledger in askQuestionClient: while a conversation's turn is parked on
 * an unanswered ask-question, live elapsed timers freeze and resume from the frozen
 * value after the answer (each paused interval subtracted, not absorbed).
 *
 * Run: npm run test:ask-question-pause -w apps/host
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
  clearAskQuestionPrompt,
  clearAskQuestionPromptsForConversation,
  conversationPauseSnapshot,
  ingestAskQuestionPayload,
  NO_QUESTION_PAUSE,
  upsertAskQuestionPrompt,
} from '../../../../out/test/ask-question-pause.mjs'

// Deterministic clock: every test reads Date.now() == t0 + clockOffset, so pause
// windows are exact regardless of how long the statements actually take.
const t0 = Date.now()
let clockOffset = 0
const realDateNow = Date.now

beforeEach(() => {
  clockOffset = 0
  Date.now = () => t0 + clockOffset
})

afterEach(() => {
  Date.now = realDateNow
})

function promptFor(toolCallId, conversationId, createdAt) {
  return {
    requestId: `req-${toolCallId}`,
    toolCallId,
    conversationId,
    messageId: 'assistant-1',
    title: 'Question',
    questions: [{ id: 'q1', prompt: 'Pick one', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
    createdAt,
  }
}

describe('conversationPauseSnapshot', () => {
  test('no pending questions → NO_QUESTION_PAUSE (stable identity)', () => {
    assert.equal(conversationPauseSnapshot('conv-x'), NO_QUESTION_PAUSE)
    assert.equal(conversationPauseSnapshot(null), NO_QUESTION_PAUSE)
    assert.equal(conversationPauseSnapshot(undefined), NO_QUESTION_PAUSE)
    clearAskQuestionPromptsForConversation('conv-x')
  })

  test('question opens a pause anchored at the question timestamp (from the host stamp)', () => {
    upsertAskQuestionPrompt(promptFor('tc-open', 'conv-a', t0 + 100_000))
    const snap = conversationPauseSnapshot('conv-a')
    assert.equal(snap.paused, true)
    assert.equal(snap.pausedSinceTs, t0 + 100_000)
    assert.equal(snap.pausedTotalMs, 0)
  })

  test('timers: frozen while waiting, seamless resume from the frozen value', () => {
    const startTs = Date.now() // turn anchor (assistant created_at)
    const askedAt = startTs + 60_000 // question asked 60s into the turn
    upsertAskQuestionPrompt(promptFor('tc-freeze', 'conv-b', askedAt))

    // While paused the display holds: pausedSinceTs − startTs − 0 = 60s, frozen.
    const frozenMs = 60_000
    const whilePaused = conversationPauseSnapshot('conv-b')
    assert.equal(whilePaused.paused, true)
    assert.equal(whilePaused.pausedTotalMs, 0)

    // Operator answers 5 minutes later (clock jumps forward). The banked wait is
    // the full pause window: asked 1 min in → answered at the 5 min mark = 4 min.
    clockOffset = 5 * 60_000
    clearAskQuestionPrompt('tc-freeze')
    const resumed = conversationPauseSnapshot('conv-b')
    assert.equal(resumed.paused, false)
    assert.equal(resumed.pausedTotalMs, 4 * 60_000)

    // Timer math after resume: now − startTs − pausedTotalMs lands exactly on the
    // frozen value at the moment of the answer, then counts agent time only.
    const atResume = Date.now() - startTs - resumed.pausedTotalMs
    assert.equal(atResume, frozenMs)
  })

  test('multiple sequential questions in one turn accumulate pauses', () => {
    const base = Date.now()
    upsertAskQuestionPrompt(promptFor('tc-q1', 'conv-c', base + 1000)) // asked 1s in
    clockOffset = 30_000
    clearAskQuestionPrompt('tc-q1') // answered at 30s → banked 29s
    // Ledger must survive while the same turn keeps running.
    let snap = conversationPauseSnapshot('conv-c')
    assert.equal(snap.paused, false)
    assert.equal(snap.pausedTotalMs, 29_000)

    upsertAskQuestionPrompt(promptFor('tc-q2', 'conv-c', base + 30_000)) // asked again at 30s
    snap = conversationPauseSnapshot('conv-c')
    assert.equal(snap.paused, true)
    assert.equal(snap.pausedSinceTs, base + 30_000)
    assert.equal(snap.pausedTotalMs, 29_000) // first wait still subtracted

    clockOffset = 42_000
    clearAskQuestionPrompt('tc-q2') // answered at 42s → banked another 12s
    snap = conversationPauseSnapshot('conv-c')
    assert.equal(snap.paused, false)
    assert.equal(snap.pausedTotalMs, 41_000)
    clearAskQuestionPromptsForConversation('conv-c')
  })

  test('a new question while already paused does not re-anchor the wait', () => {
    const base = Date.now()
    upsertAskQuestionPrompt(promptFor('tc-early', 'conv-d', base + 5_000))
    upsertAskQuestionPrompt(promptFor('tc-late', 'conv-d', base + 90_000))
    const snap = conversationPauseSnapshot('conv-d')
    assert.equal(snap.paused, true)
    assert.equal(snap.pausedSinceTs, base + 5_000) // earliest wins
    clearAskQuestionPromptsForConversation('conv-d')
  })

  test('turn boundary wipes pause accounting — next turn counts from zero', () => {
    const base = Date.now()
    upsertAskQuestionPrompt(promptFor('tc-turn', 'conv-e', base))
    clockOffset = 42_000
    clearAskQuestionPrompt('tc-turn')
    assert.equal(conversationPauseSnapshot('conv-e').pausedTotalMs, 42_000)

    // Turn ends (or a new turn starts): prompts cleared per conversation.
    clearAskQuestionPromptsForConversation('conv-e')
    assert.equal(conversationPauseSnapshot('conv-e'), NO_QUESTION_PAUSE)
  })

  test('turn-end cleanup also closes an open pause (turn dies on the question)', () => {
    const base = Date.now()
    upsertAskQuestionPrompt(promptFor('tc-die', 'conv-f', base + 1000))
    clearAskQuestionPromptsForConversation('conv-f')
    assert.equal(conversationPauseSnapshot('conv-f'), NO_QUESTION_PAUSE)
  })

  test('pauses are per conversation — other chats are unaffected', () => {
    const base = Date.now()
    upsertAskQuestionPrompt(promptFor('tc-mine', 'conv-mine', base + 1000))
    assert.equal(conversationPauseSnapshot('conv-other'), NO_QUESTION_PAUSE)
    upsertAskQuestionPrompt(promptFor('tc-theirs', 'conv-other', base + 2000))
    assert.equal(conversationPauseSnapshot('conv-mine').pausedSinceTs, base + 1000)
    assert.equal(conversationPauseSnapshot('conv-other').pausedSinceTs, base + 2000)
    clearAskQuestionPrompt('tc-mine')
    assert.equal(conversationPauseSnapshot('conv-mine'), NO_QUESTION_PAUSE)
    assert.equal(conversationPauseSnapshot('conv-other').paused, true)
    clearAskQuestionPromptsForConversation('conv-other')
  })

  test('legacy payload without createdAt anchors the pause at ingest time', () => {
    const at = Date.now()
    upsertAskQuestionPrompt({
      requestId: 'req-legacy',
      toolCallId: 'tc-legacy',
      conversationId: 'conv-h',
      messageId: null,
      title: 'Question',
      questions: promptFor('x', 'y', 0).questions,
    })
    const snap = conversationPauseSnapshot('conv-h')
    assert.equal(snap.paused, true)
    assert.ok(Math.abs(snap.pausedSinceTs - at) < 100)
  })

  test('pause closed with nothing banked collapses to the stable identity', () => {
    // A closed ledger with zero banked wait must not churn row memoization.
    const base = Date.now()
    upsertAskQuestionPrompt(promptFor('tc-close', 'conv-j', base + 1000))
    clearAskQuestionPrompt('tc-close') // closes with 0ms banked (same-clock tick)
    assert.equal(conversationPauseSnapshot('conv-j'), NO_QUESTION_PAUSE)
  })

  test('ingest reseed carries the host-stamped createdAt through (reload recovery)', () => {
    const askedAt = t0 + 321_000
    ingestAskQuestionPayload({
      requestId: 'req-seed',
      toolCallId: 'tc-seed',
      conversationId: 'conv-i',
      messageId: null,
      title: 'Question',
      questions: promptFor('x', 'y', 0).questions,
      createdAt: askedAt,
    })
    const snap = conversationPauseSnapshot('conv-i')
    assert.equal(snap.paused, true)
    assert.equal(snap.pausedSinceTs, askedAt)
  })
})