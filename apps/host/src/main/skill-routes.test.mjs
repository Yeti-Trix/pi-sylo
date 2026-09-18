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

describe('filterSkillRoutesForSidebar', () => {
  it('hides routes when optional package is off', () => {
    const out = filterSkillRoutesForSidebar([baseRoute], {
      optionalPackagesPref: { 'sylo-web-access': false },
      disabledSkillPaths: [],
    })
    assert.equal(out.length, 0)
  })

  it('shows routes when optional package is on', () => {
    const out = filterSkillRoutesForSidebar([baseRoute], {
      optionalPackagesPref: { 'sylo-web-access': true },
      disabledSkillPaths: [],
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].routeId, 'webaccess')
  })

  it('hides routes when skill is excluded from agent', () => {
    const out = filterSkillRoutesForSidebar([baseRoute], {
      optionalPackagesPref: { 'sylo-web-access': true },
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
