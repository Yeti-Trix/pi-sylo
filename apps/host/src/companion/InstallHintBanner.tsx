import React, { useEffect, useState } from 'react'
import {
  detectInstallPlatform,
  dismissInstallHint,
  installHintDismissed,
  installHintText,
  isCompanionStandalone,
} from './installHint'
import {
  canPromptCompanionInstall,
  getCompanionPwaStatus,
  promptCompanionInstall,
} from './registerPwa'

const ROOT_CA_PATH = './api/companion/root-ca.pem'

export function InstallHintBanner(): React.ReactElement | null {
  const [hidden, setHidden] = useState(
    () => isCompanionStandalone() || installHintDismissed(),
  )
  const [installReady, setInstallReady] = useState(() => canPromptCompanionInstall())
  const [pwaStatus, setPwaStatus] = useState(() => getCompanionPwaStatus())
  const [needsCaOnPhone, setNeedsCaOnPhone] = useState(false)

  useEffect(() => {
    const refresh = () => {
      setInstallReady(canPromptCompanionInstall())
      setPwaStatus(getCompanionPwaStatus())
    }
    const onReady = () => setInstallReady(true)
    const onInstalled = () => setHidden(true)
    window.addEventListener('sylo-companion-install-ready', onReady)
    window.addEventListener('sylo-companion-installed', onInstalled)
    window.addEventListener('sylo-companion-pwa-status', refresh)
    void fetch('./api/companion/tls-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { needsCaOnPhone?: boolean } | null) => {
        setNeedsCaOnPhone(Boolean(info?.needsCaOnPhone))
        refresh()
      })
      .catch(() => refresh())
    return () => {
      window.removeEventListener('sylo-companion-install-ready', onReady)
      window.removeEventListener('sylo-companion-installed', onInstalled)
      window.removeEventListener('sylo-companion-pwa-status', refresh)
    }
  }, [])

  if (hidden) return null

  const platform = detectInstallPlatform()
  const onHttps = pwaStatus.secureContext
  const showCertHint =
    platform === 'android' &&
    (needsCaOnPhone || !onHttps || pwaStatus.serviceWorkerFailed || (onHttps && !installReady))

  return (
    <div className="border-b border-accent/25 bg-accent/[0.08] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold text-text-primary">Install Sylo on your phone</p>
          <p className="mt-1 mb-0 text-xs leading-relaxed text-text-secondary">
            {showCertHint ?
              'Download the root certificate from this server, install it on Android (Settings → Security → Install CA certificate), reload this page, then log in.'
            : installHintText(platform)}
            {' '}
            Log in once — the app reuses your session.
          </p>
          {showCertHint ?
            <a
              href={ROOT_CA_PATH}
              download="sylo-companion-ca.pem"
              className="mt-2 inline-flex rounded-lg border border-accent/40 bg-bg-secondary px-3 py-2 text-sm font-medium text-text-primary no-underline"
            >
              Download root certificate
            </a>
          : null}
          {installReady ?
            <button
              type="button"
              className="mt-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg-primary"
              onClick={() => {
                void promptCompanionInstall().then((accepted) => {
                  if (accepted) setHidden(true)
                })
              }}
            >
              Install app
            </button>
          : null}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
          aria-label="Dismiss"
          onClick={() => {
            dismissInstallHint()
            setHidden(true)
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
