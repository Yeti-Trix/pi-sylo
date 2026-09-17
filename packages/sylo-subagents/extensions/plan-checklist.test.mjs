/**
 * Run: npm run test:subagent-plan-checklist -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ensureSectionGoals,
  extractPlanGoal,
  isPlanFinished,
  nextOpenGoal,
  parsePlanStatus,
  parsePlanTodos,
  parseReviewVerdict,
  planGoalsComplete,
  snapshotPlanMarkdown,
  tickPlanGoals,
} from './plan-checklist.ts'

const DETAILED = `# Persist planner goals

Live section goals above the composer.

## Persist the plan on disk
Sylo writes \`.sylo/plans/current.md\` after the planner finishes.

### Approach
- Host hooks \`subagent_run_end\`
- Keep a conversation-scoped copy

### Files
- \`plan-file.ts\` — write and delete

### Done when
The file exists after planner success.

## Show goals above the composer
The bar lists each \`##\` heading with a checkbox.

- [ ] this inner box is a detail, not a goal

### Done when
The composer shows two goals, not the inner box.
`

describe('parsePlanTodos', () => {
  test('each ## section is a goal; inner checklists and ### are not', () => {
    const todos = parsePlanTodos(DETAILED)
    assert.deepEqual(
      todos.map((t) => t.text),
      ['Persist the plan on disk', 'Show goals above the composer'],
    )
    assert.equal(todos.every((t) => t.done === false), true)
  })

  test('reads [x] on the heading', () => {
    const todos = parsePlanTodos('## [x] Wired the bar\nDetails.\n## [ ] Still open\nMore.')
    assert.deepEqual(
      todos.map((t) => ({ text: t.text, done: t.done })),
      [
        { text: 'Wired the bar', done: true },
        { text: 'Still open', done: false },
      ],
    )
  })

  test('skips reserved meta headings', () => {
    const todos = parsePlanTodos('## Risks\nWatch the watcher.\n## Notes\nBlocked.')
    assert.equal(todos.length, 0)
  })
})

describe('extractPlanGoal', () => {
  test('uses the H1 title', () => {
    assert.equal(extractPlanGoal(DETAILED), 'Persist planner goals')
  })

  test('falls back to ## Goal paragraph', () => {
    assert.equal(extractPlanGoal('## Goal\nShip the bar\n\n## Risks\nNone.'), 'Ship the bar')
  })
})

describe('ensureSectionGoals', () => {
  test('injects [ ] on goal headings and keeps section bodies', () => {
    const out = ensureSectionGoals(DETAILED)
    assert.match(out, /## \[ \] Persist the plan on disk/)
    assert.match(out, /### Approach/)
    assert.match(out, /## \[ \] Show goals above the composer/)
    assert.match(out, /this inner box is a detail/)
    assert.equal(parsePlanTodos(out).length, 2)
    assert.equal(ensureSectionGoals(out), out)
  })

  test('converts a legacy Goal + Checklist into H1 + sections', () => {
    const out = ensureSectionGoals(
      '## Goal\nShip the bar\n\n## Checklist\n- [ ] Persist the plan\n- [x] Show the bar\n\n## Risks\nCrash loss\n',
    )
    assert.match(out, /^# Ship the bar/m)
    assert.match(out, /## \[ \] Persist the plan/)
    assert.match(out, /## \[x\] Show the bar/)
    assert.match(out, /## Risks/)
    assert.equal(parsePlanTodos(out).length, 2)
  })
})

describe('snapshotPlanMarkdown', () => {
  test('reads conversation_id and status from frontmatter', () => {
    const snap = snapshotPlanMarkdown(
      '---\nsource: planner\nstatus: active\nconversation_id: conv-1\n---\n\n# Title\n\n## [ ] One\nBody.\n',
    )
    assert.equal(snap.conversationId, 'conv-1')
    assert.equal(snap.goal, 'Title')
    assert.equal(snap.todos[0]?.text, 'One')
    assert.equal(snap.status, 'active')
    assert.equal(snap.hidden, false)
  })

  test('hidden is frontmatter, independent of status', () => {
    const snap = snapshotPlanMarkdown(
      '---\nsource: planner\nstatus: reviewed\nhidden: true\n---\n\n# Title\n\n## [x] One\nBody.\n',
    )
    assert.equal(snap.hidden, true)
    assert.equal(snap.status, 'reviewed')
    assert.equal(snap.todos[0]?.done, true, 'a hidden plan keeps its ticks')
  })
})

describe('plan completion', () => {
  const PARTIAL = '## [x] One\nDone.\n\n## [ ] Two\nOpen.\n\n## [ ] Three\nOpen.\n'
  const ALL_DONE = '## [x] One\nDone.\n\n## [x] Two\nDone.\n'

  test('nextOpenGoal is the first unticked section', () => {
    assert.equal(nextOpenGoal(PARTIAL)?.text, 'Two')
    assert.equal(nextOpenGoal(ALL_DONE), undefined)
  })

  test('planGoalsComplete needs every goal ticked', () => {
    assert.equal(planGoalsComplete(PARTIAL), false)
    assert.equal(planGoalsComplete(ALL_DONE), true)
    assert.equal(planGoalsComplete('## Risks\nNo goals here.'), false)
  })

  test('an unfinished plan survives so continue can resume it', () => {
    assert.equal(isPlanFinished(PARTIAL), false)
    assert.equal(isPlanFinished(ALL_DONE), true)
  })

  test('reviewer sign-off finishes a plan even with an open goal', () => {
    const reviewed = `---\nsource: planner\nstatus: reviewed\n---\n\n${PARTIAL}`
    assert.equal(parsePlanStatus(reviewed), 'reviewed')
    assert.equal(isPlanFinished(reviewed), true)
    assert.equal(parsePlanStatus(PARTIAL), 'active')
  })
})

describe('parseReviewVerdict', () => {
  test('reads the sign-off line', () => {
    assert.equal(parseReviewVerdict('## Summary\nLooks good.\n\nVERDICT: PASS'), 'pass')
    assert.equal(parseReviewVerdict('## Critical\nBroken.\n\nVERDICT: FAIL'), 'fail')
    assert.equal(parseReviewVerdict('**VERDICT:** PASS'), 'pass')
    assert.equal(parseReviewVerdict('verdict: pass'), 'pass')
  })

  test('the last verdict wins', () => {
    assert.equal(parseReviewVerdict('VERDICT: PASS\n\nOn reflection:\n\nVERDICT: FAIL'), 'fail')
  })

  test('prose quoting the plan is not a verdict', () => {
    // Plans literally say "Return explicit PASS/FAIL", and reviewers echo that back.
    // Treating the bare word as sign-off would close goals off a template quote.
    assert.equal(parseReviewVerdict('The plan asks me to return explicit PASS/FAIL.'), 'none')
    assert.equal(parseReviewVerdict('I would PASS this if the tests existed.'), 'none')
    assert.equal(parseReviewVerdict(undefined), 'none')
    assert.equal(parseReviewVerdict(''), 'none')
  })
})

describe('tickPlanGoals', () => {
  const PLAN = `---\nstatus: active\n---\n\n# Outcome\n\n## [ ] Finalize gun models\nWork.\n\n## [ ] Replace reload overlays\nWork.\n\n## Risks\nNot a goal.\n`

  test('closes only the named goal', () => {
    const out = tickPlanGoals(PLAN, ['Finalize gun models'])
    assert.match(out, /## \[x\] Finalize gun models/)
    assert.match(out, /## \[ \] Replace reload overlays/)
    assert.match(out, /^## Risks$/m, 'reserved headings are never ticked')
  })

  test('matches a goal despite case and punctuation drift', () => {
    const out = tickPlanGoals(PLAN, ['finalize gun models.'])
    assert.match(out, /## \[x\] Finalize gun models/)
  })

  test('a whole-plan pass closes every goal but no reserved heading', () => {
    const out = tickPlanGoals(PLAN, 'all')
    assert.equal(planGoalsComplete(out), true)
    assert.match(out, /^## Risks$/m)
  })

  test('keeps the frontmatter and leaves unknown goals alone', () => {
    assert.match(tickPlanGoals(PLAN, 'all'), /^---\nstatus: active\n---/)
    assert.equal(tickPlanGoals(PLAN, ['Something never planned']), PLAN)
    assert.equal(tickPlanGoals(PLAN, []), PLAN)
  })

  test('already ticked goals are left as they are', () => {
    const done = tickPlanGoals(PLAN, 'all')
    assert.equal(tickPlanGoals(done, 'all'), done)
  })
})
