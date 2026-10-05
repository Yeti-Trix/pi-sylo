export type CanvasKind = 'svg' | 'mermaid' | 'markdown'

export type CanvasPayload = {
  toolCallId: string
  kind: CanvasKind
  title?: string
  /** Inline SVG markup, Mermaid source, or Markdown source. */
  content?: string
  /** Absolute path to a local `.svg` file (rendered via sylo-file://). */
  filePath?: string
  /** Absolute path the markdown content was loaded from (for "Reveal/Open" affordances). */
  sourcePath?: string
}

// ─── Live (subscribed) canvas — sibling to the snapshot payload above ───────
// The snapshot `CanvasPayload` is emitted once and then static. A live canvas
// binds the panel to a `liveId`; the main process fans `canvas:live-update`
// patches to the docked canvas + any popped-out windows subscribed to that id.
// Snapshot kinds are untouched — live is an additive, parallel path so the
// existing svg/mermaid/markdown experience cannot regress.

export type CanvasLiveKind = 'live-demo' | 'task-board' | 'subagent-runs'

export type CanvasLiveSubscription = {
  liveId: string
  kind: CanvasLiveKind
  title?: string
  /** Last-known live data; updated by `canvas:live-update` patches. */
  data?: unknown
}

/** Discriminated view the CanvasPanel renders. `null` = empty canvas. */
export type CanvasView =
  | { mode: 'snapshot'; payload: CanvasPayload }
  | { mode: 'live'; sub: CanvasLiveSubscription }

/** One tab in the docked canvas. Each tab owns exactly one view — snapshot
 *  or live — which is what makes Pop out / Refresh unambiguous (the old
 *  single-slot model could hold a shown snapshot AND a hidden live board at
 *  the same time, which is how Pop out ended up opening a stale item).
 *
 *  Phase 4 (apps pane): tabs can also be non-canvas app panes (terminal,
 *  browser, side chat). `kind` defaults to 'canvas'; non-canvas kinds ignore
 *  `view` (it holds an empty placeholder payload) and render their own body.
 *  `title` names app panes (canvas tabs label from their view). */
export type AppTabKind = 'canvas' | 'terminal' | 'browser' | 'side-chat' | 'widget' | 'diff'

/** One-shot agent payload opened as a widget tab (skill-surface iframe).
 *  Sent by the host when an agent calls `show_widget`; replaces the old
 *  chat-column widget host. Exactly one of html/path is meaningful — both
 *  set or both missing render the invalid-payload fallback. */
export type WidgetTabPayload = {
  toolCallId: string
  html?: string
  path?: string
  data?: unknown
}

export const APP_TAB_KIND_LABEL: Record<AppTabKind, string> = {
  canvas: 'Canvas',
  terminal: 'Terminal',
  browser: 'Browser',
  'side-chat': 'Side chat',
  widget: 'Widget',
  diff: 'Diff',
}

export type CanvasTab = {
  id: string
  view: CanvasView
  kind?: AppTabKind
  title?: string
  /** Workspace-pool tabs: which chat opened it (muted chip in the strip). */
  origin?: string
  /** Workspace-pool persistence: terminal start cwd / last browser URL. */
  terminalCwd?: string
  browserUrl?: string
  /** Widget tab body (skill-surface payload for an agent `show_widget`).
   *  Ephemeral by design: pool persistence saves only terminal/browser
   *  kinds, so a widget payload does not survive a restart (the agent can
   *  re-show it). */
  widget?: WidgetTabPayload
  /** Diff-review tab body (task 07): read-only per-turn file diffs. Same
   *  ephemerality as widgets — re-openable from the change card. */
  diff?: DiffTabPayload
}

/** Diff-review tab payload: per-file unified diffs for one assistant turn. */
export type DiffTabPayload = {
  assistantMessageId: string
  files: Array<{
    rel: string
    status: 'modified' | 'added' | 'deleted'
    diff: string
    skipped?: 'size' | 'binary'
  }>
}

export function tabKind(t: CanvasTab): AppTabKind {
  return t.kind ?? 'canvas'
}

/** Glyph prefix for app-pane tabs (canvas tabs use their live dot instead). */
export const APP_TAB_KIND_GLYPH: Record<AppTabKind, string> = {
  canvas: '',
  terminal: '>_',
  browser: '◎',
  'side-chat': '◇',
  widget: '▣',
  diff: '±',
}

/** Short label for a tab: app-pane title → payload title → file name → kind fallback. */
export function canvasTabLabel(view: CanvasView, kind: AppTabKind = 'canvas', title?: string): string {
  if (kind !== 'canvas') {
    return title?.trim() || APP_TAB_KIND_LABEL[kind]
  }
  if (view.mode === 'live') {
    return (
      view.sub.title?.trim() ||
      (view.sub.kind === 'task-board' ? 'Task board' : 'Live')
    )
  }
  const p = view.payload
  return (
    p.title?.trim() ||
    (p.sourcePath ? p.sourcePath.split(/[\\/]/).pop() || '' : '') ||
    (p.kind === 'mermaid' ? 'Diagram' : p.kind === 'markdown' ? 'Markdown' : 'SVG')
  )
}