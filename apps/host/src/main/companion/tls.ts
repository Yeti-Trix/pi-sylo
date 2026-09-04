import { X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate } from 'selfsigned'

import { listLanIpv4Addresses } from './server-urls.js'
import type { CompanionBindMode } from './prefs.js'
import { ensureTailscaleCompanionCert } from './tailscale-cert.js'

export type CompanionTlsMaterial = {
  key: string
  cert: string
}

export type CompanionTlsMode = 'mkcert' | 'sylo-ca'

export type CompanionTlsTrustInfo = {
  mode: CompanionTlsMode
  certName: string
  certsDir: string
  /** Absolute path on desktop (Settings copy button). */
  rootCaPath: string | null
  /** Relative URL on companion server for phone download. */
  rootCaDownloadPath: string
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOST_ROOT = join(__dirname, '..', '..')
export const COMPANION_CERTS_DIR = join(HOST_ROOT, 'certs')
export const COMPANION_ROOT_CA_DOWNLOAD_PATH = '/api/companion/root-ca.pem'

const MKCERT_CERT_CANDIDATES = ['sylo-companion', 'sylo-tailscale'] as const

function tlsDir(userDataPath: string): string {
  return join(userDataPath, 'companion-tls')
}

function altNameFingerprint(altNames: string[]): string {
  return [...altNames].sort().join('\n')
}

function buildTlsAltNames(): string[] {
  const names = new Set<string>(['localhost', '127.0.0.1'])
  const host = hostname().trim()
  if (host) names.add(host)
  for (const ip of listLanIpv4Addresses()) names.add(ip)
  return [...names]
}

function mapAltNames(altNames: string[]) {
  return altNames.map((name) =>
    /^\d+\.\d+\.\d+\.\d+$/.test(name) ? { type: 7 as const, ip: name } : { type: 2 as const, value: name },
  )
}

function resolveMkcertPaths(): { certPath: string; keyPath: string; certName: string } | null {
  for (const name of MKCERT_CERT_CANDIDATES) {
    const certPath = join(COMPANION_CERTS_DIR, `${name}.crt`)
    const keyPath = join(COMPANION_CERTS_DIR, `${name}.key`)
    if (existsSync(certPath) && existsSync(keyPath)) {
      return { certPath, keyPath, certName: name }
    }
  }
  return null
}

function defaultMkcertRootCaPath(): string | null {
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    const winPath = join(localAppData, 'mkcert', 'rootCA.pem')
    if (existsSync(winPath)) return winPath
  }
  const homeCa = join(homedir(), '.local', 'share', 'mkcert', 'rootCA.pem')
  if (existsSync(homeCa)) return homeCa
  const macCa = join(homedir(), 'Library', 'Application Support', 'mkcert', 'rootCA.pem')
  if (existsSync(macCa)) return macCa
  return null
}

function resolveBundledRootCaPath(): string | null {
  const bundled = join(COMPANION_CERTS_DIR, 'rootCA.pem')
  return existsSync(bundled) ? bundled : null
}

function syloCaPaths(userDataPath: string) {
  const dir = tlsDir(userDataPath)
  return {
    dir,
    caPath: join(dir, 'ca.pem'),
    caKeyPath: join(dir, 'ca-key.pem'),
    keyPath: join(dir, 'key.pem'),
    certPath: join(dir, 'cert.pem'),
    metaPath: join(dir, 'alt-names.txt'),
  }
}

export function getCompanionTlsTrustInfo(userDataPath: string): CompanionTlsTrustInfo {
  const mkcert = resolveMkcertPaths()
  if (mkcert) {
    return {
      mode: 'mkcert',
      certName: mkcert.certName,
      certsDir: COMPANION_CERTS_DIR,
      rootCaPath: resolveBundledRootCaPath() ?? defaultMkcertRootCaPath(),
      rootCaDownloadPath: COMPANION_ROOT_CA_DOWNLOAD_PATH,
    }
  }
  const { caPath } = syloCaPaths(userDataPath)
  return {
    mode: 'sylo-ca',
    certName: 'Sylo Companion (auto)',
    certsDir: tlsDir(userDataPath),
    rootCaPath: existsSync(caPath) ? caPath : null,
    rootCaDownloadPath: COMPANION_ROOT_CA_DOWNLOAD_PATH,
  }
}

/** PEM body for phone CA install. Public — no auth required. */
export function readCompanionRootCaPem(userDataPath: string): string | null {
  const mkcert = resolveMkcertPaths()
  if (mkcert) {
    const bundled = resolveBundledRootCaPath()
    if (bundled) return readFileSync(bundled, 'utf8')
    const system = defaultMkcertRootCaPath()
    if (system) return readFileSync(system, 'utf8')
    return null
  }
  const { caPath } = syloCaPaths(userDataPath)
  if (!existsSync(caPath)) return null
  return readFileSync(caPath, 'utf8')
}

