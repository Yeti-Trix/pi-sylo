/**
 * Best-effort auto-provisioning of a Tailscale Let's Encrypt cert for the
 * companion's public (MagicDNS) URL.
 *
 * Why this exists: `readCompanionPublicFqdn` (tls.ts) derives the phone URL's
 * host from the DNS SAN of an override cert at `apps/host/certs/sylo-tailscale.{crt,key}`.
 * Without that cert, the UI falls back to the raw tailnet IP. Provisioning the
 * cert automatically — when a Tailscale interface is present and the companion
 * is LAN-bound — makes the phone URL `https://<node>.<tailnet>.ts.net:<port>`
 * with no manual step, and the Let's Encrypt cert is publicly trusted so the
 * phone needs no custom CA install.
 *
 * Everything here is best-effort: any failure (no `tailscale` binary, tailnet
 * "HTTPS certificates" feature off, transient Let's Encrypt error) falls
 * through to the self-signed Sylo CA path in `ensureCompanionTlsMaterial`.
 * This module never throws.
 */
import { execFile as execFileCb } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

import { isTailscaleIPv4, listLanIpv4Addresses } from './server-urls.js'

const execFile = promisify(execFileCb)

/** Renew if the existing cert expires within this many days. */
const RENEW_WINDOW_DAYS = 14
const STATUS_TIMEOUT_MS = 10_000
const CERT_TIMEOUT_MS = 90_000
const CERT_BASENAME = 'sylo-tailscale'

export function companionTailscaleCertPaths(certsDir: string): {
  certPath: string
  keyPath: string
} {
  return {
    certPath: join(certsDir, `${CERT_BASENAME}.crt`),
    keyPath: join(certsDir, `${CERT_BASENAME}.key`),
  }
}

/**
 * Resolve the `tailscale` CLI binary. Returns an absolute path, or null when
 * not installed. Node's `execFile` does not append `.exe` on Windows, so we
 * search a few known locations plus every PATH entry ourselves.
 */
export function findTailscaleBinary(): string | null {
  const exe = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale'
  const candidates: string[] = []

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Tailscale\\tailscale.exe',
      'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
    )
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Tailscale.app/Contents/MacOS/Tailscale')
    candidates.push('/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale')
  } else {
    candidates.push('/usr/bin/tailscale', '/usr/local/bin/tailscale', '/snap/bin/tailscale')
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir) candidates.push(join(dir, exe))
  }

  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return null
}

/** True when a local interface carries a Tailscale CGNAT (100.64.0.0/10) IPv4. */
export function hasTailscaleInterface(): boolean {
  return listLanIpv4Addresses().some((ip) => isTailscaleIPv4(ip))
}

/**
 * This node's MagicDNS FQDN (e.g. `machine.tailnet-name.ts.net`), or null when
 * Tailscale is absent/offline or no Tailscale interface is present.
 */
export async function detectTailscaleFqdn(binary: string): Promise<string | null> {
  if (!hasTailscaleInterface()) return null
  try {
    const { stdout } = await execFile(binary, ['status', '--json'], {
      timeout: STATUS_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    const j = JSON.parse(stdout)
    const self = j?.Self
    const dns = typeof self?.DNSName === 'string' ? self.DNSName.trim() : ''
    if (!dns) return null
    // Tailscale reports a trailing dot (`machine.tailnet-name.ts.net.`).
    return dns.replace(/\.$/, '')
  } catch {
    return null
  }
}

/** Days until a PEM cert's notAfter; Infinity if unparseable. */
function daysUntilExpiry(certPath: string): number {
  try {
    const x509 = new X509Certificate(readFileSync(certPath, 'utf8'))
    const ms = new Date(x509.validTo).getTime() - Date.now()
    return ms / (24 * 60 * 60 * 1000)
  } catch {
    return -Infinity
  }
}

export type EnsureTailscaleCertResult = {
  /** The MagicDNS FQDN now covered by the cert, or null when not provisioned. */
  fqdn: string | null
  /** True iff we wrote/renewed the cert files this call. */
  provisioned: boolean
}

/**
 * Ensure `sylo-tailscale.{crt,key}` exists and is fresh for this node's
 * MagicDNS name. Idempotent + renewal-gated (only calls `tailscale cert` when
 * the cert is missing or inside the renewal window). Never throws.
 */
export async function ensureTailscaleCompanionCert(opts: {
  certsDir: string
  binary?: string | null
}): Promise<EnsureTailscaleCertResult> {
  const binary = opts.binary ?? findTailscaleBinary()
  if (!binary) return { fqdn: null, provisioned: false }

  const fqdn = await detectTailscaleFqdn(binary)
  if (!fqdn) return { fqdn: null, provisioned: false }

  const { certPath, keyPath } = companionTailscaleCertPaths(opts.certsDir)
  const certFresh =
    existsSync(certPath) && existsSync(keyPath) && daysUntilExpiry(certPath) > RENEW_WINDOW_DAYS
  if (certFresh) return { fqdn, provisioned: false }

  try {
    await execFile(
      binary,
      ['cert', '--cert-file', certPath, '--key-file', keyPath, fqdn],
      { timeout: CERT_TIMEOUT_MS },
    )
    return { fqdn, provisioned: true }
  } catch (e) {
    // A failed renewal with a still-valid existing cert is fine — keep using it.
    if (existsSync(certPath) && existsSync(keyPath) && daysUntilExpiry(certPath) > 0) {
      console.warn(
        '[sylo companion] tailscale cert renewal failed; keeping existing cert:',
        e instanceof Error ? e.message : String(e),
      )
      return { fqdn, provisioned: false }
    }
    console.warn(
      '[sylo companion] tailscale cert provisioning failed; falling back to self-signed CA:',
      e instanceof Error ? e.message : String(e),
    )
    return { fqdn: null, provisioned: false }
  }
}

/** Unused export kept for tests / future LAN-watchdog callers. */
export const _TAILSCALE_RENEW_WINDOW_DAYS = RENEW_WINDOW_DAYS
export const _TAILSCALE_HOMEDIR = homedir