/**
 * Run: npm run test:subagent-plan-file -w apps/host
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { parsePlanHidden, parsePlanTodos } from './plan-checklist.ts'
import {
  conversationPlanAbs,
  conversationPlanRel,
  currentPlanAbs,
  hideFinishedPlan,
  isPlannerAgentName,
  isReviewerAgentName,
  isWorkerAgentName,
  markGoalsBuilt,
  markPlanReviewed,
  readPlanMarkdown,
  removeCurrentPlan,
  reopenFailedGoals,
  resolveRunGoals,
  restorePlan,
  retractForeignCurrentPlan,
  tickReviewedGoals,
  writeCurrentPlan,
} from './plan-file.ts'

const roots = []

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'sylo-plan-'))
  roots.push(dir)
  return dir
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('agent name match', () => {
  test('planner and reviewer aliases', () => {
    assert.equal(isPlannerAgentName('planner'), true)
    assert.equal(isPlannerAgentName('code-planner'), true)
    assert.equal(isPlannerAgentName('worker'), false)
    assert.equal(isReviewerAgentName('reviewer'), true)
    assert.equal(isReviewerAgentName('security-reviewer'), true)
    assert.equal(isReviewerAgentName('planner'), false)
    assert.equal(isWorkerAgentName('worker'), true)
    assert.equal(isWorkerAgentName('ui_worker'), true)
    assert.equal(isWorkerAgentName('reviewer'), false)
  })
})

describe('conversation-scoped plan file', () => {
  test('writes only the conversation file, not a workspace current.md', () => {
    const cwd = scratch()
    const rel = writeCurrentPlan(
      cwd,
      '# Ship it\n\n## Persist the plan\nWrite scoped file.\n\n### Approach\nHost write.\n',
      { conversationId: 'conv-1' },
    )
    assert.equal(rel, conversationPlanRel('conv-1'))
    const text = readFileSync(conversationPlanAbs(cwd, 'conv-1'), 'utf8')
    assert.match(text, /source: planner/)
    assert.match(text, /conversation_id: conv-1/)
    assert.match(text, /## \[ \] Persist the plan/)
    assert.match(text, /### Approach/)
    assert.equal(parsePlanTodos(text)[0]?.text, 'Persist the plan')
    assert.equal(existsSync(currentPlanAbs(cwd)), false)
    assert.match(readFileSync(join(cwd, '.sylo', 'plans', '.gitignore'), 'utf8'), /\*/)
    assert.match(readPlanMarkdown(cwd, 'conv-1') ?? '', /Persist the plan/)
  })

  test('another conversation cannot read this chat\'s plan', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## Goal A\nDo A.\n', { conversationId: 'conv-1' })
    assert.equal(readPlanMarkdown(cwd, 'conv-2'), null)
    assert.ok(readPlanMarkdown(cwd, 'conv-1'))
  })

  test('write without conversation id does not create a global plan', () => {
    const cwd = scratch()
    assert.equal(writeCurrentPlan(cwd, 'plan'), null)
    assert.equal(existsSync(currentPlanAbs(cwd)), false)
    assert.equal(existsSync(join(cwd, '.sylo', 'plans')), false)
  })

  test('empty body does not write', () => {
    const cwd = scratch()
    assert.equal(writeCurrentPlan(cwd, '  ', { conversationId: 'conv-1' }), null)
  })

  test('remove deletes this conversation file only', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## One\nA.\n', { conversationId: 'conv-1' })
    writeCurrentPlan(cwd, '# B\n\n## Two\nB.\n', { conversationId: 'conv-2' })
    assert.equal(removeCurrentPlan(cwd, 'conv-1'), true)
    assert.equal(readPlanMarkdown(cwd, 'conv-1'), null)
    assert.ok(readPlanMarkdown(cwd, 'conv-2'))
    assert.equal(removeCurrentPlan(cwd, 'conv-1'), false)
  })

  test('retracts a leftover current.md that belongs to another chat', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## One\nA.\n', { conversationId: 'conv-1' })
    const dir = join(cwd, '.sylo', 'plans')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      currentPlanAbs(cwd),
      '---\nsource: planner\nconversation_id: conv-1\n---\n\n# Leftover\n',
      'utf8',
    )
    assert.equal(retractForeignCurrentPlan(cwd, 'conv-2'), true)
    assert.equal(existsSync(currentPlanAbs(cwd)), false)
    assert.ok(readPlanMarkdown(cwd, 'conv-1'))
    assert.equal(readPlanMarkdown(cwd, 'conv-2'), null)
  })

  test('reviewer sign-off keeps the file so the goals bar survives', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [x] One\nDone.\n', { conversationId: 'conv-1' })
    assert.equal(markPlanReviewed(cwd, 'conv-1'), true)
    const text = readPlanMarkdown(cwd, 'conv-1') ?? ''
    assert.match(text, /status: reviewed/)
    assert.match(text, /## \[x\] One/)
    assert.equal(parsePlanTodos(text).length, 1)
  })

  test('next send hides a reviewed plan but keeps an unfinished one showing', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [x] One\nDone.\n\n## [ ] Two\nOpen.\n', {
      conversationId: 'conv-1',
    })
    assert.equal(hideFinishedPlan(cwd, 'conv-1'), false)
    assert.equal(parsePlanHidden(readPlanMarkdown(cwd, 'conv-1') ?? ''), false)

    writeCurrentPlan(cwd, '# A\n\n## [x] One\nDone.\n\n## [x] Two\nDone.\n', {
      conversationId: 'conv-1',
    })
    markPlanReviewed(cwd, 'conv-1')
    assert.equal(hideFinishedPlan(cwd, 'conv-1'), true)
    assert.equal(hideFinishedPlan(cwd, 'conv-1'), false, 'hiding twice is a no-op')
    const hiddenText = readPlanMarkdown(cwd, 'conv-1') ?? ''
    assert.match(hiddenText, /hidden: true/)
    assert.match(hiddenText, /status: reviewed/, 'sign-off survives the hide')
  })

  test('hidden goals come back on request, ticks and all', () => {
    // A crash, an End, or a close must not cost the operator the plan: "continue"
    // has to be able to put the same boxes back.
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [x] One\nDone.\n\n## [x] Two\nDone.\n', {
      conversationId: 'conv-1',
    })
    markPlanReviewed(cwd, 'conv-1')
    hideFinishedPlan(cwd, 'conv-1')

    assert.equal(restorePlan(cwd, 'conv-1'), true)
    const text = readPlanMarkdown(cwd, 'conv-1') ?? ''
    assert.equal(parsePlanHidden(text), false)
    assert.match(text, /status: reviewed/)
    assert.equal(
      parsePlanTodos(text).every((t) => t.done),
      true,
      'the ticks the reviewer earned are still there',
    )
    assert.equal(restorePlan(cwd, 'conv-1'), false, 'a visible plan needs no restore')
    assert.equal(restorePlan(cwd, 'conv-2'), false, 'other chats have nothing to restore')
  })

  test('a passing per-section review closes just that goal', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [ ] One\nOpen.\n\n## [ ] Two\nOpen.\n', {
      conversationId: 'conv-1',
    })
    assert.equal(tickReviewedGoals(cwd, 'conv-1', ['One']), true)
    const todos = parsePlanTodos(readPlanMarkdown(cwd, 'conv-1') ?? '')
    assert.deepEqual(
      todos.map((t) => [t.text, t.done]),
      [
        ['One', true],
        ['Two', false],
      ],
    )
  })

  test('a whole-plan pass closes every goal and then signs off', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [ ] One\nOpen.\n\n## [ ] Two\nOpen.\n', {
      conversationId: 'conv-1',
    })
    assert.equal(tickReviewedGoals(cwd, 'conv-1', 'all'), true)
    assert.equal(markPlanReviewed(cwd, 'conv-1'), true)
    const text = readPlanMarkdown(cwd, 'conv-1') ?? ''
    assert.match(text, /status: reviewed/)
    assert.equal(parsePlanTodos(text).every((t) => t.done), true)
  })

  test('ticking a goal no plan contains changes nothing', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [ ] One\nOpen.\n', { conversationId: 'conv-1' })
    assert.equal(tickReviewedGoals(cwd, 'conv-1', ['Not a goal here']), false)
    assert.equal(tickReviewedGoals(cwd, 'conv-2', 'all'), false, 'other chats are untouched')
  })

  test('a worker marks its section built; only a review closes it', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [ ] One\nOpen.\n\n## [ ] Two\nOpen.\n', {
      conversationId: 'conv-1',
    })
    assert.equal(markGoalsBuilt(cwd, 'conv-1', ['One']), true)
    let todos = parsePlanTodos(readPlanMarkdown(cwd, 'conv-1') ?? '')
    assert.deepEqual(
      todos.map((t) => t.state),
      ['built', 'open'],
    )
    assert.equal(markPlanReviewed(cwd, 'conv-1'), false, 'built is not reviewed')

    assert.equal(tickReviewedGoals(cwd, 'conv-1', ['One']), true)
    todos = parsePlanTodos(readPlanMarkdown(cwd, 'conv-1') ?? '')
    assert.deepEqual(
      todos.map((t) => t.state),
      ['passed', 'open'],
    )
  })

  test('a failed review reopens the section it judged', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [ ] One\nOpen.\n', { conversationId: 'conv-1' })
    markGoalsBuilt(cwd, 'conv-1', ['One'])
    assert.equal(reopenFailedGoals(cwd, 'conv-1', ['One']), true)
    assert.equal(parsePlanTodos(readPlanMarkdown(cwd, 'conv-1') ?? '')[0].state, 'open')
  })

  test('all boxes built but never reviewed keeps the plan open and visible', () => {
    // The operator's rule: nothing retires a plan except a reviewer.
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [ ] One\nOpen.\n\n## [ ] Two\nOpen.\n', {
      conversationId: 'conv-1',
    })
    markGoalsBuilt(cwd, 'conv-1', ['One', 'Two'])
    assert.equal(markPlanReviewed(cwd, 'conv-1'), false)
    assert.equal(hideFinishedPlan(cwd, 'conv-1'), false, 'an unreviewed plan is never hidden')
    assert.ok(readPlanMarkdown(cwd, 'conv-1'))
  })

  test('every box ticked without a review still does not finish the plan', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [x] One\nDone.\n\n## [x] Two\nDone.\n', {
      conversationId: 'conv-1',
    })
    assert.equal(hideFinishedPlan(cwd, 'conv-1'), false)
    assert.ok(readPlanMarkdown(cwd, 'conv-1'), 'survives a crash so it can be resumed')
  })

  describe('resolveRunGoals', () => {
    // The orchestrator does not pass `goal` — in a real session every single run
    // arrived without one, so a passing review was read as covering the whole plan
    // and a half-done plan could never tick anything. The goal is resolved here.
    function plan() {
      const cwd = scratch()
      writeCurrentPlan(cwd, '# A\n\n## [ ] One\nOpen.\n\n## [ ] Two\nOpen.\n', {
        conversationId: 'conv-1',
      })
      return cwd
    }

    test('a named goal wins when it matches a heading', () => {
      const cwd = plan()
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'worker', 'Two'), ['Two'])
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'worker', 'two.'), ['Two'])
    })

    test('a goal the plan does not contain falls back to inference', () => {
      // The orchestrator invents its own names ("S3 maps"); silently ticking
      // nothing is how a run reaches the end with an untouched plan.
      const cwd = plan()
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'worker', 'S3 maps'), ['One'])
    })

    test('a worker is building the first open section', () => {
      const cwd = plan()
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'worker'), ['One'])
      markGoalsBuilt(cwd, 'conv-1', ['One'])
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'worker'), ['Two'])
    })

    test('a reviewer is judging the first built section, not the whole plan', () => {
      const cwd = plan()
      markGoalsBuilt(cwd, 'conv-1', ['One'])
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'reviewer'), ['One'])
      tickReviewedGoals(cwd, 'conv-1', ['One'])
      markGoalsBuilt(cwd, 'conv-1', ['Two'])
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'reviewer'), ['Two'])
    })

    test('a reviewer with nothing built judges the first unfinished section', () => {
      const cwd = plan()
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'reviewer'), ['One'])
    })

    test('no plan means nothing to mark', () => {
      const cwd = plan()
      assert.deepEqual(resolveRunGoals(cwd, 'conv-2', 'worker'), [])
      assert.equal(markGoalsBuilt(cwd, 'conv-1', []), false)
    })

    test('a hidden plan is not marked by unrelated later work', () => {
      // The operator moved on; a worker running now is doing something else, and
      // guessing a section would tick work nobody did.
      const cwd = plan()
      tickReviewedGoals(cwd, 'conv-1', 'all')
      markPlanReviewed(cwd, 'conv-1')
      hideFinishedPlan(cwd, 'conv-1')
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'worker'), [])
      assert.deepEqual(resolveRunGoals(cwd, 'conv-1', 'reviewer'), [])
    })
  })

  test('a review with goals still open is not sign-off', () => {
    // The reviewer's own verdict here is "incomplete" — badging the plan reviewed
    // told the operator the work was done while every goal sat unticked.
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [ ] One\nOpen.\n\n## [ ] Two\nOpen.\n', {
      conversationId: 'conv-1',
    })
    assert.equal(markPlanReviewed(cwd, 'conv-1'), false)
    const text = readPlanMarkdown(cwd, 'conv-1') ?? ''
    assert.match(text, /status: active/)
    assert.equal(hideFinishedPlan(cwd, 'conv-1'), false, 'unfinished work stays on the bar')
  })

  test('unscoped current.md is never returned to a named conversation', () => {
    const cwd = scratch()
    const dir = join(cwd, '.sylo', 'plans')
    mkdirSync(dir, { recursive: true })
    writeFileSync(currentPlanAbs(cwd), '# Orphan\n\n## Do leftover work\n', 'utf8')
    assert.equal(readPlanMarkdown(cwd, 'conv-2'), null)
    assert.equal(retractForeignCurrentPlan(cwd, 'conv-2'), true)
    assert.equal(existsSync(currentPlanAbs(cwd)), false)
  })
})
