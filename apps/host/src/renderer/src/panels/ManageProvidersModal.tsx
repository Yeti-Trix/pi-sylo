import React, { useCallback, useEffect, useState } from 'react'
import {
  CHATGPT_CODEX_PROVIDER,
  SYLO_MODEL_PROVIDERS,
  SYLO_MODEL_PROVIDER_LABELS,
} from '../../../shared/chatgpt-codex'
import { API_PROVIDER_ENV_VARS } from '../../../shared/configured-providers'
import type { SyloModelProvider } from '../../../shared/chatgpt-codex'
import { cn } from '../lib/cn'
import { normalizeOllamaOriginUi } from './ollama-ui'
import { ChatGptSignIn } from './ChatGptSignIn'
import { btnGhostSm, btnPrimarySm, errorText, fieldLabel, input, mutedText, settingsCaption } from './ui-classes'

/** Providers that authenticate with an API key stored in Pi's auth.json. */
const KEY_PROVIDERS = SYLO_MODEL_PROVIDERS.filter(
  (p): p is Exclude<SyloModelProvider, 'ollama' | 'openai-codex'> =>
    p !== 'ollama' && p !== CHATGPT_CODEX_PROVIDER,
)

type KeyStatus = { hasKey: boolean; preview: string | null }

/**
 * Configure EVERY provider from one place, independent of which provider the chat
 * model currently uses: save/replace/remove API keys (Pi's ~/.pi/agent/auth.json),
 * sign in/out of ChatGPT OAuth, and check Ollama reachability. Saving a key for a
 * provider makes it appear in the chat and subagent pickers without touching the
 * active model.
 */
