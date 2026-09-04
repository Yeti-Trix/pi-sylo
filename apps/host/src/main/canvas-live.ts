import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'

/**
 * Live (subscribed) Canvas — sibling to the snapshot pipeline in `canvas-popout.ts`.
 *
 * The snapshot canvas emits a single `canvas:show` payload and is then static;
 * a popped-out snapshot fetches its stash once via `canvas:get-popout` and
 * registers no update listener. Live canvas instead registers a `liveId` with
 * a set of subscribed `WebContents` (the main window's docked canvas + any
 * popped-out canvas windows bound to that `liveId`); the main process fans
 * `canvas:live-update` patches to every subscriber.
 *
 * Live kinds:
 *   `'task-board'`  — a task list bound to a `liveId` (rendered by
 *                     `CanvasLiveContent`). Future kinds (`draw`, `3d` …) add
 *                     another host-owned render branch and another entry here
 *                     — they do not touch the snapshot kinds.
 */
export type CanvasLiveKind = 'live-demo' | 'task-board'

export type CanvasLiveSubscription = {
  liveId: string
  kind: CanvasLiveKind
  title?: string
  /** Last-known live data. Subscribers render this until a `canvas:live-update`
   *  patch arrives. The main process keeps it current so a newly opened popout
   *  can fetch the latest state via `getLiveSubscription`. */
  data?: unknown
}

type LiveEntry = {
  sub: CanvasLiveSubscription
  subscribers: Set<WebContents>
}

const liveStore = new Map<string, LiveEntry>()

function cleanSubscribers(entry: LiveEntry): void {
  for (const wc of entry.subscribers) {
    if (wc.isDestroyed()) entry.subscribers.delete(wc)
  }
}

export function createLiveSubscription(
  init: Omit<CanvasLiveSubscription, 'liveId'>,
): CanvasLiveSubscription {
  const liveId = randomUUID()
  const sub: CanvasLiveSubscription = { liveId, ...init }
  liveStore.set(liveId, { sub, subscribers: new Set() })
  return sub
}

export function getLiveSubscription(liveId: string): CanvasLiveSubscription | null {
  const key = liveId.trim()
  if (!key) return null
  return liveStore.get(key)?.sub ?? null
}

/** Register a `WebContents` (main window's docked canvas, or a popped-out
 *  canvas window) to receive `canvas:live-update` patches for `liveId`.
 *  Auto-removes when the `WebContents` is destroyed so closed popouts don't
 *  leak. Returns false if the `liveId` is unknown. */
export function subscribeLive(liveId: string, wc: WebContents): boolean {
  const key = liveId.trim()
  const entry = liveStore.get(key)
  if (!entry) return false
  if (!entry.subscribers.has(wc)) {
    entry.subscribers.add(wc)
    wc.once('destroyed', () => {
      entry.subscribers.delete(wc)
    })
  }
  return true
}

export function unsubscribeLive(liveId: string, wc: WebContents): void {
  const key = liveId.trim()
  const entry = liveStore.get(key)
  if (!entry) return
  entry.subscribers.delete(wc)
}

/** Fan a data patch to every live subscriber for `liveId` (docked main window
 *  + any popped-out canvas windows). Also updates the stored snapshot so a
 *  newly opened popout fetches the latest state. No-op if `liveId` unknown. */
export function broadcastLiveUpdate(liveId: string, data: unknown): void {
  const key = liveId.trim()
  const entry = liveStore.get(key)
  if (!entry) return
  entry.sub.data = data
  cleanSubscribers(entry)
  for (const wc of entry.subscribers) {
    if (!wc.isDestroyed()) wc.send('canvas:live-update', { liveId: key, data })
  }
}

/** Fan a `canvas:live-clear` to every live subscriber for `liveId` (docked
 *  main window + any popped-out canvas windows) so they all blank cleanly.
 *  No-op if `liveId` unknown. Used by `disposeLive` and any future explicit
 *  "end this live view" path. */
export function broadcastLiveClear(liveId: string): void {
  const key = liveId.trim()
  const entry = liveStore.get(key)
  if (!entry) return
  cleanSubscribers(entry)
  for (const wc of entry.subscribers) {
    if (!wc.isDestroyed()) wc.send('canvas:live-clear', { liveId: key })
  }
}

/** Tear down a live subscription: fans a `canvas:live-clear` to every
 *  subscriber (docked + popouts) so they blank cleanly instead of freezing at
 *  a stale last value, then drops subscribers and removes the entry. */
export function disposeLive(liveId: string): void {
  const key = liveId.trim()
  const entry = liveStore.get(key)
  if (!entry) return
  broadcastLiveClear(key)
  entry.subscribers.clear()
  liveStore.delete(key)
}