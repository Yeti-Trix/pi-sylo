// Unit tests for the generic Sylo host-plugin loader (pi.sylo contract v1).
// Run: npm run test:personal-plugin (esbuild-bundles this file, then node --test).
// Fixtures are plain-JS ESM packages written into a temp agent dir — local-path
// (settings.json) and npm-installed (node_modules) shapes, plus the legacy
// name-gated personal bundle via SYLO_TOOLS_PERSONAL_DIR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  discoverHostPluginDirs,
  loadPersonalPlugin,
  personalPluginOps,
  personalPluginRpc,
  personalPluginSettingsCard,
  personalPluginCompanionManifest,
  __resetHostPluginsForTests,
} from './personal-plugin.ts'

function makeAgentDir() {
  return mkdtempSync(join(tmpdir(), 'sylo-host-plugins-'))
}

/** Write a minimal package: manifest + optional host entry (plain-JS ESM). */
function writePackage(root, rel, manifest, hostCode) {
  const dir = join(root, rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest), 'utf8')
  if (hostCode !== undefined) {
    mkdirSync(join(dir, 'host'), { recursive: true })
    writeFileSync(join(dir, 'host', 'index.js'), hostCode, 'utf8')
  }
  return dir
}

function saveLegacyEnv() {
  return process.env.SYLO_TOOLS_PERSONAL_DIR
}

function restoreLegacyEnv(old) {
  if (old === undefined) delete process.env.SYLO_TOOLS_PERSONAL_DIR
  else process.env.SYLO_TOOLS_PERSONAL_DIR = old
}

function mockDi(agentDir) {
  const roots = []
  return {
    roots,
    di: {
      dataDirOverride: () => null,
      dataRoot: () => '/data-root',
      hostAgentDir: () => agentDir,
      setPersonalAppRoot: (fn, pluginId) => roots.push({ id: pluginId, fn }),
    },
  }
}

test('discovery: manifest-driven from settings.json local paths + npm node_modules, legacy last', () => {
  const old = saveLegacyEnv()
  try {
    const agentDir = makeAgentDir()
    // settings.json local-path package declaring pi.sylo (id override in manifest).
    writePackage(agentDir, 'local-pkg', {
      name: 'local-pkg',
      'pi.sylo': { v: 1, host: './host/index.js', id: 'local-test' },
    })
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: ['./local-pkg'] }),
      'utf8',
    )
    // npm-installed sylo packages (one scoped) + a plain package without pi.sylo.
    writePackage(join(agentDir, 'npm', 'node_modules', 'sylo-fake'), '', {
      name: 'sylo-fake',
      'pi.sylo': { v: 1, host: './host/index.js' },
    })
    writePackage(join(agentDir, 'npm', 'node_modules', 'plain'), '', {
      name: 'plain',
      pi: { extensions: ['./ext.js'] },
    })
    writePackage(join(agentDir, 'npm', 'node_modules', '@scope', 'scoped'), '', {
      name: '@scope/scoped',
      'pi.sylo': { v: 1, host: './host/index.js' },
    })
    // Legacy bundle via env override (pre-contract shape: no pi.sylo block).
    const legacyDir = makeAgentDir()
    writePackage(legacyDir, '', { name: 'sylo-tools-personal' })
    process.env.SYLO_TOOLS_PERSONAL_DIR = legacyDir

    const candidates = discoverHostPluginDirs(agentDir)
    const ids = candidates.map((c) => c.id)
    assert.deepEqual(ids, ['local-test', '@scope/scoped', 'sylo-fake', 'personal'])
    assert.equal(candidates[0].legacy, false)
    assert.equal(candidates[3].legacy, true)
    // The plain npm package (no pi.sylo) must never be a host-plugin candidate.
    assert.ok(!ids.some((id) => id.includes('plain')))
    rmSync(agentDir, { recursive: true, force: true })
    rmSync(legacyDir, { recursive: true, force: true })
  } finally {
    restoreLegacyEnv(old)
  }
})

