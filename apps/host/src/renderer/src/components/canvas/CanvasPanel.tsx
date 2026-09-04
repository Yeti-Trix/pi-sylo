import React, { useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { btnGhostSm, mutedText } from '../../panels/ui-classes'
import { CanvasContent } from './CanvasContent'
import { CanvasDraw } from './CanvasDraw'
import { CanvasLiveContent } from './CanvasLiveContent'
import { canvasTabLabel, type CanvasPayload, type CanvasTab } from './canvasTypes'
import type { CanvasView } from './canvasTypes'

type Props = {
  view: CanvasView | null
  className?: string
  style?: React.CSSProperties
  variant?: 'docked' | 'popout'
  onCollapse?: () => void
  onPopOut?: () => void
  /**
   * Drag-and-drop a local `.md` / `.svg` file onto the canvas to view it.
   * Docked variant: parent forwards the path to `window.sylo.canvas.showFile`
   * (main process reads the file and emits `canvas:show`).
   * Popout variant: parent reads the file itself (the popout can't receive
   * `canvas:show`, which targets the main window) and updates local state.
   * Dropping a file always replaces whatever is showing (snapshot or live).
   */
  onDropFile?: (filePath: string, kind: 'markdown' | 'svg') => void
  /** Active conversation id (docked variant only). Forwarded to the live
   *  task-board so its "Send to agent" affordance can deliver a queued message
   *  to the right conversation via `window.sylo.chat.deliverQueued`. Also used
   *  by draw mode's "Send to agent" to deliver the sketch as an image
   *  attachment. */
  conversationId?: string
  /** Parent-held (App-level) backup of the last freehand sketch (PNG data
   *  URL). Lifted above CanvasPanel so the sketch survives CanvasPanel unmount
   *  on tab switches. Draw mode restores from this on mount. */
  sketchBackupRef?: React.MutableRefObject<string | null>
  /** Tab strip (docked variant): open canvas tabs + the active one. The strip
   *  renders only when there are 2+ tabs, so the single-artifact UX is
   *  unchanged. */
  tabs?: CanvasTab[]
  activeTabId?: string | null
  onSelectTab?: (tabId: string) => void
  onCloseTab?: (tabId: string) => void
  /** Replace the currently shown snapshot payload — used by Refresh after
   *  re-reading a file-backed view from disk. */
  onUpdatePayload?: (p: CanvasPayload) => void
}

function fileKindForName(name: string): 'markdown' | 'svg' | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'svg') return 'svg'
  return null
}

