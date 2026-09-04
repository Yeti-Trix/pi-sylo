import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { isThinkTankFragmentBody, sanitizeThinkTankSeatOutput, validateFinalReportBody, validateModeratorDebateTurn } from './fragment.ts'

describe('isThinkTankFragmentBody', () => {
  it('detects prompt. hold pattern from degraded session', () => {
    const body =
      'Holding. "prompt." is a stray fragment, explicitly named in my instructions as a token to ignore.\n\nNo new output.'
    assert.equal(isThinkTankFragmentBody(body), true)
  })

  it('accepts substantive debate turn', () => {
    const body =
      '## Observation\nCosmological actuality selects one branch.\n\n{"stance":"continue","summary":"Constraint types differ"}'
    assert.equal(isThinkTankFragmentBody(body), false)
  })

  it('detects meta final report checklist', () => {
    const body =
      'All required markdown sections were present in the delivered FinalReport:\n\n- ## Thesis\n- ## Evidence'
    assert.equal(isThinkTankFragmentBody(body), true)
  })
})

describe('sanitizeThinkTankSeatOutput', () => {
  it('truncates at stance footer and strips meta tail', () => {
    const raw =
      '## Argument\nPlay paper on opener.\n\n{"stance":"continue","summary":"Exploit rock bias"}\n\n' +
      'The user just said seat — this must be cycle 2. Let me add more.'
    const out = sanitizeThinkTankSeatOutput(raw, 'debate')
    assert.match(out, /Play paper on opener/)
    assert.doesNotMatch(out, /user just said/i)
    assert.match(out, /"stance":"continue"/)
  })

  it('strips embedded thinking blocks', () => {
    const raw =
      '## CRUX\n\nThe gate is output quality.\n\n```thinking\ninternal only\n```\n\n{"stance":"continue","summary":"ok"}'
    const out = sanitizeThinkTankSeatOutput(raw, 'debate')
    assert.doesNotMatch(out, /internal only/)
    assert.match(out, /output quality/)
  })
})

describe('validateFinalReportBody', () => {
  it('accepts report with thesis section', () => {
    const body = '## Thesis\n\nThe parallel is forced rhyme.\n\n## Evidence\nActuality diverges.'
    const v = validateFinalReportBody(body)
    assert.equal(v.ok, true)
  })

  it('accepts debater report with BOTTOM LINE sections', () => {
    const body =
      '## BOTTOM LINE\n\nShip the fixed 0.95 profit-factor gate to live.\n\n## SUPPORTING FACTS\n- [file: x] line 1\n\n## RISKS & LIMITATIONS\nCounter case on slippage still unresolved.'
    assert.equal(validateFinalReportBody(body, 'debater').ok, true)
  })

  it('accepts moderator report with decision brief sections', () => {
    const body =
      '## BOTTOM LINE\n\nRun the output-quality gate before outreach.\n\n' +
      '## WHAT WE FOUND\n\nBoth researchers agree billable controls exist.\n\n' +
      '## OPTIONS\n\nA) Gate first B) Outreach first\n\n' +
      '## WHAT TO DO NOW\n\nRun the sim this week.\n\n' +
      '## GAPS & MORE WORK\n\nNeed employer side-work policy in writing.\n\n' +
      '## CONFIDENCE\n\nmed'
    assert.equal(validateFinalReportBody(body, 'moderator').ok, true)
  })

  it('rejects meta checklist report', () => {
    const body = 'All required markdown sections were present. ## Thesis ## Evidence'
    assert.equal(validateFinalReportBody(body).ok, false)
  })
})

describe('validateModeratorDebateTurn', () => {
  it('rejects one-line moderator status ping', () => {
    const body =
      'Two proof tasks assigned. The crux is unresolved.\n\n{"stance":"continue","summary":"continuing"}'
    assert.equal(validateModeratorDebateTurn(body).ok, false)
  })

  it('accepts full KEY FINDING / EVIDENCE CHECK moderator cycle', () => {
    const body =
      '## KEY FINDING\n\nWhether the operator has billable controls work today decides every path.\n\n' +
      '## EVIDENCE CHECK\n\nDebater 1 overclaimed vendor pricing as solo-operator pricing without sourcing acquisition.\n\n' +
      '## GAPS\n\nEmployer side-work policy still missing from context.\n\n' +
      '## READINESS\n\nRun the output-quality gate first, then check employer permission before outreach.\n\n' +
      '{"stance":"continue","summary":"tasks assigned"}'
    assert.equal(body.length >= 400, true)
    assert.equal(validateModeratorDebateTurn(body).ok, true)
  })
})
