/**
 * Run: npm run test:pinned-skills -w apps/host
 * Requires out/test/sylo-capability-paths.mjs from esbuild bundle.
 *
 * Covers which skills get inlined into the system prompt. This matters for cost: an
 * inlined SKILL.md is re-sent on every turn (web-access alone measures ~1,700 tokens),
 * while an unpinned skill costs only its one-line pointer.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  normalizeSkillCapabilityPath,
  normalizeSkillPathListForPolicyJson,
  selectPinnedSkills,
} from '../../out/test/sylo-capability-paths.mjs'

const skill = (name, filePath) => ({ name, filePath })

const SKILLS = [
  skill('web-access', 'C:/Users/me/.pi/agent/skills/web-access/SKILL.md'),
  skill('tasks', 'C:/Users/me/.pi/agent/skills/tasks/SKILL.md'),
  skill('think-tank', 'C:/Users/me/.pi/agent/skills/think-tank/SKILL.md'),
]

const pinSet = (paths) => new Set(normalizeSkillPathListForPolicyJson(paths))

describe('selectPinnedSkills', () => {
  test('pins nothing when the workspace has pinned nothing', () => {
    // The default. Previously web-access was inlined unconditionally, costing every
    // turn even for operators who never use it.
    assert.deepEqual(selectPinnedSkills(SKILLS, pinSet([])), [])
  })

  test('inlines only the pinned skill', () => {
    const picked = selectPinnedSkills(SKILLS, pinSet(['C:/Users/me/.pi/agent/skills/tasks']))
    assert.equal(picked.length, 1)
    assert.equal(picked[0].name, 'tasks')
  })

  test('matches whether the pin names the folder or the SKILL.md file', () => {
    // Pi reports skills either way, and the Capability Manager stores whatever it was given.
    const byFile = selectPinnedSkills(
      SKILLS,
      pinSet(['C:/Users/me/.pi/agent/skills/web-access/SKILL.md']),
    )
    const byDir = selectPinnedSkills(SKILLS, pinSet(['C:/Users/me/.pi/agent/skills/web-access']))
    assert.equal(byFile.length, 1)
    assert.deepEqual(
      byFile.map((s) => s.name),
      byDir.map((s) => s.name),
    )
  })

  test('ignores separator style, which differs between JSON storage and Pi', () => {
    const picked = selectPinnedSkills(
      SKILLS,
      pinSet(['C:\\Users\\me\\.pi\\agent\\skills\\think-tank']),
    )
    assert.equal(picked.length, 1)
    assert.equal(picked[0].name, 'think-tank')
  })

  test('matching is case-sensitive, so both sides must come from Pi discovery', () => {
    // Documents a real limit rather than asserting a fix: the shared normalizer cannot
    // case-fold, because skill paths on Linux/macOS are genuinely case-sensitive. Pins and
    // the broker's skill list both originate from Pi's discovery, so their casing agrees;
    // a hand-edited pin with different casing would silently not apply.
    const picked = selectPinnedSkills(
      SKILLS,
      pinSet(['c:\\users\\me\\.pi\\agent\\skills\\think-tank']),
    )
    assert.deepEqual(picked, [])
  })

  test('pinning several skills inlines exactly those', () => {
    const picked = selectPinnedSkills(
      SKILLS,
      pinSet([
        'C:/Users/me/.pi/agent/skills/tasks',
        'C:/Users/me/.pi/agent/skills/think-tank',
      ]),
    )
    assert.deepEqual(
      picked.map((s) => s.name).sort(),
      ['tasks', 'think-tank'],
    )
  })

  test('a pin for an uninstalled skill drops out instead of throwing', () => {
    assert.deepEqual(selectPinnedSkills(SKILLS, pinSet(['C:/Users/me/.pi/agent/skills/gone'])), [])
  })

  test('skills with no path are never inlined', () => {
    const nameless = [skill('mystery', undefined), skill('blank', '')]
    assert.deepEqual(selectPinnedSkills(nameless, pinSet(['C:/anything'])), [])
  })
})

describe('normalizeSkillPathListForPolicyJson', () => {
  test('dedupes folder and SKILL.md spellings of the same skill', () => {
    const norm = normalizeSkillPathListForPolicyJson([
      'C:/Users/me/.pi/agent/skills/tasks',
      'C:/Users/me/.pi/agent/skills/tasks/SKILL.md',
    ])
    assert.equal(norm.length, 1)
  })

  test('drops non-string entries rather than corrupting the set', () => {
    assert.deepEqual(normalizeSkillPathListForPolicyJson([null, 42, {}, '']), [])
  })

  test('produces keys that selectPinnedSkills can match', () => {
    const [key] = normalizeSkillPathListForPolicyJson([
      'C:/Users/me/.pi/agent/skills/web-access/SKILL.md',
    ])
    assert.equal(key, normalizeSkillCapabilityPath('C:/Users/me/.pi/agent/skills/web-access'))
  })
})