test('load: multi-plugin ops union, rpc routing (first-wins collisions), cards array, manifest merge, per-plugin app roots', async () => {
  const old = saveLegacyEnv()
  try {
    const agentDir = makeAgentDir()
    writePackage(
      agentDir,
      'local-pkg',
      { name: 'local-pkg', 'pi.sylo': { v: 1, host: './host/index.js', id: 'local-test' } },
      `export function createSyloHostPlugin(di) {
        di.setPersonalAppRoot(() => '/local-test-ui')
        return {
          ops: ['local.ping', 'shared.collide'],
          settingsCard: () => ({ title: 'Local card', prefKey: 'local.pref' }),
          companionManifest: () => ({ tabs: [{ id: 'main', label: 'Main' }] }),
          rpc: (op) => (op === 'local.ping' ? 'local-ok' : 'local-collide'),
        }
      }`,
    )
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: ['./local-pkg'] }),
      'utf8',
    )
    writePackage(
      join(agentDir, 'npm', 'node_modules', 'sylo-fake'),
      '',
      { name: 'sylo-fake', 'pi.sylo': { v: 1, host: './host/index.js' } },
      `export function createSyloHostPlugin() {
        return {
          ops: ['fake.ping', 'shared.collide'],
          settingsCard: () => null,
          companionManifest: () => ({ appBase: '/custom-base', tabs: [{ id: 'main', label: 'Fake' }] }),
          rpc: (op) => (op === 'fake.ping' ? 'fake-ok' : 'fake-collide'),
        }
      }`,
    )
    const legacyDir = makeAgentDir()
    writePackage(
      legacyDir,
      '',
      { name: 'sylo-tools-personal' },
      `export function createPersonalPlugin(di) {
        di.setPersonalAppRoot(() => '/legacy-ui')
        return {
          ops: ['personal.ping'],
          settingsCard: () => ({ title: 'Personal card', prefKey: 'personal.pref' }),
          companionManifest: () => ({
            appBase: '/personal-app',
            tabs: [{ id: 'health', label: 'Health' }],
            landing: { op: 'personal.landing', payload: {}, title: 'Personal', singleLabel: 'entry', countNoun: 'entries' },
          }),
          rpc: (op) => (op === 'personal.ping' ? 'personal-ok' : null),
        }
      }`,
    )
    process.env.SYLO_TOOLS_PERSONAL_DIR = legacyDir

    const { di, roots } = mockDi(agentDir)
    __resetHostPluginsForTests()
    const first = await loadPersonalPlugin(di)
    assert.equal(first?.id, 'local-test')

    // Ops: ordered union, first-wins dedupe of the colliding op.
    assert.deepEqual(await personalPluginOps(), [
      'local.ping',
      'shared.collide',
      'fake.ping',
      'personal.ping',
    ])

    // RPC routing: each op lands on its owning plugin; collision → first-loaded.
    assert.equal(await personalPluginRpc('local.ping', {}), 'local-ok')
    assert.equal(await personalPluginRpc('fake.ping', {}), 'fake-ok')
    assert.equal(await personalPluginRpc('personal.ping', {}), 'personal-ok')
    assert.equal(await personalPluginRpc('shared.collide', {}), 'local-collide')
    await assert.rejects(() => personalPluginRpc('totally.unknown', {}), /unknown_op/)

    // Settings cards: array of non-null configs in load order; null cards skipped.
    const cards = await personalPluginSettingsCard()
    assert.deepEqual(cards.map((c) => c.title), ['Local card', 'Personal card'])

    // Companion manifest: tabs merged, appBase injected per plugin, legacy base
    // honored, colliding tab id prefixed, landing from first declarer.
    const manifest = await personalPluginCompanionManifest()
    assert.deepEqual(
      manifest.tabs.map((t) => ({ id: t.id, appBase: t.appBase })),
      [
        { id: 'main', appBase: '/personal-app/local-test' },
        { id: 'sylo-fake:main', appBase: '/personal-app/sylo-fake' },
        { id: 'health', appBase: '/personal-app' },
      ],
    )
    assert.equal(manifest.appBase, '/personal-app/local-test')
    assert.equal(manifest.landing?.title, 'Personal')

    // App roots registered per plugin (scoped di), in load order.
    // (sylo-fake's fixture never registers one — optional per contract.)
    assert.deepEqual(
      roots.map((r) => r.id),
      ['local-test', 'personal'],
    )

    rmSync(agentDir, { recursive: true, force: true })
    rmSync(legacyDir, { recursive: true, force: true })
  } finally {
    restoreLegacyEnv(old)
    __resetHostPluginsForTests()
  }
})