export function CanvasPanel({
  view,
  className,
  style,
  variant = 'docked',
  onCollapse,
  onPopOut,
  onDropFile,
  conversationId,
  sketchBackupRef,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onUpdatePayload,
}: Props): React.ReactElement {
  const [dragOver, setDragOver] = useState(false)
  // Phase 5: freehand draw mode. Local to the panel — toggling it swaps the
  // body for a sketch surface. The sketch bitmap is backed up to
  // `sketchBackupRef` (lifted to App) so it survives unmount on tab switches.
  const [drawMode, setDrawMode] = useState(false)
  // Refresh: bumped for cache-bust (svg file) / re-render (mermaid); the
  // markdown path re-reads the file and calls `onUpdatePayload` instead.
  const [reloadNonce, setReloadNonce] = useState(0)
  const localBackupRef = useRef<string | null>(null)
  const backupRef = sketchBackupRef ?? localBackupRef

  const snapshot = view?.mode === 'snapshot' ? view.payload : null
  const live = view?.mode === 'live' ? view.sub : null

  const kindLabel =
    snapshot?.kind === 'mermaid' ? 'Diagram'
    : snapshot?.kind === 'markdown' ? 'Markdown'
    : snapshot?.filePath ? 'SVG file'
    : snapshot ? 'SVG'
    : live ? 'Live'
    : 'Canvas'

  const title =
    snapshot?.title?.trim() ||
    (snapshot?.kind === 'markdown' && snapshot.sourcePath
      ? snapshot.sourcePath.split(/[\\/]/).pop()
      : undefined) ||
    live?.title?.trim() ||
    kindLabel

  const hasPopoutTarget = view != null && (
    view.mode === 'live'
      ? true
      : (view.payload.kind === 'mermaid'
        ? !!(view.payload.content ?? '').trim()
        : view.payload.kind === 'markdown'
          ? !!(view.payload.content ?? '').trim()
          : !!(view.payload.content?.trim() || view.payload.filePath?.trim()))
  )

  const sourcePath = snapshot?.sourcePath?.trim()

  // Refresh applies when there is a source to reload from: a file-backed
  // markdown (re-read from disk), a file-backed SVG (cache-bust the preview
  // URL), or mermaid (force re-render). Live views update themselves via
  // `canvas:live-update`; content-only snapshots have nothing to reload.
  const canRefresh =
    !!snapshot &&
    !drawMode &&
    (snapshot.kind === 'mermaid' ||
      (snapshot.kind === 'markdown' && !!sourcePath) ||
      (snapshot.kind === 'svg' && !!snapshot.filePath?.trim()))

  const refreshTitle =
    snapshot?.kind === 'markdown'
      ? `Reload ${sourcePath} from disk`
      : snapshot?.kind === 'svg'
        ? 'Reload this SVG file from disk'
        : 'Re-render the diagram'

  const handleRefresh = () => {
    if (!snapshot) return
    if (snapshot.kind === 'markdown' && sourcePath) {
      if (!onUpdatePayload) return
      void window.sylo.files.readTextFile(sourcePath).then((r) => {
        if (r.ok) {
          onUpdatePayload({ ...snapshot, content: r.content })
        } else {
          onUpdatePayload({
            ...snapshot,
            content: `**Could not re-read file:** \`${sourcePath}\` — ${r.error}`,
          })
        }
      })
      return
    }
    // SVG file → cache-bust the sylo-file:// URL; mermaid → re-render.
    setReloadNonce((n) => n + 1)
  }

  const revealInFolder = () => {
    if (sourcePath) void window.sylo.shell.showItemInFolder(sourcePath)
  }
  const openExternally = () => {
    if (sourcePath) void window.sylo.shell.openPath(sourcePath)
  }

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (!onDropFile) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    for (const f of files) {
      const kind = fileKindForName(f.name)
      if (!kind) continue
      let path = ''
      try {
        path = window.sylo.files.pathFromWebFile(f).trim()
      } catch {
        /* in-memory file — skip */
      }
      if (path) {
        onDropFile(path, kind)
        return
      }
    }
  }

  return (
    <section
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-bg-primary',
        dragOver && 'ring-2 ring-accent/60',
        className,
      )}
      style={style}
      aria-label="Canvas"
      onDragEnter={(e) => {
        if (!onDropFile) return
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragOver={(e) => {
        if (!onDropFile) return
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragOver(false)
        }
      }}
      onDrop={handleDrop}
    >
      {dragOver ?
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/70 p-6 text-center">
          <div className="rounded-lg border border-dashed border-accent/70 bg-bg-secondary px-4 py-3 text-[0.85rem] text-text-primary">
            Drop <code>.md</code> or <code>.svg</code> to view in canvas
          </div>
        </div>
      : null}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[0.85rem] font-medium text-text-primary">Canvas</div>
          <div className={cn(mutedText, 'truncate text-[0.74rem]')}>
            {title}
            {view ? ` · ${view.mode === 'live' ? 'live' : view.payload.kind}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canRefresh ?
            <button type="button" className={btnGhostSm} title={refreshTitle} onClick={handleRefresh}>
              Refresh
            </button>
          : null}
          {sourcePath ?
            <>
              <button type="button" className={btnGhostSm} title={`Reveal ${sourcePath} in folder`} onClick={revealInFolder}>
                Reveal
              </button>
              <button type="button" className={btnGhostSm} title={`Open ${sourcePath} in default app`} onClick={openExternally}>
                Open
              </button>
            </>
          : null}
          {variant === 'docked' ?
            <button
              type="button"
              className={cn(btnGhostSm, drawMode && 'bg-accent/20 text-accent')}
              title="Switch the canvas to freehand draw mode (mouse). Send the sketch to the agent as an image."
              onClick={() => setDrawMode((v) => !v)}
            >
              {drawMode ? 'Exit draw' : 'Draw'}
            </button>
          : null}
                    {variant === 'docked' && live && !drawMode ?
            <button
              type="button"
              className={btnGhostSm}
              title="Stop the live canvas view"
              onClick={() => {
                void window.sylo.canvas.stopLiveDemo(live.liveId)
              }}
            >
              Stop
            </button>
          : null}
          {variant === 'docked' && hasPopoutTarget && onPopOut && !drawMode ?
            <button type="button" className={btnGhostSm} title="Open in a new window" onClick={onPopOut}>
              Pop out
            </button>
          : null}
          {variant === 'docked' && onCollapse ?
            <button type="button" className={btnGhostSm} onClick={onCollapse}>
              Hide
            </button>
          : null}
          {variant === 'popout' ?
            <button type="button" className={btnGhostSm} onClick={() => window.close()}>
              Close
            </button>
          : null}
        </div>
      </header>
      {tabs && tabs.length > 1 ?
        <div
          role="tablist"
          aria-label="Canvas tabs"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-1.5 py-1"
        >
          {tabs.map((t) => {
            const active = t.id === activeTabId
            const label = canvasTabLabel(t.view)
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                title={active ? label : `Show ${label}`}
                onClick={() => onSelectTab?.(t.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    onCloseTab?.(t.id)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectTab?.(t.id)
                  }
                }}
                className={cn(
                  'flex min-w-0 max-w-[150px] shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[0.72rem] outline-none transition-colors',
                  active
                    ? 'border-accent/50 bg-bg-tertiary text-text-primary'
                    : 'border-transparent text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary',
                )}
              >
                {t.view.mode === 'live' ?
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    title="Live — updates automatically"
                  />
                : null}
                <span className="min-w-0 truncate">{label}</span>
                <button
                  type="button"
                  aria-label={`Close tab: ${label}`}
                  title="Close tab"
                  className={cn(
                    'shrink-0 rounded px-0.5 leading-none text-text-secondary hover:text-danger',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab?.(t.id)
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      : null}
      {variant === 'docked' && drawMode ?
        <div className="min-h-0 flex-1 p-2">
          <CanvasDraw
            conversationId={conversationId}
            backupRef={backupRef}
            onExit={() => setDrawMode(false)}
          />
        </div>
      : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {view?.mode === 'live' ?
            <CanvasLiveContent sub={view.sub} />
          : (
            <CanvasContent
              payload={snapshot}
              interactive={variant === 'docked'}
              reloadNonce={reloadNonce}
              onOpenPopout={variant === 'docked' && hasPopoutTarget ? onPopOut : undefined}
            />
          )}
        </div>
      )}
    </section>
  )
}