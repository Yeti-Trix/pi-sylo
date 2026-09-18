// Unit tests for local custom-tools export/import (functionality only, no data).
// Run: npm run test:custom-tools-pack -w apps/host
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectExportFiles,
  extractCustomToolsZip,
  formatExportDate,
  importCustomToolsFromZip,
  listCustomToolPackages,
  readCustomToolsManifest,
  registerCustomToolPackage,
  resolveCustomToolsRoot,
  shouldSkipRel,
  suggestedExportFileName,
  writeCustomToolsZip,
  ensureLocalPackageSkillsInstalled,
} from './custom-tools-pack.ts'
import { writeZipBuffer } from './custom-tools-zip.ts'
import { discoverSkillRoutes } from './skill-routes.ts'

function scratch(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writePkg(dir, manifest, files = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8')
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'))
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body, 'utf8')
  }
}

test('formatExportDate is MM-DD-YYYY', () => {
  assert.equal(formatExportDate(new Date(2026, 8, 18)), '09-18-2026')
})

test('suggestedExportFileName uses package id when exporting one', () => {
  assert.equal(suggestedExportFileName(['sylo-tools-onenote'], new Date(2026, 8, 18)), 'sylo-tools-onenote-09-18-2026.zip')
  assert.equal(suggestedExportFileName(['a', 'b'], new Date(2026, 8, 18)), 'sylo-custom-tools-09-18-2026.zip')
})

test('shouldSkipRel drops data, deps, and secrets', () => {
  assert.equal(shouldSkipRel('node_modules/foo/index.js'), true)
  assert.equal(shouldSkipRel('.sylo/health/data.db'), true)
  assert.equal(shouldSkipRel('.git/config'), true)
  assert.equal(shouldSkipRel('scripts/notes.db'), true)
  assert.equal(shouldSkipRel('.env'), true)
  assert.equal(shouldSkipRel('secrets.private.json'), true)
  assert.equal(shouldSkipRel('packages/sylo-forge/skills/forge/SKILL.md'), false)
  assert.equal(shouldSkipRel('ui/index.html'), false)
})

test('listCustomToolPackages reads Custom/ and ignores junk', () => {
  const repo = scratch('sylo-custom-list-')
  mkdirSync(join(repo, 'Custom', 'not-a-package'), { recursive: true })
  writePkg(join(repo, 'Custom', 'sylo-tools-onenote'), {
    name: 'sylo-tools-onenote',
    version: '1.2.3',
    description: 'notes',
  })
  writeFileSync(join(repo, 'Custom', 'readme.txt'), 'no', 'utf8')
  const listed = listCustomToolPackages(repo)
  assert.equal(resolveCustomToolsRoot(repo), join(repo, 'Custom'))
  assert.deepEqual(
    listed.map((p) => ({ id: p.id, version: p.version })),
    [{ id: 'sylo-tools-onenote', version: '1.2.3' }],
  )
  rmSync(repo, { recursive: true, force: true })
})

