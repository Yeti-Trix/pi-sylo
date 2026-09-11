import { useCallback, useEffect, useRef, useState } from 'react'
import {
  APP_TAB_KIND_LABEL,
  type AppTabKind,
  type CanvasPayload,
  type CanvasTab,
  type CanvasView,
} from './canvasTypes'

/**
 * Tab state for the docked apps pane. Replaces the old single-slot model
 * (`canvasPayload` + `canvasLive` + `canvasPayloadByWs`) where one snapshot
 * and one live subscription shared a single visible slot and each new show
 * clobbered the previous artifact.
 *
 * Model:
 *  - Tabs are keyed per SCOPE: `c:<conversationId>` when a chat is focused,
 *    `w:<workspaceId>` as the fallback (no focused chat). Switching the active
 *    conversation swaps the per-chat artifact tab set (canvas snapshots,
 *    sketches, side chat); the WORKSPACE POOL — task boards, terminals and
 *    browsers — always lives in the `w:` bucket and stays visible in the strip
 *    regardless of which conversation is focused (dedup by `liveId` for
 *    boards; terminals/browsers are repeatable, one pty/URL state per tab).
 *  - `activeByScope[scopeKey]` means "the tab I was last looking at while
 *    viewing that scope". Clicking/opening a tab always records it for the
 *    scope being VIEWED (even if the tab physically lives in the other
 *    bucket), and the render resolves: current scope's record (if the tab
 *    still exists) → ws bucket's record → first tab. Stale/'' ids fall
 *    through, so a closed tab can never blank the pane.
 *  - A tab owns exactly one `CanvasView` — snapshot or live (or is an app
 *    pane: terminal / browser / side chat, which ignore `view`). This is what
 *    fixes the old Pop out bug: the single-slot model could hold a *shown*
 *    snapshot and a *hidden* live board at once (the ws-restore path set
 *    both), and `openCanvasPopout` preferred the hidden live board.
 *  - `canvas:show` opens a new tab, except when it matches an existing tab by
 *    `sourcePath` (same file re-shown → update in place, no tab spam from the
 *    chat chip View button) or `toolCallId` (agent re-show of the same call).
 *  - Live tabs stay subscribed even when backgrounded, so a task board keeps
 *    updating while the operator reads a snapshot tab. On scope/workspace
 *    switch the outgoing conversation's live tabs unsubscribe (main keeps
 *    boards alive + fresh) and the incoming scope's re-subscribe, with
 *    task boards refreshed via `getActiveBoardForWorkspace` (which also
 *    recreates a board binding after a restart).
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

/** Scope bucket key: conversation-scoped when a chat is focused, else the
 *  workspace fallback. Task boards always live in the `w:` bucket. */
function scopeKeyOf(conversationId: string | undefined, workspaceId: string): string {
  return conversationId ? `c:${conversationId}` : `w:${workspaceId}`
}

type Options = {
  /** Active sidebar workspace id ('' until resolved). Owns the `w:` bucket. */
  workspaceId: string
  /** Active conversation id (undefined = no chat focused → `w:` fallback). */
  conversationId?: string
  /** Active workspace cwd — used for the ws-switch board restore. Read from
   *  the effect closure at switch time (same as the previous inline effect). */
  workspaceCwd: string
  /** Mirrors the active workspace cwd; read by the once-registered
   *  `canvas:show` / `canvas:live-show` workspace gates. */
  activeWorkspaceCwdRef: React.MutableRefObject<string>
  /** Restored pool terminals need a pty — App ensures the session here. */
  onTerminalRestored?: (tabId: string, cwd: string) => void
  /** Called when a show/live-show lands (App opens + persists the panel). */
  onOpenPanel: () => void
}

export type UseCanvasTabs = {
  /** Tabs for the active scope (content tabs first, then the ws task board). */
  tabs: CanvasTab[]
  /** Active tab id for the active scope (null = empty pane). */
  activeTabId: string | null
  /** The active tab's view (null = empty pane or app-pane tab). */
  view: CanvasView | null
  setActiveTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  /** Replace the active tab's snapshot payload (used by Refresh). No-op when
   *  the active tab is live or missing. */
  updateActiveSnapshot: (fn: (p: CanvasPayload) => CanvasPayload) => void
  /** Open an app-pane tab. Side chat dedupes to one tab per scope (single
   *  child conversation) and canvas opens a new per-chat blank sketch;
   *  terminal + browser are repeatable and WORKSPACE-POOLED — each call
   *  opens another tab ("Terminal", "Terminal 2"…) visible from every
   *  conversation in the workspace, each with its own pty / URL state.
   *  Opens the panel. Returns the tab id. */
  openAppTab: (kind: AppTabKind, origin?: string) => string
}

