/**
 * Run: npm run test:perf-log -w apps/host
 *
 * Covers the perf ring buffer (cap, ordered retrieval, formatting) that backs
 * the Developer → Testing freeze-diagnostics panel (chat-switch + image-send
 * measurement, 2026-10-11 freeze report).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatPerfEntry, perfMark, perfNote, perfRecent } from '../../out/test/perf-log.mjs'

describe('perf ring buffer', () => {
  test('returns entries newest last with measured ms', () => {
    perfNote('test.scope', 'note detail')
    perfMark('test.scope2', 'mark detail', 42)
    const recent = perfRecent(10)
    assert.ok(recent.length >= 2)
    const last = recent[recent.length - 1]
    assert.equal(last.scope, 'test.scope2')
    assert.equal(last.ms, 42)
    const prev = recent[recent.length - 2]
    assert.equal(prev.detail, 'note detail')
    assert.equal(prev.ms, undefined)
  })

  test('perfRecent(limit) truncates to the last N', () => {
    for (let i = 0; i < 12; i++) perfMark('test.limit', `entry ${i}`, i)
    const last3 = perfRecent(3)
    assert.equal(last3.length, 3)
    assert.match(last3[2].detail, /entry 11$/)
  })

  test('ring buffer caps at 200 entries', () => {
    for (let i = 0; i < 230; i++) perfMark('test.cap', `cap ${i}`, i)
    const all = perfRecent(1000)
    // Cap is internal; what matters is entries never exceed it and the latest survive.
    assert.ok(all.length <= 200)
    assert.match(all[all.length - 1].detail, /cap 229$/)
  })

  test('formatPerfEntry renders scope, ms and detail', () => {
    const s = formatPerfEntry({ at: Date.now(), scope: 'chat.load', detail: '120 rows, 300KB', ms: 37 })
    assert.match(s, /chat\.load/)
    assert.match(s, /37ms/)
    assert.match(s, /120 rows, 300KB/)
  })
})