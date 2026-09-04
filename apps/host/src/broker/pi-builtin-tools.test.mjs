/**
 * Run: npm run test:pi-builtin-tools -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { defaultPiBuiltinToolsPref } from '../shared/pi-builtin-tools.ts'
import {
  resolvePiBuiltinToolsSessionOptions,
  resolveSyloActiveToolNames,
} from '../shared/pi-builtin-tools-broker.ts'
import { makeSyloDisabledToolKey, normalizeSyloCapabilityPath } from '../shared/sylo-capability-paths.ts'

describe('resolvePiBuiltinToolsSessionOptions', () => {
  test('does not pass Pi tools allowlist when builtins enabled (would drop extension tools)', () => {
    const pref = defaultPiBuiltinToolsPref()
    assert.deepEqual(resolvePiBuiltinToolsSessionOptions(pref), {})
    assert.ok(!('tools' in resolvePiBuiltinToolsSessionOptions(pref)))
  })

  test('uses noTools builtin when master switch off', () => {
    const pref = { ...defaultPiBuiltinToolsPref(), enabled: false }
    assert.deepEqual(resolvePiBuiltinToolsSessionOptions(pref), { noTools: 'builtin' })
  })

  test('uses noTools all when chat only', () => {
    const pref = defaultPiBuiltinToolsPref()
    assert.deepEqual(resolvePiBuiltinToolsSessionOptions(pref, true), { noTools: 'all' })
  })
})

describe('resolveSyloActiveToolNames', () => {
  test('includes enabled builtins and non-disabled extension tools', () => {
    const pref = defaultPiBuiltinToolsPref()
    const tools = [
      { name: 'read', sourceInfo: { source: 'builtin', path: '<builtin:read>' } },
      { name: 'web_search', sourceInfo: { source: 'extension', path: 'C:/npm/pi-web-access/index.ts' } },
      { name: 'fetch_content', sourceInfo: { source: 'extension', path: 'C:/npm/pi-web-access/index.ts' } },
    ]
    const active = resolveSyloActiveToolNames(pref, tools, new Set(), new Set())
    assert.ok(active.includes('read'))
    assert.ok(active.includes('web_search'))
    assert.ok(active.includes('fetch_content'))
    assert.ok(active.includes('grep'))
  })

  test('honors disabled extension paths and per-tool keys', () => {
    const pref = defaultPiBuiltinToolsPref()
    const extPath = normalizeSyloCapabilityPath('C:/npm/pi-web-access/index.ts')
    const tools = [
      { name: 'web_search', sourceInfo: { source: 'extension', path: extPath } },
      { name: 'fetch_content', sourceInfo: { source: 'extension', path: extPath } },
    ]
    const byExtension = resolveSyloActiveToolNames(pref, tools, new Set([extPath]), new Set())
    assert.deepEqual(byExtension, ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'])

    const byTool = resolveSyloActiveToolNames(
      pref,
      tools,
      new Set(),
      new Set([makeSyloDisabledToolKey(extPath, 'web_search')]),
    )
    assert.ok(byTool.includes('fetch_content'))
    assert.ok(!byTool.includes('web_search'))
  })
})
