import React, { useCallback, useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { btnGhostSm, btnPrimary, errorText, fieldLabel, settingsCaption } from './ui-classes'

/**
 * ChatGPT Plus/Pro sign-in card (OpenAI Codex OAuth), shared by the Model section
 * of Settings (active-provider block) and the Manage-providers modal row.
 * Credentials live in Pi's `~/.pi/agent/auth.json`; the broker reads them at
 * session start, so a fresh sign-in applies to new turns after a broker restart.
 */
export function ChatGptSignIn({
  onChange,
  onSignedIn,
  compact = false,
}: {
  /** Call after any credential change so provider pickers refresh. */
  onChange?: () => void
  /** Call after a successful sign-in (e.g. default the model id in Settings). */
  onSignedIn?: () => void
  /** Tighter card for embedding inside the Manage-providers modal. */
  compact?: boolean
}): React.ReactElement {
  const [connected, setConnected] = useState(false)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState('')
  const [deviceUri, setDeviceUri] = useState('')
  const [progress, setProgress] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    const st = await window.sylo.chatgpt.status()
    setConnected(st.connected)
    setAccountId(st.accountId)
  }, [])

  // Mount-time fetch: the modal embed mounts this for the openai-codex row
  // regardless of which provider the chat is currently on.
  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    return window.sylo.chatgpt.onLoginEvent((event) => {
      if (event.type === 'device_code' && event.userCode && event.verificationUri) {
        setDeviceCode(event.userCode)
        setDeviceUri(event.verificationUri)
        setProgress('Waiting for you to approve in the browser…')
        setError(null)
      } else if (event.type === 'auth_url' && event.url) {
        setDeviceUri(event.url)
        setProgress(event.instructions || 'Complete login in your browser…')
      } else if ((event.type === 'progress' || event.type === 'info') && event.message) {
        setProgress(event.message)
      }
    })
  }, [])

  const startLogin = useCallback(async () => {
    setBusy(true)
    setError(null)
    setDeviceCode('')
    setDeviceUri('')
    setProgress('Starting ChatGPT sign-in…')
    try {
      const r = await window.sylo.chatgpt.login()
      if (r.ok) {
        setConnected(true)
        setProgress(null)
        await refreshStatus()
        onSignedIn?.()
        onChange?.()
      } else if (!r.cancelled) {
        setError(r.error)
        setProgress(null)
      } else {
        setProgress(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress(null)
    } finally {
      setBusy(false)
      setDeviceCode('')
      setDeviceUri('')
    }
  }, [onChange, onSignedIn, refreshStatus])

  const cancelLogin = useCallback(async () => {
    await window.sylo.chatgpt.cancel()
    setBusy(false)
    setDeviceCode('')
    setDeviceUri('')
    setProgress(null)
  }, [])

  const logout = useCallback(async () => {
    if (!window.confirm('Sign out of ChatGPT Plus in Sylo?')) return
    const r = await window.sylo.chatgpt.logout()
    if (!r.ok) {
      window.alert(`Could not sign out: ${r.error}`)
      return
    }
    setConnected(false)
    setAccountId(null)
    onChange?.()
  }, [onChange])

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3',
        compact ? 'py-2' : 'py-2.5',
      )}
    >
      <span className={fieldLabel}>ChatGPT OAuth</span>
      <p className={settingsCaption}>
        Signs into your ChatGPT subscription through OpenAI Codex (same path Hermes uses). This is not
        the paid OpenAI API — no platform key, usage comes from your Plus/Pro quota.
      </p>
      {connected ?
        <p className={settingsCaption}>
          Signed in{accountId ? <> — account <code>{accountId}</code></> : null}
          {compact ?
            '.'
          : (
            <>
              . Choose a model below, then <strong>Save model settings</strong> so the broker
              switches over.
            </>
          )}
        </p>
      : <p className={settingsCaption}>Not signed in yet.</p>}
      {error ? <p className={errorText}>{error}</p> : null}
      {deviceCode ?
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <code className="select-all text-2xl font-bold tracking-[0.2em]">{deviceCode}</code>
          {deviceUri ?
            <a className={cn(btnPrimary, 'ml-auto')} href={deviceUri} target="_blank" rel="noreferrer">
              Open ChatGPT
            </a>
          : null}
        </div>
      : null}
      {progress ? <p className={settingsCaption}>{progress}</p> : null}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        {busy ?
          <button type="button" className={btnGhostSm} onClick={() => void cancelLogin()}>
            Cancel sign-in
          </button>
        : connected ?
          <button type="button" className={btnGhostSm} onClick={() => void logout()}>
            Sign out
          </button>
        : (
          <button type="button" className={btnPrimary} onClick={() => void startLogin()}>
            Sign in with ChatGPT
          </button>
        )}
      </div>
    </div>
  )
}