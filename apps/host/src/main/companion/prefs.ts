import * as db from '../database.js'

import { hashCompanionPassword } from './auth.js'



export type CompanionBindMode = 'loopback' | 'lan'



export type CompanionPrefs = {

  enabled: boolean

  port: number

  bind: CompanionBindMode

  username: string

  passwordHash: string

  passwordSalt: string

}



const PREF_ENABLED = 'sylo.companion.enabled'

const PREF_PORT = 'sylo.companion.port'

const PREF_BIND = 'sylo.companion.bind'

const PREF_USERNAME = 'sylo.companion.username'

const PREF_PASSWORD_HASH = 'sylo.companion.password_hash'

const PREF_PASSWORD_SALT = 'sylo.companion.password_salt'



export const COMPANION_DEFAULT_PORT = 9241



function normalizePort(raw: unknown): number {

  const n = typeof raw === 'number' ? raw : Number(raw)

  if (!Number.isFinite(n) || n < 1024 || n > 65535) return COMPANION_DEFAULT_PORT

  return Math.floor(n)

}



function normalizeBind(raw: unknown): CompanionBindMode {

  return raw === 'lan' ? 'lan' : 'loopback'

}



function normalizeUsername(raw: unknown): string {

  return typeof raw === 'string' ? raw.trim() : ''

}



export function readCompanionPrefs(): CompanionPrefs {

  return {

    enabled: Boolean(db.getPref(PREF_ENABLED, false)),

    port: normalizePort(db.getPref(PREF_PORT, COMPANION_DEFAULT_PORT)),

    bind: normalizeBind(db.getPref(PREF_BIND, 'loopback')),

    username: normalizeUsername(db.getPref(PREF_USERNAME, '')),

    passwordHash: String(db.getPref(PREF_PASSWORD_HASH, '') || ''),

    passwordSalt: String(db.getPref(PREF_PASSWORD_SALT, '') || ''),

  }

}



export function hasCompanionCredentials(prefs?: CompanionPrefs): boolean {

  const p = prefs ?? readCompanionPrefs()

  return p.username.length > 0 && p.passwordHash.length > 0 && p.passwordSalt.length > 0

}



export function writeCompanionPrefs(patch: Partial<CompanionPrefs>): CompanionPrefs {

  const current = readCompanionPrefs()

  const next: CompanionPrefs = {

    enabled: patch.enabled ?? current.enabled,

    port: patch.port !== undefined ? normalizePort(patch.port) : current.port,

    bind: patch.bind !== undefined ? normalizeBind(patch.bind) : current.bind,

    username: patch.username !== undefined ? normalizeUsername(patch.username) : current.username,

    passwordHash: patch.passwordHash !== undefined ? patch.passwordHash : current.passwordHash,

    passwordSalt: patch.passwordSalt !== undefined ? patch.passwordSalt : current.passwordSalt,

  }

  db.setPref(PREF_ENABLED, next.enabled)

  db.setPref(PREF_PORT, next.port)

  db.setPref(PREF_BIND, next.bind)

  db.setPref(PREF_USERNAME, next.username)

  db.setPref(PREF_PASSWORD_HASH, next.passwordHash)

  db.setPref(PREF_PASSWORD_SALT, next.passwordSalt)

  return next

}



export function setCompanionCredentials(username: string, password: string): CompanionPrefs {

  const user = username.trim()

  if (!user) throw new Error('username_required')

  if (!password) throw new Error('password_required')

  const { hash, salt } = hashCompanionPassword(password)

  return writeCompanionPrefs({

    username: user,

    passwordHash: hash,

    passwordSalt: salt,

  })

}



export function companionBindHost(bind: CompanionBindMode): string {

  return bind === 'lan' ? '0.0.0.0' : '127.0.0.1'

}


