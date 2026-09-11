import React, { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import {
  btnGhostSm,
  ctxMenuBackdrop,
  ctxMenuShell,
  mutedText,
  routeCtxItem,
  sidebarResizeBtn,
} from '../../panels/ui-classes'
import { CanvasContent } from './CanvasContent'
import { CanvasDraw } from './CanvasDraw'
import { CanvasLiveContent } from './CanvasLiveContent'
import {
  APP_TAB_KIND_GLYPH,
  APP_TAB_KIND_LABEL,
  canvasTabLabel,
  tabKind,
  type AppTabKind,
  type CanvasPayload,
  type CanvasTab,
} from './canvasTypes'
import type { CanvasView } from './canvasTypes'
import { BrowserPane } from './BrowserPane'
import { SideChatPane } from './SideChatPane'
import { TerminalPane } from './TerminalPane'
import type { TerminalRegistry } from './useTerminalSessions'

// `+` picker entries (lucide-style stroke icons, 16px). Module-level so the
// JSX isn't rebuilt every render.
type AddTabItem = { key: AppTabKind | 'file'; label: string; icon: React.ReactElement }

const addTabIcon = (children: React.ReactNode): React.ReactElement => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
  >
    {children}
  </svg>
)

const ADD_TAB_ITEMS: AddTabItem[] = [
  {
    key: 'terminal',
    label: 'Terminal',
    icon: addTabIcon(
      <>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </>,
    ),
  },
  {
    key: 'browser',
    label: 'Browser',
    icon: addTabIcon(
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </>,
    ),
  },
  {
    key: 'canvas',
    label: 'Canvas',
    icon: addTabIcon(
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </>,
    ),
  },
  {
    key: 'side-chat',
    label: 'Side chat',
    icon: addTabIcon(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  },
  {
    key: 'file',
    label: 'File…',
    icon: addTabIcon(
      <>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      </>,
    ),
  },
]

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
  /** Parent-held (App-level) backup of the last freehand sketch (PNG data
   *  URL). Lifted above CanvasPanel so the sketch survives CanvasPanel unmount
   *  on tab switches. Draw mode restores from this on mount. */
  sketchBackupRef?: React.MutableRefObject<string | null>
  /** Tab strip (docked variant): always visible — open canvas tabs + app panes
   *  (terminal/browser/side chat) + the `+` type picker. Popout keeps the old
   *  2+-tabs-only strip (it has no picker). */
  tabs?: CanvasTab[]
  activeTabId?: string | null
  onSelectTab?: (tabId: string) => void
  onCloseTab?: (tabId: string) => void
  /** Close many tabs at once (tab context menu: Close others / Close all
   *  terminals / Close all browsers). Parent disposes terminal sessions. */
  onCloseTabs?: (ids: string[]) => void
  /** `+` picker in the docked tab strip: open a new app-pane tab. */
  onAddTab?: (kind: AppTabKind) => void
  /** Terminal session registry (App-level). Terminal panes stay mounted
   *  (hidden) so the pty + scrollback survive tab switches. */
  terminals?: TerminalRegistry
  /** Active conversation id — parent for side-chat panes (null → placeholder). */
  sideChatParentId?: string | null
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
  sketchBackupRef,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseTabs,
  onAddTab,
  terminals,
  sideChatParentId,
  onUpdatePayload,
}: Props): React.ReactElement {
  const [dragOver, setDragOver] = useState(false)
  // `+` type-picker menu in the docked tab strip. The `+` follows the tabs,
  // so it can sit near either edge — measure on open and anchor the menu to
  // whichever side has room (208px menu + margin).
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuAlign, setAddMenuAlign] = useState<'left' | 'right'>('right')
  const addMenuBtnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  // Tab context menu (right-click a tab pill): Close others / Close all
  // terminals / Close all browsers. Escape + backdrop close it.
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!tabMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabMenu])
  const toggleAddMenu = () => {
    setAddMenuOpen((v) => {
      const next = !v
      if (next) {
        // Measure room against the PANE's edges, not the viewport — the menu
        // is clipped by the pane (overflow-hidden) and sibling panes paint
        // over anything that pokes outside, so the menu must stay inside.
        const btn = addMenuBtnRef.current?.getBoundingClientRect()
        const pane = panelRef.current?.getBoundingClientRect()
        if (btn && pane) {
          const roomLeft = btn.left - pane.left
          const roomRight = pane.right - btn.right
          setAddMenuAlign(roomLeft >= 216 && roomLeft > roomRight ? 'right' : 'left')
        }
      }
      return next
    })
  }
  useEffect(() => {
    if (!addMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addMenuOpen])
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

  // App-pane tabs (terminal / browser / side chat) render their own body and
  // hide the canvas view actions.
  const activeTab = tabs?.find((t) => t.id === activeTabId) ?? null
  const activeKind = activeTab ? tabKind(activeTab) : 'canvas'
  const isAppPane = activeKind !== 'canvas'

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
      ref={panelRef}
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
      {variant === 'popout' ?
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[0.85rem] font-medium text-text-primary">
            {isAppPane ? (activeTab?.title?.trim() || APP_TAB_KIND_LABEL[activeKind]) : 'Canvas'}
          </div>
          <div className={cn(mutedText, 'truncate text-[0.74rem]')}>
            {isAppPane ? APP_TAB_KIND_LABEL[activeKind] : (
              <>
                {title}
                {view ? ` · ${view.mode === 'live' ? 'live' : view.payload.kind}` : ''}
              </>
            )}
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
          {variant === 'popout' ?
            <button type="button" className={btnGhostSm} onClick={() => window.close()}>
              Close
            </button>
          : null}
        </div>
      </header>
      : null}
      {variant === 'docked' || (tabs && tabs.length > 1) ?
        <div className="flex shrink-0 items-center gap-1 border-b border-border py-1 pl-1.5 pr-1.5">
          {/* Scrollable tab area — kept separate from the `+` picker so the
              picker's dropdown can't be clipped by overflow-x-auto. */}
          <div
            role="tablist"
            aria-label="Apps tabs"
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
          >
          {(tabs ?? []).map((t) => {
            const active = t.id === activeTabId
            const k = tabKind(t)
            const label = canvasTabLabel(t.view, k, t.title)
            const glyph = APP_TAB_KIND_GLYPH[k]
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                title={active ? label : `Show ${label}`}
                onClick={() => onSelectTab?.(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setTabMenu({ tabId: t.id, x: e.clientX, y: e.clientY })
                }}
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
                    ? 'border-transparent bg-[#2e2e2e] text-text-primary'
                    : 'border-transparent text-text-secondary hover:bg-[#1e1e1e] hover:text-text-primary',
                )}
              >
                {k !== 'canvas' && glyph ?
                  <span aria-hidden className="shrink-0 font-mono text-[0.62rem] leading-none text-text-muted">
                    {glyph}
                  </span>
                : t.view.mode === 'live' ?
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    title="Live — updates automatically"
                  />
                : null}
                <span className="min-w-0 truncate">{label}</span>
                {t.origin && k !== 'canvas' ?
                  <span
                    className="shrink-0 text-[0.64rem] leading-none text-text-muted/80"
                    title={`Opened from chat: ${t.origin}`}
                  >
                    · {t.origin}
                  </span>
                : null}
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
          {variant === 'docked' && onAddTab ?
            <div className="relative shrink-0">
              <button
                type="button"
                ref={addMenuBtnRef}
                aria-label="Add apps tab"
                aria-expanded={addMenuOpen}
                title="Open a Terminal, Browser, Canvas, File, or Side chat pane"
                className={cn(
                  'flex size-[22px] cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-[0.9rem] leading-none text-text-secondary transition-colors hover:bg-[#1e1e1e] hover:text-text-primary',
                )}
                onClick={toggleAddMenu}
              >
                +
              </button>
              {addMenuOpen ?
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAddMenuOpen(false)}
                    aria-hidden
                  />
                  {/* Right-aligned so it opens leftward INTO the panel — the
                      `+` sits at the pane's right edge, a left-anchored menu
                      would be clipped off-window (panel root is
                      overflow-hidden). */}
                  <div
                    role="menu"
                    className={cn(
                      'absolute top-[30px] z-50 w-[208px] rounded-lg border border-border bg-bg-secondary py-1.5 shadow-[0_12px_32px_rgb(0_0_0/0.5)]',
                      addMenuAlign === 'right' ? 'right-0' : 'left-0',
                    )}
                  >
                    {ADD_TAB_ITEMS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        className="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-3 py-2 text-left text-[0.82rem] text-text-secondary transition-colors hover:bg-[#1e1e1e] hover:text-text-primary"
                        onClick={() => {
                          setAddMenuOpen(false)
                          if (item.key === 'file') {
                            void window.sylo.canvas.pickFile?.()
                          } else {
                            onAddTab(item.key)
                          }
                        }}
                      >
                        <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
                          {item.icon}
                        </span>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              : null}
            </div>
          : null}
          {/* Docked view actions + collapse — relocated from the removed header.
              ml-auto pins them to the right edge (the collapse takes the old
              `+` spot). Popout keeps its own header (no strip actions). */}
          {variant === 'docked' ?
            <div className="ml-auto flex shrink-0 items-center gap-1">
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
              {hasPopoutTarget && onPopOut && !drawMode ?
                <button type="button" className={btnGhostSm} title="Open in a new window" onClick={onPopOut}>
                  Pop out
                </button>
              : null}
              {live && !drawMode ?
                <button
                  type="button"
                  className={cn(btnGhostSm, 'px-2 text-[0.9rem] leading-none')}
                  title="Stop the live canvas view"
                  aria-label="Stop live view"
                  onClick={() => {
                    void window.sylo.canvas.stopLiveDemo(live.liveId)
                  }}
                >
                  ×
                </button>
              : null}
              {onCollapse ?
                <button
                  type="button"
                  className={sidebarResizeBtn}
                  title="Collapse canvas"
                  aria-label="Collapse canvas"
                  onClick={onCollapse}
                >
                  ▶
                </button>
              : null}
            </div>
          : null}
        </div>
      : null}
      {tabMenu && variant === 'docked' ?
        <>
          <div
            className={ctxMenuBackdrop}
            onClick={() => setTabMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setTabMenu(null)
            }}
            aria-hidden
          />
          <div
            role="menu"
            className={ctxMenuShell}
            style={{ left: tabMenu.x, top: tabMenu.y }}
          >
            {(() => {
              const all = tabs ?? []
              const target = all.find((t) => t.id === tabMenu.tabId)
              const kindOf = (t: CanvasTab) => tabKind(t)
              const terminalIds = all.filter((t) => kindOf(t) === 'terminal').map((t) => t.id)
              const browserIds = all.filter((t) => kindOf(t) === 'browser').map((t) => t.id)
              const item = (label: string, danger: boolean, onClick: () => void, disabled = false) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  className={cn(routeCtxItem, danger && 'text-danger hover:bg-[rgb(241_106_80/0.12)]', 'disabled:cursor-not-allowed disabled:opacity-50')}
                  onClick={() => {
                    setTabMenu(null)
                    onClick()
                  }}
                >
                  {label}
                </button>
              )
              return (
                <>
                  {item(
                    'Close others',
                    false,
                    () => onCloseTabs?.(all.filter((t) => t.id !== tabMenu.tabId).map((t) => t.id)),
                    all.length <= 1,
                  )}
                  {target && kindOf(target) !== 'canvas'
                    ? item(`Close ${canvasTabLabel(target.view, kindOf(target), target.title)}`, false, () => onCloseTab?.(target.id))
                    : null}
                  {item(
                    `Close all terminals (${terminalIds.length})`,
                    false,
                    () => onCloseTabs?.(terminalIds),
                    terminalIds.length === 0,
                  )}
                  {item(
                    `Close all browsers (${browserIds.length})`,
                    false,
                    () => onCloseTabs?.(browserIds),
                    browserIds.length === 0,
                  )}
                </>
              )
            })()}
          </div>
        </>
      : null}
      {/* Terminal panes stay mounted (hidden) so the pty + scrollback survive
          tab switches; only the active terminal tab is visible. */}
      {variant === 'docked' && terminals ?
        (tabs ?? [])
          .filter((t) => tabKind(t) === 'terminal')
          .map((t) => (
            <div
              key={t.id}
              className={cn(
                'min-h-0 min-w-0 flex-1',
                t.id === activeTabId && activeKind === 'terminal' ? 'flex' : 'hidden',
              )}
            >
              <TerminalPane tabId={t.id} terminals={terminals} className="min-h-0 min-w-0 flex-1" />
            </div>
          ))
      : null}
      {/* Browser panes stay mounted (hidden) so navigation state survives tab
          switches; the webview element itself dies on tab close. */}
      {variant === 'docked' ?
        (tabs ?? [])
          .filter((t) => tabKind(t) === 'browser')
          .map((t) => (
            <div
              key={t.id}
              className={cn(
                'min-h-0 min-w-0 flex-1',
                t.id === activeTabId && activeKind === 'browser' ? 'flex' : 'hidden',
              )}
            >
              <BrowserPane tabId={t.id} initialUrl={t.browserUrl} />
            </div>
          ))
      : null}
      {variant === 'docked' && isAppPane && activeKind === 'side-chat' ?
        <SideChatPane
          parentId={sideChatParentId ?? null}
          className="min-h-0 flex-1"
        />
      : variant === 'docked' && !isAppPane && drawMode ?
        <div className="min-h-0 flex-1 p-2">
                    <CanvasDraw
            backupRef={backupRef}
          />
        </div>
      : !isAppPane ? (
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
      )
      : null}
      {/* Bottom control bar (docked): the draw toggle lives here, not in the
          header — the header keeps only the view actions, the × (stop live)
          and the collapse arrow. */}
      {variant === 'docked' && !isAppPane ?
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5">
          <button
            type="button"
            className={cn(btnGhostSm, drawMode && 'bg-accent/20 text-accent')}
            title={drawMode ? 'Exit draw mode' : 'Switch the canvas to freehand draw mode (mouse). The agent can pull the sketch from chat (canvas_sketch tool).'}
            onClick={() => setDrawMode((v) => !v)}
          >
            {drawMode ? 'Exit draw' : 'Draw'}
          </button>
        </footer>
      : null}
    </section>
  )
}