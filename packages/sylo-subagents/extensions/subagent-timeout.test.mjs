/**
 * Run: npm run test:subagent-timeout -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DEFAULT_SUBAGENT_CEILING_MS,
  DEFAULT_SUBAGENT_STALL_MS,
  LOCAL_SUBAGENT_STALL_MS,
  isLocalModelProvider,
  resolveSubagentStallMs,
  resolveSubagentTimeoutMs,
} from './subagent-timeout.ts'

describe('subagent timeout policy', () => {
  test('isLocalModelProvider treats ollama and empty as local', () => {
    assert.equal(isLocalModelProvider('ollama'), true)
    assert.equal(isLocalModelProvider(''), true)
    assert.equal(isLocalModelProvider('openai'), false)
    assert.equal(isLocalModelProvider('chatgpt'), false)
  })

  test('default ceiling is 2h for both local and cloud', () => {
    assert.equal(resolveSubagentTimeoutMs({ provider: 'ollama' }), DEFAULT_SUBAGENT_CEILING_MS)
    assert.equal(resolveSubagentTimeoutMs({ provider: 'openai' }), DEFAULT_SUBAGENT_CEILING_MS)
    assert.equal(DEFAULT_SUBAGENT_CEILING_MS, 7_200_000)
  })

  test('frontmatter timeout_seconds is the ceiling (scout stays at 300)', () => {
    assert.equal(resolveSubagentTimeoutMs({ timeoutSeconds: 300, provider: 'ollama' }), 300_000)
    assert.equal(resolveSubagentTimeoutMs({ timeoutSeconds: 900, provider: 'openai' }), 900_000)
  })

  test('stall is 10 min local, 5 min cloud', () => {
    assert.equal(resolveSubagentStallMs({ provider: 'ollama' }), LOCAL_SUBAGENT_STALL_MS)
    assert.equal(resolveSubagentStallMs({ provider: 'openai' }), DEFAULT_SUBAGENT_STALL_MS)
    assert.equal(LOCAL_SUBAGENT_STALL_MS, 600_000)
    assert.equal(DEFAULT_SUBAGENT_STALL_MS, 300_000)
  })
})