export function ManageProvidersModal({
  activeProvider,
  onProvidersChanged,
  onClose,
}: {
  /** Provider id tagged as the current chat model in the row list. */
  activeProvider: string
  /** Call after any credential change so provider pickers refresh. */
  onProvidersChanged: () => void
  onClose: () => void
}): React.ReactElement {
  const [keys, setKeys] = useState<Record<string, KeyStatus>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [ollamaOrigin, setOllamaOrigin] = useState('')
  const [ollamaModelCount, setOllamaModelCount] = useState<number | null>(null)
  const [ollamaChecking, setOllamaChecking] = useState(false)
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const loadKeys = useCallback(async () => {
    const rows = await Promise.all(
      KEY_PROVIDERS.map(async (p) => {
        const r = await window.sylo.piAuth.get(p)
        return [p, r.ok ? { hasKey: r.hasKey, preview: r.keyPreview } : { hasKey: false, preview: null }] as const
      }),
    )
    setKeys(Object.fromEntries(rows))
  }, [])

  const label = (p: string) =>
    SYLO_MODEL_PROVIDER_LABELS[p as keyof typeof SYLO_MODEL_PROVIDER_LABELS] ?? p

  const checkOllama = useCallback(async () => {
    setOllamaChecking(true)
    setOllamaError(null)
    try {
      const pref = ((await window.sylo.prefs.get('sylo.ollama_base_url', '')) as string).trim()
      const origin = pref ? normalizeOllamaOriginUi(pref) : await window.sylo.ollama.inferBaseUrl()
      setOllamaOrigin(origin)
      const tags = await window.sylo.ollama.listTags(origin)
      if (tags.ok) {
        setOllamaModelCount(tags.models.length)
      } else {
        setOllamaModelCount(null)
        setOllamaError(tags.error)
      }
    } catch (e) {
      setOllamaModelCount(null)
      setOllamaError(e instanceof Error ? e.message : String(e))
    } finally {
      setOllamaChecking(false)
    }
  }, [])

  // Re-read live state every time the modal opens, so this surface can never
  // disagree with the active-provider blocks in Settings.
  useEffect(() => {
    void loadKeys()
    void checkOllama()
  }, [loadKeys, checkOllama])

  const setProviderError = (p: string, error: string | null) =>
    setErrors((prev) => ({ ...prev, [p]: error }))

  const saveKey = async (p: string) => {
    const value = (drafts[p] ?? '').trim()
    if (value === '') return
    setBusyProvider(p)
    setProviderError(p, null)
    const w = await window.sylo.piAuth.set(p, value)
    setBusyProvider(null)
    if (!w.ok) {
      setProviderError(p, w.error)
      return
    }
    setDrafts((prev) => ({ ...prev, [p]: '' }))
    const r = await window.sylo.piAuth.get(p)
    if (r.ok) setKeys((prev) => ({ ...prev, [p]: { hasKey: r.hasKey, preview: r.keyPreview } }))
    setDirty(true)
    onProvidersChanged()
  }

  const removeKey = async (p: string) => {
    if (!window.confirm(`Remove the saved ${label(p)} key from auth.json?`)) return
    setBusyProvider(p)
    setProviderError(p, null)
    const w = await window.sylo.piAuth.set(p, '')
    setBusyProvider(null)
    if (!w.ok) {
      setProviderError(p, w.error)
      return
    }
    setKeys((prev) => ({ ...prev, [p]: { hasKey: false, preview: null } }))
    setDirty(true)
    onProvidersChanged()
  }

  const restartBroker = async () => {
    if (
      !window.confirm(
        'Restart the Pi broker now? In-flight turns in every conversation are interrupted, and the app reconnects with the new credentials.',
      )
    )
      return
    setRestarting(true)
    await window.sylo.broker.restart()
    setRestarting(false)
    setDirty(false)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-[rgb(8_10_14/0.72)] px-4 py-12"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[720px] rounded-[10px] border border-border bg-bg-secondary px-[18px] py-4 shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sylo-manage-providers-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 id="sylo-manage-providers-title" className="m-0 text-base font-semibold">
            Manage providers
          </h2>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-inherit text-[0.75rem] text-accent underline underline-offset-2 hover:text-[#8cb4ff]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <p className={cn(mutedText, 'mb-3 text-[0.82rem] leading-[1.45]')}>
          Save API keys or sign in to any number of providers — each one works independently of the
          active chat model. Keys live in Pi&apos;s <code>~/.pi/agent/auth.json</code>, so they
          survive restarts and provider switches.
        </p>

        <div className="flex flex-col gap-2">
          {SYLO_MODEL_PROVIDERS.map((p) => {
            if (p === 'ollama') {
              return (
                <div
                  key={p}
                  className="flex flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={fieldLabel}>Ollama</span>
                    {activeProvider === p ?
                      <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[0.68rem] text-text-secondary">
                        Active chat model
                      </span>
                    : null}
                  </div>
                  {ollamaModelCount !== null ?
                    <p className={settingsCaption}>
                      Reachable — {ollamaModelCount} model(s) at <code>{ollamaOrigin}</code>.
                    </p>
                  : ollamaError ?
                    <p className={settingsCaption}>Unreachable at <code>{ollamaOrigin}</code>.</p>
                  : <p className={settingsCaption}>Checking…</p>}
                  {ollamaError ? <p className={errorText}>{ollamaError}</p> : null}
                  <p className={settingsCaption}>
                    No key needed. The server URL is edited in the Model section when Ollama is the
                    active provider.
                  </p>
                  <div>
                    <button type="button" className={btnGhostSm} onClick={() => void checkOllama()} disabled={ollamaChecking}>
                      {ollamaChecking ? 'Checking…' : 'Check connection'}
                    </button>
                  </div>
                </div>
              )
            }
            if (p === CHATGPT_CODEX_PROVIDER) {
              return (
                <div
                  key={p}
                  className="rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={fieldLabel}>{label(p)}</span>
                    {activeProvider === p ?
                      <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[0.68rem] text-text-secondary">
                        Active chat model
                      </span>
                    : null}
                  </div>
                  <ChatGptSignIn compact onChange={onProvidersChanged} />
                </div>
              )
            }
            const st = keys[p]
            const envVar = API_PROVIDER_ENV_VARS[p as keyof typeof API_PROVIDER_ENV_VARS]
            return (
              <div
                key={p}
                className="flex flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={fieldLabel}>{label(p)}</span>
                  {activeProvider === p ?
                    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[0.68rem] text-text-secondary">
                      Active chat model
                    </span>
                  : null}
                </div>
                <p className={settingsCaption}>
                  {st === undefined ?
                    'Checking…'
                  : st.hasKey ?
                    <>
                      Key saved — <code>{st.preview}</code>.
                    </>
                  : 'No key saved.'}{' '}
                  {envVar ?
                    <>Pi also accepts a <code>{envVar}</code> environment variable as a fallback.</>
                  : null}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={cn(input, 'min-w-[220px] flex-1')}
                    type="password"
                    value={drafts[p] ?? ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [p]: e.target.value }))}
                    placeholder="Paste an API key…"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`${label(p)} API key`}
                    disabled={busyProvider === p}
                  />
                  <button
                    type="button"
                    className={btnPrimarySm}
                    onClick={() => void saveKey(p)}
                    disabled={(drafts[p] ?? '').trim() === '' || busyProvider === p}
                  >
                    {busyProvider === p ? 'Saving…' : 'Save key'}
                  </button>
                  {st?.hasKey ?
                    <button
                      type="button"
                      className={btnGhostSm}
                      onClick={() => void removeKey(p)}
                      disabled={busyProvider === p}
                    >
                      Remove saved key
                    </button>
                  : null}
                </div>
                {errors[p] ? <p className={errorText}>{errors[p]}</p> : null}
              </div>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-border pt-3">
          <p className={cn(settingsCaption, 'min-w-[200px] flex-1')}>
            New credentials apply to new sessions — restart the broker so live chats pick them up.
          </p>
          <button type="button" className={btnGhostSm} onClick={() => void restartBroker()} disabled={restarting}>
            {restarting ? 'Restarting…' : 'Restart broker'}
          </button>
        </div>
      </div>
    </div>
  )
}