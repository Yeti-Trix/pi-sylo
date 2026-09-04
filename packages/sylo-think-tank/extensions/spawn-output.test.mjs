import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { pickBestThinkTankSeatOutput } from './spawn-seat.ts'

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
