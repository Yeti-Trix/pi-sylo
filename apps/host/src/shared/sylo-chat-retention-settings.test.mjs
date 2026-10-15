/**
 * Run: npm run test:chat-retention -w apps/host
 *
 * Covers the shared chat-retention settings helpers (pref keys, default,
 * bounds, normalization) used by both the main-process startup sweep and the
 * Settings → General → Inactive chats card.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  MS_PER_DAY,
  SYLO_RETENTION_AUTO_ARCHIVE_PREF,
  SYLO_RETENTION_DAYS_PREF,
  clampRetentionDays,
  normalizeAutoArchiveEnabled,
  normalizeRetentionDays,
} from '../../out/test/sylo-chat-retention-settings.mjs'

describe('pref keys and defaults', () => {
  test('stable keys and the 30-day default', () => {
    assert.equal(SYLO_RETENTION_AUTO_ARCHIVE_PREF, 'sylo.retention.auto_archive')
    assert.equal(SYLO_RETENTION_DAYS_PREF, 'sylo.retention.days')
    assert.equal(DEFAULT_RETENTION_DAYS, 30)
    assert.equal(MS_PER_DAY, 24 * 60 * 60 * 1000)
  })
})

describe('clampRetentionDays', () => {
  test('accepts numbers and numeric strings, rounding fractions', () => {
    assert.equal(clampRetentionDays(45), 45)
    assert.equal(clampRetentionDays('45'), 45)
    assert.equal(clampRetentionDays(29.6), 30)
  })
  test('clamps to bounds', () => {
    assert.equal(clampRetentionDays(0), MIN_RETENTION_DAYS)
    assert.equal(clampRetentionDays(-10), MIN_RETENTION_DAYS)
    assert.equal(clampRetentionDays(99999), MAX_RETENTION_DAYS)
  })
  test('garbage falls back to the default', () => {
    assert.equal(clampRetentionDays(undefined), DEFAULT_RETENTION_DAYS)
    assert.equal(clampRetentionDays(null), DEFAULT_RETENTION_DAYS)
    assert.equal(clampRetentionDays('abc'), DEFAULT_RETENTION_DAYS)
  })
})

describe('normalizeRetentionDays', () => {
  test('valid numbers and numeric strings clamp through', () => {
    assert.equal(normalizeRetentionDays(60), 60)
    assert.equal(normalizeRetentionDays('60'), 60)
    assert.equal(normalizeRetentionDays(0), MIN_RETENTION_DAYS)
    assert.equal(normalizeRetentionDays(100000), MAX_RETENTION_DAYS)
  })
  test('unusable values return null so callers fall back to the default', () => {
    assert.equal(normalizeRetentionDays(undefined), null)
    assert.equal(normalizeRetentionDays(null), null)
    assert.equal(normalizeRetentionDays('abc'), null)
    assert.equal(normalizeRetentionDays({}), null)
    assert.equal(normalizeRetentionDays(true), null)
  })
})

describe('normalizeAutoArchiveEnabled', () => {
  test('literal booleans pass through', () => {
    assert.equal(normalizeAutoArchiveEnabled(true), true)
    assert.equal(normalizeAutoArchiveEnabled(false), false)
  })
  test('anything else is null so callers fall back to enabled', () => {
    assert.equal(normalizeAutoArchiveEnabled(undefined), null)
    assert.equal(normalizeAutoArchiveEnabled(null), null)
    assert.equal(normalizeAutoArchiveEnabled('no'), null)
    assert.equal(normalizeAutoArchiveEnabled(1), null)
  })
})