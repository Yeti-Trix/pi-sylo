/**
 * Run: npm run test:orchestrator-resume -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  composeOrchestratorResumePrompt,
  composePlanScopeNote,
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
  test('keeps the operator text and forbids parent-side planning', () => {
    const out = composeOrchestratorResumePrompt('did you finish?')
    assert.match(out, /did you finish\?/)
    assert.match(out, /agent "planner"/)
    assert.match(out, /no plan file/)
    assert.match(out, /Do not write an implementation plan/)
    assert.match(out, /<operator_request>/)
  })

  test('names this chat\'s plan file and the next open section', () => {
    const out = composeOrchestratorResumePrompt('continue', {
      planRel: '.sylo/plans/conv-1.md',
      done: 1,
      total: 3,
      nextGoal: 'Wire the goals bar',
    })
    assert.match(out, /\.sylo\/plans\/conv-1\.md/)
    assert.match(out, /1\/3 goals done/)
    assert.match(out, /Wire the goals bar/)
    assert.match(out, /one `worker` per unticked/)
  })
})

describe('composePlanScopeNote', () => {
  test('forbids other chats\' plans when this chat has none', () => {
    const out = composePlanScopeNote('conv-2', { planRel: null, done: 0, total: 0 })
    assert.match(out, /conv-2/)
    assert.match(out, /no plan file/)
    assert.match(out, /other chats/)
  })

  test('keeps dispatching sections and defers the reviewer', () => {
    const out = composePlanScopeNote('conv-1', {
      planRel: '.sylo/plans/conv-1.md',
      done: 1,
      total: 4,
      nextGoal: 'Section two',
    })
    assert.match(out, /Section two/)
    assert.match(out, /keep going until none are left/)
    assert.match(out, /Do NOT run `reviewer` until every goal is ticked/)
    assert.doesNotMatch(out, /Every goal is ticked/)
  })

  test('asks for one review over all work when the plan is fully ticked', () => {
    const out = composePlanScopeNote('conv-1', {
      planRel: '.sylo/plans/conv-1.md',
      done: 4,
      total: 4,
    })
    assert.match(out, /Every goal is ticked/)
    assert.match(out, /`reviewer` once over all of the work/)
    assert.doesNotMatch(out, /per unticked/)
  })
})
