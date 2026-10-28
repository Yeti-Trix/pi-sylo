import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { discoverSkillRoutes, filterSkillRoutesForSidebar } from './skill-routes.ts'

const baseRoute = {
  skillName: 'web-access',
  skillFolderName: 'web-access',
  skillDir: 'C:\\agent\\skills\\nutrition',
  routeId: 'webaccess',
  title: 'Web access',
  entry: 'routes/web-access/index.html',
  fallback: 'routes/web-access/fallback.md',
  nav_section: 'domain',
  fixturePath: '/skill-surface/routes/web-access/webaccess/index.html',
}

// sylo-tts stays a visible optional-package toggle (issue #39); the pref-gating
// tests use it instead of web-access so they keep passing after the web-access
// extraction pass.
const ttsRoute = { ...baseRoute, skillName: 'tts', skillFolderName: 'tts', routeId: 'tts', title: 'Speech' }

// Core packages (issue #39) are always visible regardless of prefs.
const tasksRoute = {
  ...baseRoute,
  skillName: 'tasks',
  skillFolderName: 'tasks',
  routeId: 'tasks',
  title: 'Tasks',
}

describe('filterSkillRoutesForSidebar', () => {
  it('shows core-package routes even with an empty pref (issue #39)', () => {
    const out = filterSkillRoutesForSidebar([tasksRoute], {
      optionalPackagesPref: {},
      disabledSkillPaths: [],
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].routeId, 'tasks')
  })

  it('hides core-package routes only when the skill dir is excluded', () => {
    const out = filterSkillRoutesForSidebar([tasksRoute], {
      optionalPackagesPref: { 'sylo-tasks': false },
      disabledSkillPaths: [tasksRoute.skillDir],
    })
    assert.equal(out.length, 0)
  })

  it('hides routes when optional package is off', () => {
    const out = filterSkillRoutesForSidebar([ttsRoute], {
      optionalPackagesPref: { 'sylo-tts': false },
      disabledSkillPaths: [],
    })
    assert.equal(out.length, 0)
  })

  it('shows routes when optional package is on', () => {
    const out = filterSkillRoutesForSidebar([ttsRoute], {
      optionalPackagesPref: { 'sylo-tts': true },
      disabledSkillPaths: [],
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].routeId, 'tts')
  })

  it('hides routes when skill is excluded from agent', () => {
    const out = filterSkillRoutesForSidebar([ttsRoute], {
      optionalPackagesPref: { 'sylo-tts': true },
      disabledSkillPaths: ['C:\\agent\\skills\\nutrition'],
    })
    assert.equal(out.length, 0)
  })

  it('discovers routes from local-path packages when agent/skills is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'sylo-routes-local-'))
    const agent = join(root, 'agent')
    const pkg = join(root, 'Custom', 'sylo-tools-demo', 'packages', 'sylo-demo')
    const skill = join(pkg, 'skills', 'plant-board')
    mkdirSync(join(skill, 'routes', 'board'), { recursive: true })
    writeFileSync(
      join(skill, 'SKILL.md'),
      '---\nname: plant-board\nroutes:\n  - id: board\n    title: Plant\n    nav_section: domain\n    entry: routes/board/index.html\n    fallback: routes/board/fallback.md\n---\n',
    )
    writeFileSync(join(skill, 'routes', 'board', 'index.html'), '<html></html>')
    writeFileSync(join(skill, 'routes', 'board', 'fallback.md'), 'x')
    mkdirSync(agent, { recursive: true })
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [pkg] }), 'utf8')
    try {
      const found = discoverSkillRoutes(agent)
      assert.equal(found.length, 1)
      assert.equal(found[0].skillFolderName, 'plant-board')
      assert.equal(found[0].nav_section, 'domain')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not gate skills that are not tied to optional packages', () => {
    const custom = { ...baseRoute, skillFolderName: 'my-app', skillDir: 'C:\\agent\\skills\\my-app' }
    const out = filterSkillRoutesForSidebar([custom], {
      optionalPackagesPref: {},
      disabledSkillPaths: [],
    })
    assert.equal(out.length, 1)
  })
})
