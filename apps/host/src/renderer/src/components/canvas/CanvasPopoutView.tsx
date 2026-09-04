import React, { useCallback, useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { CanvasPanel } from './CanvasPanel'
import type { CanvasView, CanvasPayload, CanvasKind } from './canvasTypes'

type Props = { popoutId: string }

/**
 * Standalone canvas window. The hash selects the variant:
 *   `#popout-canvas=<id>`       — snapshot: main stashed a `CanvasPopoutSnapshot`;
 *                                 fetch once and render (no live updates — popouts
 *                                 can't receive `canvas:show`).
 *   `#popout-canvas-live=<id>`  — live: main holds a `CanvasLiveSubscription`;
 *                                 fetch the latest state, subscribe to
 *                                 `canvas:live-update` for this `liveId`, and
 *                                 stay in sync with the docked canvas.
 *
 * `popoutId` is the parsed `<id>` from whichever hash variant this window was
 * opened with. The variant is inferred by probing `getPopout` (snapshot) first
 * and falling back to `getLivePopout` (live).
 */
export function CanvasPopoutView({ popoutId }: Props): React.ReactElement {
  const [view, setView] = useState<CanvasView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  // Resolve the variant + initial state, then (for live) subscribe to updates.
  useEffect(() => {
    let cancelled = false
    let unsubUpdate: (() => void) | undefined
    let unsubClear: (() => void) | undefined
    void (async () => {
      try {
        // Try snapshot first (the existing path).
        const snap = await window.sylo.canvas.getPopout(popoutId)
        if (cancelled) return
        if (snap) {
          const payload: CanvasPayload = {
            toolCallId: snap.toolCallId ?? popoutId,
            kind: snap.kind as CanvasKind,
            title: snap.title,
            content: snap.content,
            filePath: snap.filePath,
            sourcePath: snap.sourcePath,
          }
          setView({ mode: 'snapshot', payload })
          setLoaded(true)
          return
        }
        // Fall back to live subscription.
        const live = await window.sylo.canvas.getLivePopout(popoutId)
        if (cancelled) return
        if (!live) {
          setLoaded(true)
          return
        }
        setView({ mode: 'live', sub: live })
        setLoaded(true)
        // Register the update listener BEFORE subscribing so we don't miss the
        // first patch that could fire between subscribe and listener setup.
        unsubUpdate = window.sylo.canvas.onLiveUpdate((p) => {
          if (p.liveId !== live.liveId) return
          setView((prev) =>
            prev && prev.mode === 'live' ? { mode: 'live', sub: { ...prev.sub, data: p.data } } : prev,
          )
        })
        // When the liveId is disposed (e.g. "Stop" clicked on the docked
        // canvas), main fans `canvas:live-clear` to every subscriber including
        // this popout. Blank our live view so we don't freeze at a stale last
        // value. (A subsequently dropped file can still repopulate the popout.)
        unsubClear = window.sylo.canvas.onLiveClear((p) => {
          if (p.liveId !== live.liveId) return
          setView((prev) =>
            prev && prev.mode === 'live' && prev.sub.liveId === p.liveId ? null : prev,
          )
        })
        // Subscribe this popout's webContents to `canvas:live-update` for this liveId.
        const subOk = await window.sylo.canvas.liveSubscribe(live.liveId)
        if (cancelled || !subOk) return
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
      unsubUpdate?.()
      unsubClear?.()
      // The main process auto-removes destroyed webContents from the live
      // subscriber set (`wc.once('destroyed', …)` in `subscribeLive`), so no
      // explicit `liveUnsubscribe` is needed on popout close.
    }
  }, [popoutId])

  // The popout can't receive `canvas:show` (snapshot path is main-window-only),
  // so a dropped `.md` file is read here and rendered locally. `.svg` files load
  // via the sylo-file:// preview URL, so no content read is needed for them.
  // Dropping a file replaces whatever is showing (snapshot or live).
  const handleDropFile = useCallback(async (filePath: string, kind: CanvasKind) => {
    const title = filePath.replace(/^.*[/\\]/, '') || filePath
    if (kind === 'svg') {
      setView({ mode: 'snapshot', payload: { toolCallId: `drop-${Date.now()}`, kind: 'svg', title, filePath, sourcePath: filePath } })
      return
    }
    const r = await window.sylo.files.readTextFile(filePath)
    if (!r.ok) {
      window.alert(`Could not open in canvas: ${r.error}`)
      return
    }
    setView({
      mode: 'snapshot',
      payload: { toolCallId: `drop-${Date.now()}`, kind: 'markdown', title, content: r.content, sourcePath: filePath },
    })
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-primary">
      {!loaded ?
        <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">
          Loading canvas…
        </div>
      : error ?
        <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">
          Could not load canvas: {error}
        </div>
      : (
        <CanvasPanel
          view={view}
          variant="popout"
          className={cn('min-h-0 flex-1', 'border-l-0')}
          onDropFile={handleDropFile}
          onUpdatePayload={(p) =>
            setView((v) => (v && v.mode === 'snapshot' ? { mode: 'snapshot', payload: p } : v))
          }
        />
      )}
    </div>
  )
}
