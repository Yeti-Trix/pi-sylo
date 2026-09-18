/**
 * Run: npm run test:configured-providers -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  listConfiguredModelProviders,
  mergeVisibleProviders,
  providerHasStoredCredential,
} from '../../out/test/configured-providers.mjs'

describe('providerHasStoredCredential', () => {
  test('accepts a non-empty API key', () => {
    assert.equal(providerHasStoredCredential({ type: 'api_key', key: 'sk-test' }), true)
  })

  test('rejects an empty key', () => {
    assert.equal(providerHasStoredCredential({ type: 'api_key', key: '  ' }), false)
  })

  test('accepts OAuth with a refresh token', () => {
    assert.equal(
      providerHasStoredCredential({ type: 'oauth', access: '', refresh: 'rt' }),
      true,
    )
  })

  test('rejects empty OAuth', () => {
    assert.equal(providerHasStoredCredential({ type: 'oauth', access: '', refresh: '' }), false)
  })
})

describe('listConfiguredModelProviders', () => {
  test('shows only Ollama and ChatGPT OAuth when those are set up', () => {
    assert.deepEqual(
      listConfiguredModelProviders({
        ollamaReachable: true,
        chatgptConnected: true,
        hasCredential: {},
      }),
      ['ollama', 'openai-codex'],
    )
  })

  test('hides every remote provider when nothing is signed in', () => {
    assert.deepEqual(
      listConfiguredModelProviders({
        ollamaReachable: false,
        chatgptConnected: false,
        hasCredential: {},
      }),
      [],
    )
  })

  test('includes an API provider that has a stored key', () => {
    assert.deepEqual(
      listConfiguredModelProviders({
        ollamaReachable: false,
        chatgptConnected: false,
        hasCredential: { anthropic: true },
      }),
      ['anthropic'],
    )
  })

  test('keeps the current selection even when that provider is no longer set up', () => {
    assert.deepEqual(
      listConfiguredModelProviders({
        ollamaReachable: true,
        chatgptConnected: false,
        hasCredential: {},
        alwaysInclude: ['openrouter'],
      }),
      ['ollama', 'openrouter'],
    )
  })
})

describe('mergeVisibleProviders', () => {
  test('unions configured providers with the current override', () => {
    assert.deepEqual(mergeVisibleProviders(['ollama'], ['openai-codex', '']), [
      'ollama',
      'openai-codex',
    ])
  })

  test('ignores unknown extras', () => {
    assert.deepEqual(mergeVisibleProviders(['ollama'], ['not-a-provider']), ['ollama'])
  })
})
