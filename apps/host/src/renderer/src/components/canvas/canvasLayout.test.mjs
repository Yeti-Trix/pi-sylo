import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHAT_PANE_SIZE_DEFAULT,
  CHAT_PANE_SIZE_MAX,
  CHAT_PANE_SIZE_MIN,
  clampChatPaneSize,
  chatPaneSizeForWindow,
  chatPaneSizeFromDrag,
} from './canvasLayout.ts'

test('clampChatPaneSize', () => {
  assert.equal(clampChatPaneSize(0), CHAT_PANE_SIZE_MIN)
  // At/under the floor clamps to the floor.
  assert.equal(clampChatPaneSize(100), CHAT_PANE_SIZE_MIN)
  assert.equal(clampChatPaneSize(CHAT_PANE_SIZE_MIN), CHAT_PANE_SIZE_MIN)
  // Sane value is rounded, passed through.
  assert.equal(clampChatPaneSize(640.4), 640)
  // Over the ceiling clamps to the ceiling.
  assert.equal(clampChatPaneSize(1400), CHAT_PANE_SIZE_MAX)
  // NaN / Infinity fall back to the default (Math.min/max would propagate NaN).
  assert.equal(clampChatPaneSize(Number.NaN), CHAT_PANE_SIZE_DEFAULT)
  assert.equal(clampChatPaneSize(Number.POSITIVE_INFINITY), CHAT_PANE_SIZE_DEFAULT)
})

test('chatPaneSizeForWindow — wide window returns the persisted size', () => {
  // 1920 * 0.75 = 1440 > default 600 → unchanged (rounded/clamped).
  assert.equal(chatPaneSizeForWindow(CHAT_PANE_SIZE_DEFAULT, 1920), CHAT_PANE_SIZE_DEFAULT)
  assert.equal(chatPaneSizeForWindow(750.4, 1920), 750)
})

test('chatPaneSizeForWindow — narrow window caps at 75% of viewport', () => {
  // 800 * 0.75 = 600 → a stored 800 paints at 600, not wider.
  assert.equal(chatPaneSizeForWindow(800, 800), 600)
  // 1000 * 0.75 = 750.
  assert.equal(chatPaneSizeForWindow(960, 1000), 750)
})

test('chatPaneSizeForWindow — tiny window keeps the min floor', () => {
  // The 75% cap never drops below CHAT_PANE_SIZE_MIN.
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
  // Clamped both ways.
  assert.equal(chatPaneSizeFromDrag(CHAT_PANE_SIZE_MIN, 900, 100), CHAT_PANE_SIZE_MIN)
  assert.equal(chatPaneSizeFromDrag(CHAT_PANE_SIZE_MAX, 900, 2000), CHAT_PANE_SIZE_MAX)
})