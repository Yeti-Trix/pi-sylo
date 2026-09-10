import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  chatgptAuthStatusFromCredential,
  pickChatgptLoginMethod,
  CHATGPT_CODEX_DEFAULT_MODEL,
  CHATGPT_CODEX_MODELS,
} from '../../out/test/chatgpt-codex.mjs'

describe('pickChatgptLoginMethod', () => {
  test('prefers device_code over browser', () => {
    assert.equal(
      pickChatgptLoginMethod([
        { id: 'browser', label: 'Browser login (default)' },
        { id: 'device_code', label: 'Device code login (headless)' },
      ]),
      'device_code',
    )
  })

  test('falls back to browser when device_code is absent', () => {
    assert.equal(pickChatgptLoginMethod([{ id: 'browser' }]), 'browser')
  })

  test('returns empty string when there are no options', () => {
    assert.equal(pickChatgptLoginMethod([]), '')
  })
})

describe('chatgptAuthStatusFromCredential', () => {
  test('treats oauth with refresh token as connected', () => {
    const st = chatgptAuthStatusFromCredential({
      type: 'oauth',
      access: 'at',
      refresh: 'rt',
      expires: Date.now() + 60_000,
      accountId: 'acct-1',
    })
    assert.equal(st.connected, true)
    assert.equal(st.accountId, 'acct-1')
  })

  test('ignores api_key entries', () => {
    const st = chatgptAuthStatusFromCredential({ type: 'api_key', key: 'sk-test' })
    assert.equal(st.connected, false)
    assert.equal(st.accountId, null)
  })

  test('ignores empty oauth', () => {
    const st = chatgptAuthStatusFromCredential({ type: 'oauth', access: '', refresh: '' })
    assert.equal(st.connected, false)
  })
})

describe('CHATGPT_CODEX_MODELS', () => {
  test('default model is in the catalog', () => {
    assert.ok(CHATGPT_CODEX_MODELS.some((m) => m.id === CHATGPT_CODEX_DEFAULT_MODEL))
  })
})
