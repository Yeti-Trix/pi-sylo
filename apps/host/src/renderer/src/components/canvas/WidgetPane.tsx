import React, { useEffect, useState } from 'react'
import { mutedText, toolLogPre } from '../../panels/ui-classes'
import { cn } from '../../lib/cn'
import { SkillSurfaceSandbox } from '../../skill-surface/iframe-host'
import type { WidgetBridgeMessageFromChild } from '../../skill-surface/bridge'
import type { WidgetTabPayload } from './canvasTypes'

/**
 * Body of a canvas 'widget' app-pane tab: renders one agent `show_widget`
 * payload in the sandboxed skill-surface iframe (same machinery dashboards
 * use) with a small view-only bridge log strip. Replaces the old chat-column
 * widget host — agent-driven rich UI belongs on the canvas, not in chat.
 *
 * Mount model: like browser panes, widget panes stay mounted (hidden) across
 * tab switches so iframe state (e.g. typed form data) survives; the element
 * dies when the tab is closed.
 */

type Props = {
  widget?: WidgetTabPayload
  className?: string
}

export function WidgetPane({ widget, className }: Props): React.ReactElement {
  const [log, setLog] = useState<string[]>([])
  // Reset the log when the tab gains a different payload (same-call re-show
  // keeps the tab id but fresh data → fresh log).
  const toolCallId = widget?.toolCallId ?? ''
  useEffect(() => {
    setLog([])
  }, [toolCallId])

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