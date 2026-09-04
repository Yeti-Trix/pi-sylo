import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeSyloOptionalPackagesPref } from './sylo-optional-packages.ts'

describe('normalizeSyloOptionalPackagesPref', () => {
  it('keeps only known package ids', () => {
    assert.deepEqual(
      normalizeSyloOptionalPackagesPref({
        'sylo-pdf-reader': true,
        unknown: true,
        bad: 'yes',
      }),
      { 'sylo-pdf-reader': true },
    )
  })

  it('migrates legacy sylo-schematic-reader pref to sylo-pdf-reader', () => {
    assert.deepEqual(
      normalizeSyloOptionalPackagesPref({ 'sylo-schematic-reader': true }),
      { 'sylo-pdf-reader': true },
    )
  })

  it('returns empty for non-objects', () => {
    assert.deepEqual(normalizeSyloOptionalPackagesPref(null), {})
    assert.deepEqual(normalizeSyloOptionalPackagesPref([]), {})
  })
})

describe('isSkillVisibleForOptionalPackages', () => {
  it('blocks gated skills when package is off', async () => {
    const { isSkillVisibleForOptionalPackages } = await import('./sylo-optional-packages.ts')
    assert.equal(isSkillVisibleForOptionalPackages('tts', {}), false)
    assert.equal(isSkillVisibleForOptionalPackages('tts', { 'sylo-tts': true }), true)
  })

  it('allows ungated skills', async () => {
    const { isSkillVisibleForOptionalPackages } = await import('./sylo-optional-packages.ts')
    assert.equal(isSkillVisibleForOptionalPackages('sylo-skill-author', {}), true)
  })
})
