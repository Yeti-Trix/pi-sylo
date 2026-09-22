/**
 * Run: npm run test:tool-telemetry -w apps/host
 * Requires out/test/tool-telemetry.mjs from esbuild bundle.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  appendPersistedToolEvents,
  persistedToolEventsToJson,
  toolFlushDelayMs,
} from '../../out/test/tool-telemetry.mjs'

function row(ts, event) {
  return { ts, event }
}

describe('appendPersistedToolEvents', () => {
  test('merges a run of thinking deltas into the entry that opened it', () => {
    const entries = appendPersistedToolEvents(
      [],
      [
        row(100, { type: 'thinking_start' }),
        row(110, { type: 'thinking_delta', delta: 'Let', _textOffset: 0 }),
        row(120, { type: 'thinking_delta', delta: ' me', _textOffset: 0 }),
        row(130, { type: 'thinking_delta', delta: ' check', _textOffset: 0 }),
        row(140, { type: 'thinking_end' }),
      ],
    )

    assert.equal(entries.length, 3)
    assert.equal(entries[1].ts, 110, 'merged run keeps the opening timestamp')
    assert.equal(entries[1].event.delta, 'Let me check')
    assert.equal(entries[1].event._textOffset, 0, 'inline placement offset survives')
    assert.equal(entries[1].event._mergedDeltas, 3)
  })

  test('keeps separate thinking blocks apart', () => {
    const entries = appendPersistedToolEvents(
      [],
      [
        row(100, { type: 'thinking_delta', delta: 'first' }),
        row(110, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'grep' }),
        row(120, { type: 'thinking_delta', delta: 'second' }),
      ],
    )

    assert.equal(entries.length, 3)
    assert.equal(entries[0].event.delta, 'first')
    assert.equal(entries[2].event.delta, 'second')
  })

  test('merges across flush boundaries', () => {
    let entries = appendPersistedToolEvents([], [row(100, { type: 'thinking_delta', delta: 'a' })])
    entries = appendPersistedToolEvents(entries, [row(110, { type: 'thinking_delta', delta: 'b' })])

    assert.equal(entries.length, 1)
    assert.equal(entries[0].event.delta, 'ab')
  })

  test('trims oversized tool payloads but keeps the surrounding fields', () => {
    const entries = appendPersistedToolEvents(
      [],
      [
        row(100, {
          type: 'tool_execution_start',
          toolCallId: 't1',
          toolName: 'write',
          args: { path: 'C:\\big.txt', content: 'x'.repeat(200_000) },
        }),
      ],
    )

    assert.equal(entries[0].event.toolName, 'write')
    assert.equal(entries[0].event.args.path, 'C:\\big.txt')
    assert.ok(entries[0].event.args.content.length < 40_000)
    assert.match(entries[0].event.args.content, /Sylo trimmed/)
  })

  test('collapses the measured 50k-delta turn without losing reasoning text', () => {
    // Shape taken from a real 5.4 MB blob: 34 thinking blocks spanning 50,592 deltas
    // that together held ~159 KB of text. That is the workload that made long turns
    // unstable, and it is dominated by the repeated envelope, not the text.
    const blocks = 34
    const deltasPerBlock = 1488
    const raw = []
    let ts = 1000
    for (let b = 0; b < blocks; b++) {
      raw.push(row(ts++, { type: 'thinking_start' }))
      for (let i = 0; i < deltasPerBlock; i++) {
        raw.push(row(ts++, { type: 'thinking_delta', delta: 'abc', _textOffset: 0 }))
      }
      raw.push(row(ts++, { type: 'thinking_end' }))
    }

    const merged = appendPersistedToolEvents([], raw)
    const before = JSON.stringify(raw).length
    const after = persistedToolEventsToJson(merged).length

    // One entry per bracket plus one merged delta run per block.
    assert.equal(merged.length, blocks * 3)
    assert.ok(after < before / 20, `expected a 20x reduction, got ${before} -> ${after}`)

    const text = merged
      .filter((e) => e.event.type === 'thinking_delta')
      .map((e) => e.event.delta)
      .join('')
    assert.equal(text.length, blocks * deltasPerBlock * 3, 'no reasoning text is dropped')
  })
})

describe('persistedToolEventsToJson', () => {
  test('drops the oldest entries and records a marker past the blob ceiling', () => {
    const entries = []
    for (let i = 0; i < 400; i++) {
      entries.push(row(1000 + i, { type: 'tool_execution_end', toolCallId: `t${i}`, blob: 'y'.repeat(20_000) }))
    }
    const json = persistedToolEventsToJson(entries)
    assert.ok(json.length <= 2 * 1024 * 1024, `blob still ${json.length} chars`)

    const parsed = JSON.parse(json)
    assert.equal(parsed[0].event.type, 'sylo_telemetry_trimmed')
    assert.ok(parsed[0].event.droppedEntries > 0)
    // Newest telemetry is what the operator is looking at, so it must survive.
    assert.equal(parsed[parsed.length - 1].event.toolCallId, 't399')
  })

  test('carries over the start row of a tool call that has not ended', () => {
    // The operator is waiting on this subagent; without its start row the renderer
    // has no live run to draw and the turn looks idle.
    const entries = [
      row(500, { type: 'tool_execution_start', toolCallId: 'live', toolName: 'subagent' }),
    ]
    for (let i = 0; i < 400; i++) {
      entries.push(
        row(1000 + i, { type: 'tool_execution_end', toolCallId: `t${i}`, blob: 'y'.repeat(20_000) }),
      )
    }
    const parsed = JSON.parse(persistedToolEventsToJson(entries))
    const live = parsed.find((e) => e.event.toolCallId === 'live')
    assert.ok(live, 'start row for the in-flight call survived trimming')
    assert.equal(live.event.type, 'tool_execution_start')
    assert.ok(parsed[0].event.droppedEntries > 0, 'still reports what was dropped')
  })

  test('does not carry over a start whose call already ended', () => {
    const entries = [
      row(500, { type: 'tool_execution_start', toolCallId: 'done', toolName: 'subagent' }),
      row(600, { type: 'tool_execution_end', toolCallId: 'done', toolName: 'subagent' }),
    ]
    for (let i = 0; i < 400; i++) {
      entries.push(
        row(1000 + i, { type: 'tool_execution_end', toolCallId: `t${i}`, blob: 'y'.repeat(20_000) }),
      )
    }
    const parsed = JSON.parse(persistedToolEventsToJson(entries))
    assert.equal(
      parsed.filter((e) => e.event.type === 'tool_execution_start').length,
      0,
      'a finished call is ordinary history and can be trimmed',
    )
  })

  test('leaves a small blob untouched', () => {
    const entries = [row(100, { type: 'turn_start' })]
    assert.equal(persistedToolEventsToJson(entries), JSON.stringify(entries))
  })
})

describe('toolFlushDelayMs', () => {
  test('backs off once the blob is large', () => {
    assert.equal(toolFlushDelayMs(0), 1000)
    assert.equal(toolFlushDelayMs(1024 * 1024), 5000)
  })
})
