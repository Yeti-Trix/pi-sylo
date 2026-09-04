import React, { useEffect, useState } from 'react'
import { detectInstallPlatform } from './installHint'

const ROOT_CA_PATH = './api/companion/root-ca.pem'

type TlsInfo = {
  mode: 'mkcert' | 'sylo-ca'
  needsCaOnPhone?: boolean
  rootCaDownloadPath?: string
}

export function CertificateSetupPanel(): React.ReactElement | null {
  const [tlsInfo, setTlsInfo] = useState<TlsInfo | null>(null)
  const secure = typeof window !== 'undefined' && window.isSecureContext
  const platform = detectInstallPlatform()

  useEffect(() => {
    void fetch('./api/companion/tls-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info: TlsInfo | null) => setTlsInfo(info))
      .catch(() => setTlsInfo(null))
  }, [])

  if (secure) return null
  if (platform === 'other' && tlsInfo?.mode !== 'sylo-ca') return null

  const downloadPath = tlsInfo?.rootCaDownloadPath ?? ROOT_CA_PATH

  return (
    <div className="rounded-xl border border-accent/30 bg-bg-secondary p-4">
      <p className="m-0 text-sm font-semibold text-text-primary">Step 1 — Trust this Sylo server</p>
      <p className="mt-2 mb-0 text-xs leading-relaxed text-text-secondary">
        {platform === 'android' ?
          'Download the root certificate, install it as a CA certificate (Settings → Security → Install CA certificate), then reload this page. You need a padlock before Chrome can offer Install app.'
        : platform === 'ios' ?
          'Download the root certificate, install the profile, enable it under Settings → General → About → Certificate Trust Settings, then reload this page.'
        : 'Download and trust the root certificate on this device, then reload this page.'}
      </p>
      <a
        href={downloadPath}
        download="sylo-companion-ca.pem"
        className="mt-3 inline-flex rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg-primary no-underline"
      >
        Download root certificate
      </a>
      <p className="mt-2 mb-0 text-[0.7rem] text-text-secondary">
        Accept the browser warning once to reach this download. After installing the CA, close the tab and open the
        same URL again — the warning should disappear.
      </p>
    </div>
  )
}