test('isolation: a broken plugin never blocks the others', async () => {
  const old = saveLegacyEnv()
  try {
    const agentDir = makeAgentDir()
    // Broken: pi.sylo present but the entry exports no factory.
    writePackage(
      join(agentDir, 'npm', 'node_modules', 'sylo-broken'),
      '',
      { name: 'sylo-broken', 'pi.sylo': { v: 1, host: './host/index.js' } },
      `export const notAFactory = true`,
    )
    writePackage(
      join(agentDir, 'npm', 'node_modules', 'sylo-good'),
      '',
      { name: 'sylo-good', 'pi.sylo': { v: 1, host: './host/index.js' } },
      `export function createSyloHostPlugin() {
        return { ops: ['good.ping'], rpc: () => 'good-ok' }
      }`,
    )
    // Point legacy env at a dir WITHOUT host/index.js → legacy candidate skipped at load.
    const emptyLegacy = makeAgentDir()
    writePackage(emptyLegacy, '', { name: 'sylo-tools-personal' })
    process.env.SYLO_TOOLS_PERSONAL_DIR = emptyLegacy

    const { di } = mockDi(agentDir)
    __resetHostPluginsForTests()
    const first = await loadPersonalPlugin(di)
    assert.equal(first?.id, 'sylo-good')
    assert.deepEqual(await personalPluginOps(), ['good.ping'])
    assert.equal(await personalPluginRpc('good.ping', {}), 'good-ok')

    rmSync(agentDir, { recursive: true, force: true })
    rmSync(emptyLegacy, { recursive: true, force: true })
  } finally {
    restoreLegacyEnv(old)
    __resetHostPluginsForTests()
  }
})
test('inventory: listHostPluginPackages reports source, metadata, entry presence, loaded state', () => {
  const old = saveLegacyEnv()
  try {
    const { listHostPluginPackages } = require('./personal-plugin.ts')
    const agentDir = makeAgentDir()
    writePackage(
      agentDir,
      'local-pkg',
      {
        name: 'local-pkg',
        version: '1.2.3',
        description: 'A local host plugin',
        'pi.sylo': { v: 1, host: './host/index.js', id: 'local-test' },
      },
      `export function createSyloHostPlugin() { return { ops: ['x'] } }`,
    )
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: ['./local-pkg'] }),
      'utf8',
    )
    writePackage(join(agentDir, 'npm', 'node_modules', 'sylo-fake'), '', {
      name: 'sylo-fake',
      version: '0.9.0',
      description: 'An npm host plugin',
      'pi.sylo': { v: 1, host: './host/index.js' },
    })
    writePackage(join(agentDir, 'npm', 'node_modules', 'sylo-empty'), '', {
      name: 'sylo-empty',
      'pi.sylo': { v: 1, host: './host/index.js' },
    })
    const legacyDir = makeAgentDir()
    writePackage(legacyDir, '', { name: 'sylo-tools-personal', version: '2.0.0' })
    process.env.SYLO_TOOLS_PERSONAL_DIR = legacyDir

    const list = listHostPluginPackages(agentDir)
    const byId = new Map(list.map((p) => [p.id, p]))
    assert.deepEqual(
      list.map((p) => `${p.source}:${p.id}`),
      ['local:local-test', 'npm:sylo-empty', 'npm:sylo-fake', 'legacy:personal'],
    )
    const local = byId.get('local-test')
    assert.equal(local.version, '1.2.3')
    assert.equal(local.description, 'A local host plugin')
    assert.equal(local.entryPresent, true)
    assert.equal(local.loaded, false)
    assert.equal(byId.get('sylo-empty').entryPresent, false)
    assert.equal(byId.get('personal').source, 'legacy')

    rmSync(agentDir, { recursive: true, force: true })
    rmSync(legacyDir, { recursive: true, force: true })
  } finally {
    restoreLegacyEnv(old)
    __resetHostPluginsForTests()
  }
})
