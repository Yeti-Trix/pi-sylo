/**
 * sylo-tasks — host main-process side of the live-subscription plumbing.
 *
 * The broker (agent tools) mutates the per-workspace JSON store and forwards
 * notifications via `process.send`. This module:
 *   1. caches the latest snapshot per (workspaceKey, listId) (Phase 1), and
 *   2. owns the Phase 2 binding registry — the task-board live subscriptions
 *      bound to workspaces — so `sylo-tasks:changed` updates can be fanned to
 *      the bound `liveId` via `broadcastLiveUpdate`.
 *
 * Per-workspace registry (restore-on-return model): each workspace may have
 * ONE active task-board at a time. Switching the sidebar workspace no longer
 * disposes the previous workspace's board — its `liveId` stays alive so the
 * docked canvas can restore it (with fresh data) when the operator switches
 * back. The renderer is the source of truth for "which workspace is showing";
 * main only needs the (workspaceKey → board) + (liveId → workspaceKey) maps so
 * `sylo-tasks:changed` fans to the right `liveId` and operator edits route to
 * the right store by `liveId`.
 *
 * The snapshot is intentionally `unknown` here to avoid a cross-package `.ts`
 * import (packages/sylo-tasks has `"type": "module"`, and direct `.ts` imports
 * from main trip TS6307 — see think-tank-config.ts). The shape is owned by the
 * package's `shared/types.ts`; main only passes it through to the renderer.
 */

import { broadcastLiveUpdate, disposeLive } from './canvas-live.js'
import { getPref, setPref } from './database.js'

/** workspaceKey → listId → latest snapshot. */
const snapshots = new Map<string, Map<string, unknown>>()

export function ingestTasksChanged(msg: {
  workspaceKey: unknown
  listId: unknown
  snapshot: unknown
}): void {
  const wk = String(msg.workspaceKey ?? '').trim()
  const lid = String(msg.listId ?? '').trim()
  if (!wk || !lid || msg.snapshot == null) return
  let bucket = snapshots.get(wk)
  if (!bucket) {
    bucket = new Map()
    snapshots.set(wk, bucket)
  }
  bucket.set(lid, msg.snapshot)
}

/** Shared fan-out for a tasks-store change (broker `sylo-tasks:changed` and
 *  the Phase 3 dashboard write path alike). Caches the snapshot and, if a
 *  task-board is bound to this (workspace, list), pushes it to the board's
 *  `liveId` (docked + any popout). A `null` snapshot means the list was
 *  deleted — dispose the bound board so the canvas clears instead of
 *  freezing at a stale last value. No-op when no board is bound. */
export function fanTasksChanged(args: {
  workspaceKey: string
  listId: string
  snapshot: unknown
}): void {
  const wk = args.workspaceKey.trim()
  const lid = args.listId.trim()
  if (!wk || !lid) return
  if (args.snapshot != null) ingestTasksChanged({ workspaceKey: wk, listId: lid, snapshot: args.snapshot })
  if (!isActiveBoard(wk, lid)) return
  const board = getBoardForWorkspace(wk)
  if (!board) return
  if (args.snapshot == null) {
    disposeLive(board.liveId)
    removeBoardByLiveId(board.liveId)
  } else {
    broadcastLiveUpdate(board.liveId, args.snapshot)
  }
}

export function getLatestTaskSnapshot(
  workspaceKey: string,
  listId: string,
): unknown | null {
  return snapshots.get(workspaceKey)?.get(listId) ?? null
}

// ── Phase 2: per-workspace task-board binding registry ───────────────────────
// One board per workspace. Opening a new list in a workspace disposes that
// workspace's previous board (the docked canvas shows a single artifact per
// workspace); other workspaces' boards stay alive for restore-on-return.

type BoardBinding = { liveId: string; listId: string }

/** workspaceKey → its current board binding. */
const boardByWorkspace = new Map<string, BoardBinding>()
/** Reverse index: liveId → the workspaceKey whose board it is. */
const workspaceByLiveId = new Map<string, string>()

