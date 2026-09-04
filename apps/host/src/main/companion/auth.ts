import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import { hasCompanionCredentials, readCompanionPrefs, type CompanionPrefs } from './prefs.js'

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 } as const
export const COMPANION_SESSION_COOKIE = 'sylo_companion_session'
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60

type SessionRow = {
  username: string
  createdAt: number
}

const sessions = new Map<string, SessionRow>()

export function hashCompanionPassword(
  password: string,
  saltHex?: string,
): { hash: string; salt: string } {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16)
  const hash = scryptSync(password, salt, 32, SCRYPT_OPTIONS)
  return { hash: hash.toString('hex'), salt: salt.toString('hex') }
}

function verifyCompanionPassword(
  password: string,
  saltHex: string,
  hashHex: string,
): boolean {
  if (!password || !saltHex || !hashHex) return false
  try {
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(password, salt, 32, SCRYPT_OPTIONS)
    if (actual.length !== expected.length) return false
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function normalizeUsername(value: string): string {
  return value.trim()
}

export function verifyCompanionLogin(
  username: string,
  password: string,
  prefs: CompanionPrefs = readCompanionPrefs(),
): boolean {
  if (!hasCompanionCredentials(prefs)) return false
  if (normalizeUsername(username) !== prefs.username) return false
  return verifyCompanionPassword(password, prefs.passwordSalt, prefs.passwordHash)
}

export function createCompanionSession(username: string): string {
  const id = randomBytes(24).toString('hex')
  sessions.set(id, { username: normalizeUsername(username), createdAt: Date.now() })
  return id
}

export function clearCompanionSessions(): void {
  sessions.clear()
}

export function validateCompanionSession(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false
  const row = sessions.get(sessionId)
  if (!row) return false
  if (Date.now() - row.createdAt > SESSION_MAX_AGE_SEC * 1000) {
    sessions.delete(sessionId)
    return false
  }
  return true
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

export function sessionIdFromRequest(req: IncomingMessage): string | null {
  const cookies = parseCookieHeader(req.headers.cookie)
  const id = cookies[COMPANION_SESSION_COOKIE]
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export function isCompanionRequestAuthorized(req: IncomingMessage): boolean {
  if (!hasCompanionCredentials()) return false
  return validateCompanionSession(sessionIdFromRequest(req))
}

export function sessionCookieHeader(sessionId: string, secure = false): string {
  const secureFlag = secure ? '; Secure' : ''
  return `${COMPANION_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secureFlag}`
}

export function clearSessionCookieHeader(secure = false): string {
  const secureFlag = secure ? '; Secure' : ''
  return `${COMPANION_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`
}

export function companionSessionUsername(req: IncomingMessage): string | null {
  const id = sessionIdFromRequest(req)
  if (!id) return null
  return sessions.get(id)?.username ?? null
}