/**
 * The public DNS name baked into the *override* cert (e.g. the Tailscale
 * `*.ts.net` Let's Encrypt cert in `apps/host/certs/sylo-tailscale.crt`).
 * Returns null for the self-signed Sylo CA (whose SAN is IPs/localhost only) so
 * the UI falls back to the raw LAN IP URLs. No hardcoding — derived from the
 * cert itself, so it is correct on whichever machine provisioned its cert.
 */
export function readCompanionPublicFqdn(userDataPath: string): string | null {
  const override = resolveMkcertPaths()
  if (!override || !existsSync(override.certPath)) return null
  try {
    const x509 = new X509Certificate(readFileSync(override.certPath, 'utf8'))
    const san = x509.subjectAltName
    if (san) {
      const m = /DNS:([^\s,]+)/.exec(san)
      if (m) return m[1]
    }
    const cn = /CN=([^,/]+)/.exec(x509.subject)
    return cn ? cn[1].trim() : null
  } catch (e) {
    console.error('[sylo companion] could not read public FQDN from cert:', e)
    return null
  }
}

async function generateSyloCaAndServer(userDataPath: string, altNames: string[]): Promise<CompanionTlsMaterial> {
  const paths = syloCaPaths(userDataPath)
  mkdirSync(paths.dir, { recursive: true })

  const notBeforeDate = new Date()
  const notAfterDate = new Date(notBeforeDate)
  notAfterDate.setDate(notAfterDate.getDate() + 825)

  let caKey = existsSync(paths.caKeyPath) ? readFileSync(paths.caKeyPath, 'utf8') : null
  let caCert = existsSync(paths.caPath) ? readFileSync(paths.caPath, 'utf8') : null

  if (!caKey || !caCert) {
    const ca = await generate([{ name: 'commonName', value: 'Sylo Companion CA' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate,
      notAfterDate,
      extensions: [{ name: 'basicConstraints', cA: true, critical: true }],
    })
    caKey = ca.private
    caCert = ca.cert
    writeFileSync(paths.caKeyPath, caKey, 'utf8')
    writeFileSync(paths.caPath, caCert, 'utf8')
  }

  const server = await generate([{ name: 'commonName', value: 'Sylo Companion' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    ca: { key: caKey, cert: caCert },
    extensions: [{ name: 'subjectAltName', altNames: mapAltNames(altNames) }],
  })

  writeFileSync(paths.keyPath, server.private, 'utf8')
  writeFileSync(paths.certPath, server.cert, 'utf8')
  writeFileSync(paths.metaPath, altNameFingerprint(altNames), 'utf8')

  return { key: server.private, cert: server.cert }
}

/**
 * mkcert override in apps/host/certs/, else auto CA + server cert in userData.
 *
 * When the companion is LAN-bound and a Tailscale interface is present, this
 * first best-effort provisions/renews a Tailscale Let's Encrypt cert for the
 * node's MagicDNS name into `apps/host/certs/sylo-tailscale.{crt,key}`; that
 * override is then picked up by `resolveMkcertPaths` so the phone URL becomes
 * `https://<node>.<tailnet>.ts.net:<port>` with no manual step. Any failure
 * falls through to the self-signed Sylo CA.
 */
export async function ensureCompanionTlsMaterial(
  userDataPath: string,
  bind?: CompanionBindMode,
): Promise<CompanionTlsMaterial> {
  if (bind === 'lan') {
    await ensureTailscaleCompanionCert({ certsDir: COMPANION_CERTS_DIR })
  }
  const mkcert = resolveMkcertPaths()
  if (mkcert) {
    return {
      key: readFileSync(mkcert.keyPath, 'utf8'),
      cert: readFileSync(mkcert.certPath, 'utf8'),
    }
  }

  const paths = syloCaPaths(userDataPath)
  const altNames = buildTlsAltNames()
  const fingerprint = altNameFingerprint(altNames)

  if (
    existsSync(paths.keyPath) &&
    existsSync(paths.certPath) &&
    existsSync(paths.metaPath) &&
    readFileSync(paths.metaPath, 'utf8') === fingerprint
  ) {
    return {
      key: readFileSync(paths.keyPath, 'utf8'),
      cert: readFileSync(paths.certPath, 'utf8'),
    }
  }

  return generateSyloCaAndServer(userDataPath, altNames)
}
