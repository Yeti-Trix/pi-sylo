import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { isSkillPathInOperatorScope } from './sylo-skill-scope.ts'

describe('isSkillPathInOperatorScope', () => {
  const agentDir = 'C:/Users/op/.pi/agent'
  const piCwd = 'C:/Users/op/Documents/GitHub/pi-sylo-workout'

  it('allows agent and workspace .pi skills', () => {
    assert.equal(
      isSkillPathInOperatorScope(join(agentDir, 'skills', 'issue-tracking'), agentDir, piCwd),
      true,
    )
    assert.equal(
      isSkillPathInOperatorScope(join(piCwd, '.pi', 'skills', 'my-skill', 'SKILL.md'), agentDir, piCwd),
      true,
    )
  })

  it('rejects .cursor skills by default', () => {
    assert.equal(
      isSkillPathInOperatorScope(
        'C:/Users/op/Documents/GitHub/pi-sylo/.cursor/skills/reference-notes',
        agentDir,
        piCwd,
      ),
      false,
    )
    assert.equal(
      isSkillPathInOperatorScope(join(piCwd, '.cursor', 'skills', 'local'), agentDir, piCwd),
      false,
    )
  })

  it('allows workspace .cursor/skills when opted in', () => {
    const opts = { includeCursorSkills: true }
    assert.equal(
      isSkillPathInOperatorScope(join(piCwd, '.cursor', 'skills', 'local'), agentDir, piCwd, opts),
      true,
    )
    assert.equal(
      isSkillPathInOperatorScope(
        'C:/Users/op/Documents/GitHub/pi-sylo/.cursor/skills/reference-notes',
        agentDir,
        piCwd,
        opts,
      ),
      false,
    )
  })

  it('allows npm/git package skill paths', () => {
    assert.equal(
      isSkillPathInOperatorScope(
        join(agentDir, 'npm', 'node_modules', 'pi-subagents', 'skills', 'librarian'),
        agentDir,
        piCwd,
      ),
      true,
    )
  })
})
