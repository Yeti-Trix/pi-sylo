import { measureElement, observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { ChatTimelineRow } from '../components/think-tank/buildChatTimeline'
import type { ThinkTankSessionUiState } from '../components/think-tank/ThinkTankSessionBlock'
import {
  CHAT_AT_END_PX,
  CHAT_VIEWPORT_REMEASURE_MAX_FRAMES,
  chatVirtualizerNeedsViewportRetry,
  readChatScrollRect,
  shouldAdjustChatRowOnSizeChange,
} from './chatScrollIntent'
import { estimateTimelineRowHeight, rememberMeasuredTimelineRowHeight } from './chatRowEstimate'

export type ChatTimelineListHandle = {
  scrollToEnd: () => void
  stopSettle: () => void
  setPinned: (next: boolean) => void
  isAtEnd: (threshold?: number) => boolean
}

type Props = {
  rows: ChatTimelineRow[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  renderRow: (row: ChatTimelineRow) => React.ReactNode
  thinkTankUi: Record<string, ThinkTankSessionUiState | undefined>
  /** True while the user wants the live tail. Cleared on scroll-up. */
  pinToEnd: boolean
  pinToEndRef: { current: boolean }
  /** Fired once a settle-to-end scroll has stabilized at the true bottom. */
  onSettleEnd?: () => void
}

/**
 * End-anchored virtual list. Only the viewport + a small overscan mount.
 * Scroll-only motion updates transforms in the DOM (no React reconcile).
 */
export const ChatTimelineList = forwardRef<ChatTimelineListHandle, Props>(
  function ChatTimelineList({ rows, scrollRef, renderRow, thinkTankUi, pinToEnd, pinToEndRef, onSettleEnd }, ref) {
    const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows])
    const estimateSize = useCallback(
      (index: number) => estimateTimelineRowHeight(rows[index], thinkTankUi),
      [rows, thinkTankUi],
    )
    const measureRow = useCallback(
      (
        element: Element,
        entry: ResizeObserverEntry | undefined,
        instance: Parameters<typeof measureElement>[2],
      ) => {
        const size = measureElement(element, entry, instance)
        const index = instance.indexFromElement(element)
        const row = rows[index]
        if (row && size > 0) rememberMeasuredTimelineRowHeight(row, thinkTankUi, size)
        return size
      },
      [rows, thinkTankUi],
    )

    const observeScrollRect = useCallback<typeof observeElementRect>((instance, cb) => {
      const unsub = observeElementRect(instance, cb)
      const el = instance.scrollElement
      if (!el || !('clientHeight' in el)) return unsub
      const node = el as unknown as HTMLElement
      let frames = 0
      let raf = 0
      const step = () => {
        raf = 0
        frames += 1
        const height = node.clientHeight
        if (height > 0) {
          cb({ width: node.clientWidth, height })
          return
        }
        if (chatVirtualizerNeedsViewportRetry(height, frames)) {
          raf = requestAnimationFrame(step)
        }
      }
      raf = requestAnimationFrame(step)
      return () => {
        if (raf) cancelAnimationFrame(raf)
        unsub?.()
      }
    }, [])

    const initialRect = readChatScrollRect(scrollRef.current)

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize,
      overscan: 4,
      gap: 12,
      getItemKey,
      measureElement: measureRow,
      anchorTo: pinToEnd ? 'end' : 'start',
      followOnAppend: pinToEnd,
      scrollEndThreshold: CHAT_AT_END_PX,
      directDomUpdates: true,
      ...(initialRect ? { initialRect } : {}),
      observeElementRect: observeScrollRect,
      // The virtualizer calls flushSync from its mount layout effect
      // (_willUpdate → notify(true)), which React 18 cannot honor while
      // rendering — it warns and drops the forced flush. Plain batching is
      // equivalent on that path; scroll-path transforms still update via
      // directDomUpdates without React.
      useFlushSync: false,
    })

    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
      shouldAdjustChatRowOnSizeChange({
        pinnedToEnd: pinToEndRef.current,
        itemStart: item.start,
        itemSize: item.size,
        scrollOffset: (instance.scrollOffset ?? 0) + instance.scrollAdjustments,
        isFirstMeasure: !instance.itemSizeCache.has(item.key),
        scrollDirection: instance.scrollDirection,
      })

    /** rAF handle for the settle pump: after an initial scrollToEnd, the DOM
     * container is sized to the *virtual* total (estimates for unmeasured rows).
     * Mounting the newly-revealed rows replaces their estimates with actual
     * (usually larger) heights, so the true bottom recedes. Keep re-pinning
     * until we're at the tail AND the total height has stabilized. */
    const settleRafRef = useRef<number | null>(null)
    const stopSettle = useCallback(() => {
      if (settleRafRef.current != null) {
        cancelAnimationFrame(settleRafRef.current)
        settleRafRef.current = null
      }
    }, [])
    useEffect(() => stopSettle, [stopSettle])

    // Use a ref for onSettleEnd to avoid the callback changing identity and
    // re-creating the scrollToEnd closure on every parent render.
    const onSettleEndRef = useRef(onSettleEnd)
    onSettleEndRef.current = onSettleEnd

    const scrollToEndSettled = useCallback(() => {
      stopSettle()
      if (!pinToEndRef.current) return
      let waitFrames = 0
      const startSettlePump = () => {
        if (!pinToEndRef.current) return
        virtualizer.scrollToEnd()
        // Wait one frame after the initial scroll so the virtualizer can process
        // the scroll and mounted items can start measuring. Then repeatedly
        // re-scroll to the end while the total size is growing (measurements
        // replacing estimates). Two stable frames was not enough for markdown
        // and tool cards; keep going until height holds or we hit the cap.
        settleRafRef.current = requestAnimationFrame(() => {
          let lastTotal = virtualizer.getTotalSize()
          let stableFrames = 0
          let frames = 0
          const STABLE_FRAMES = 6
          const MAX_FRAMES = 45
          const step = () => {
            settleRafRef.current = null
            if (!pinToEndRef.current) return
            frames += 1
            if (stableFrames >= STABLE_FRAMES || frames >= MAX_FRAMES) {
              onSettleEndRef.current?.()
              return
            }
            const total = virtualizer.getTotalSize()
            if (total === lastTotal) {
              stableFrames += 1
            } else {
              stableFrames = 0
              lastTotal = total
            }
            virtualizer.scrollToEnd()
            settleRafRef.current = requestAnimationFrame(step)
          }
          step()
        })
      }
      const waitForViewport = () => {
        if (!pinToEndRef.current) return
        const el = scrollRef.current
        if (!el || el.clientHeight > 0) {
          startSettlePump()
          return
        }
        waitFrames += 1
        if (waitFrames >= CHAT_VIEWPORT_REMEASURE_MAX_FRAMES) {
          startSettlePump()
          return
        }
        settleRafRef.current = requestAnimationFrame(() => {
          settleRafRef.current = null
          waitForViewport()
        })
      }
      waitForViewport()
    }, [virtualizer, stopSettle, scrollRef, pinToEndRef])

    useImperativeHandle(
      ref,
      () => ({
        scrollToEnd: scrollToEndSettled,
        stopSettle,
        setPinned: (next: boolean) => {
          pinToEndRef.current = next
          if (!next) stopSettle()
          virtualizer.setOptions({
            ...virtualizer.options,
            anchorTo: next ? 'end' : 'start',
            followOnAppend: next,
          })
        },
        isAtEnd: (threshold = CHAT_AT_END_PX) => virtualizer.isAtEnd(threshold),
      }),
      [virtualizer, scrollToEndSettled, stopSettle, pinToEndRef],
    )

    const virtualItems = virtualizer.getVirtualItems()
    const mounted = useMemo(
      () =>
        virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null
          return (
            <div
              key={row.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full contain-layout"
              style={{ transform: `translate3d(0, ${virtualRow.start}px, 0)` }}
            >
              {renderRow(row)}
            </div>
          )
        }),
      [virtualItems, rows, renderRow, virtualizer.measureElement],
    )

    return (
      <div ref={virtualizer.containerRef} className="relative w-full">
        {mounted}
      </div>
    )
  },
)
