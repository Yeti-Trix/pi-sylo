/**
 * Run: npm run test:model-max-tokens -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  LOCAL_MODEL_MIN_MAX_TOKENS,
  resolveLocalModelMaxTokens,
} from '../../out/test/model-input.mjs'

describe('local model per-reply cap', () => {
  test('unknown context window falls back to the generous floor', () => {
    assert.equal(resolveLocalModelMaxTokens(null), LOCAL_MODEL_MIN_MAX_TOKENS)
    assert.equal(resolveLocalModelMaxTokens(0), LOCAL_MODEL_MIN_MAX_TOKENS)
  })

  test('a large local context window yields a cap far above any real reply', () => {
    assert.equal(resolveLocalModelMaxTokens(131072), 98304)
    assert.equal(resolveLocalModelMaxTokens(32768), LOCAL_MODEL_MIN_MAX_TOKENS)
  })

  test('never exceeds the context window', () => {
    assert.equal(resolveLocalModelMaxTokens(8192), 8192)
    assert.equal(resolveLocalModelMaxTokens(16384), 16384)
  })

  test('replaces the 8k catalog cap once the context window is synced', () => {
    // The reported failure: qwen3 capped at 8,192 output tokens per reply while
    // Ollama had a 128k context allocated.
    assert.ok(resolveLocalModelMaxTokens(131072) > 8192)
  })
})
