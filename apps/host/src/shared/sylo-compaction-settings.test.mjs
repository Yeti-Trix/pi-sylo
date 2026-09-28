/**
 * Run: npm run test:compaction-settings -w apps/host
 *
 * Covers the per-model compaction trigger helpers and — against the real Pi
 * SettingsManager — the settings-view mutation the broker uses to apply an
 * operator override without a broker restart.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import {
  applyCompactionReserveToSettings,
  compactionModelKey,
  defaultCompactionTriggerPct,
  normalizeCompactionOverridePct,
  normalizeCompactionOverrides,
  PI_DEFAULT_COMPACTION_RESERVE_TOKENS,
  PI_FALLBACK_CONTEXT_WINDOW_TOKENS,
  reserveTokensForTriggerPct,
  resolveCompactionReserveTokens,
} from '../../out/test/sylo-compaction-settings.mjs'

describe('compaction model key', () => {
  test('provider + model id with the shared separator', () => {
    assert.equal(compactionModelKey('anthropic', 'claude-opus-4-6'), 'anthropic:claude-opus-4-6')
    // Empty provider (Pi default model) still yields a stable key.
    assert.equal(compactionModelKey('', 'some-model'), ':some-model')
  })
})

describe('normalizeCompactionOverridePct', () => {
  test('accepts percentages in (0, 100] and rounds to 2dp', () => {
    assert.equal(normalizeCompactionOverridePct(85), 85)
    assert.equal(normalizeCompactionOverridePct(91.808), 91.81)
    assert.equal(normalizeCompactionOverridePct(100), 100)
  })
  test('rejects non-numbers and out-of-range values', () => {
    assert.equal(normalizeCompactionOverridePct(0), null)
    assert.equal(normalizeCompactionOverridePct(-5), null)
    assert.equal(normalizeCompactionOverridePct(101), null)
    assert.equal(normalizeCompactionOverridePct('85'), null)
    assert.equal(normalizeCompactionOverridePct(Number.NaN), null)
    assert.equal(normalizeCompactionOverridePct(null), null)
  })
  test('normalizeCompactionOverrides drops invalid entries', () => {
    assert.deepEqual(
      normalizeCompactionOverrides({
        'a:m1': 80,
        'b:m2': 0,
        'c:m3': 'x',
        'd:m4': 150,
        'e:m5': 92.5,
      }),
      { 'a:m1': 80, 'e:m5': 92.5 },
    )
    assert.deepEqual(normalizeCompactionOverrides(null), {})
    assert.deepEqual(normalizeCompactionOverrides('nope'), {})
  })
})

describe('reserve math', () => {
  test('reserveTokensForTriggerPct — compact when context reaches pct% of the window', () => {
    assert.equal(reserveTokensForTriggerPct(200000, 91.8), 16400)
    assert.equal(reserveTokensForTriggerPct(200000, 50), 100000)
    assert.equal(reserveTokensForTriggerPct(200000, 100), 0)
    assert.equal(reserveTokensForTriggerPct(0, 50), 0)
  })
  test('defaultCompactionTriggerPct — Pi default reserve expressed as % of window', () => {
    // 200k window with 16,384 reserve → compact at ~91.8% full.
    assert.equal(defaultCompactionTriggerPct(200000).toFixed(3), '91.808')
    assert.equal(defaultCompactionTriggerPct(128000).toFixed(3), '87.200')
    // Degenerate tiny window clamps to 0 rather than going negative.
    assert.equal(defaultCompactionTriggerPct(16384), 0)
    assert.equal(defaultCompactionTriggerPct(0), 0)
  })
  test('PI_DEFAULT_COMPACTION_RESERVE_TOKENS matches Pi DEFAULT_COMPACTION_SETTINGS', () => {
    // Guards against a Pi default change silently desyncing the Sylo UI copy.
    assert.equal(PI_DEFAULT_COMPACTION_RESERVE_TOKENS, 16384)
    assert.equal(PI_FALLBACK_CONTEXT_WINDOW_TOKENS, 128000)
  })
})

describe('resolveCompactionReserveTokens', () => {
  test('no override → null (Pi default)', () => {
    assert.equal(resolveCompactionReserveTokens({}, 'anthropic', 'm', 200000), null)
  })
  test('override resolved against the declared context window', () => {
    assert.equal(
      resolveCompactionReserveTokens({ 'anthropic:m': 91.8 }, 'anthropic', 'm', 200000),
      16400,
    )
  })
  test('override with undeclared window uses Pi fallback window', () => {
    assert.equal(resolveCompactionReserveTokens({ 'anthropic:m': 87.2 }, 'anthropic', 'm', null), 16384)
    assert.equal(
      resolveCompactionReserveTokens({ 'anthropic:m': 50 }, 'anthropic', 'm', null),
      64000,
    )
  })
  test('invalid stored override → null', () => {
    assert.equal(resolveCompactionReserveTokens({ 'anthropic:m': 0 }, 'anthropic', 'm', 200000), null)
  })
})

describe('applyCompactionReserveToSettings (broker mechanism, real Pi SettingsManager)', () => {
  test('override takes effect live and null restores Pi default', () => {
    const mgr = SettingsManager.inMemory({})
    assert.equal(mgr.getCompactionSettings().reserveTokens, PI_DEFAULT_COMPACTION_RESERVE_TOKENS)

    applyCompactionReserveToSettings(mgr, 30000)
    assert.equal(mgr.getCompactionSettings().reserveTokens, 30000)

    applyCompactionReserveToSettings(mgr, null)
    assert.equal(mgr.getCompactionSettings().reserveTokens, PI_DEFAULT_COMPACTION_RESERVE_TOKENS)
  })

  test('preserves unrelated compaction keys and global settings', () => {
    const mgr = SettingsManager.inMemory({ compaction: { enabled: false }, theme: 'dark' })
    applyCompactionReserveToSettings(mgr, 40000)
    assert.equal(mgr.getCompactionSettings().reserveTokens, 40000)
    assert.equal(mgr.getCompactionSettings().enabled, false)
    assert.equal(mgr.getTheme(), 'dark')

    applyCompactionReserveToSettings(mgr, null)
    assert.equal(mgr.getCompactionSettings().enabled, false)
    assert.equal(mgr.getCompactionSettings().reserveTokens, PI_DEFAULT_COMPACTION_RESERVE_TOKENS)
  })

  test('tolerates a settings manager with no settings object', () => {
    assert.doesNotThrow(() => applyCompactionReserveToSettings(undefined, 123))
    assert.doesNotThrow(() => applyCompactionReserveToSettings({}, 123))
  })
})