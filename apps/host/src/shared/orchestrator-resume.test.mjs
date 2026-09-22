/**
 * Run: npm run test:orchestrator-resume -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  composeOrchestratorResumePrompt,
  composePlanScopeNote,
  isPlanRestoreRequest,
  isResumeLikeRequest,
  lastAssistantLooksIncomplete,
  shouldInjectOrchestratorResume,
} from '../../out/test/orchestrator-resume.mjs'

describe('isResumeLikeRequest', () => {
  test('matches continue / did you finish / use the planner', () => {
    assert.equal(isResumeLikeRequest('did you finish?'), true)
    assert.equal(isResumeLikeRequest('please continue'), true)
    assert.equal(isResumeLikeRequest('use the planner and keep going'), true)
    assert.equal(isResumeLikeRequest('thanks'), false)
    assert.equal(isResumeLikeRequest('what is in package.json?'), false)
  })
})

describe('isPlanRestoreRequest', () => {
  test('covers resuming and asking for the goals by name', () => {
    assert.equal(isPlanRestoreRequest('continue'), true)
    assert.equal(isPlanRestoreRequest('show me the goals again'), true)
    assert.equal(isPlanRestoreRequest('bring back the plan'), true)
    assert.equal(isPlanRestoreRequest('put the checkboxes back up'), true)
    assert.equal(isPlanRestoreRequest('finish the plan'), true)
    assert.equal(isPlanRestoreRequest('thanks'), false)
    assert.equal(isPlanRestoreRequest('add a dark mode toggle'), false)
    assert.equal(isPlanRestoreRequest('what does a plan file look like?'), false)
  })
})

describe('lastAssistantLooksIncomplete', () => {
  test('failed or recovery copy is incomplete', () => {
    assert.equal(lastAssistantLooksIncomplete('', 'failed'), true)
    assert.equal(lastAssistantLooksIncomplete('(error) Model returned no text.'), true)
    assert.equal(lastAssistantLooksIncomplete('The model ran tools but never wrote a reply summarizing what it did.'), true)
    assert.equal(lastAssistantLooksIncomplete('Here is the plan:\n1. Edit foo'), false)
  })
})

describe('shouldInjectOrchestratorResume', () => {
  test('injects after an incomplete turn', () => {
    assert.equal(
      shouldInjectOrchestratorResume({
        userText: 'did you finish?',
        lastAssistantStatus: 'failed',
        lastAssistantContent: '(error) Model returned no text.',
        conversationUsedSubagents: true,
        alreadyForcedMention: false,
      }),
      true,
    )
  })

  test('injects resume in a subagent chat even if the last row looks fine', () => {
    assert.equal(
      shouldInjectOrchestratorResume({
        userText: 'continue',
        lastAssistantStatus: 'complete',
        lastAssistantContent: 'Ran 49 tool calls.',
        conversationUsedSubagents: true,
        alreadyForcedMention: false,
      }),
      true,
    )
  })

  test('skips @mention turns and thanks', () => {
    assert.equal(
      shouldInjectOrchestratorResume({
        userText: 'continue',
        lastAssistantStatus: 'failed',
        conversationUsedSubagents: true,
        alreadyForcedMention: true,
      }),
      false,
    )
    assert.equal(
      shouldInjectOrchestratorResume({
        userText: 'thanks',
        lastAssistantStatus: 'failed',
        conversationUsedSubagents: true,
        alreadyForcedMention: false,
      }),
      false,
    )
  })
})

describe('composeOrchestratorResumePrompt', () => {
  test('with no plan, recovers the turn without ordering subagents', () => {
    // Recovering a turn is not a reason to delegate. Mandating a `planner` here meant
    // any follow-up after an error spawned subagents for work the parent could finish.
    const out = composeOrchestratorResumePrompt('did you finish?')
    assert.match(out, /did you finish\?/)
    assert.match(out, /<operator_request>/)
    assert.match(out, /Judge for yourself whether it needs subagents/)
    assert.match(out, /answer it directly when you can/)
    assert.match(out, /does not need a plan just because it was resumed/)
    assert.doesNotMatch(out, /You are the orchestrator/)
  })

  test('names this chat\'s plan file and the next open section', () => {
    const out = composeOrchestratorResumePrompt('continue', {
      planRel: '.sylo/plans/conv-1.md',
      done: 1,
      total: 3,
      nextGoal: 'Wire the goals bar',
    })
    assert.match(out, /\.sylo\/plans\/conv-1\.md/)
    assert.match(out, /1\/3 goals passed review/)
    assert.match(out, /Wire the goals bar/)
    assert.match(out, /one at a time in file order/)
  })
})

describe('composePlanScopeNote', () => {
  test('forbids other chats\' plans when this chat has none', () => {
    const out = composePlanScopeNote('conv-2', { planRel: null, done: 0, total: 0 })
    assert.match(out, /conv-2/)
    assert.match(out, /no plan file/)
    assert.match(out, /other chats/)
  })

  test('drives one stack per section and gates the next on a passing review', () => {
    const out = composePlanScopeNote('conv-1', {
      planRel: '.sylo/plans/conv-1.md',
      done: 1,
      total: 4,
      nextGoal: 'Section two',
    })
    assert.match(out, /Section two/)
    assert.match(out, /one at a time in file order/)
    assert.match(out, /Do not start the next section until the current one has passed/)
    assert.doesNotMatch(out, /Every goal has passed review/)
  })

  test('an unreviewed built section is reported and reviewed before more building', () => {
    // The failure this exists for: the run built several sections and only then ran a
    // reviewer, which had to fail work that was never finished, so nothing ever closed.
    const out = composePlanScopeNote('conv-1', {
      planRel: '.sylo/plans/conv-1.md',
      done: 1,
      total: 4,
      built: 1,
      nextGoal: 'Section three',
      nextReview: 'Section two',
    })
    assert.match(out, /1 built and awaiting review/)
    assert.match(out, /"Section two" is built but unreviewed/)
    assert.match(out, /before any further building/)
  })

  test('tells the parent Sylo owns the marks, keyed to the reviewer verdict', () => {
    const out = composePlanScopeNote('conv-1', {
      planRel: '.sylo/plans/conv-1.md',
      done: 0,
      total: 2,
    })
    assert.match(out, /Never edit the plan file yourself/)
    assert.match(out, /VERDICT: PASS/)
    assert.match(out, /Pass `goal`/)
    assert.match(out, /## \[~\]/, 'the built mark is explained')
  })

  test('stops starting sections once every goal has passed', () => {
    const out = composePlanScopeNote('conv-1', {
      planRel: '.sylo/plans/conv-1.md',
      done: 4,
      total: 4,
    })
    assert.match(out, /Every goal has passed review/)
    assert.doesNotMatch(out, /one at a time in file order/)
  })

  test('a hidden plan is history, not work to redo', () => {
    const out = composePlanScopeNote('conv-1', {
      planRel: '.sylo/plans/conv-1.md',
      done: 3,
      total: 3,
      hidden: true,
    })
    assert.match(out, /do NOT re-run those goals/)
    assert.match(out, /Sylo puts it back/)
    assert.doesNotMatch(out, /one at a time in file order/)
  })
})
