/**
 * Run: npm run test:ollama-context -w apps/host
 * Requires out/test/ollama-context.mjs from esbuild bundle.
 *
 * The measured figures below come from a real Ollama 0.33.3 server: every installed
 * model reported a 262,144 trained context with no Modelfile `num_ctx`, and
 * `qwen3-coder:30b` loaded through `/v1` allocated the full 262,144.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DEFAULT_OLLAMA_CONTEXT_LIMIT,
  describeContextWindowVerdict,
  isCloudHostedOllamaModel,
  judgeContextWindow,
  resolveEffectiveOllamaContext,
} from '../../out/test/ollama-context.mjs'

const probe = ({ trained = null, modelfileNumCtx = null, loaded = null } = {}) => ({
  trained,
  modelfileNumCtx,
  loaded,
})

describe('resolveEffectiveOllamaContext', () => {
  test('a loaded model is ground truth over the trained size', () => {
    // /api/ps already reflects the server limit, the Modelfile, and any VRAM shrink.
    const effective = resolveEffectiveOllamaContext(
      probe({ trained: 262144, loaded: 131072 }),
      DEFAULT_OLLAMA_CONTEXT_LIMIT,
    )
    assert.equal(effective, 131072)
  })

  test('falls back to the server limit when the model is not loaded', () => {
    // Without this cap Sylo would declare 262144 against an OLLAMA_CONTEXT_LENGTH of
    // 131072 and push Pi into the silent-truncation regime.
    const effective = resolveEffectiveOllamaContext(probe({ trained: 262144 }), 131072)
    assert.equal(effective, 131072)
  })

  test('never exceeds what the model was trained for', () => {
    const effective = resolveEffectiveOllamaContext(probe({ trained: 8192 }), 131072)
    assert.equal(effective, 8192)
  })

  test('a Modelfile num_ctx outranks the server limit', () => {
    const effective = resolveEffectiveOllamaContext(
      probe({ trained: 262144, modelfileNumCtx: 16384 }),
      131072,
    )
    assert.equal(effective, 16384)
  })

  test('reports unknown rather than guessing when /api/show gives nothing', () => {
    assert.equal(resolveEffectiveOllamaContext(probe(), 131072), null)
  })

  test('the local server limit does not cap a cloud-hosted model', () => {
    // Measured against glm-5.3-flash:cloud, which /api/show reports at 1,048,576 tokens.
    // OLLAMA_CONTEXT_LENGTH sizes local VRAM, so clamping the cloud model to it would
    // throw away 87% of its window and make Pi compact for no reason.
    const effective = resolveEffectiveOllamaContext(probe({ trained: 1048576 }), 131072, true)
    assert.equal(effective, 1048576)
  })

  test('a Modelfile num_ctx still applies to a cloud-hosted model', () => {
    const effective = resolveEffectiveOllamaContext(
      probe({ trained: 1048576, modelfileNumCtx: 200000 }),
      131072,
      true,
    )
    assert.equal(effective, 200000)
  })

  test('a loaded cloud model still reports what Ollama actually allocated', () => {
    const effective = resolveEffectiveOllamaContext(
      probe({ trained: 1048576, loaded: 262144 }),
      131072,
      true,
    )
    assert.equal(effective, 262144)
  })
})

describe('isCloudHostedOllamaModel', () => {
  test('recognizes the :cloud tag Ollama uses for remote models', () => {
    assert.equal(isCloudHostedOllamaModel('glm-5.3-flash:cloud'), true)
    assert.equal(isCloudHostedOllamaModel('nemotron-3-ultra:cloud'), true)
  })

  test('local models and lookalike tags stay local', () => {
    assert.equal(isCloudHostedOllamaModel('qwen3.8:27b'), false)
    assert.equal(isCloudHostedOllamaModel('qwen3-coder:30b'), false)
    // Only the tag counts; a name that merely contains "cloud" is still local.
    assert.equal(isCloudHostedOllamaModel('cloud-llama:7b'), false)
  })
})

describe('judgeContextWindow', () => {
  test('flags the measured qwen3-coder:30b misconfiguration as wasteful', () => {
    // models.json declared 32768 while Ollama allocated 262144, so Pi compacted at
    // 32768 - 16384 = 16384 tokens: 6% of what was actually available.
    const verdict = judgeContextWindow(262144, 32768)
    assert.equal(verdict.kind, 'wasting')
    const message = describeContextWindowVerdict(verdict, 'qwen3-coder:30b')
    assert.match(message, /262,144/)
    assert.match(message, /16,384 tokens/)
  })

  test('flags an over-declared window as truncating', () => {
    const verdict = judgeContextWindow(32768, 131072)
    assert.equal(verdict.kind, 'truncating')
    assert.match(describeContextWindowVerdict(verdict, 'm'), /silently drop/)
  })

  test('treats an undeclared window as missing so Pi stops assuming 128k', () => {
    const verdict = judgeContextWindow(262144, null)
    assert.equal(verdict.kind, 'missing')
    assert.match(describeContextWindowVerdict(verdict, 'm'), /128,000/)
  })

  test('warns when the declared window leaves little room after Pi reserves 16384', () => {
    assert.equal(judgeContextWindow(32768, 32768).kind, 'cramped')
  })

  test('accepts an exact match without nagging', () => {
    assert.equal(judgeContextWindow(262144, 262144).kind, 'ok')
  })

  test('tolerates a conservative margin below the real window', () => {
    // Deliberately under-declaring by a little is prudent, not a misconfiguration.
    assert.equal(judgeContextWindow(262144, 200000).kind, 'ok')
  })

  test('stays quiet when the context cannot be determined', () => {
    assert.equal(judgeContextWindow(null, 32768).kind, 'unknown')
  })
})
