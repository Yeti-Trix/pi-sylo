import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasPayload, CanvasTab, CanvasView } from './canvasTypes'

/**
 * Tab state for the docked canvas. Replaces the old single-slot model
 * (`canvasPayload` + `canvasLive` + `canvasPayloadByWs`) where one snapshot
 * and one live subscription shared a single visible slot and each new show
 * clobbered the previous artifact.
 *
 * Model:
 *  - Tabs are keyed per workspace id. Switching sidebar workspaces swaps the
 *    whole tab set (the old per-workspace snapshot stash, generalized).
 *  - A tab owns exactly one `CanvasView` — snapshot or live. This is what
 *    fixes the old Pop out bug: the single-slot model could hold a *shown*
 *    snapshot and a *hidden* live board at once (the ws-restore path set
 *    both), and `openCanvasPopout` preferred the hidden live board.
 *  - `canvas:show` opens a new tab, except when it matches an existing tab by
 *    `sourcePath` (same file re-shown → update in place, no tab spam from the
 *    chat chip View button) or `toolCallId` (agent re-show of the same call).
 *  - Live tabs stay subscribed even when backgrounded, so a task board keeps
 *    updating while the operator reads a snapshot tab. On workspace switch
 *    the old ws's live tabs unsubscribe (main keeps boards alive + fresh) and
 *    the new ws's re-subscribe, with data refreshed via
 *    `getActiveBoardForWorkspace` (which also recreates a board binding after
 *    a restart).
 *  - `canvas:live-clear` (Stop / board disposed) closes the tab bound to that
 *    `liveId` and activates a neighbor, mirroring the old blank-out.
 *
 * Refs mirror state because the main→renderer listeners are registered once
 * (empty deps) and must read current values (same pattern as the old
 * `activeWorkspaceCwdRef` gate).
 */

/** Normalize a path/workspace key: case, slash direction, trailing sep. */
export function normWsKey(s: string): string {
  return s.trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
}

type Options = {
  /** Active sidebar workspace id ('' until resolved). Tabs are keyed per id. */
  workspaceId: string
  /** Active workspace cwd — used for the ws-switch board restore. Read from
   *  the effect closure at switch time (same as the previous inline effect). */
  workspaceCwd: string
  /** Mirrors the active workspace cwd; read by the once-registered
   *  `canvas:show` / `canvas:live-show` workspace gates. */
  activeWorkspaceCwdRef: React.MutableRefObject<string>
  /** Called when a show/live-show lands (App opens + persists the panel). */
  onOpenPanel: () => void
}

export type UseCanvasTabs = {
  /** Tabs for the active workspace. */
  tabs: CanvasTab[]
  /** Active tab id for the active workspace (null = empty canvas). */
  activeTabId: string | null
  /** The active tab's view (null = empty canvas). */
  view: CanvasView | null
  setActiveTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  /** Replace the active tab's snapshot payload (used by Refresh). No-op when
   *  the active tab is live or missing. */
  updateActiveSnapshot: (fn: (p: CanvasPayload) => CanvasPayload) => void
}

