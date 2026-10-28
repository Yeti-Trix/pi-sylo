/**
 * Run: npm run test:restart-badge -w apps/host
 * Requires out/test/restart-badge.mjs from esbuild bundle.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  coerceRestartBadge,
  emptyRestartBadge,
  mergeRestartBadge,
} from '../../out/test/restart-badge.mjs'

describe('coerceRestartBadge', () => {
  test('drops malformed input to the empty state', () => {
    assert.deepEqual(coerceRestartBadge(null), emptyRestartBadge())
    assert.deepEqual(coerceRestartBadge('nope'), emptyRestartBadge())
    assert.deepEqual(coerceRestartBadge({ required: true }), emptyRestartBadge())
    assert.deepEqual(coerceRestartBadge({ required: true, reason: '   ' }), emptyRestartBadge())
  })

  test('keeps a valid raise with sane fallbacks', () => {
    const s = coerceRestartBadge({ required: true, reason: 'main-process fix' })
    assert.equal(s.required, true)
    assert.equal(s.reason, 'main-process fix')
    assert.ok(typeof s.raisedAt === 'number' && Number.isFinite(s.raisedAt))
    assert.equal(s.source, null)
  })

  test('caps reason length and clamps bad timestamps', () => {
    const s = coerceRestartBadge({
      required: true,
      reason: 'x'.repeat(500),
      raisedAt: 'garbage',
      source: 'C:/Users/operator/Documents/GitHub/pi-sylo-dev',
    })
    assert.equal(s.reason.length, 300)
    assert.ok(typeof s.raisedAt === 'number' && Number.isFinite(s.raisedAt))
    assert.equal(s.source, 'C:/Users/operator/Documents/GitHub/pi-sylo-dev')
  })
})

describe('mergeRestartBadge', () => {
  test('latest reason wins, original raisedAt kept', () => {
    const first = { required: true, reason: 'fix A', raisedAt: 1_000, source: 'ws1' }
    const merged = mergeRestartBadge(first, {
      required: true,
      reason: 'fix B',
      raisedAt: 5_000,
      source: 'ws2',
    })
    assert.equal(merged.reason, 'fix B')
    assert.equal(merged.raisedAt, 1_000, 'badge keeps the original raise time')
    assert.equal(merged.source, 'ws2')
    assert.equal(merged.required, true)
  })
})