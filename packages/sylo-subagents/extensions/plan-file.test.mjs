/**
 * Run: npm run test:subagent-plan-file -w apps/host
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { parsePlanTodos } from './plan-checklist.ts'
import {
  clearFinishedPlan,
  conversationPlanAbs,
  conversationPlanRel,
  currentPlanAbs,
  isPlannerAgentName,
  isReviewerAgentName,
  markPlanReviewed,
  readPlanMarkdown,
  removeCurrentPlan,
  retractForeignCurrentPlan,
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

  test('next send clears a reviewed plan but keeps an unfinished one', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [x] One\nDone.\n\n## [ ] Two\nOpen.\n', {
      conversationId: 'conv-1',
    })
    assert.equal(clearFinishedPlan(cwd, 'conv-1'), false)
    assert.ok(readPlanMarkdown(cwd, 'conv-1'))

    markPlanReviewed(cwd, 'conv-1')
    assert.equal(clearFinishedPlan(cwd, 'conv-1'), true)
    assert.equal(readPlanMarkdown(cwd, 'conv-1'), null)
  })

  test('next send clears a fully ticked plan even without a review', () => {
    const cwd = scratch()
    writeCurrentPlan(cwd, '# A\n\n## [x] One\nDone.\n\n## [x] Two\nDone.\n', {
      conversationId: 'conv-1',
    })
    assert.equal(clearFinishedPlan(cwd, 'conv-1'), true)
    assert.equal(readPlanMarkdown(cwd, 'conv-1'), null)
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