export function useCanvasTabs({
  workspaceId,
  workspaceCwd,
  activeWorkspaceCwdRef,
  onOpenPanel,
}: Options): UseCanvasTabs {
  const [tabsByWs, setTabsByWs] = useState<Record<string, CanvasTab[]>>({})
  const [activeTabByWs, setActiveTabByWs] = useState<Record<string, string>>({})

  // Eager refs: mutated synchronously by every writer below, then pushed into
  // state. The once-registered listeners always read fresh values.
  const tabsRef = useRef<Record<string, CanvasTab[]>>({})
  const activeRef = useRef<Record<string, string>>({})
  const wsIdRef = useRef(workspaceId)
  // Previous workspace id — synced ONLY inside the switch effect below (the
  // generic wsIdRef is already updated by its own effect by the time that one
  // runs, so it can't be used to detect the transition).
  const prevWsRef = useRef('')
  const tabSeq = useRef(0)

  useEffect(() => {
    wsIdRef.current = workspaceId
  }, [workspaceId])

  const nextTabId = useCallback((): string => `canvas-tab-${++tabSeq.current}`, [])

  const writeTabs = useCallback((next: Record<string, CanvasTab[]>) => {
    tabsRef.current = next
    setTabsByWs(next)
  }, [])

  const writeActive = useCallback((next: Record<string, string>) => {
    activeRef.current = next
    setActiveTabByWs(next)
  }, [])

  const activate = useCallback(
    (wsId: string, tabId: string) => {
      writeActive({ ...activeRef.current, [wsId]: tabId })
    },
    [writeActive],
  )

  // ── canvas:show (snapshot) ────────────────────────────────────────────────
  useEffect(() => {
    const onShow = window.sylo.canvas?.onShow
    if (!onShow) return
    const u = onShow((p) => {
      // Per-workspace gate: a background workspace's agent canvas show must
      // not pollute the foreground workspace's tabs. The snapshot is
      // ephemeral — the chat chip View button can re-open it later from the
      // correct workspace. At startup (cwd not yet resolved) shows pass
      // through, preserving the original behavior.
      if (
        p.workspaceKey &&
        activeWorkspaceCwdRef.current &&
        normWsKey(p.workspaceKey) !== normWsKey(activeWorkspaceCwdRef.current)
      ) {
        return
      }
      const wsId = wsIdRef.current
      const payload: CanvasPayload = {
        toolCallId: p.toolCallId,
        kind: p.kind,
        title: p.title,
        content: p.content,
        filePath: p.filePath,
        sourcePath: p.sourcePath,
      }
      const tabs = tabsRef.current[wsId] ?? []
      // Dedupe: same file (sourcePath) or same tool call updates in place so
      // re-Viewing a file chip or re-running a show_canvas doesn't pile up
      // duplicate tabs.
      const srcKey = p.sourcePath?.trim() ? normWsKey(p.sourcePath) : ''
      const idx = tabs.findIndex((t) => {
        if (t.view.mode !== 'snapshot') return false
        const tp = t.view.payload
        if (srcKey && tp.sourcePath?.trim()) return normWsKey(tp.sourcePath) === srcKey
        return tp.toolCallId === p.toolCallId
      })
      const next = [...tabs]
      let targetId: string
      if (idx >= 0) {
        targetId = next[idx].id
        next[idx] = { id: targetId, view: { mode: 'snapshot', payload } }
      } else {
        targetId = nextTabId()
        next.push({ id: targetId, view: { mode: 'snapshot', payload } })
      }
      writeTabs({ ...tabsRef.current, [wsId]: next })
      activate(wsId, targetId)
      onOpenPanel()
    })
    return u
    // onOpenPanel must be a stable useCallback; activeWorkspaceCwdRef is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOpenPanel, nextTabId, writeTabs, activate])

  // ── canvas:live-show (live-demo / task-board) ────────────────────────────
  useEffect(() => {
    const onLiveShow = window.sylo.canvas?.onLiveShow
    if (!onLiveShow) return
    const u = onLiveShow((p) => {
      // Per-workspace gate (same semantics as the old inline effect): a
      // task-board show carries `workspaceKey`; live-demo shows omit it and
      // always apply. See the snapshot gate above for the startup caveat.
      if (
        p.workspaceKey &&
        activeWorkspaceCwdRef.current &&
        normWsKey(p.workspaceKey) !== normWsKey(activeWorkspaceCwdRef.current)
      ) {
        return
      }
      const wsId = wsIdRef.current
      const sub: CanvasView = {
        mode: 'live',
        sub: { liveId: p.liveId, kind: p.kind, title: p.title, data: p.data },
      }
      const tabs = tabsRef.current[wsId] ?? []
      const existing = tabs.find(
        (t) => t.view.mode === 'live' && t.view.sub.liveId === p.liveId,
      )
      const next = [...tabs]
      if (existing) {
        // Re-show of a live board we already track: refresh its data in place.
        const i = next.indexOf(existing)
        next[i] = { id: existing.id, view: sub }
        writeTabs({ ...tabsRef.current, [wsId]: next })
        activate(wsId, existing.id)
      } else {
        const id = nextTabId()
        next.push({ id, view: sub })
        writeTabs({ ...tabsRef.current, [wsId]: next })
        activate(wsId, id)
      }
      void window.sylo.canvas.liveSubscribe(p.liveId)
      onOpenPanel()
    })
    return u
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOpenPanel, nextTabId, writeTabs, activate])

  // ── canvas:live-update (fan-out patches) ─────────────────────────────────
  // Apply to the matching live tab in ANY workspace list: only subscribed
  // tabs receive patches, and background-ws tabs are unsubscribed, so this
  // just keeps visible (and recently-visible) boards current.
  useEffect(() => {
    const onLiveUpdate = window.sylo.canvas?.onLiveUpdate
    if (!onLiveUpdate) return
    const u = onLiveUpdate((p) => {
      let changed = false
      const next: Record<string, CanvasTab[]> = {}
      for (const [ws, tabs] of Object.entries(tabsRef.current)) {
        let wsChanged = false
        const nt = tabs.map((t): CanvasTab => {
          if (t.view.mode !== 'live' || t.view.sub.liveId !== p.liveId) return t
          wsChanged = true
          return {
            id: t.id,
            view: { mode: 'live', sub: { ...t.view.sub, data: p.data } },
          }
        })
        next[ws] = wsChanged ? nt : tabs
        if (wsChanged) changed = true
      }
      if (changed) writeTabs(next)
    })
    return u
  }, [writeTabs])

  // ── canvas:live-clear (Stop / board disposed) ────────────────────────────
  // Close the tab bound to that liveId everywhere; if it was the active tab
  // of the current workspace, activate a neighbor (browser semantics).
  useEffect(() => {
    const onLiveClear = window.sylo.canvas?.onLiveClear
    if (!onLiveClear) return
    const u = onLiveClear((p) => {
      const cur = wsIdRef.current
      const next: Record<string, CanvasTab[]> = {}
      let activateId: string | null = null
      let hasCurrentWs = false
      for (const [ws, tabs] of Object.entries(tabsRef.current)) {
        const idx = tabs.findIndex(
          (t) => t.view.mode === 'live' && t.view.sub.liveId === p.liveId,
        )
        if (idx < 0) {
          next[ws] = tabs
          continue
        }
        const remaining = tabs.filter((_, i) => i !== idx)
        next[ws] = remaining
        if (ws === cur) {
          hasCurrentWs = true
          if ((activeRef.current[cur] ?? '') === tabs[idx].id) {
            // Neighbor at the same position in the post-removal list.
            const neighbor = remaining[Math.min(idx, remaining.length - 1)] ?? null
            activateId = neighbor ? neighbor.id : ''
          }
        }
      }
      writeTabs(next)
      if (hasCurrentWs && activateId !== null) {
        writeActive({ ...activeRef.current, [cur]: activateId })
      }
    })
    return u
  }, [writeTabs, writeActive])

  // ── workspace switch: swap tab sets, rebind live subscriptions ───────────
  useEffect(() => {
    const prevWs = prevWsRef.current
    prevWsRef.current = workspaceId
    if (prevWs === workspaceId) return
    // Unsubscribe the old workspace's live tabs — main keeps each board alive
    // and its `sub.data` fresh for the return trip; we just stop receiving
    // patches for tabs we can't see.
    for (const t of tabsRef.current[prevWs] ?? []) {
      if (t.view.mode === 'live') void window.sylo.canvas?.liveUnsubscribe(t.view.sub.liveId)
    }
    // Re-subscribe the new workspace's live tabs.
    for (const t of tabsRef.current[workspaceId] ?? []) {
      if (t.view.mode === 'live') void window.sylo.canvas?.liveSubscribe(t.view.sub.liveId)
    }
    // Refresh the new workspace's bound task board (fresh data; also restores
    // a binding lost to a main-process restart). Does NOT open the panel — a
    // workspace switch must not force the canvas open.
    void (async () => {
      if (!workspaceCwd) return
      const board = await window.sylo.canvas?.getActiveBoardForWorkspace(workspaceCwd)
      if (!board) {
        // Board deleted (or binding cleared) while away: its tab(s) are dead.
        const current = tabsRef.current[workspaceId] ?? []
        const stale = current.filter(
          (t) => t.view.mode === 'live' && t.view.sub.kind === 'task-board',
        )
        if (stale.length > 0) {
          const remaining = current.filter(
            (t) => !(t.view.mode === 'live' && t.view.sub.kind === 'task-board'),
          )
          writeTabs({ ...tabsRef.current, [workspaceId]: remaining })
          const active = activeRef.current[workspaceId] ?? ''
          if (stale.some((t) => t.id === active)) {
            writeActive({ ...activeRef.current, [workspaceId]: remaining[0]?.id ?? '' })
          }
        }
        return
      }
      const tabs = tabsRef.current[workspaceId] ?? []
      const existing = tabs.find(
        (t) => t.view.mode === 'live' && t.view.sub.liveId === board.liveId,
      )
      const freshSub: CanvasView = {
        mode: 'live',
        sub: { liveId: board.liveId, kind: board.kind, title: board.title, data: board.data },
      }
      if (existing) {
        writeTabs({
          ...tabsRef.current,
          [workspaceId]: tabs.map((t) => (t.id === existing.id ? { id: t.id, view: freshSub } : t)),
        })
        return
      }
      const id = nextTabId()
      writeTabs({ ...tabsRef.current, [workspaceId]: [...tabs, { id, view: freshSub }] })
      // This tab didn't exist at switch time, so the sync re-subscribe loop
      // above didn't cover it.
      void window.sylo.canvas?.liveSubscribe(board.liveId)
      // Old restore semantics: the returned board became the shown view only
      // when there was nothing else to show (the stashed snapshot won).
      if (tabs.length === 0) activate(workspaceId, id)
    })()
    // workspaceCwd is read at switch time via closure (same as the previous
    // inline effect, which also disabled exhaustive-deps here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, writeTabs, writeActive, activate, nextTabId])

  const setActiveTab = useCallback(
    (tabId: string) => activate(wsIdRef.current, tabId),
    [activate],
  )

  const closeTab = useCallback(
    (tabId: string) => {
      const cur = wsIdRef.current
      const tabs = tabsRef.current[cur] ?? []
      const idx = tabs.findIndex((t) => t.id === tabId)
      if (idx < 0) return
      const tab = tabs[idx]
      if (tab.view.mode === 'live') {
        void window.sylo.canvas?.liveUnsubscribe(tab.view.sub.liveId)
      }
      const remaining = tabs.filter((t) => t.id !== tabId)
      writeTabs({ ...tabsRef.current, [cur]: remaining })
      if ((activeRef.current[cur] ?? '') === tabId) {
        const neighbor = remaining[Math.min(idx, remaining.length - 1)] ?? null
        writeActive({ ...activeRef.current, [cur]: neighbor ? neighbor.id : '' })
      }
    },
    [writeTabs, writeActive],
  )

  const updateActiveSnapshot = useCallback(
    (fn: (p: CanvasPayload) => CanvasPayload) => {
      const cur = wsIdRef.current
      const activeId = activeRef.current[cur] ?? ''
      if (!activeId) return
      const tabs = tabsRef.current[cur] ?? []
      let changed = false
      const next = tabs.map((t): CanvasTab => {
        if (t.id !== activeId || t.view.mode !== 'snapshot') return t
        changed = true
        return { id: t.id, view: { mode: 'snapshot', payload: fn(t.view.payload) } }
      })
      if (changed) writeTabs({ ...tabsRef.current, [cur]: next })
    },
    [writeTabs],
  )

  const tabs = tabsByWs[workspaceId] ?? []
  const activeTabId = activeTabByWs[workspaceId] ?? tabs[0]?.id ?? null
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const view: CanvasView | null = activeTab ? activeTab.view : null

  return { tabs, activeTabId, view, setActiveTab, closeTab, updateActiveSnapshot }
}