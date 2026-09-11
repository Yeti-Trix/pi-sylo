import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { modelsToUnload, ollamaModelIdFromPiModel } from './ollama-gpu.ts'

describe('ollamaModelIdFromPiModel', () => {
  test('strips the ollama/ prefix Pi uses on --model', () => {
    assert.equal(ollamaModelIdFromPiModel('ollama/gemma4:12b'), 'gemma4:12b')
  })

  test('passes through a bare Ollama tag', () => {
    assert.equal(ollamaModelIdFromPiModel('qwen3.8:27b'), 'qwen3.8:27b')
  })

  test('ignores an empty seat model', () => {
    assert.equal(ollamaModelIdFromPiModel(undefined), null)
    assert.equal(ollamaModelIdFromPiModel('  '), null)
  })
})

describe('modelsToUnload', () => {
  test('unloads the host chat model so the seat can use the GPU', () => {
    // Measured stall: qwen3.8:27b (17.2 GB) stayed loaded while Debater 1
    // generated on gemma4:12b. Ollama queued the seat and never returned.
    assert.deepEqual(modelsToUnload(['qwen3.8:27b', 'gemma4:12b'], 'gemma4:12b'), [
      'qwen3.8:27b',
    ])
  })

  test('does not unload the seat model itself', () => {
    assert.deepEqual(modelsToUnload(['gemma4:12b'], 'gemma4:12b'), [])
  })

  test('matching is case-insensitive', () => {
    assert.deepEqual(modelsToUnload(['Qwen3.8:27b'], 'qwen3.8:27b'), [])
  })
})
