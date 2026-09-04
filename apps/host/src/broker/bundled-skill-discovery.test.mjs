/**
 * Run: npm run test:bundled-skills -w apps/host
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  discoverBundledSkillPathsFromExtensionPaths,
  discoverBundledSkillPathsFromPackageRoot,
  discoverBundledSkillPathsFromPiPackages,
  resolvePackageRootFromExtensionPath,
} from '../shared/bundled-skill-discovery.ts'

describe('discoverBundledSkillPathsFromPackageRoot', () => {
  test('finds SKILL.md under skills/<name>/', () => {
    const base = mkdtempSync(join(tmpdir(), 'sylo-skills-'))
    try {
      const skillDir = join(base, 'skills', 'librarian')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: librarian\n---\n')
      const found = discoverBundledSkillPathsFromPackageRoot(base)
      assert.equal(found.length, 1)
      assert.ok(found[0].endsWith('librarian\\SKILL.md') || found[0].endsWith('librarian/SKILL.md'))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test('returns empty when skills/ missing', () => {
    const base = mkdtempSync(join(tmpdir(), 'sylo-skills-empty-'))
    try {
      assert.deepEqual(discoverBundledSkillPathsFromPackageRoot(base), [])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('resolvePackageRootFromExtensionPath', () => {
  test('walks up from extension entry to package.json root', () => {
    const base = mkdtempSync(join(tmpdir(), 'sylo-pkg-root-'))
    try {
      writeFileSync(
        join(base, 'package.json'),
        JSON.stringify({ name: 'pi-web-access', version: '1.0.0' }),
      )
      const ext = join(base, 'index.ts')
      writeFileSync(ext, 'export default {}')
      assert.equal(resolvePackageRootFromExtensionPath(ext), base)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('discoverBundledSkillPathsFromExtensionPaths', () => {
  test('dedupes skills from multiple extension paths in same package', () => {
    const base = mkdtempSync(join(tmpdir(), 'sylo-skills-dedupe-'))
    try {
      writeFileSync(
        join(base, 'package.json'),
        JSON.stringify({ name: 'demo-pkg', version: '1.0.0' }),
      )
      const skillDir = join(base, 'skills', 'alpha')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: alpha\n---\n')
      const extA = join(base, 'index.ts')
      const extB = join(base, 'lib', 'index.ts')
      mkdirSync(join(base, 'lib'), { recursive: true })
      writeFileSync(extA, '')
      writeFileSync(extB, '')
      const found = discoverBundledSkillPathsFromExtensionPaths([extA, extB])
      assert.equal(found.length, 1)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('discoverBundledSkillPathsFromPiPackages', () => {
  test('reads npm: specs from agent settings.json', () => {
    const base = mkdtempSync(join(tmpdir(), 'sylo-pi-pkgs-'))
    const agentDir = join(base, 'agent')
    try {
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(
        join(agentDir, 'settings.json'),
        JSON.stringify({ packages: ['npm:demo-pkg'] }),
      )

      const prevAppData = process.env.APPDATA
      process.env.APPDATA = join(base, 'appdata')
      const globalPkg = join(process.env.APPDATA, 'npm', 'node_modules', 'demo-pkg')
      mkdirSync(globalPkg, { recursive: true })
      writeFileSync(
        join(globalPkg, 'package.json'),
        JSON.stringify({ name: 'demo-pkg', version: '1.0.0' }),
      )
      const globalSkillDir = join(globalPkg, 'skills', 'helper')
      mkdirSync(globalSkillDir, { recursive: true })
      writeFileSync(join(globalSkillDir, 'SKILL.md'), '---\nname: helper\n---\n')

      const found = discoverBundledSkillPathsFromPiPackages(agentDir, join(base, 'project'))
      assert.equal(found.length, 1)
      assert.ok(found[0].includes('helper'))

      process.env.APPDATA = prevAppData
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
