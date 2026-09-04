import assert from 'node:assert/strict'
import test from 'node:test'

test('inferDebatePhase opening vs mid', async () => {
  const { inferDebatePhase } = await import('./debate-prompts.ts')
  assert.equal(inferDebatePhase(1), 'opening')
  assert.equal(inferDebatePhase(2), 'mid')
})

test('debaterRoleOverrideBlock for 2 researchers', async () => {
  const { debaterRoleOverrideBlock } = await import('./debate-prompts.ts')
  const primary = debaterRoleOverrideBlock(0, 2)
  const counter = debaterRoleOverrideBlock(1, 2)
  assert.ok(primary && /Primary Case/.test(primary))
  assert.ok(counter && /Counter Case/.test(counter))
})

test('debaterRoleOverrideBlock only for 3+ researchers', async () => {
  const { debaterRoleOverrideBlock } = await import('./debate-prompts.ts')
  const d1 = debaterRoleOverrideBlock(0, 3)
  const d2 = debaterRoleOverrideBlock(1, 3)
  const d3 = debaterRoleOverrideBlock(2, 3)
  assert.ok(d1 && /Primary Case/.test(d1))
  assert.ok(d2 && /Methodology Reviewer/.test(d2))
  assert.ok(d3 && /Practical Skeptic/.test(d3))
})

test('buildModeratorCycleInstructions includes GAPS and READINESS', async () => {
  const { buildModeratorCycleInstructions } = await import('./debate-prompts.ts')
  const text = buildModeratorCycleInstructions({ cycle: 2, debaterLabels: ['Debater 1', 'Debater 2'] })
  assert.match(text, /KEY FINDING/)
  assert.match(text, /GAPS/)
  assert.match(text, /READINESS/)
})
