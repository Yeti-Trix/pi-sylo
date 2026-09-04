/**
 * Run: npm run test:workflow-timing -w apps/host
 * Requires out/test/workflowTimeline.mjs from esbuild bundle.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  auditWorkflowTiming,
  buildAssistantSegments,
  collapseConsecutiveTimelineEvents,
  collapsedAssistantAnswerText,
  formatCollapsedTimelineLine,
  gapsForOrderedChatSegments,
  liveOpenChatGap,
} from '../../out/test/workflowTimeline.mjs'

function row(ts, event) {
  return { ts, event }
}

describe('auditWorkflowTiming', () => {
  test('reports user→assistant and assistant→first thinking gaps', () => {
    const userTs = 1_000
    const assistantTs = 1_050
    const entries = [
      row(1_400, { type: 'turn_start' }),
      row(1_500, { type: 'thinking_start' }),
      row(1_800, { type: 'thinking_delta', delta: 'hmm' }),
      row(2_000, { type: 'thinking_end' }),
    ]
    const audit = auditWorkflowTiming({
      assistantCreatedAt: assistantTs,
      precedingUserCreatedAt: userTs,
      entries,
    })
    const ids = audit.gaps.map((g) => g.id)
    assert.ok(ids.includes('user-to-assistant-row'))
    assert.ok(ids.includes('assistant-to-first-telemetry'))
    const userGap = audit.gaps.find((g) => g.id === 'user-to-assistant-row')
    assert.equal(userGap.ms, 50)
    const preThink = audit.gaps.find((g) => g.id === 'assistant-to-first-telemetry')
    assert.equal(preThink.ms, 350)
    assert.equal(audit.flags.includes('no_turn_start'), false)
  })

  test('reports gap between thought block and tool not shown inline', () => {
    const assistantTs = 5_000
    const entries = [
      row(5_100, { type: 'thinking_start' }),
      row(5_200, { type: 'thinking_delta', delta: 'plan' }),
      row(5_300, { type: 'thinking_end' }),
      row(5_900, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'read' }),
      row(6_500, { type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', isError: false }),
    ]
    const segs = buildAssistantSegments(entries)
    assert.equal(segs.length, 2)
    const audit = auditWorkflowTiming({
      assistantCreatedAt: assistantTs,
      entries,
    })
    const between = audit.gaps.find((g) => g.stage === 'between_chat_segments')
    assert.ok(between, 'expected between-segment gap')
    assert.equal(between.ms, 600)
    assert.ok(between.label.includes('Thought'))
    assert.ok(between.label.includes('read'))
  })

  test('text_delta never appears — large assistant→telemetry gap is expected', () => {
    const audit = auditWorkflowTiming({
      assistantCreatedAt: 10_000,
      entries: [row(15_000, { type: 'thinking_start' })],
    })
    const gap = audit.gaps.find((g) => g.id === 'assistant-to-first-telemetry')
    assert.equal(gap.ms, 5_000)
    assert.match(gap.detail, /text_delta/)
  })

  test('liveOpenChatGap while streaming after tool ends', () => {
    const assistantTs = 1_000
    const entries = [
      row(1_100, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'grep' }),
      row(1_500, { type: 'tool_execution_end', toolCallId: 't1', toolName: 'grep', isError: false }),
    ]
    const segs = buildAssistantSegments(entries)
    const live = liveOpenChatGap(segs, assistantTs, true)
    assert.ok(live)
    assert.equal(live.label, 'Processing tool results')
    assert.equal(live.startTs, 1_500)
    assert.equal(liveOpenChatGap(segs, assistantTs, false), null)
  })

  test('liveOpenChatGap null while tool still running', () => {
    const entries = [
      row(1_100, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'grep' }),
    ]
    const segs = buildAssistantSegments(entries)
    assert.equal(liveOpenChatGap(segs, 1_000, true), null)
  })

  test('gapsForOrderedChatSegments matches between-segment audit gap', () => {
    const assistantTs = 5_000
    const entries = [
      row(5_100, { type: 'thinking_start' }),
      row(5_200, { type: 'thinking_delta', delta: 'plan' }),
      row(5_300, { type: 'thinking_end' }),
      row(5_900, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'read' }),
      row(6_500, { type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', isError: false }),
    ]
    const segs = buildAssistantSegments(entries)
    const inline = gapsForOrderedChatSegments(segs, assistantTs)
    assert.equal(inline.length, 2)
    assert.equal(inline[0].placement, 'lead')
    assert.equal(inline[0].label, 'Waiting for first output')
    assert.equal(inline[0].ms, 100)
    assert.equal(inline[1].placement, 'between')
    assert.equal(inline[1].label, 'Preparing tool call')
    assert.equal(inline[1].ms, 600)
  })

  test('chat visible ms is less than telemetry window when lifecycle sits between blocks', () => {
    const entries = [
      row(1_000, { type: 'thinking_start' }),
      row(1_500, { type: 'thinking_delta', delta: 'a' }),
      row(2_000, { type: 'thinking_end' }),
      row(3_000, { type: 'agent_start' }),
      row(3_100, { type: 'tool_execution_start', toolCallId: 'x', toolName: 'grep' }),
      row(4_000, { type: 'tool_execution_end', toolCallId: 'x', toolName: 'grep', isError: false }),
      row(4_500, { type: 'turn_end' }),
    ]
    const audit = auditWorkflowTiming({ assistantCreatedAt: 900, entries })
    assert.ok(audit.telemetryWindowMs === 3_500)
    assert.ok(audit.chatVisibleMs < audit.telemetryWindowMs)
    assert.ok(audit.untrackedInWindowMs > 0)
  })
})

describe('collapsedAssistantAnswerText', () => {
  test('returns tail after last segment offset, hiding preamble and between-step text', () => {
    const body = 'Let me check.\n\nHere is the final answer.'
    const segments = buildAssistantSegments([
      row(100, { type: 'thinking_start', _textOffset: 0 }),
      row(200, { type: 'thinking_end', _textOffset: 0 }),
      row(300, {
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'grep',
        _textOffset: 15,
      }),
      row(400, {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'grep',
        isError: false,
        _textOffset: 15,
      }),
    ])
    assert.equal(collapsedAssistantAnswerText(body, segments), 'Here is the final answer.')
  })

  test('returns full body when no stamped offsets (legacy telemetry)', () => {
    const body = 'Plain assistant reply.'
    const segments = buildAssistantSegments([
      row(100, { type: 'thinking_start' }),
      row(200, { type: 'thinking_end' }),
    ])
    assert.equal(collapsedAssistantAnswerText(body, segments), body)
  })

  test('returns full body when there are no workflow segments', () => {
    assert.equal(collapsedAssistantAnswerText('Hello.', []), 'Hello.')
  })
})

describe('collapseConsecutiveTimelineEvents', () => {
  test('merges consecutive identical brief labels', () => {
    const entries = [
      row(1_000, { type: 'thinking_start' }),
      row(1_100, { type: 'thinking_delta', delta: 'a' }),
      row(1_200, { type: 'thinking_delta', delta: 'b' }),
      row(1_300, { type: 'thinking_delta', delta: 'c' }),
      row(1_400, { type: 'thinking_end' }),
    ]
    const collapsed = collapseConsecutiveTimelineEvents(entries)
    assert.equal(collapsed.length, 3)
    assert.equal(collapsed[0].brief, 'thinking start')
    assert.equal(collapsed[0].eventCount, 1)
    assert.equal(collapsed[1].brief, 'thinking delta')
    assert.equal(collapsed[1].eventCount, 3)
    assert.equal(collapsed[1].spanMs, 200)
    assert.equal(collapsed[2].brief, 'thinking end')
  })

  test('formatCollapsedTimelineLine shows count and span for merged runs', () => {
    const collapsed = collapseConsecutiveTimelineEvents([
      row(1_000, { type: 'thinking_delta', delta: 'a' }),
      row(1_500, { type: 'thinking_delta', delta: 'b' }),
      row(2_000, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'grep' }),
    ])
    const line = formatCollapsedTimelineLine(collapsed[0], 0, null)
    assert.match(line, /thinking delta \(2×/)
    assert.match(line, /500 ms span/)
  })
})

describe('buildAssistantSegments compaction', () => {
  test('pairs compaction_start with compaction_end', () => {
    const segs = buildAssistantSegments([
      row(10_000, { type: 'compaction_start', reason: 'threshold' }),
      row(14_500, {
        type: 'compaction_end',
        reason: 'threshold',
        tokensBefore: 72000,
        summary: 'Earlier we fixed meal logging.',
      }),
    ])
    assert.equal(segs.length, 1)
    assert.equal(segs[0].kind, 'compaction')
    assert.equal(segs[0].live, false)
    assert.equal(segs[0].tokensBefore, 72000)
    assert.equal(segs[0].summary, 'Earlier we fixed meal logging.')
    assert.equal(segs[0].endTs, 14_500)
  })
})
