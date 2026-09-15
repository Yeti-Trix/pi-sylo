/**
 * Run: npm run test:skill-nav-layout -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DEFAULT_SKILL_NAV_LAYOUT,
  isPinnedKey,
  resolvePinnedNavEntries,
  skillRouteRowKey,
  tabNavKey,
  togglePinnedKey,
} from '../../../out/test/skill-nav-layout.mjs'

const routes = [
  { skillFolderName: 'sylo-tasks', routeId: 'dashboard', nav_section: 'domain', title: 'Tasks' },
  { skillFolderName: 'sylo-tts', routeId: 'voices', nav_section: 'tools', title: 'Voices' },
]

describe('togglePinnedKey', () => {
  test('pins then unpins a route key', () => {
    const key = skillRouteRowKey(routes[0])
    const pinned = togglePinnedKey(DEFAULT_SKILL_NAV_LAYOUT, key)
    assert.deepEqual(pinned.pinned, [key])
    assert.equal(isPinnedKey(pinned, key), true)
    const unpinned = togglePinnedKey(pinned, key)
    assert.deepEqual(unpinned.pinned, [])
  })

  test('ignores blank keys', () => {
    assert.equal(togglePinnedKey(DEFAULT_SKILL_NAV_LAYOUT, '  '), DEFAULT_SKILL_NAV_LAYOUT)
  })
})

describe('resolvePinnedNavEntries', () => {
  test('keeps pin order and drops missing keys', () => {
    const tasks = skillRouteRowKey(routes[0])
    const voices = skillRouteRowKey(routes[1])
    const schedules = tabNavKey('schedules')
    const entries = resolvePinnedNavEntries(
      [schedules, 'gone:route', voices, tasks],
      routes,
    )
    assert.deepEqual(
      entries.map((e) => e.key),
      [schedules, voices, tasks],
    )
    assert.equal(entries[0].kind, 'tab')
    assert.equal(entries[0].title, 'Schedules')
    assert.equal(entries[1].kind, 'route')
    assert.equal(entries[1].title, 'Voices')
  })
})
