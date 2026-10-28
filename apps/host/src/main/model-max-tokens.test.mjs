/**
 * Run: npm run test:model-max-tokens -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  CLOUD_HOSTED_MODEL_MAX_TOKENS,
  LOCAL_MODEL_MIN_MAX_TOKENS,
  resolveLocalModelMaxTokens,
  resolveOllamaMaxTokens,
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

describe('ollama model per-reply cap, cloud-aware', () => {
  test('a cloud model on a 1M window stops at the provider cap, not 3/4 of context', () => {
    // beam:cloud and deepseek-v4.1-flash:cloud rejected every request with
    // `max_tokens (786432) exceeds model's maximum output tokens (131072)` when
    // the local three-quarters guard wrote three quarters of the 1M window.
    assert.equal(resolveOllamaMaxTokens(1048576, true), CLOUD_HOSTED_MODEL_MAX_TOKENS)
  })

  test('a small cloud window stays under both bounds', () => {
    assert.equal(resolveOllamaMaxTokens(131072, true), 98304)
    assert.equal(resolveOllamaMaxTokens(262144, true), CLOUD_HOSTED_MODEL_MAX_TOKENS)
  })

  test('unknown-window floor and local models are unchanged', () => {
    assert.equal(resolveOllamaMaxTokens(null, true), LOCAL_MODEL_MIN_MAX_TOKENS)
    assert.equal(resolveOllamaMaxTokens(1048576, false), 786432)
    assert.equal(resolveOllamaMaxTokens(131072, false), 98304)
  })
})
