/**
 * Chat scroll intent: stay pinned to the newest message unless the user
 * clearly scrolled up. The virtual list and conversation switches both move
 * `scrollTop` on their own; treating those as user input is what flings the
 * pane to the top and makes the End button necessary.
 */

/** Pixel-wheel delta smaller than this is trackpad jitter, not a read-back. */
export const CHAT_WHEEL_UP_PX = 12

/**
 * Must be this close to the true end before stick-to-bottom can turn back on,
 * and before the virtualizer treats a row resize as "still at Latest".
 * A 120px band is wide enough that the user's own prompt (just above a
 * short reply) still counts as the end — that is the jump-to-Latest yank.
 */
export const CHAT_AT_END_PX = 8

/** True when the loaded messages belong to the conversation now on screen. */
export function chatMessagesMatchConversation(
  activeId: string | undefined,
  lastMessageConversationId: string | undefined,
): boolean {
  if (!activeId) return false
  if (!lastMessageConversationId) return false
  return lastMessageConversationId === activeId
}

/**
 * A scrollTop decrease is only a user opt-out when the list's height did not
 * also change. Measurement (estimate → real row height) and conversation
 * swaps change both; dragging the scrollbar changes only scrollTop.
 */
export function isUserDrivenScrollUp(opts: {
  scrollTop: number
  lastScrollTop: number
  scrollHeight: number
  lastScrollHeight: number
  now: number
  suppressUntil: number
}): boolean {
  if (opts.now <= opts.suppressUntil) return false
  if (opts.scrollTop >= opts.lastScrollTop - 1) return false
  const heightChanged = Math.abs(opts.scrollHeight - opts.lastScrollHeight) > 1
  return !heightChanged
}

/** Wheel/trackpad: line/page ticks always count; pixel mode needs a floor. */
export function isUserScrollUpWheel(deltaY: number, deltaMode = 0): boolean {
  if (deltaY >= 0) return false
  if (deltaMode !== 0) return true
  return deltaY <= -CHAT_WHEEL_UP_PX
}

/**
 * Re-enable stick-to-bottom only when already pinned, or when the user
 * scrolled down onto the true end. Being merely near the end after an
 * upward read-back must not re-pin.
 */
export function shouldRepinChatToEnd(opts: {
  atEnd: boolean
  alreadyPinned: boolean
  scrollTop: number
  lastScrollTop: number
}): boolean {
  if (!opts.atEnd) return false
  if (opts.alreadyPinned) return true
  return opts.scrollTop >= opts.lastScrollTop - 1
}

/**
 * Leave stick-to-bottom as soon as the user has actually moved away from
 * the end. Height must not gate this: a streaming reply changes
 * scrollHeight on the same frame as a trackpad step, and ignoring that
 * step is what left stick on so a later resize yanked back to Latest.
 */
export function shouldUnpinChatFromEnd(opts: {
  atEnd: boolean
  scrollTop: number
  lastScrollTop: number
  now: number
  suppressUntil: number
}): boolean {
  if (opts.now <= opts.suppressUntil) return false
  if (opts.atEnd) return false
  return opts.scrollTop < opts.lastScrollTop - 1
}

/**
 * Keep the reading position stable when an older row's estimate is wrong:
 * compensate items that sit entirely above the fold. Do not compensate the
 * on-screen row (the user prompt they just reached) — that is the
 * jump-to-Latest. While pinned, also compensate a first measure that
 * starts above the fold so the live tail does not drift.
 */
export function shouldAdjustChatRowOnSizeChange(opts: {
  pinnedToEnd: boolean
  itemStart: number
  itemSize: number
  scrollOffset: number
  isFirstMeasure: boolean
  scrollDirection: 'forward' | 'backward' | null
}): boolean {
  const entirelyAbove = opts.itemStart + opts.itemSize <= opts.scrollOffset
  if (entirelyAbove) return true
  if (opts.pinnedToEnd && opts.isFirstMeasure && opts.itemStart < opts.scrollOffset) {
    return true
  }
  return false
}

/**
 * TanStack Virtual yields `range: null` (no mounted rows) while the
 * scrollport height is 0. A missed first measure is the blank-chat-until-
 * resize / chat-switch symptom. Retry for this many frames.
 */
export const CHAT_VIEWPORT_REMEASURE_MAX_FRAMES = 30

export function readChatScrollRect(
  el: { clientWidth: number; clientHeight: number } | null | undefined,
): { width: number; height: number } | undefined {
  if (!el) return undefined
  const width = el.clientWidth
  const height = el.clientHeight
  if (height <= 0) return undefined
  return { width, height }
}

export function chatVirtualizerNeedsViewportRetry(
  viewportHeight: number,
  framesTried: number,
  maxFrames = CHAT_VIEWPORT_REMEASURE_MAX_FRAMES,
): boolean {
  return viewportHeight <= 0 && framesTried < maxFrames
}
