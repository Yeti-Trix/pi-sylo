import { networkInterfaces } from 'node:os'



/** Tailscale CGNAT range — often marked internal but valid for phone access. */

export function isTailscaleIPv4(address: string): boolean {

  const parts = address.split('.').map((p) => Number(p))

  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false

  return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127

}



export function listLanIpv4Addresses(): string[] {

  const out: string[] = []

  for (const ifaces of Object.values(networkInterfaces())) {

    if (!ifaces) continue

    for (const iface of ifaces) {

      const fam = iface.family as string | number

      if (fam !== 'IPv4' && fam !== 4) continue

      if (iface.internal && !isTailscaleIPv4(iface.address)) continue

      out.push(iface.address)

    }

  }

  return [...new Set(out)]

}



export type CompanionPublicUrls = {
  loopback: string
  lan: string[]
  /** Public DNS URL from the override cert (e.g. Tailscale *.ts.net). null when using the self-signed Sylo CA. */
  fqdn: string | null
}

export function companionPublicUrls(
  port: number,
  bind: 'loopback' | 'lan',
  fqdnHost?: string | null,
): CompanionPublicUrls {
  const loopback = `https://127.0.0.1:${port}`
  const lan =
    bind === 'lan' ? listLanIpv4Addresses().map((ip) => `https://${ip}:${port}`) : []
  const fqdn = fqdnHost ? `https://${fqdnHost}:${port}` : null
  return { loopback, lan, fqdn }
}