/** Title for a new repeatable app-pane tab: "Terminal", then "Terminal 2",
 *  "Terminal 3"… (max existing numeric suffix + 1, so closing one and opening
 *  another never collides). */
function nextAppTabTitle(existing: CanvasTab[], kind: AppTabKind): string {
  const label = APP_TAB_KIND_LABEL[kind]
  let next = 2
  for (const t of existing) {
    if ((t.kind ?? 'canvas') !== kind) continue
    const m = (t.title ?? '').match(/\s(\d+)$/)
    if (m) next = Math.max(next, Number(m[1]) + 1)
  }
  return existing.some((t) => (t.kind ?? 'canvas') === kind) ? `${label} ${next}` : label
}

export function useCanvasTabs({
  workspaceId,
  conversationId,
  workspaceCwd,
  activeWorkspaceCwdRef,
  onOpenPanel,
  onTerminalRestored,
}: Options): UseCanvasTabs {
  const [tabsByScope, setTabsByScope] = useState<Record<string, CanvasTab[]>>({})
  const [activeByScope, setActiveByScope] = useState<Record<string, string>>({})

  // Eager refs: mutated synchronously by every writer below, then pushed into
  // state. The once-registered listeners always read fresh values.
  const tabsRef = useRef<Record<string, CanvasTab[]>>({})
  const activeRef = useRef<Record<string, string>>({})
  const wsIdRef = useRef(workspaceId)
  const convIdRef = useRef(conversationId)
  // Previous scope/ws — synced ONLY inside the switch effects below (the
  // generic refs are already updated by their own effects by the time those
  // run, so they can't be used to detect the transition).
  const prevScopeRef = useRef('')
  const prevWsRef = useRef('')
  const tabSeq = useRef(0)

  useEffect(() => {
    wsIdRef.current = workspaceId
  }, [workspaceId])

  useEffect(() => {
    convIdRef.current = conversationId
  }, [conversationId])

  const nextTabId = useCallback((): string => `canvas-tab-${++tabSeq.current}`, [])

  // ── workspace pool persistence: restore saved terminal/browser tabs ──────
  // Runs once per workspace id (guard ref): reads the main-process JSON store
  // and recreates the pool. Restored terminals get their pty via
  // `onTerminalRestored`; browsers reopen their saved URL via `browserUrl`.
  const restoredPoolWsRef = useRef('')
  useEffect(() => {
    if (!workspaceId || restoredPoolWsRef.current === workspaceId) return
    restoredPoolWsRef.current = workspaceId
    void (async () => {
      let saved: { kind: 'terminal' | 'browser'; title?: string; terminalCwd?: string; browserUrl?: string }[] = []
      try {
        saved = (await window.sylo.canvas.loadPoolTabs?.(workspaceId)) ?? []
      } catch {
        return
      }
      if (!Array.isArray(saved) || saved.length === 0) return
      const bucket = `w:${workspaceId}`
      const existing = tabsRef.current[bucket] ?? []
      const additions: CanvasTab[] = []
      for (const s of saved) {
        if (!s || (s.kind !== 'terminal' && s.kind !== 'browser')) continue
        const id = nextTabId()
        additions.push({
          id,
          kind: s.kind,
          title: typeof s.title === 'string' && s.title.trim() ? s.title : APP_TAB_KIND_LABEL[s.kind],
          terminalCwd: s.terminalCwd,
          browserUrl: s.browserUrl,
          view: { mode: 'snapshot', payload: { toolCallId: id, kind: 'markdown', content: '' } },
        })
        if (s.kind === 'terminal') {
          onTerminalRestored?.(id, typeof s.terminalCwd === 'string' ? s.terminalCwd : '')
        }
      }
      if (additions.length === 0) return
      writeTabs({ ...tabsRef.current, [bucket]: [...existing, ...additions] })
      if (!(activeRef.current[bucket] ?? '') && additions[0]) {
        writeActive({ ...activeRef.current, [bucket]: additions[0].id })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const writeTabs = useCallback((next: Record<string, CanvasTab[]>) => {
    tabsRef.current = next
    setTabsByScope(next)
  }, [])

  const writeActive = useCallback((next: Record<string, string>) => {
    activeRef.current = next
    setActiveByScope(next)
  }, [])

  /** Which bucket holds this tab? Scope bucket wins; falls back to the ws
   *  bucket (task board); unknown ids land in the scope bucket. */
  const bucketKeyFor = useCallback(
    (tabId: string, scope: string, ws: string): string => {
      if ((tabsRef.current[scope] ?? []).some((t) => t.id === tabId)) return scope
      if (ws && (tabsRef.current[`w:${ws}`] ?? []).some((t) => t.id === tabId)) return `w:${ws}`
      return scope
    },
    [],
  )

  const activate = useCallback(
    (tabId: string, scope: string, ws: string) => {
      writeActive({ ...activeRef.current, [bucketKeyFor(tabId, scope, ws)]: tabId })
    },
    [writeActive, bucketKeyFor],
  )

  // ── canvas:show (snapshot) ────────────────────────────────────────────────
  useEffect(() => {
    const onShow = window.sylo.canvas?.onShow
    if (!onShow) return
    const u = onShow((p) => {
      // Per-workspace gate: a background workspace's agent canvas show must
      // not pollute the foreground tabs. The snapshot is ephemeral — the chat
      // chip View button can re-open it later from the correct workspace. At
      // startup (cwd not yet resolved) shows pass through, preserving the
      // original behavior.
      if (
        p.workspaceKey &&
        activeWorkspaceCwdRef.current &&
        normWsKey(p.workspaceKey) !== normWsKey(activeWorkspaceCwdRef.current)
      ) {
        return
      }
      const scope = scopeKeyOf(convIdRef.current, wsIdRef.current)
      const payload: CanvasPayload = {
        toolCallId: p.toolCallId,
        kind: p.kind,
        title: p.title,
        content: p.content,
        filePath: p.filePath,
        sourcePath: p.sourcePath,
      }
      const tabs = tabsRef.current[scope] ?? []
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
      writeTabs({ ...tabsRef.current, [scope]: next })
      activate(targetId, scope, wsIdRef.current)
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
      const sub: CanvasView = {
        mode: 'live',
        sub: { liveId: p.liveId, kind: p.kind, title: p.title, data: p.data },
      }
      // Task boards are workspace resources: they always land in the `w:`
      // bucket so every conversation in the workspace sees the same board.
      // Live-demo shows (no workspaceKey) scope to the focused conversation.
      const isBoard = p.kind === 'task-board'
      const scope = isBoard
        ? `w:${wsIdRef.current}`
        : scopeKeyOf(convIdRef.current, wsIdRef.current)
      const tabs = tabsRef.current[scope] ?? []
      const existing = tabs.find(
        (t) => t.view.mode === 'live' && t.view.sub.liveId === p.liveId,
      )
      const next = [...tabs]
      let targetId: string
      if (existing) {
        // Re-show of a live board we already track: refresh its data in place.
        const i = next.indexOf(existing)
        next[i] = { id: existing.id, view: sub }
        targetId = existing.id
      } else {
        targetId = nextTabId()
        next.push({ id: targetId, view: sub })
      }
      writeTabs({ ...tabsRef.current, [scope]: next })
      activate(targetId, scope, wsIdRef.current)
      // An explicit agent show must surface the board even when the focused
      // conversation's scope already records its own active tab: also mark it
      // active for the CURRENT scope (the render merges both buckets and
      // prefers the scope's own choice).
      writeActive({
        ...activeRef.current,
        [scopeKeyOf(convIdRef.current, wsIdRef.current)]: targetId,
      })
      void window.sylo.canvas.liveSubscribe(p.liveId)
      onOpenPanel()
    })
    return u
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOpenPanel, nextTabId, writeTabs, activate])

  // ── canvas:live-update (fan-out patches) ─────────────────────────────────
  // Apply to the matching live tab in ANY scope list: only subscribed
  // tabs receive patches, and background tabs are unsubscribed, so this
  // just keeps visible (and recently-visible) boards current.
  useEffect(() => {
    const onLiveUpdate = window.sylo.canvas?.onLiveUpdate
    if (!onLiveUpdate) return
    const u = onLiveUpdate((p) => {
      let changed = false
      const next: Record<string, CanvasTab[]> = {}
      for (const [scope, tabs] of Object.entries(tabsRef.current)) {
        let scopeChanged = false
        const nt = tabs.map((t): CanvasTab => {
          if (t.view.mode !== 'live' || t.view.sub.liveId !== p.liveId) return t
          scopeChanged = true
          return {
            id: t.id,
            view: { mode: 'live', sub: { ...t.view.sub, data: p.data } },
          }
        })
        next[scope] = scopeChanged ? nt : tabs
        if (scopeChanged) changed = true
      }
      if (changed) writeTabs(next)
    })
    return u
  }, [writeTabs])

  // ── canvas:live-clear (Stop / board disposed) ────────────────────────────
  // Close the tab bound to that liveId everywhere; if it was the active tab
  // of the current scope, activate a neighbor (browser semantics).
  useEffect(() => {
    const onLiveClear = window.sylo.canvas?.onLiveClear
    if (!onLiveClear) return
    const u = onLiveClear((p) => {
      const scope = scopeKeyOf(convIdRef.current, wsIdRef.current)
      const wsBucket = `w:${wsIdRef.current}`
      const next: Record<string, CanvasTab[]> = {}
      let activateId: string | null = null
      let activateBucket: string | null = null
      for (const [key, tabs] of Object.entries(tabsRef.current)) {
        const idx = tabs.findIndex(
          (t) => t.view.mode === 'live' && t.view.sub.liveId === p.liveId,
        )
        if (idx < 0) {
          next[key] = tabs
          continue
        }
        const remaining = tabs.filter((_, i) => i !== idx)
        next[key] = remaining
        if (key === scope || key === wsBucket) {
          const activeKey = key === scope ? scope : wsBucket
          if ((activeRef.current[activeKey] ?? '') === tabs[idx].id) {
            // Neighbor at the same position in the post-removal list.
            const neighbor = remaining[Math.min(idx, remaining.length - 1)] ?? null
            activateId = neighbor ? neighbor.id : ''
            activateBucket = activeKey
          }
        }
      }
      writeTabs(next)
      if (activateBucket !== null) {
        if (activateId) {
          activate(activateId, scope, wsIdRef.current)
        } else {
          writeActive({ ...activeRef.current, [activateBucket]: '' })
        }
      }
    })
    return u
  }, [writeTabs, writeActive, activate])

  // ── scope switch (conversation change): swap content tab sets, rebind the
  //    conversation's live-demo subscriptions. The ws task-board bucket is
  //    NOT touched here — it stays subscribed while the workspace is active.
  useEffect(() => {
    const scope = scopeKeyOf(conversationId, workspaceId)
    const prevScope = prevScopeRef.current
    prevScopeRef.current = scope
    if (prevScope === scope) return
    if (prevScope.startsWith('c:')) {
      for (const t of tabsRef.current[prevScope] ?? []) {
        if (t.view.mode === 'live') void window.sylo.canvas?.liveUnsubscribe(t.view.sub.liveId)
      }
    }
    if (scope.startsWith('c:')) {
      for (const t of tabsRef.current[scope] ?? []) {
        if (t.view.mode === 'live') void window.sylo.canvas?.liveSubscribe(t.view.sub.liveId)
      }
    } else if (prevScope.startsWith('c:') && prevScope !== `w:${workspaceId}`) {
      // Landing on the ws fallback (chat closed/deselected): make sure the
      // ws task board (if restored below or previously shown) is subscribed.
      for (const t of tabsRef.current[`w:${workspaceId}`] ?? []) {
        if (t.view.mode === 'live') void window.sylo.canvas?.liveSubscribe(t.view.sub.liveId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // ── workspace switch: swap ws tab sets, rebind live subscriptions ────────
  useEffect(() => {
    const prevWs = prevWsRef.current
    prevWsRef.current = workspaceId
    if (prevWs === workspaceId) return
    // Unsubscribe the old workspace's live tabs — main keeps each board alive
    // and its `sub.data` fresh for the return trip; we just stop receiving
    // patches for tabs we can't see.
    for (const t of tabsRef.current[`w:${prevWs}`] ?? []) {
      if (t.view.mode === 'live') void window.sylo.canvas?.liveUnsubscribe(t.view.sub.liveId)
    }
    // Re-subscribe the new workspace's live tabs.
    for (const t of tabsRef.current[`w:${workspaceId}`] ?? []) {
      if (t.view.mode === 'live') void window.sylo.canvas?.liveSubscribe(t.view.sub.liveId)
    }
    // Refresh the new workspace's bound task board (fresh data; also restores
    // a binding lost to a main-process restart). Does NOT open the panel — a
    // workspace switch must not force the pane open.
    void (async () => {
      if (!workspaceCwd) return
      const board = await window.sylo.canvas?.getActiveBoardForWorkspace(workspaceCwd)
      if (!board) {
        // Board deleted (or binding cleared) while away: its tab(s) are dead.
        const bucket = `w:${workspaceId}`
        const current = tabsRef.current[bucket] ?? []
        const stale = current.filter(
          (t) => t.view.mode === 'live' && t.view.sub.kind === 'task-board',
        )
        if (stale.length > 0) {
          const remaining = current.filter(
            (t) => !(t.view.mode === 'live' && t.view.sub.kind === 'task-board'),
          )
          writeTabs({ ...tabsRef.current, [bucket]: remaining })
          const active = activeRef.current[bucket] ?? ''
          if (stale.some((t) => t.id === active)) {
            writeActive({ ...activeRef.current, [bucket]: remaining[0]?.id ?? '' })
          }
        }
        return
      }
      const bucket = `w:${workspaceId}`
      const tabs = tabsRef.current[bucket] ?? []
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
          [bucket]: tabs.map((t) => (t.id === existing.id ? { id: t.id, view: freshSub } : t)),
        })
        return
      }
      const id = nextTabId()
      writeTabs({ ...tabsRef.current, [bucket]: [...tabs, { id, view: freshSub }] })
      // This tab didn't exist at switch time, so the sync re-subscribe loop
      // above didn't cover it.
      void window.sylo.canvas?.liveSubscribe(board.liveId)
      // Old restore semantics: the returned board became the shown view only
      // when there was nothing else to show (the stashed snapshot won).
      if (tabs.length === 0) writeActive({ ...activeRef.current, [bucket]: id })
    })()
    // workspaceCwd is read at switch time via closure (same as the previous
    // inline effect, which also disabled exhaustive-deps here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, writeTabs, writeActive, nextTabId])

  const setActiveTab = useCallback(
    (tabId: string) => {
      // Record intent for the scope the operator is LOOKING at (not the tab's
      // own bucket): clicking a pooled terminal/browser/board from a chat must
      // focus it there, and the render prefers the current scope's record.
      writeActive({
        ...activeRef.current,
        [scopeKeyOf(convIdRef.current, wsIdRef.current)]: tabId,
      })
    },
    [writeActive],
  )

  const closeTab = useCallback(
    (tabId: string) => {
      const scope = scopeKeyOf(convIdRef.current, wsIdRef.current)
      const wsBucket = `w:${wsIdRef.current}`
      const scopeTabs = tabsRef.current[scope] ?? []
      const wsTabs = wsBucket !== scope ? (tabsRef.current[wsBucket] ?? []) : []
      const merged = [...scopeTabs, ...wsTabs]
      const idx = merged.findIndex((t) => t.id === tabId)
      if (idx < 0) return
      const tab = merged[idx]
      if (tab.view.mode === 'live') {
        void window.sylo.canvas?.liveUnsubscribe(tab.view.sub.liveId)
      }
      const bucketKey = bucketKeyFor(tabId, scope, wsIdRef.current)
      const bucketTabs = tabsRef.current[bucketKey] ?? []
      const bIdx = bucketTabs.findIndex((t) => t.id === tabId)
      const remainingBucket = bucketTabs.filter((_, i) => i !== bIdx)
      writeTabs({ ...tabsRef.current, [bucketKey]: remainingBucket })
      const remainingMerged = merged.filter((t) => t.id !== tabId)
      const nextActive: Record<string, string> = { ...activeRef.current }
      // Keep the tab's own-bucket record honest (neighbor within that bucket).
      if ((nextActive[bucketKey] ?? '') === tabId) {
        nextActive[bucketKey] = remainingBucket[Math.max(0, bIdx - 1)]?.id ?? ''
      }
      // If the operator was LOOKING at the closed tab, activate a neighbor in
      // the merged list for the scope being viewed.
      if ((nextActive[scope] ?? '') === tabId) {
        const neighbor = remainingMerged[Math.min(idx, remainingMerged.length - 1)] ?? null
        nextActive[scope] = neighbor?.id ?? ''
      }
      writeActive(nextActive)
    },
    [writeTabs, writeActive, bucketKeyFor],
  )

  const updateActiveSnapshot = useCallback(
    (fn: (p: CanvasPayload) => CanvasPayload) => {
      const scope = scopeKeyOf(convIdRef.current, wsIdRef.current)
      const activeId = activeRef.current[scope] ?? ''
      if (!activeId) return
      const tabs = tabsRef.current[scope] ?? []
      let changed = false
      const next = tabs.map((t): CanvasTab => {
        if (t.id !== activeId || t.view.mode !== 'snapshot') return t
        changed = true
        return { id: t.id, view: { mode: 'snapshot', payload: fn(t.view.payload) } }
      })
      if (changed) writeTabs({ ...tabsRef.current, [scope]: next })
    },
    [writeTabs],
  )

  const openAppTab = useCallback(
    (kind: AppTabKind, origin?: string) => {
      const scope = scopeKeyOf(convIdRef.current, wsIdRef.current)
      const wsBucket = `w:${wsIdRef.current}`
      const tabs = [...(tabsRef.current[scope] ?? []), ...(wsBucket !== scope ? (tabsRef.current[wsBucket] ?? []) : [])]
      // Side chat dedupes to one tab per scope (it is bound to a single child
      // conversation). Canvas is repeatable per chat. Terminal + browser are
      // repeatable AND live in the WORKSPACE POOL (like task boards): visible
      // and operable from every conversation in the workspace, each with its
      // own pty / URL state (keyed per tab id).
      if (kind === 'side-chat') {
        const existing = tabs.find((t) => (t.kind ?? 'canvas') === kind)
        if (existing) {
          activate(existing.id, scope, wsIdRef.current)
          onOpenPanel()
          return existing.id
        }
      }
      const targetScope = kind === 'terminal' || kind === 'browser' ? wsBucket : scope
      const id = nextTabId()
      const tab: CanvasTab =
        kind === 'canvas'
          ? {
              id,
              view: {
                mode: 'snapshot',
                payload: {
                  toolCallId: `local-canvas-${tabSeq.current}`,
                  kind: 'markdown',
                  title: 'Canvas',
                  content: '',
                },
              },
            }
          : {
              id,
              kind,
              title: nextAppTabTitle(tabs, kind),
              origin: origin?.trim() || undefined,
              view: { mode: 'snapshot', payload: { toolCallId: id, kind: 'markdown', content: '' } },
            }
      writeTabs({ ...tabsRef.current, [targetScope]: [...(tabsRef.current[targetScope] ?? []), tab] })
      // Surface the new tab for the scope being VIEWED: a pooled tab opened
      // from a chat must become active there even if that chat already has
      // its own active tab record (the render prefers the scope's record).
      writeActive({ ...activeRef.current, [scope]: id })
      onOpenPanel()
      return id
    },
    [writeTabs, writeActive, activate, nextTabId, onOpenPanel],
  )

  const scope = scopeKeyOf(conversationId, workspaceId)
  const wsBucket = `w:${workspaceId}`
  const scopeTabs = tabsByScope[scope] ?? []
  const boardTabs = wsBucket !== scope ? (tabsByScope[wsBucket] ?? []) : []
  const tabs = [...scopeTabs, ...boardTabs]
  // Active resolution across the merged buckets: the conversation scope's own
  // choice wins when it still exists; otherwise the ws bucket's (task board —
  // clicking the board tab activates it THERE); otherwise the first tab.
  // `??` alone is not enough: '' and stale ids (closed tab) must fall through
  // too, or the pane renders blank while the strip still lists the tab.
  const cActive = activeByScope[scope] ?? ''
  const wsActive = activeByScope[wsBucket] ?? ''
  const activeTabId = (
    cActive && tabs.some((t) => t.id === cActive) ? cActive
    : wsActive && tabs.some((t) => t.id === wsActive) ? wsActive
    : tabs[0]?.id
  ) ?? null
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const view: CanvasView | null = activeTab ? activeTab.view : null

  return { tabs, activeTabId, view, setActiveTab, closeTab, updateActiveSnapshot, openAppTab }
}