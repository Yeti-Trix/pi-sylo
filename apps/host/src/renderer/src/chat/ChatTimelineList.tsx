import { useVirtualizer } from '@tanstack/react-virtual'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { ChatTimelineRow } from '../components/think-tank/buildChatTimeline'
import type { ThinkTankSessionUiState } from '../components/think-tank/ThinkTankSessionBlock'
import { estimateTimelineRowHeight } from './chatRowEstimate'

export const CHAT_NEAR_BOTTOM_PX = 120

export type ChatTimelineListHandle = {
  scrollToEnd: () => void
  isAtEnd: (threshold?: number) => boolean
}

type Props = {
  rows: ChatTimelineRow[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  renderRow: (row: ChatTimelineRow) => React.ReactNode
  thinkTankUi: Record<string, ThinkTankSessionUiState | undefined>
  /** Fired once a settle-to-end scroll has stabilized at the true bottom. */
  onSettleEnd?: () => void
}

/**
 * End-anchored virtual list. Only the viewport + a small overscan mount.
 * Scroll-only motion updates transforms in the DOM (no React reconcile).
 */
export const ChatTimelineList = forwardRef<ChatTimelineListHandle, Props>(
  function ChatTimelineList({ rows, scrollRef, renderRow, thinkTankUi, onSettleEnd }, ref) {
    const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows])
    const estimateSize = useCallback(
      (index: number) => estimateTimelineRowHeight(rows[index], thinkTankUi),
      [rows, thinkTankUi],
    )

    const virtualizer = useVirtualizer({
      count: rows.length,
      enabled: rows.length > 0,
      getScrollElement: () => scrollRef.current,
      estimateSize,
      overscan: 4,
      gap: 12,
      getItemKey,
      anchorTo: 'end',
      followOnAppend: true,
      scrollEndThreshold: CHAT_NEAR_BOTTOM_PX,
      directDomUpdates: true,
      // The virtualizer calls flushSync from its mount layout effect
      // (_willUpdate → notify(true)), which React 18 cannot honor while
      // rendering — it warns and drops the forced flush. Plain batching is
      // equivalent on that path; scroll-path transforms still update via
      // directDomUpdates without React.
      useFlushSync: false,
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
      virtualizer.scrollToEnd()
      stopSettle()
      // Wait one frame after the initial scroll so the virtualizer can process
      // the scroll and mounted items can start measuring. Then repeatedly
      // re-scroll to the end while the total size is growing (measurements
      // replacing estimates). Stop after the total has been stable for 2 frames.
      settleRafRef.current = requestAnimationFrame(() => {
        let lastTotal = virtualizer.getTotalSize()
        let stableFrames = 0
        const step = () => {
          settleRafRef.current = null
          if (stableFrames >= 2) {
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
    }, [virtualizer, stopSettle])

    useImperativeHandle(
      ref,
      () => ({
        scrollToEnd: scrollToEndSettled,
        isAtEnd: (threshold = CHAT_NEAR_BOTTOM_PX) => virtualizer.isAtEnd(threshold),
      }),
      [virtualizer, scrollToEndSettled],
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
            >
              {renderRow(row)}
            </div>
          )
        }),
      [virtualItems, rows, renderRow, virtualizer.measureElement],
    )

    if (rows.length === 0) return null

    return (
      <div ref={virtualizer.containerRef} className="relative w-full">
        {mounted}
      </div>
    )
  },
)
