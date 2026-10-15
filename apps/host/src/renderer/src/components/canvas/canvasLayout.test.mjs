import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHAT_PANE_SIZE_DEFAULT,
  CHAT_PANE_SIZE_MAX,
  CHAT_PANE_SIZE_MIN,
  CANVAS_SIZE_MIN,
  canvasMinWidthForWindow,
  chatPaneMaxForWindow,
  clampChatPaneSize,
  chatPaneSizeForWindow,
  chatPaneSizeFromDrag,
} from './canvasLayout.ts'

// In bare node there is no `window`, so the module falls back to a 1920px
// viewport. With that fallback the pane ceiling = max(960, 1920 − max(140, 192))
// = max(960, 1728) = 1728.
const CEIL_NO_WINDOW = Math.max(CHAT_PANE_SIZE_MAX, 1920 - Math.max(CANVAS_SIZE_MIN, 192))

test('clampChatPaneSize', () => {
  assert.equal(clampChatPaneSize(0), CHAT_PANE_SIZE_MIN)
  // At/under the floor clamps to the floor.
  assert.equal(clampChatPaneSize(100), CHAT_PANE_SIZE_MIN)
  assert.equal(clampChatPaneSize(CHAT_PANE_SIZE_MIN), CHAT_PANE_SIZE_MIN)
  // Sane value is rounded, passed through.
  assert.equal(clampChatPaneSize(640.4), 640)
  // Over the (no-window fallback) ceiling clamps to it — NOT the legacy 960:
  // a pane wider than 960 has been draggable since the wide-monitor fix, and
  // a loaded pref must keep that size. (1400 sits under the 1728 fallback
  // ceiling; 2400 exceeds it.)
  assert.equal(clampChatPaneSize(1400), 1400)
  assert.equal(clampChatPaneSize(2400), CEIL_NO_WINDOW)
  // NaN / Infinity fall back to the default (Math.min/max would propagate NaN).
  assert.equal(clampChatPaneSize(Number.NaN), CHAT_PANE_SIZE_DEFAULT)
  assert.equal(clampChatPaneSize(Number.POSITIVE_INFINITY), CHAT_PANE_SIZE_DEFAULT)
})

test('clampChatPaneSize — explicit maxPx is the ceiling (window-aware drag/clamp path)', () => {
  // Wide window: ceiling well above the legacy 960 hard cap.
  assert.equal(clampChatPaneSize(1400, 2289), 1400)
  assert.equal(clampChatPaneSize(1400, 1500), 1400)
  assert.equal(clampChatPaneSize(3000, 2289), 2289)
  // Never under the floor, even if the caller's max is absurdly small.
  assert.equal(clampChatPaneSize(500, 100), CHAT_PANE_SIZE_MIN)
})

test('canvasMinWidthForWindow', () => {
  // 10% of the viewport, but never below the 140px safety net.
  assert.equal(canvasMinWidthForWindow(2543), 254)
  assert.equal(canvasMinWidthForWindow(1600), 160)
  assert.equal(canvasMinWidthForWindow(1000), CANVAS_SIZE_MIN)
  // Degenerate width → safety net only.
  assert.equal(canvasMinWidthForWindow(0), CANVAS_SIZE_MIN)
  assert.equal(canvasMinWidthForWindow(Number.NaN), CANVAS_SIZE_MIN)
})

test('chatPaneMaxForWindow — leaves the canvas its minimum', () => {
  // No left chrome: 2543 − canvasMin(254) = 2289.
  assert.equal(chatPaneMaxForWindow(2543), 2289)
  // Sidebar open (520 wide): 2543 − 520 − 254 = 1769.
  assert.equal(chatPaneMaxForWindow(2543, 520), 1769)
  // Sidebar collapsed (44): 2543 − 44 − 254 = 2245.
  assert.equal(chatPaneMaxForWindow(2543, 44), 2245)
  // Narrow window: at least the pane min.
  assert.equal(chatPaneMaxForWindow(500, 400), CHAT_PANE_SIZE_MIN)
  // Degenerate innerWidth → 1920 fallback: 1920 − canvasMin(192) = 1728.
  assert.equal(chatPaneMaxForWindow(0), 1728)
})

test('chatPaneSizeForWindow — wide window returns the persisted size', () => {
  // 1920 − max(140, 192) = 1728 > default 600 → unchanged (rounded/clamped).
  assert.equal(chatPaneSizeForWindow(CHAT_PANE_SIZE_DEFAULT, 1920), CHAT_PANE_SIZE_DEFAULT)
  assert.equal(chatPaneSizeForWindow(750.4, 1920), 750)
})

test('chatPaneSizeForWindow — narrow window caps so the canvas keeps its strip', () => {
  // 800 − canvasMin(140... max(140, 80) = 140) = 660 → a stored 800 paints at 660.
  assert.equal(chatPaneSizeForWindow(800, 800), 660)
  // 1000 − 140 = 860: stored 960 paints at 860.
  assert.equal(chatPaneSizeForWindow(960, 1000), 860)
  // With a 520px sidebar reserve: 1000 − 520 − 140 = 340 < floor → pane min.
  assert.equal(chatPaneSizeForWindow(960, 1000, 520), CHAT_PANE_SIZE_MIN)
})

test('chatPaneSizeForWindow — tiny window keeps the min floor', () => {
  // The cap never drops below CHAT_PANE_SIZE_MIN.
  assert.equal(chatPaneSizeForWindow(CHAT_PANE_SIZE_DEFAULT, 400), CHAT_PANE_SIZE_MIN)
  assert.equal(chatPaneSizeForWindow(CHAT_PANE_SIZE_MIN, 400), CHAT_PANE_SIZE_MIN)
})

test('chatPaneSizeForWindow — degenerate innerWidth falls back to the clamp', () => {
  assert.equal(chatPaneSizeForWindow(700, 0), 700)
  assert.equal(chatPaneSizeForWindow(700, -5), 700)
  assert.equal(chatPaneSizeForWindow(Number.NaN, 1000), CHAT_PANE_SIZE_DEFAULT)
})

test('chatPaneSizeFromDrag — pane edge tracks the cursor (handle = chat right edge)', () => {
  // Drag RIGHT of the start point (< cursor > start) → chat pane widens.
  assert.equal(chatPaneSizeFromDrag(500, 900, 950), 550)
  // Drag LEFT → chat pane narrows, so the canvas widens.
  assert.equal(chatPaneSizeFromDrag(500, 900, 860), 460)
  // No movement → unchanged.
  assert.equal(chatPaneSizeFromDrag(500, 900, 900), 500)
  // Clamped both ways (no-window fallback ceiling).
  assert.equal(chatPaneSizeFromDrag(CHAT_PANE_SIZE_MIN, 900, 100), CHAT_PANE_SIZE_MIN)
  assert.equal(chatPaneSizeFromDrag(CHAT_PANE_SIZE_MAX, 900, 2000 + 900), CEIL_NO_WINDOW)
})

test('chatPaneSizeFromDrag — window-aware ceiling lets the canvas shrink past 960', () => {
  // Regression: on a wide monitor the legacy hard 960 cap stopped the drag —
  // the canvas could never shrink below windowWidth − 960 (~1345px on 2543).
  // With the ceiling passed in, the same drag goes past 960.
  const ceil = chatPaneMaxForWindow(2543, 251)
  assert.equal(ceil, 2038) // 2543 − 251 − 254
  assert.equal(chatPaneSizeFromDrag(960, 1200, 2500, ceil), 2038)
  assert.equal(chatPaneSizeFromDrag(2038, 1200, 3000, ceil), 2038)
})