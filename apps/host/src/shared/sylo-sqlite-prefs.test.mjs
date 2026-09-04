/**
 * Run: npm run test:sylo-sqlite-prefs -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveSyloSqlitePathForTest } from '../shared/sylo-sqlite-prefs.ts'

describe('resolveSyloSqlitePathForTest', () => {
  test('accepts direct sqlite file path', () => {
    assert.equal(
      resolveSyloSqlitePathForTest('C:/appdata/sylo-data/sylo.sqlite'),
      'C:/appdata/sylo-data/sylo.sqlite',
    )
  })

  test('expands userData root to sylo-data/sylo.sqlite', () => {
    assert.equal(
      resolveSyloSqlitePathForTest('C:/appdata/host')!.replace(/\\/g, '/'),
      'C:/appdata/host/sylo-data/sylo.sqlite',
    )
  })
})
