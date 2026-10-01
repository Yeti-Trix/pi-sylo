import { useCallback, useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import {
  btnGhostSm,
  btnPrimary,
  card,
  cardTitle,
  detailsBody,
  detailsSummary,
  errorText,
  fieldLabel,
  input,
  leadText,
  mutedText,
  select,
} from './ui-classes'
import { Badge } from './Badge'

const caption = cn(mutedText, 'm-0 text-[0.78rem] leading-[1.4]')

/**
 * Companion (phone / LAN) settings — self-contained: server status, credentials,
 * port/bind, live URLs, and TLS notes. Re-renders from `window.sylo.companion`.
 */
export function CompanionCard({
  onChanged,
}: {
  onChanged: () => void | Promise<void>
}): React.ReactElement {
  const [companionEnabled, setCompanionEnabled] = useState(false)
  const [companionBind, setCompanionBind] = useState<'loopback' | 'lan'>('loopback')
  const [companionPort, setCompanionPort] = useState(9241)
  const [companionUrl, setCompanionUrl] = useState('')
  const [companionUrlsLan, setCompanionUrlsLan] = useState<string[]>([])
  const [companionFqdnUrl, setCompanionFqdnUrl] = useState<string | null>(null)
  const [companionStaticBuilt, setCompanionStaticBuilt] = useState(true)
  const [companionRunning, setCompanionRunning] = useState(false)
  const [companionUsername, setCompanionUsername] = useState('')
  const [companionPassword, setCompanionPassword] = useState('')
  const [companionHasCredentials, setCompanionHasCredentials] = useState(false)
  const [companionCredError, setCompanionCredError] = useState<string | null>(null)
  const [companionTlsMode, setCompanionTlsMode] = useState<'mkcert' | 'sylo-ca'>('sylo-ca')
  const [companionRootCaPath, setCompanionRootCaPath] = useState<string | null>(null)

  const refreshCompanionStatus = useCallback(async () => {
    const st = await window.sylo.companion.getStatus()
    setCompanionEnabled(st.enabled)
    setCompanionBind(st.bind)
    setCompanionPort(st.port)
    setCompanionUrl(st.urls.loopback)
    setCompanionUrlsLan(st.urls.lan)
    setCompanionFqdnUrl(st.urls.fqdn)
    setCompanionStaticBuilt(st.staticBuilt)
    setCompanionRunning(st.running)
    setCompanionUsername(st.username)
    setCompanionHasCredentials(st.hasCredentials)
    setCompanionTlsMode(st.tls.mode)
    setCompanionRootCaPath(st.tls.rootCaPath)
  }, [])

  useEffect(() => {
    void refreshCompanionStatus()
  }, [refreshCompanionStatus])

  return (
    <section className={card}>
      <h2 className={cardTitle}>Companion (phone / LAN)</h2>
      <p className={leadText}>
        Optional phone web UI for this desktop. Set a username and password below, then log in from your phone.
      </p>
      <details className="m-0">
        <summary className={detailsSummary}>Why it needs a login</summary>
        <p className={detailsBody}>
          Still worth a password on a home LAN — guest Wi‑Fi and other devices can reach an open port.
        </p>
      </details>
      {!companionStaticBuilt ?
        <p className={errorText}>
          Companion UI not built. Run <code className="text-[0.85em]">npm run build:companion</code> in{' '}
          <code className="text-[0.85em]">apps/host</code>, then restart Sylo.
        </p>
      : null}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[140px] flex-1 flex-col gap-1">
          <span className={fieldLabel}>Username</span>
          <input
            className={input}
            value={companionUsername}
            onChange={(e) => setCompanionUsername(e.target.value)}
            autoComplete="off"
            placeholder="e.g. sylo"
          />
        </label>
        <label className="flex min-w-[140px] flex-1 flex-col gap-1">
          <span className={fieldLabel}>Password</span>
          <input
            className={input}
            type="password"
            value={companionPassword}
            onChange={(e) => setCompanionPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={companionHasCredentials ? 'Leave blank to keep current' : 'Required before enable'}
          />
        </label>
      </div>
      {companionCredError ?
        <p className={errorText}>{companionCredError}</p>
      : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            setCompanionCredError(null)
            const password = companionPassword.trim()
            if (!companionUsername.trim()) {
              setCompanionCredError('Username is required.')
              return
            }
            if (!password && !companionHasCredentials) {
              setCompanionCredError('Password is required the first time.')
              return
            }
            if (!password) {
              setCompanionCredError('Enter a new password to change it.')
              return
            }
            void window.sylo.companion
              .setCredentials({ username: companionUsername.trim(), password })
              .then((r) => {
                if ('ok' in r && r.ok === false) {
                  setCompanionCredError(
                    r.error === 'username_required' ? 'Username is required.'
                    : r.error === 'password_required' ? 'Password is required.'
                    : r.error,
                  )
                  return
                }
                setCompanionPassword('')
                void refreshCompanionStatus()
              })
          }}
        >
          Save login
        </button>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-[0.88rem]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={companionEnabled}
          disabled={!companionHasCredentials}
          onChange={(e) => {
            const enabled = e.target.checked
            setCompanionEnabled(enabled)
            void window.sylo.companion
              .setConfig({ enabled, bind: companionBind, port: companionPort })
              .then((st) => {
                if ('ok' in st && st.ok === false) {
                  setCompanionEnabled(false)
                  setCompanionCredError('Save username and password before enabling.')
                  return
                }
                if ('urls' in st) {
                  setCompanionUrl(st.urls.loopback)
                  setCompanionUrlsLan(st.urls.lan)
                  setCompanionFqdnUrl(st.urls.fqdn)
                  setCompanionRunning(st.running)
                  setCompanionStaticBuilt(st.staticBuilt)
                }
              })
          }}
        />
        <span>Enable companion server{!companionHasCredentials ? ' (save login first)' : ''}</span>
      </label>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[120px] flex-col gap-1">
          <span className={fieldLabel}>HTTPS port</span>
          <input
            className={input}
            type="number"
            min={1024}
            max={65535}
            value={companionPort}
            onChange={(e) => setCompanionPort(Number(e.target.value) || 9241)}
            onBlur={() => {
              void window.sylo.companion
                .setConfig({ enabled: companionEnabled, bind: companionBind, port: companionPort })
                .then((st) => {
                  if ('ok' in st && st.ok === false) return
                  void refreshCompanionStatus()
                })
            }}
          />
        </label>
        <label className="flex min-w-[160px] flex-col gap-1">
          <span className={fieldLabel}>Network bind</span>
          <select
            className={select}
            value={companionBind}
            onChange={(e) => {
              const bind = e.target.value === 'lan' ? 'lan' : 'loopback'
              setCompanionBind(bind)
              void window.sylo.companion
                .setConfig({ enabled: companionEnabled, bind, port: companionPort })
                .then((st) => {
                  if ('ok' in st && st.ok === false) return
                  void refreshCompanionStatus()
                })
            }}
          >
            <option value="loopback">This PC only (127.0.0.1)</option>
            <option value="lan">Phone on same Wi‑Fi / Tailscale (0.0.0.0)</option>
          </select>
        </label>
      </div>
      {companionEnabled ?
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={companionRunning ? 'ok' : 'neutral'}>
              {companionRunning ? 'Running' : 'Not running'}
            </Badge>
            <span className={caption}>
              {companionBind === 'lan' ?
                `Allow Node on HTTPS port ${companionPort} through Windows Firewall.`
              : 'Phone on another device cannot reach loopback — switch bind to LAN.'}
            </span>
          </div>
          {companionUrl ?
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>URL (this PC)</span>
                <input className={input} readOnly value={companionUrl} onFocus={(e) => e.target.select()} />
              </label>
              {companionFqdnUrl ?
                <label className="flex flex-col gap-1">
                  <span className={fieldLabel}>URL (Tailscale — use on phone)</span>
                  <input className={input} readOnly value={companionFqdnUrl} onFocus={(e) => e.target.select()} />
                </label>
              : null}
              {companionUrlsLan.map((u) => (
                <label key={u} className="flex flex-col gap-1">
                  <span className={fieldLabel}>URL (LAN — {companionFqdnUrl ? 'untrusted fallback' : 'use on phone'})</span>
                  <input className={input} readOnly value={u} onFocus={(e) => e.target.select()} />
                </label>
              ))}
            </div>
          : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnGhostSm}
              onClick={() => {
                const copy = companionFqdnUrl ?? companionUrlsLan[0] ?? companionUrl
                if (copy) void navigator.clipboard.writeText(copy)
              }}
            >
              Copy phone URL
            </button>
            <button
              type="button"
              className={btnGhostSm}
              onClick={() => {
                void window.sylo.companion.openCertsFolder()
              }}
            >
              Open certs folder
            </button>
            {companionRootCaPath ?
              <button
                type="button"
                className={btnGhostSm}
                onClick={() => {
                  void navigator.clipboard.writeText(companionRootCaPath)
                }}
              >
                Copy root CA path
              </button>
            : null}
          </div>
          <p className={cn(caption, 'mb-0 mt-2')}>
            HTTPS:{' '}
            {companionTlsMode === 'mkcert' ?
              (companionFqdnUrl ?
                <>trusted public cert — <code className="text-[0.85em]">{companionFqdnUrl}</code> (apps/host/certs/ override)</>
              : 'using mkcert files in apps/host/certs/ (developer override)')
            : 'Sylo creates a unique CA when companion starts. The phone downloads it from the companion site.'}
          </p>
          {(companionFqdnUrl ?? companionUrlsLan[0] ?? companionUrl) ?
            <p className={cn(caption, 'mb-0 mt-2')}>
              {companionFqdnUrl ?
                <>On the phone, open the <strong>Tailscale URL</strong> → log in → <strong>Install app</strong>. No root-cert install needed — trusted Let's Encrypt cert for your node's <code className="text-[0.85em]">*.ts.net</code> name. Full steps: <code className="text-[0.85em]">docs/COMPANION_PHONE_INSTALL.md</code>.</>
              : <>On the phone, open the LAN URL → tap <strong>Download root certificate</strong> → install as CA
                → reload → log in → <strong>Install app</strong>. Full steps:{' '}
                <code className="text-[0.85em]">docs/COMPANION_PHONE_INSTALL.md</code></>}
            </p>
          : null}
          <details className="m-0">
            <summary className={detailsSummary}>Certificates &amp; phone setup</summary>
            <p className={detailsBody}>
              Root CA download path on the server:{' '}
              <code className="text-[0.85em]">/api/companion/root-ca.pem</code>. Changing the password
              logs out phones until they sign in again.
            </p>
          </details>
        </>
      : null}
    </section>
  )
}