/**
 * SSRF guard for outbound fetches.
 *
 * Blocks loopback, RFC1918 private ranges, link-local, CGNAT, and IPv6
 * loopback/ULA/link-local destinations so a malicious search result cannot
 * coerce the host into probing internal services. Reference pattern borrowed
 * from `@juicesharp/rpiv-web-tools` and legacy Sylo `url_normalize.py`.
 *
 * Note: this is a hostname/literal-IP check only. It does NOT resolve DNS, so
 * it does not defend against DNS-rebinding; that is acceptable for L1/L2 where
 * the threat model is "untrusted URL", not "actively hostile DNS".
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback'])

/** Decimal-dotted IPv4 → 32-bit integer, or null if not an IPv4 literal. */
function ipv4ToInt(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const octets = m.slice(1, 5).map((o) => Number(o))
  if (octets.some((o) => o > 255)) return null
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0
}

function isPrivateIpv4(host: string): boolean {
  const n = ipv4ToInt(host)
  if (n === null) return false
  const inRange = (a: string, bits: number): boolean => {
    const base = ipv4ToInt(a)!
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (n & mask) === (base & mask)
  }
  return (
    inRange('10.0.0.0', 8) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.168.0.0', 16) ||
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('0.0.0.0', 8) // "this network"
  )
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === '::1' || h === '::') return true
  if (h.startsWith('fe80:')) return true // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true // unique local (fc00::/7)
  // IPv4-mapped (::ffff:a.b.c.d)
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h)
  if (mapped) return isPrivateIpv4(mapped[1]!)
  return false
}

/**
 * Validate a URL for outbound fetch.
 *
 * @param raw - Candidate URL string.
 * @returns `{ ok: true, url }` with a normalized URL, or `{ ok: false, error }`.
 */
export function assertFetchableUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: `Invalid URL: ${raw}` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `Blocked non-http(s) scheme: ${url.protocol}` }
  }
  const host = url.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, error: `Blocked hostname: ${host}` }
  }
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: `Blocked internal TLD: ${host}` }
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { ok: false, error: `Blocked private/loopback address: ${host}` }
  }
  return { ok: true, url }
}
