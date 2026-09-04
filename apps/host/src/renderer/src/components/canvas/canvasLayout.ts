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