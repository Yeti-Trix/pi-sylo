import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  isSkillVisibleForOptionalPackages,
  isSyloOptionalPackageEnabled,
  normalizeSyloOptionalPackagesPref,
  findSyloOptionalPackage,
  SYLO_OPTIONAL_PACKAGES,
} from './sylo-optional-packages.ts'
import { enabledOptionalExtensionPaths } from '../main/sylo-optional-packages-host.ts'

// src/shared and the bundled out/test copy both sit 4 levels under the repo root.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

const CORE_IDS = ['sylo-terminal-bridge', 'sylo-tasks', 'sylo-workflows', 'sylo-chat-export', 'sylo-coder']

describe('normalizeSyloOptionalPackagesPref', () => {
  it('keeps only known package ids', () => {
    assert.deepEqual(
      normalizeSyloOptionalPackagesPref({
        'sylo-tts': true,
        unknown: true,
        bad: 'yes',
      }),
      { 'sylo-tts': true },
    )
  })

  it('drops the legacy sylo-council pref now that think-tank left the registry (issue #41)', () => {
    // The council → think-tank migration is retired: sylo-think-tank was
    // removed (replaced by subagent runs + the saved think-tank workflow),
    // so the legacy pref normalizes away via the known-id filter.
    assert.deepEqual(normalizeSyloOptionalPackagesPref({ 'sylo-council': true }), {})
  })

  it('drops the legacy sylo-schematic-reader pref now that sylo-pdf-reader left the registry', () => {
    // The schematic-reader migration (kept intact, C4 / issue #39) resolves to
    // sylo-pdf-reader, which is no longer a known id — it normalizes away.
    assert.deepEqual(normalizeSyloOptionalPackagesPref({ 'sylo-schematic-reader': true }), {})
  })

  it('drops the legacy sylo-web-access key now that web-access left the registry (issue #39 final pass)', () => {
    // sylo-web-access was extracted to the operator's personal repo
    // (~/Documents/GitHub/sylo-web-access); it installs via settings.json
    // `packages`, no longer through this registry, so stale toggle prefs for
    // the id normalize away below via the known-id filter.
    assert.deepEqual(
      normalizeSyloOptionalPackagesPref({ 'sylo-web-access': true, 'sylo-tts': true }),
      { 'sylo-tts': true },
    )
    assert.deepEqual(normalizeSyloOptionalPackagesPref({ 'sylo-web-access': false }), {})
  })

  it('returns empty for non-objects', () => {
    assert.deepEqual(normalizeSyloOptionalPackagesPref(null), {})
    assert.deepEqual(normalizeSyloOptionalPackagesPref([]), {})
  })
})

describe('core packages (issue #39)', () => {
  it('flags exactly the 5 expected entries as core', () => {
    assert.deepEqual(
      SYLO_OPTIONAL_PACKAGES.filter((p) => p.core).map((p) => p.id).sort(),
      [...CORE_IDS].sort(),
    )
  })

  it('toggles carry no core flag', () => {
    for (const id of ['sylo-tts', 'sylo-image-gen', 'sylo-video-gen']) {
      assert.equal(findSyloOptionalPackage(id)?.core, undefined)
    }
  })

  it('empty pref → core enabled + skills visible; toggles stay off', () => {
    for (const id of CORE_IDS) {
      assert.equal(isSyloOptionalPackageEnabled({}, id), true, id)
    }
    assert.equal(isSyloOptionalPackageEnabled({}, 'sylo-tts'), false)
    assert.equal(isSkillVisibleForOptionalPackages('tasks', {}), true)
    assert.equal(isSkillVisibleForOptionalPackages('sylo-workflows', {}), true)
    assert.equal(isSkillVisibleForOptionalPackages('chat-export', {}), true)
    assert.equal(isSkillVisibleForOptionalPackages('sylo-coder', {}), true)
    assert.equal(isSkillVisibleForOptionalPackages('tts', {}), false)
  })

  it('core packages ignore an explicit false pref', () => {
    const pref = { 'sylo-tasks': false, 'sylo-coder': false }
    assert.equal(isSyloOptionalPackageEnabled(pref, 'sylo-tasks'), true)
    assert.equal(isSkillVisibleForOptionalPackages('tasks', pref), true)
    assert.equal(isSkillVisibleForOptionalPackages('sylo-coder', pref), true)
  })

  it('toggles remain pref-gated', () => {
    assert.equal(isSkillVisibleForOptionalPackages('tts', { 'sylo-tts': true }), true)
    assert.equal(isSkillVisibleForOptionalPackages('tts', { 'sylo-tts': false }), false)
  })

  it('empty pref → enabledOptionalExtensionPaths includes core paths only', () => {
    const paths = enabledOptionalExtensionPaths(REPO_ROOT, {})
    for (const id of CORE_IDS) {
      const pkg = findSyloOptionalPackage(id)
      assert.ok(pkg, id)
      const rel = pkg.extensionRelPath.replace(/\\/g, '/')
      assert.ok(
        paths.some((p) => p.replace(/\\/g, '/').endsWith(rel)),
        `core path missing: ${rel}`,
      )
    }
    assert.ok(!paths.some((p) => p.includes('sylo-tts')), 'toggle must stay pref-gated')
    // Registry rows for the extracted packages are gone.
    assert.equal(findSyloOptionalPackage('sylo-pdf-reader'), undefined)
    assert.equal(findSyloOptionalPackage('sylo-docx'), undefined)
    assert.equal(findSyloOptionalPackage('sylo-spreadsheet'), undefined)
    assert.equal(findSyloOptionalPackage('sylo-web-access'), undefined)
    assert.ok(!paths.some((p) => p.includes('sylo-web-access')), 'extracted web-access path must not come from the registry')
  })
})

describe('isSkillVisibleForOptionalPackages', () => {
  it('blocks gated skills when package is off', async () => {
    assert.equal(isSkillVisibleForOptionalPackages('tts', {}), false)
    assert.equal(isSkillVisibleForOptionalPackages('tts', { 'sylo-tts': true }), true)
  })

  it('allows ungated skills', async () => {
    assert.equal(isSkillVisibleForOptionalPackages('sylo-skill-author', {}), true)
  })
})
