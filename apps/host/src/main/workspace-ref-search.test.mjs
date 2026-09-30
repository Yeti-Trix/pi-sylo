/**
 * Run: npm run test:workspace-refs -w apps/host
 *
 * Covers the @-reference workspace search (task 06): ranking, exclusions
 * (checkpoint-style skip dirs + big/binary files), folders vs files, caps.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { searchWorkspaceRefs } from '../../out/test/workspace-ref-search.mjs'

const root = join(tmpdir(), `sylo-ref-search-${Date.now()}`)

describe('workspace ref search', () => {
  test('ranks name matches over path matches, shallow over deep', () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'src', 'deep', 'folder'), { recursive: true })
    writeFileSync(join(root, 'src', 'parse.ts'), '1')
    writeFileSync(join(root, 'src', 'deep', 'folder', 'parsing-helper.ts'), '2')
    writeFileSync(join(root, 'parse.md'), '3')
    try {
      const hits = searchWorkspaceRefs(root, 'pars')
      assert.ok(hits.length >= 3)
      assert.equal(hits[0].kind, 'file')
      const paths = hits.map((h) => h.relativePath)
      assert.ok(paths.indexOf('src/parse.ts') < paths.indexOf('src/deep/folder/parsing-helper.ts'))
      // Name matches rank above path-only matches.
      const helperOnly = searchWorkspaceRefs(root, 'helper')
      assert.deepEqual(helperOnly.map((h) => h.relativePath), ['src/deep/folder/parsing-helper.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('skips node_modules/.git, big and binary files; includes folders', () => {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'pkg', 'readme.md'), 'x')
    writeFileSync(join(root, '.git', 'config'), 'y')
    writeFileSync(join(root, 'runme.exe'), Buffer.alloc(10))
    const big = Buffer.alloc(6 * 1024 * 1024)
    writeFileSync(join(root, 'huge.md'), big)
    mkdirSync(join(root, 'docs'), { recursive: true })
    try {
      const hits = searchWorkspaceRefs(root, '')
      assert.ok(!hits.some((h) => h.relativePath.includes('node_modules')))
      assert.ok(!hits.some((h) => h.relativePath.includes('.git')))
      assert.ok(!hits.some((h) => h.relativePath.endsWith('.exe')))
      assert.ok(!hits.some((h) => h.relativePath === 'huge.md'))
      assert.ok(hits.some((h) => h.kind === 'folder' && h.relativePath === 'docs'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})