export const CANVAS_SIZE_DEFAULT = 280
export const CANVAS_SIZE_MIN = 140

// The canvas sits on the right; dragging its left edge leftward widens it.
// (Legacy clamp for the pre-workbench canvas-size pref — kept for stored-pref
// hygiene.) The fixed pixel floor (CANVAS_SIZE_MIN) is a small-screen safety
// net; on normal/large screens the fraction governs.
const CANVAS_MAX_FRACTION = 0.75
const CANVAS_MIN_FRACTION = 0.1
const MIN_NONCANVAS_WIDTH = 320

export function clampCanvasSize(size: number): number {
  if (!Number.isFinite(size)) return CANVAS_SIZE_DEFAULT
  const avail = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1920
  const min = Math.max(CANVAS_SIZE_MIN, Math.floor(avail * CANVAS_MIN_FRACTION))
  const max = Math.max(
    min,
    Math.min(
      Math.floor(avail * CANVAS_MAX_FRACTION),
      avail - Math.max(MIN_NONCANVAS_WIDTH, Math.floor(avail * CANVAS_MIN_FRACTION)),
    ),
  )
  return Math.min(max, Math.max(min, Math.round(size)))
}

// Workbench (canvas docked): the CHAT pane is the fixed-width side and the
// canvas takes the remaining space — Cursor-style proportions.
export const CHAT_PANE_SIZE_DEFAULT = 600
export const CHAT_PANE_SIZE_MIN = 380
export const CHAT_PANE_SIZE_MAX = 960

// The canvas may shrink to ~10% of the viewport (down from an implied 25%).
// Why 25% was the old real floor: the chat pane was clamped to a HARD 960px,
// so on a wide monitor the canvas could never get smaller than
// `windowWidth − 960` — on a 2543px screen that pinned the canvas at ~1345px
// (over half the window) no matter how far the operator dragged. The ceiling
// is now window-aware (chatPaneMaxForWindow) and the canvas floors at
// max(CANVAS_SIZE_MIN, 10% of the window).
const CANVAS_STRIP_MIN_FRACTION = 0.1

/**
 * Canvas may never be painted narrower than this for a given window.
 */
export function canvasMinWidthForWindow(innerWidth: number): number {
  if (!Number.isFinite(innerWidth) || innerWidth <= 0) return CANVAS_SIZE_MIN
  return Math.max(CANVAS_SIZE_MIN, Math.round(innerWidth * CANVAS_STRIP_MIN_FRACTION))
}

/**
 * Largest chat-pane size that still leaves the canvas at its minimum:
 * viewport width, minus whatever chrome sits left of the workbench (the
 * workspace sidebar), minus the canvas floor. Never below CHAT_PANE_SIZE_MIN.
 */
export function chatPaneMaxForWindow(innerWidth: number, leftReserve = 0): number {
  const w = Number.isFinite(innerWidth) && innerWidth > 0 ? innerWidth : 1920
  const reserve = Number.isFinite(leftReserve) && leftReserve > 0 ? Math.round(leftReserve) : 0
  return Math.max(CHAT_PANE_SIZE_MIN, Math.floor(w - reserve - canvasMinWidthForWindow(w)))
}

export function clampChatPaneSize(v: number, maxPx?: number): number {
  // Math.min/max propagate NaN — a corrupt stored pref must fall back to the
  // default, not paint `flex: 0 0 NaNpx` (invalid → class basis-0 → 50/50 again).
  if (!Number.isFinite(v)) return CHAT_PANE_SIZE_DEFAULT
  // Ceiling for this clamp: a caller-supplied window-aware max when given;
  // otherwise a window-derived bound (fallback 1920 outside a browser/JSDOM)
  // so a stored pref ≥ 960 from a dragged session still loads instead of being
  // silently amputated back to the legacy hard cap on wide monitors.
  const ceil =
    typeof maxPx === 'number' && Number.isFinite(maxPx)
      ? Math.max(CHAT_PANE_SIZE_MIN, Math.round(maxPx))
      : chatPaneMaxForWindow(typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1920)
  return Math.min(ceil, Math.max(CHAT_PANE_SIZE_MIN, Math.round(v)))
}

/**
 * Render-time size for the workbench chat pane. The pane is a fixed flex-basis
 * (flex: 0 0 Xpx — an inherited flex-1/basis-0% would otherwise ignore `width`),
 * so also cap it so the canvas keeps at least canvasMinWidthForWindow: a window
 * (or expanded sidebar) that shrank since the operator last dragged must never
 * starve the canvas below that floor. `leftReserve` is the sidebar width (or
 * its collapsed width). The operator's persisted preference is stored/clamped
 * unperturbed — this only bounds what is PAINTED this render.
 */
export function chatPaneSizeForWindow(size: number, innerWidth: number, leftReserve = 0): number {
  return clampChatPaneSize(size, chatPaneMaxForWindow(innerWidth, leftReserve))
}

/**
 * Workbench resize drag math. The handle is the CHAT pane's right edge, so the
 * pane edge tracks the cursor exactly: hand right → chat widens (canvas
 * narrows), hand left → canvas widens. Same convention as the sidebar
 * splitter. (The old canvas-size drag used the opposite sign because there the
 * handle sat on the CANVAS's left edge — dragging left widened the canvas;
 * 2df9343 repointed that formula at the chat size without flipping it, which
 * made the pane move opposite the mouse.)
 *
 * `maxPx` is the window-aware pane ceiling (chatPaneMaxForWindow) so the drag
 * can exceed the legacy 960 cap on wide monitors — that hard cap was exactly
 * what stopped the canvas from shrinking smaller `windowWidth − 960`.
 */
export function chatPaneSizeFromDrag(startSize: number, startX: number, clientX: number, maxPx?: number): number {
  const d = clientX - startX
  return clampChatPaneSize(startSize + d, maxPx)
}