test('export zip omits data and import restores code + settings only', async () => {
  const srcRepo = scratch('sylo-custom-src-')
  const destRepo = scratch('sylo-custom-dest-')
  const agent = scratch('sylo-custom-agent-')
  const staging = scratch('sylo-custom-stage-')
  const zipDir = scratch('sylo-custom-zip-')
  writePkg(
    join(srcRepo, 'Custom', 'sylo-tools-demo'),
    { name: 'sylo-tools-demo', version: '0.1.0', description: 'demo tools' },
    {
      'skills/demo/SKILL.md':
        '---\nname: demo\nroutes:\n  - id: demo\n    title: Demo board\n    nav_section: domain\n    entry: routes/demo/index.html\n    fallback: routes/demo/fallback.md\n---\n# Demo\n',
      'skills/demo/routes/demo/index.html': '<html><body>demo</body></html>',
      'skills/demo/routes/demo/fallback.md': 'fallback',
      'extensions/index.ts': 'export {}\n',
    },
  )
  mkdirSync(join(srcRepo, 'Custom', 'sylo-tools-demo', 'node_modules', 'leftpad'), { recursive: true })
  writeFileSync(join(srcRepo, 'Custom', 'sylo-tools-demo', 'node_modules', 'leftpad', 'index.js'), 'nope', 'utf8')
  mkdirSync(join(srcRepo, 'Custom', 'sylo-tools-demo', '.sylo'), { recursive: true })
  writeFileSync(join(srcRepo, 'Custom', 'sylo-tools-demo', '.sylo', 'saved.json'), '{"secret":1}', 'utf8')
  writeFileSync(join(srcRepo, 'Custom', 'sylo-tools-demo', 'cache.db'), 'sqlite', 'utf8')

  const exportedRels = collectExportFiles(join(srcRepo, 'Custom', 'sylo-tools-demo')).map((f) => f.rel)
  assert.ok(exportedRels.includes('skills/demo/SKILL.md'))
  assert.ok(!exportedRels.some((r) => r.includes('node_modules')))
  assert.ok(!exportedRels.some((r) => r.includes('.sylo')))
  assert.ok(!exportedRels.some((r) => r.endsWith('.db')))

  const zipPath = join(zipDir, 'pack.zip')
  const written = writeCustomToolsZip({ repoRoot: srcRepo, destZip: zipPath })
  assert.equal(written.ok, true)
  const man = readCustomToolsManifest(zipPath)
  assert.equal(man.ok, true)
  if (man.ok) assert.equal(man.manifest.packages[0].id, 'sylo-tools-demo')

  const extracted = join(staging, 'peek')
  const peek = extractCustomToolsZip(zipPath, extracted)
  assert.equal(peek.ok, true)
  assert.equal(existsSync(join(extracted, 'packages', 'sylo-tools-demo', 'node_modules')), false)

  const surfaceDest = join(destRepo, 'apps', 'host', 'test-fixtures', 'skill-surface')
  const imported = await importCustomToolsFromZip({
    repoRoot: destRepo,
    agentDir: agent,
    zipPath,
    stagingDir: join(staging, 'work'),
    installDeps: false,
    surfaceDests: [surfaceDest],
  })
  assert.equal(imported.ok, true)
  if (!imported.ok) throw new Error(imported.error)
  assert.equal(imported.imported[0].id, 'sylo-tools-demo')
  assert.deepEqual(imported.skillsCopied, ['demo'])
  const destPkg = join(destRepo, 'Custom', 'sylo-tools-demo')
  assert.match(readFileSync(join(destPkg, 'skills', 'demo', 'SKILL.md'), 'utf8'), /Demo board/)
  assert.equal(existsSync(join(agent, 'skills', 'demo', 'SKILL.md')), true)
  assert.equal(existsSync(join(surfaceDest, 'routes', 'demo', 'demo', 'index.html')), true)
  const routes = discoverSkillRoutes(agent)
  assert.equal(routes.some((r) => r.skillFolderName === 'demo' && r.nav_section === 'domain'), true)
  assert.equal(existsSync(join(destPkg, '.sylo')), false)
  assert.equal(existsSync(join(destPkg, 'cache.db')), false)
  const settings = JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf8'))
  assert.ok(settings.packages.some((p) => String(p).replace(/\\/g, '/').endsWith('/Custom/sylo-tools-demo')))

  const again = registerCustomToolPackage(agent, destPkg)
  assert.deepEqual(again, [])
  const settings2 = JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf8'))
  assert.equal(settings2.packages.length, settings.packages.length)

  rmSync(srcRepo, { recursive: true, force: true })
  rmSync(destRepo, { recursive: true, force: true })
  rmSync(agent, { recursive: true, force: true })
  rmSync(staging, { recursive: true, force: true })
  rmSync(zipDir, { recursive: true, force: true })
})

test('ensureLocalPackageSkillsInstalled copies missing agent skills only', () => {
  const root = scratch('sylo-custom-ensure-')
  const agent = join(root, 'agent')
  const pkg = join(root, 'Custom', 'sylo-tools-demo')
  writePkg(pkg, { name: 'sylo-tools-demo' }, { 'skills/plant/SKILL.md': '---\nname: plant\n---\n' })
  mkdirSync(agent, { recursive: true })
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [pkg] }), 'utf8')
  const first = ensureLocalPackageSkillsInstalled(agent)
  assert.deepEqual(first, ['plant'])
  writeFileSync(join(agent, 'skills', 'plant', 'SKILL.md'), 'keep-operator-copy', 'utf8')
  const second = ensureLocalPackageSkillsInstalled(agent)
  assert.deepEqual(second, [])
  assert.equal(readFileSync(join(agent, 'skills', 'plant', 'SKILL.md'), 'utf8'), 'keep-operator-copy')
  rmSync(root, { recursive: true, force: true })
})

test('extract rejects path traversal and non-zip files', () => {
  const dir = scratch('sylo-custom-trav-')
  writePkg(join(dir, 'Custom', 'ok-pkg'), { name: 'ok-pkg', version: '1.0.0' }, { 'a.txt': 'a' })
  const goodZip = join(dir, 'good.zip')
  assert.equal(writeCustomToolsZip({ repoRoot: dir, destZip: goodZip }).ok, true)

  const badZip = join(dir, 'trav.zip')
  writeFileSync(
    badZip,
    writeZipBuffer([
      {
        name: 'sylo-custom-tools.json',
        data: Buffer.from(
          JSON.stringify({
            kind: 'sylo-custom-tools',
            v: 1,
            exportedAt: '09-18-2026',
            packages: [{ id: 'ok-pkg', name: 'ok-pkg', version: '1.0.0', description: null }],
          }),
        ),
      },
      { name: 'packages/../evil.txt', data: Buffer.from('nope') },
    ]),
  )
  const extracted = extractCustomToolsZip(badZip, join(dir, 'out'))
  assert.equal(extracted.ok, false)
  assert.equal(existsSync(join(dir, 'evil.txt')), false)

  const r = readCustomToolsManifest(join(dir, 'missing.zip'))
  writeFileSync(join(dir, 'empty.zip'), 'not-a-zip')
  assert.equal(readCustomToolsManifest(join(dir, 'empty.zip')).ok, false)
  assert.equal(r.ok, false)
  rmSync(dir, { recursive: true, force: true })
})
