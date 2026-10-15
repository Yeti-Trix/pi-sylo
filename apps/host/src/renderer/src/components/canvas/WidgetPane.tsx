import React, { useEffect, useState } from 'react'
import { mutedText, toolLogPre } from '../../panels/ui-classes'
import { cn } from '../../lib/cn'
import { SkillSurfaceSandbox } from '../../skill-surface/iframe-host'
import type { SkillRouteBridgeOp, WidgetBridgeMessageFromChild } from '../../skill-surface/bridge'
import type { SkillRouteTabPayload, WidgetTabPayload } from './canvasTypes'

/**
 * Body of a canvas 'widget' app-pane tab: renders one agent `show_widget`
 * payload in the sandboxed skill-surface iframe (same machinery dashboards
 * use) with a small view-only bridge log strip. Replaces the old chat-column
 * widget host — agent-driven rich UI belongs on the canvas, not in chat.
 *
 * Also carries the branch for canvas 'skill-route' tabs (persistent
 * docked dashboards, e.g. the image-gen Images route). The branch lives in
 * THIS file so the docked route body sits beside the plain-widget body it
 * mirrors (route args are exactly the full-area route mount in App.tsx) — a
 * separate RoutePane file would only duplicate this mount while the payload
 * flows through the same mounting block.
 *
 * Mount model: like browser panes, widget/route panes stay mounted (hidden)
 * across tab switches so iframe state survives; the element dies when the tab
 * is closed.
 */

type Props = {
  widget?: WidgetTabPayload
  /** Docked skill-route tab payload. When set, renders the route-variant
   *  sandbox branch instead of the one-shot widget branch. */
  skillRoute?: SkillRouteTabPayload
  /** Route-only: the REAL skill-route bridge for this tab's own route row
   *  (App pins `handleSkillRouteBridge` to the tab payload) — no view-only
   *  log strip, mirroring the full-area/pop-out route mounts. */
  skillRouteBridge?: (op: SkillRouteBridgeOp, payload: unknown) => Promise<unknown>
  /** Route-only workspace context: pushed to the iframe on workspace change. */
  skillRouteHostPiCwd?: string
  /** Route-only: imagegen library change fan (identity-based push). */
  skillRouteLibraryFan?: { workspaceKey: string; reason: string } | null
  /** Route-only: videogen twin of `skillRouteLibraryFan` (plan §5.5, §8 step
   *  7 — CLONE discipline: a sibling prop threaded into the sandbox's
   *  `videogenLibraryChangedFan` push, not a generalization of the imagegen
   *  fan). */
  skillRouteVideoLibraryFan?: { workspaceKey: string; reason: string } | null
  className?: string
}

export function WidgetPane({
  widget,
  skillRoute,
  skillRouteBridge,
  skillRouteHostPiCwd,
  skillRouteLibraryFan,
  skillRouteVideoLibraryFan,
  className,
}: Props): React.ReactElement {
  const [log, setLog] = useState<string[]>([])
  // Reset the log when the tab gains a different payload (same-call re-show
  // keeps the tab id but fresh data → fresh log).
  const toolCallId = widget?.toolCallId ?? ''
  useEffect(() => {
    setLog([])
  }, [toolCallId])

  // ── skill-route tabs ──────────────────────────────────────────────────────
  // Mirrors App.tsx's full-area route mount one-to-one (variant="route",
  // widgetData={}, compactChrome, noop reject/error); the only deltas are
  // per-tab threading of the real bridge handler + ws context, and
  // `iframeClassName="min-h-0"` neutralizing the route iframe's
  // `min-h-[calc(100dvh-10.5rem)]` (full-area assumption) — a docked pane
  // sizes from `flex-1` within the canvas column instead.
  if (skillRoute !== undefined) {
    return (
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
        <SkillSurfaceSandbox
          key={`${skillRoute.skillFolderName}:${skillRoute.routeId}`}
          variant="route"
          fixturePath={skillRoute.fixturePath}
          title={skillRoute.title}
          widgetData={{}}
          compactChrome
          hostPiCwd={skillRouteHostPiCwd}
          libraryChangedFan={skillRouteLibraryFan ?? null}
          videogenLibraryChangedFan={skillRouteVideoLibraryFan ?? null}
          onSkillBridgeRpc={skillRouteBridge}
          onBridgeReject={() => {}}
          onError={() => {}}
          iframeClassName="min-h-0"
        />
      </div>
    )
  }

  if (!widget) {
    // Reachable only when a widget tab exists without a payload (should not
    // happen — the payload is created with the tab) — mirror the old host's
    // invalid-payload fallback so the pane is never blank.
    return (
      <div className={cn('flex min-h-0 min-w-0 flex-1 items-start overflow-auto p-4', className)}>
        <p className={cn(mutedText, 'text-[0.8rem]')}>Invalid payload: missing html and path.</p>
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      {widget.html && widget.path ?
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <p className={cn(mutedText, 'text-[0.8rem]')}>Invalid payload: both html and path set.</p>
        </div>
      : !widget.html && !widget.path ?
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <p className={cn(mutedText, 'text-[0.8rem]')}>Invalid payload: missing html and path.</p>
        </div>
      : (
        <SkillSurfaceSandbox
          key={widget.toolCallId}
          {...(widget.html ? { inlineHtmlFragment: widget.html } : { fixturePath: widget.path! })}
          widgetData={widget.data}
          title="Agent-driven widget"
          onBridge={(m: WidgetBridgeMessageFromChild) => {
            setLog((prev) => {
              const line = `[${m.op}] ${JSON.stringify(m.payload)}`
              const next = [...prev, line]
              return next.length > 20 ? next.slice(-20) : next
            })
            if (m.op === 'sendToAgent') {
              void window.sylo.skillSurface
                .injectFollowUp(
                  `[Sylo widget sendToAgent] toolCallId=${widget.toolCallId} payload=${JSON.stringify(m.payload)}`,
                )
                .then((inj) => {
                  if (!inj.ok) {
                    setLog((prev) => [...prev, `[inject] ${inj.error}`])
                  }
                })
            }
          }}
          onBridgeReject={() => setLog((prev) => [...prev, '[rejected: nonce_mismatch]'])}
          onError={(err) => setLog((prev) => [...prev, `[error] ${err}`])}
        />
      )}
      {log.length > 0 ?
        <pre className={cn(toolLogPre, 'max-h-[100px] shrink-0 text-[0.78rem]')}>{log.join('\n')}</pre>
      : null}
    </div>
  )
}