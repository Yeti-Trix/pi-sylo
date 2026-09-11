import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  generatedCharsFromEvent,
  MAX_SEAT_OUTPUT_CHARS,
  pickBestThinkTankSeatOutput,
} from './spawn-seat.ts'

describe('pickBestThinkTankSeatOutput', () => {
  it('prefers substantive debate turn over trailing fragment refusal', () => {
    const good =
      '## Observation\nCosmological actuality selects one branch.\n\n' +
      '{"stance":"continue","summary":"Constraint types differ"}'
    const bad = 'Fragment. No action.\n\n{"stance":"no_more_to_add","summary":"done"}'
    const picked = pickBestThinkTankSeatOutput([good, bad], 'debate')
    assert.match(picked.text, /Cosmological actuality/)
    assert.equal(picked.pickedFrom, 'best_score')
  })

  it('prefers final report with Thesis section', () => {
    const weak = 'Fragment. No action.'
    const strong = '## Thesis\nThe parallel is forced.\n\n## Evidence\nActuality diverges.'
    const picked = pickBestThinkTankSeatOutput([weak, strong], 'final_report')
    assert.match(picked.text, /## Thesis/)
  })
})

describe('generatedCharsFromEvent', () => {
  it('counts spoken text and reasoning alike', () => {
    // The measured runaway was reasoning, not answer text, so thinking must be metered too.
    assert.equal(generatedCharsFromEvent({ type: 'text_delta', delta: 'hello' }), 5)
    assert.equal(generatedCharsFromEvent({ type: 'thinking_delta', delta: 'hmm' }), 3)
  })

  it('ignores events that carry no generated tokens', () => {
    assert.equal(generatedCharsFromEvent({ type: 'tool_execution_start' }), 0)
    assert.equal(generatedCharsFromEvent({ type: 'thinking_start', contentIndex: 0 }), 0)
    assert.equal(generatedCharsFromEvent({ type: 'text_delta' }), 0)
    assert.equal(generatedCharsFromEvent({ type: 'text_delta', delta: 42 }), 0)
  })

  it('leaves room for a real turn but trips long before a context window fills', () => {
    // Measured on gemma4:12b: a legitimate debate turn streamed 4,780 chars in 21s, and an
    // induced runaway was still generating at 60,000. The ceiling has to clear the former
    // with margin and cut the latter well inside a minute or two.
    const measuredRealTurnChars = 4_780
    assert.ok(MAX_SEAT_OUTPUT_CHARS > measuredRealTurnChars * 3)
    assert.ok(MAX_SEAT_OUTPUT_CHARS < 60_000)
  })
})
