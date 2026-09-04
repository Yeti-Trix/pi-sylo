import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { filterSkillRoutesForSidebar } from './skill-routes.ts'

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

  it('does not gate skills that are not tied to optional packages', () => {
    const custom = { ...baseRoute, skillFolderName: 'my-app', skillDir: 'C:\\agent\\skills\\my-app' }
    const out = filterSkillRoutesForSidebar([custom], {
      optionalPackagesPref: {},
      disabledSkillPaths: [],
    })
    assert.equal(out.length, 1)
  })
})
