/**
 * Run: npm run test:concurrent-pool -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  clampMaxConcurrentTurns,
  DEFAULT_MAX_CONCURRENT_TURNS,
  MAX_CONCURRENT_TURNS_LIMIT,
  MIN_CONCURRENT_TURNS,
} from '../../out/test/concurrent-turns.mjs'
import { TurnBrokerPool } from '../../out/test/concurrent-broker-pool.mjs'

describe('clampMaxConcurrentTurns', () => {
  test('bounds are sane', () => {
    assert.equal(MIN_CONCURRENT_TURNS, 1)
    assert.ok(MAX_CONCURRENT_TURNS_LIMIT > DEFAULT_MAX_CONCURRENT_TURNS)
  })

  test('garbage falls back to the default', () => {
    assert.equal(clampMaxConcurrentTurns(undefined), DEFAULT_MAX_CONCURRENT_TURNS)
    assert.equal(clampMaxConcurrentTurns(null), DEFAULT_MAX_CONCURRENT_TURNS)
    assert.equal(clampMaxConcurrentTurns(''), DEFAULT_MAX_CONCURRENT_TURNS)
    assert.equal(clampMaxConcurrentTurns('abc'), DEFAULT_MAX_CONCURRENT_TURNS)
    assert.equal(clampMaxConcurrentTurns(Number.NaN), DEFAULT_MAX_CONCURRENT_TURNS)
  })

  test('clamps out-of-range values into [1, 16]', () => {
    assert.equal(clampMaxConcurrentTurns(0), MIN_CONCURRENT_TURNS)
    assert.equal(clampMaxConcurrentTurns(-5), MIN_CONCURRENT_TURNS)
    assert.equal(clampMaxConcurrentTurns(999), MAX_CONCURRENT_TURNS_LIMIT)
    assert.equal(clampMaxConcurrentTurns('64'), MAX_CONCURRENT_TURNS_LIMIT)
  })

  test('keeps valid values and rounds floats', () => {
    assert.equal(clampMaxConcurrentTurns(1), 1)
    assert.equal(clampMaxConcurrentTurns(4), 4)
    assert.equal(clampMaxConcurrentTurns(8), 8)
    assert.equal(clampMaxConcurrentTurns(6.4), 6)
    assert.equal(clampMaxConcurrentTurns(' 7 '), 7)
  })
})

describe('TurnBrokerPool.maxConcurrent', () => {
  const pool = new TurnBrokerPool()

  test('disabled mode is always 1, whatever the configured max says', () => {
    assert.equal(pool.maxConcurrent(false), 1)
    assert.equal(pool.maxConcurrent(false, 12), 1)
    assert.equal(pool.maxConcurrent(false, 0), 1)
  })

  test('enabled mode uses the configured max, clamped', () => {
    assert.equal(pool.maxConcurrent(true), DEFAULT_MAX_CONCURRENT_TURNS)
    assert.equal(pool.maxConcurrent(true, 8), 8)
    assert.equal(pool.maxConcurrent(true, 100), MAX_CONCURRENT_TURNS_LIMIT)
    assert.equal(pool.maxConcurrent(true, 0), MIN_CONCURRENT_TURNS)
  })
})