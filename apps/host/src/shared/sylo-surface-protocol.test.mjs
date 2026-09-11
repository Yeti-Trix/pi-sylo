/**
 * Run: npm run test:sylo-surface-protocol -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  resolveWidgetFetchUrl,
  syloSurfaceRelativePath,
} from '../../out/test/sylo-surface-protocol.mjs'

const THINK_TANK = '/skill-surface/routes/think-tank/think-tank/index.html'

describe('resolveWidgetFetchUrl', () => {
  test('keeps http(s) origin-root paths on the dev server', () => {
    assert.equal(
      resolveWidgetFetchUrl(THINK_TANK, 'http://127.0.0.1:9240/'),
      'http://127.0.0.1:9240/skill-surface/routes/think-tank/think-tank/index.html',
    )
  })

  test('maps file:// renderer pages onto the skill-surface protocol', () => {
    const base = 'file:///D:/Program%20Repo/pi-sylo/apps/host/out/renderer/index.html'
    assert.equal(
      resolveWidgetFetchUrl(THINK_TANK, base),
      'sylo-surface://renderer/skill-surface/routes/think-tank/think-tank/index.html',
    )
  })

  test('ignores a hash on the compiled renderer URL', () => {
    const base = 'file:///D:/app/out/renderer/index.html#/think-tank'
    assert.equal(
      resolveWidgetFetchUrl(THINK_TANK, base),
      'sylo-surface://renderer/skill-surface/routes/think-tank/think-tank/index.html',
    )
  })

  test('passes through absolute http(s) URLs', () => {
    assert.equal(
      resolveWidgetFetchUrl('https://example.test/widget.html', 'file:///D:/x/index.html'),
      'https://example.test/widget.html',
    )
  })

  test('accepts paths without a leading slash', () => {
    assert.equal(
      resolveWidgetFetchUrl('skill-surface/smoke.html', 'http://127.0.0.1:9240/'),
      'http://127.0.0.1:9240/skill-surface/smoke.html',
    )
  })
})

describe('syloSurfaceRelativePath', () => {
  test('accepts a Think Tank fixture URL', () => {
    assert.equal(
      syloSurfaceRelativePath(
        'sylo-surface://renderer/skill-surface/routes/think-tank/think-tank/index.html',
      ),
      'skill-surface/routes/think-tank/think-tank/index.html',
    )
  })

  test('accepts a relative asset URL under the same route', () => {
    const html = 'sylo-surface://renderer/skill-surface/routes/think-tank/think-tank/index.html'
    const asset = new URL('./assets/index.js', html).href
    assert.equal(
      syloSurfaceRelativePath(asset),
      'skill-surface/routes/think-tank/think-tank/assets/index.js',
    )
  })

  test('rejects path traversal that normalizes outside skill-surface', () => {
    assert.equal(
      syloSurfaceRelativePath('sylo-surface://renderer/skill-surface/../../../etc/passwd'),
      null,
    )
  })

  test('rejects a different host or scheme', () => {
    assert.equal(syloSurfaceRelativePath('sylo-surface://other/skill-surface/smoke.html'), null)
    assert.equal(syloSurfaceRelativePath('file:///skill-surface/smoke.html'), null)
  })
})