/** Record a board binding for `workspaceKey` (overwrites any prior binding for
 *  this workspace — callers must have disposed the prior liveId first). */
export function setActiveTaskBoard(
  liveId: string,
  workspaceKey: string,
  listId: string,
): void {
  boardByWorkspace.set(workspaceKey, { liveId, listId })
  workspaceByLiveId.set(liveId, workspaceKey)
}

export function getBoardForWorkspace(workspaceKey: string): BoardBinding | null {
  return boardByWorkspace.get(workspaceKey) ?? null
}

export function getBoardByLiveId(liveId: string): {
  workspaceKey: string
  listId: string
} | null {
  const wk = workspaceByLiveId.get(liveId)
  if (!wk) return null
  const b = boardByWorkspace.get(wk)
  return b ? { workspaceKey: wk, listId: b.listId } : null
}

/** True if the board bound to `workspaceKey` is for `(workspaceKey, listId)`
 *  — i.e. a `sylo-tasks:changed` for this list should fan to that workspace's
 *  bound `liveId`. */
export function isActiveBoard(workspaceKey: string, listId: string): boolean {
  const b = boardByWorkspace.get(workspaceKey)
  return !!b && b.listId === listId
}

/** Remove a board binding by its `liveId` (after the liveId has been disposed).
 *  Cleans both maps and drops the persisted binding so a cleared board does not
 *  re-appear after a restart ("stay until manually cleared" semantics). */
export function removeBoardByLiveId(liveId: string): void {
  const wk = workspaceByLiveId.get(liveId)
  if (wk) {
    const b = boardByWorkspace.get(wk)
    if (b && b.liveId === liveId) boardByWorkspace.delete(wk)
    clearPersistedBoardBinding(wk)
  }
  workspaceByLiveId.delete(liveId)
}

// ── Restart persistence ─────────────────────────────────────────────────────
// The in-memory registry above is lost on restart. We also persist a tiny
// `workspaceKey → {listId, title}` map to a pref so the docked canvas can
// re-bind a workspace's last board on startup (lazy restore, driven by the
// renderer's `canvas:get-active-board-for-workspace` call). The snapshot is
// NEVER persisted — it is always re-fetched fresh from the store on restore,
// so the board reflects current task state, not a stale copy.
//
// The broker sends `workspaceKey` as SYLO_PI_CWD (backslashes on Windows);
// the renderer sends `cwd` as `resolvedPiCwd` (same path, possibly different
// slash/case). Normalize keys so persist (broker) and load (renderer) match
// regardless of trivial format drift.

const ACTIVE_BOARD_PREF = 'sylo.canvas.tasks.activeBoard'

type PersistedBinding = { listId: string; title?: string }

function normKey(wk: string): string {
  return wk.trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
}

function readPersistedMap(): Record<string, PersistedBinding> {
  return getPref<Record<string, PersistedBinding>>(ACTIVE_BOARD_PREF, {})
}

/** Persist (or overwrite) the board bound to a workspace so it survives restart. */
export function persistBoardBinding(workspaceKey: string, listId: string, title?: string): void {
  const wk = normKey(workspaceKey)
  if (!wk || !listId) return
  const map = readPersistedMap()
  map[wk] = { listId, title }
  setPref(ACTIVE_BOARD_PREF, map)
}

/** Drop the persisted binding for a workspace (board cleared / list deleted). */
export function clearPersistedBoardBinding(workspaceKey: string): void {
  const wk = normKey(workspaceKey)
  if (!wk) return
  const map = readPersistedMap()
  if (!(wk in map)) return
  delete map[wk]
  setPref(ACTIVE_BOARD_PREF, map)
}

/** Read the persisted binding for a workspace (null if none / the list is gone). */
export function loadPersistedBoardForWorkspace(workspaceKey: string): PersistedBinding | null {
  const wk = normKey(workspaceKey)
  if (!wk) return null
  const b = readPersistedMap()[wk]
  return b && b.listId ? b : null
}