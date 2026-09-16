/**
 * Run: npm run test:empty-reply -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  decideEmptyReply,
  EMPTY_REPLY_CONTINUE_PROMPT,
  lastAssistantCutoff,
  lastAssistantText,
  turnUsedTools,
} from '../../out/test/empty-reply.mjs'

function user(text) {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistant(opts) {
  const content = []
  if (opts.thinking) content.push({ type: 'thinking', thinking: opts.thinking })
  if (opts.text != null) content.push({ type: 'text', text: opts.text })
  if (opts.tool) content.push({ type: 'toolCall', name: 'subagent', id: 't1', arguments: {} })
  return {
    role: 'assistant',
    content,
    stopReason: opts.stopReason,
    errorMessage: opts.errorMessage,
    usage: opts.usage,
  }
}

function toolResult() {
  return { role: 'toolResult', content: [{ type: 'text', text: 'done' }] }
}

describe('decideEmptyReply', () => {
  test('ok when the last assistant has text', () => {
    const d = decideEmptyReply({
      messages: [user('hi'), assistant({ text: 'hello' })],
      chatOnly: false,
    })
    assert.equal(d.kind, 'ok')
    assert.equal(d.autoContinue, false)
    assert.equal(d.userMessage, null)
  })

  test('aborted empty is not a failure', () => {
    const d = decideEmptyReply({
      messages: [user('hi'), assistant({ stopReason: 'aborted' })],
      chatOnly: false,
    })
    assert.equal(d.kind, 'aborted')
    assert.equal(d.autoContinue, false)
    assert.equal(d.userMessage, null)
  })

  test('provider error keeps the model message', () => {
    const d = decideEmptyReply({
      messages: [user('hi'), assistant({ stopReason: 'error', errorMessage: 'boom' })],
      chatOnly: false,
    })
    assert.equal(d.kind, 'provider_error')
    assert.equal(d.userMessage, 'boom')
    assert.equal(d.autoContinue, false)
  })

  test('does not blame chat-only when tools ran and chat-only is off', () => {
    const d = decideEmptyReply({
      messages: [
        user('use subagents'),
        assistant({ thinking: 'plan', tool: true }),
        toolResult(),
        assistant({ thinking: 'still planning' }),
      ],
      chatOnly: false,
    })
    assert.equal(d.kind, 'tools_no_text')
    assert.equal(d.autoContinue, true)
    assert.match(d.userMessage, /ran tools/)
    assert.ok(!/chat-only/i.test(d.userMessage))
  })

  test('thinking-only is recoverable, not chat-only', () => {
    const d = decideEmptyReply({
      messages: [user('status?'), assistant({ thinking: 'let me plan…' })],
      chatOnly: false,
    })
    assert.equal(d.kind, 'thinking_only')
    assert.equal(d.autoContinue, true)
    assert.ok(!/chat-only/i.test(d.userMessage))
  })

  test('chat-only hint only when that pref is on', () => {
    const d = decideEmptyReply({
      messages: [user('hi'), assistant({})],
      chatOnly: true,
    })
    assert.equal(d.kind, 'chat_only')
    assert.equal(d.autoContinue, false)
    assert.match(d.userMessage, /Chat-only is on/)
  })

  test('context full is not auto-continued', () => {
    const d = decideEmptyReply({
      messages: [
        user('go'),
        assistant({
          thinking: '…',
          stopReason: 'length',
          usage: { output: 12, totalTokens: 32000 },
        }),
      ],
      chatOnly: false,
      contextWindow: 32768,
    })
    assert.equal(d.kind, 'context_full')
    assert.equal(d.autoContinue, false)
    assert.match(d.userMessage, /context window/)
  })

  test('output cap is recoverable even without stopReason length', () => {
    const d = decideEmptyReply({
      messages: [
        user('go'),
        assistant({
          thinking: '…',
          usage: { output: 16300, totalTokens: 20000 },
        }),
      ],
      chatOnly: false,
      maxTokens: 16384,
    })
    assert.equal(d.kind, 'output_capped')
    assert.equal(d.autoContinue, true)
  })
})

describe('turn / cutoff helpers', () => {
  test('turnUsedTools sees toolCall and toolResult after the last user', () => {
    assert.equal(
      turnUsedTools([user('a'), assistant({ text: 'x' }), user('b'), assistant({ tool: true })]),
      true,
    )
    assert.equal(turnUsedTools([user('a'), assistant({ text: 'x' })]), false)
  })

  test('lastAssistantCutoff only when stopReason is length', () => {
    assert.equal(
      lastAssistantCutoff([assistant({ text: 'x', usage: { output: 1, totalTokens: 2 } })]),
      null,
    )
    assert.deepEqual(
      lastAssistantCutoff([
        assistant({ stopReason: 'length', usage: { output: 9, totalTokens: 99 } }),
      ]),
      { output: 9, total: 99 },
    )
  })

  test('lastAssistantText ignores thinking', () => {
    assert.equal(lastAssistantText([assistant({ thinking: 'secret', text: 'hi' })]), 'hi')
    assert.equal(lastAssistantText([assistant({ thinking: 'secret' })]), '')
  })

  test('recovery prompt is one-shot and does not ban later subagent calls', () => {
    assert.match(EMPTY_REPLY_CONTINUE_PROMPT, /this_message_only/)
    assert.match(EMPTY_REPLY_CONTINUE_PROMPT, /Later operator messages may use the subagent tool/)
  })
})
