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

export type CanvasLiveKind = 'live-demo' | 'task-board'

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
 *  the same time, which is how Pop out ended up opening a stale item). */
export type CanvasTab = {
  id: string
  view: CanvasView
}

/** Short label for a tab: payload title → file name → kind fallback. */
export function canvasTabLabel(view: CanvasView): string {
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