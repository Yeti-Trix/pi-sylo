import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { allSeatsReady, parseDebateTurn } from './stance.ts'

describe('parseDebateTurn', () => {
  it('parses JSON footer stance', () => {
    const raw = 'My argument here.\n\n{"stance":"satisfied","summary":"Agree on DSR gate"}'
    const parsed = parseDebateTurn(raw)
    assert.equal(parsed.stance, 'satisfied')
    assert.equal(parsed.summary, 'Agree on DSR gate')
    assert.match(parsed.body, /My argument/)
  })

  it('defaults missing stance to continue', () => {
    const parsed = parseDebateTurn('No structured footer')
    assert.equal(parsed.stance, 'continue')
  })

  it('parses inline JSON stance when footer block missing', () => {
    const raw = 'Fragment. No action.\n\n```json\n{"stance":"no_more_to_add","summary":"done"}\n```'
    const parsed = parseDebateTurn(raw)
    assert.equal(parsed.stance, 'no_more_to_add')
  })

  it('allSeatsReady requires every seat done', () => {
    assert.equal(allSeatsReady(['satisfied', 'no_more_to_add']), true)
    assert.equal(allSeatsReady(['satisfied', 'continue']), false)
  })
})
