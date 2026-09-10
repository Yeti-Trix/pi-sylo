/**
 * ChatGPT Plus/Pro (OpenAI Codex) OAuth for Sylo.
 *
 * Uses Pi's built-in `openai-codex` provider — the same ChatGPT subscription
 * login as Hermes / `pi /login`. Tokens land in `~/.pi/agent/auth.json`.
 * Device-code is preferred so we never bind Codex CLI's localhost:1455 callback.
 */
import { join } from 'node:path'
import { ModelRuntime, readStoredCredential } from '@earendil-works/pi-coding-agent'
import type { AuthEvent, AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai'
import {
  chatgptAuthStatusFromCredential,
  pickChatgptLoginMethod,
  type ChatgptAuthStatus,
  type ChatgptLoginEvent,
} from '../shared/chatgpt-codex.js'

export type ChatgptLoginResult =
  | { ok: true }
  | { ok: false; error: string; cancelled?: boolean }

type OpenExternal = (url: string) => Promise<void>

let loginAbort: AbortController | undefined

export function chatgptAuthStatus(agentDir: string): ChatgptAuthStatus {
  const authPath = join(agentDir, 'auth.json')
  try {
    return chatgptAuthStatusFromCredential(readStoredCredential('openai-codex', authPath))
  } catch {
    return { connected: false, accountId: null }
  }
}

export function cancelChatgptLogin(): void {
  loginAbort?.abort()
}

function waitUntilAborted(signal: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    const fail = (): void => reject(new Error('Login cancelled'))
    if (signal.aborted) {
      fail()
      return
    }
    signal.addEventListener('abort', fail, { once: true })
  })
}

function toLoginEvent(event: AuthEvent): ChatgptLoginEvent | null {
  if (event.type === 'device_code') {
    return {
      type: 'device_code',
      userCode: event.userCode,
      verificationUri: event.verificationUri,
      expiresInSeconds: event.expiresInSeconds,
    }
  }
  if (event.type === 'auth_url') {
    return { type: 'auth_url', url: event.url, instructions: event.instructions }
  }
  if (event.type === 'progress') {
    return { type: 'progress', message: event.message }
  }
  if (event.type === 'info') {
    return { type: 'info', message: event.message }
  }
  return null
}

export async function loginChatgptCodex(opts: {
  agentDir: string
  openExternal: OpenExternal
  onEvent: (event: ChatgptLoginEvent) => void
}): Promise<ChatgptLoginResult> {
  if (loginAbort) {
    return { ok: false, error: 'A ChatGPT sign-in is already in progress.' }
  }
  const abort = new AbortController()
  loginAbort = abort
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(opts.agentDir, 'auth.json'),
      modelsPath: join(opts.agentDir, 'models.json'),
    })
    if (abort.signal.aborted) {
      return { ok: false, error: 'Login cancelled', cancelled: true }
    }

    const interaction: AuthInteraction = {
      signal: abort.signal,
      prompt: async (prompt: AuthPrompt) => {
        if (prompt.type === 'select') {
          const id = pickChatgptLoginMethod(prompt.options)
          if (!id) throw new Error('ChatGPT login offered no sign-in method.')
          return id
        }
        // Browser-login fallback: Pi races a localhost callback against this
        // prompt. Hang until abort (callback won, or the user cancelled).
        if (prompt.type === 'manual_code') {
          const signal = prompt.signal ?? abort.signal
          return waitUntilAborted(signal)
        }
        throw new Error(`Unexpected ChatGPT login prompt (${prompt.type}).`)
      },
      notify: (event) => {
        const mapped = toLoginEvent(event)
        if (mapped) opts.onEvent(mapped)
        const url =
          event.type === 'device_code' ? event.verificationUri
          : event.type === 'auth_url' ? event.url
          : null
        if (url) void opts.openExternal(url)
      },
    }

    await runtime.login('openai-codex', 'oauth', interaction)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cancelled =
      abort.signal.aborted || /login cancelled|aborted|abort/i.test(msg)
    return { ok: false, error: cancelled ? 'Login cancelled' : msg, cancelled }
  } finally {
    if (loginAbort === abort) loginAbort = undefined
  }
}

export async function logoutChatgptCodex(agentDir: string): Promise<ChatgptLoginResult> {
  cancelChatgptLogin()
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
    })
    await runtime.logout('openai-codex')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
