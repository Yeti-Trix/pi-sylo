import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { assertThinkTankTopicUsable, thinkTankTopicTitle, resolveThinkTankTopic, splitThinkTankTopic } from './topic.ts'

describe('resolveThinkTankTopic', () => {
  it('merges context and topic', () => {
    const out = resolveThinkTankTopic({
      context: 'Operator pasted a PDF summary: DSR gate risks.',
      topic: 'Should we use PF 0.95?',
    })
    assert.match(out, /Operator pasted a PDF/)
    assert.match(out, /Think tank debate question/)
    assert.match(out, /PF 0\.95/)
  })

  it('accepts context-only when operator message is entirely in context', () => {
    const out = resolveThinkTankTopic({
      context: 'Debate this trading gate: fixed 0.95 profit factor minimum.',
    })
    assert.match(out, /0\.95 profit factor/)
  })

  it('rejects empty topic', () => {
    assert.throws(() => resolveThinkTankTopic({ topic: '   ' }), /required/)
  })

  it('rejects bare topic label', () => {
    assert.throws(() => assertThinkTankTopicUsable('topic:'), /empty/)
  })

  it('preserves full question after context merge (no Wh truncation)', () => {
    const full = resolveThinkTankTopic({
      context: 'Workflow audit test.',
      topic: 'What is the best strategy for Rock-Paper-Scissors?',
    })
    const title = thinkTankTopicTitle(full)
    assert.match(title, /^What is the best/)
    const split = splitThinkTankTopic(full)
    assert.match(split.question, /^What is the best/)
  })
})
