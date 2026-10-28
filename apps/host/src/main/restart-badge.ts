/** Main-process state for the agent-raised "Restart Required" badge (issue #44).
 *  App-global: any broker chat can raise it; it persists in userData/sylo-data so it
 *  survives app close, and clears at the next launch — the restart it was waiting for.
 *  Deliberately NOT cleared by "Restart broker": that reloads Pi but no main-process
 *  or dependency change this badge tracks. */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

import {
  coerceRestartBadge,
  emptyRestartBadge,
  mergeRestartBadge,
  RESTART_BADGE_MARKER,
  type RestartBadgeState,
} from '../shared/restart-badge.js'

let badge: RestartBadgeState = emptyRestartBadge()
let markerPath = ''

/** userData/sylo-data — next to sylo.sqlite; main process calls this once at boot. */
export function initRestartBadgeStore(userDataPath: string): void {
  markerPath = join(userDataPath, 'sylo-data', RESTART_BADGE_MARKER)
  // A launch IS the restart the badge asked for: always clear at boot, silently.
  // (The in-memory badge starts empty either way; the delete keeps the folder tidy
  // and makes "was a restart pending?" greppable in logs only.)
  try {
    if (markerPath && rmSyncIfPresent(markerPath)) {
      console.log('[sylo] restart-required badge cleared: marker consumed by this launch')
    }
  } catch (e) {
    console.warn('[sylo] restart-required marker cleanup failed:', String((e as Error)?.message ?? e))
  }
  badge = emptyRestartBadge()
}

function rmSyncIfPresent(path: string): boolean {
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

export function getRestartBadge(): RestartBadgeState {
  return badge
}

export function raiseRestartBadge(rawReason: unknown, source: unknown, raisedAt: unknown): RestartBadgeState {
  const reason = typeof rawReason === 'string' ? rawReason.trim() : ''
  if (!reason) return badge
  const raise = coerceRestartBadge({
    required: true,
    reason,
    raisedAt: typeof raisedAt === 'number' && Number.isFinite(raisedAt) ? raisedAt : Date.now(),
    source: typeof source === 'string' && source.trim() ? source.trim() : null,
  })
  badge = mergeRestartBadge(badge, raise)
  persist()
  return badge
}

function persist(): void {
  if (!markerPath) return
  try {
    badge = coerceRestartBadge(badge)
    writeFileSync(markerPath, JSON.stringify(badge, null, 2), 'utf8')
  } catch (e) {
    console.warn('[sylo] restart-required marker write failed:', String((e as Error)?.message ?? e))
  }
}

type BadgeWindow = Pick<BrowserWindow, 'webContents' | 'isDestroyed'> | null | undefined

export function broadcastRestartBadge(mw: BadgeWindow): void {
  if (mw && !mw.isDestroyed()) mw.webContents.send('restart-badge:changed', badge)
}