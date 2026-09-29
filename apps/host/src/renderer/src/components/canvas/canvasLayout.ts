export const CANVAS_SIZE_DEFAULT = 280
export const CANVAS_SIZE_MIN = 140

// The canvas sits on the right; dragging its left edge leftward widens it.
// When the canvas is shown, the operator wants neither pane smaller than 25%
// of the available width — i.e. the canvas is clamped to [25%, 75%] of the
// viewport. The fixed pixel floors (CANVAS_SIZE_MIN for the canvas,
// MIN_NONCANVAS_WIDTH for the chat strip) are kept only as small-screen safety
// nets so a tiny window never collapses a pane to an unusable sliver; on
// normal/large screens the 25% fractions govern.
const CANVAS_MIN_FRACTION = 0.25
const CANVAS_MAX_FRACTION = 0.75
const MIN_NONCANVAS_WIDTH = 320

export function clampCanvasSize(size: number): number {
  if (!Number.isFinite(size)) return CANVAS_SIZE_DEFAULT
  const avail = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1920
  const min = Math.max(CANVAS_SIZE_MIN, Math.floor(avail * CANVAS_MIN_FRACTION))
  const max = Math.max(
    min,
    Math.min(Math.floor(avail * CANVAS_MAX_FRACTION), avail - Math.max(MIN_NONCANVAS_WIDTH, Math.floor(avail * CANVAS_MIN_FRACTION))),
  )
  return Math.min(max, Math.max(min, Math.round(size)))
}
// Workbench (canvas docked): the CHAT pane is the fixed-width side and the
// canvas takes the remaining space — Cursor-style proportions.
export const CHAT_PANE_SIZE_DEFAULT = 600
export const CHAT_PANE_SIZE_MIN = 380
export const CHAT_PANE_SIZE_MAX = 960
export function clampChatPaneSize(v: number): number {
  // Math.min/max propagate NaN — a corrupt stored pref must fall back to the
  // default, not paint `flex: 0 0 NaNpx` (invalid → class basis-0 → 50/50 again).
  if (!Number.isFinite(v)) return CHAT_PANE_SIZE_DEFAULT
  return Math.min(CHAT_PANE_SIZE_MAX, Math.max(CHAT_PANE_SIZE_MIN, Math.round(v)))
}

/**
 * Render-time size for the workbench chat pane. The pane is a fixed flex-basis
 * (flex: 0 0 Xpx — an inherited flex-1/basis-0% would otherwise ignore `width`),
 * so also cap it at 75% of the actual window: a window that shrank since the
 * operator last dragged must never starve the canvas below a usable strip.
 * The operator's persisted preference is stored/clamped unperturbed —
 * this only bounds what is PAINTED this render.
 */
export function chatPaneSizeForWindow(size: number, innerWidth: number): number {
  const clamped = clampChatPaneSize(size)
  if (!Number.isFinite(innerWidth) || innerWidth <= 0) return clamped
  const cap = Math.max(CHAT_PANE_SIZE_MIN, Math.round(innerWidth * CANVAS_MAX_FRACTION))
  return clampChatPaneSize(Math.min(clamped, cap))
}

/**
 * Workbench resize drag math. The handle is the CHAT pane's right edge, so the
 * pane edge tracks the cursor exactly: hand right → chat widens (canvas
 * narrows), hand left → canvas widens. Same convention as the sidebar
 * splitter. (The old canvas-size drag used the opposite sign because there the
 * handle sat on the CANVAS's left edge — dragging left widened the canvas;
 * 2df9343 repointed that formula at the chat size without flipping it, which
 * made the pane move opposite the mouse.)
 */
export function chatPaneSizeFromDrag(startSize: number, startX: number, clientX: number): number {
  const d = (clientX - startX)
  return clampChatPaneSize(startSize + d)
}
