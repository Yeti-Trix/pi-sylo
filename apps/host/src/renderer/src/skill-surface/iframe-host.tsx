import React, { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import {
  newBridgeNonce,
  parseSkillBridgeMessage,
  parseWidgetBridgeMessage,
  skillBridgeEvent,
  skillBridgeReply,
  type SkillRouteBridgeOp,
  type WidgetBridgeMessageFromChild,
} from './bridge'
import { SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR } from './hostCapabilityDescriptor'
import { inlineRouteFixtureAssets } from './route-fixture'
import {
  assertWidgetMarkupPassesPolicy,
  SkillSurfacePolicyError,
  skillSurfaceInjectedStyles,
} from './sandbox-policy'

function resolveWidgetFetchUrl(path: string): string {
  const t = path.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  const withSlash = t.startsWith('/') ? t : `/${t}`
  return new URL(withSlash, window.location.href).href
}

export type SkillSurfaceSandboxProps = {
  /** Path served from the renderer host (e.g. /skill-surface/smoke.html) or absolute http(s) URL. */
  fixturePath?: string
  /** HTML fragment injected as body (after policy scan). Exactly one of fixturePath or inlineHtmlFragment required. */
  inlineHtmlFragment?: string
  widgetData?: unknown
  /** Widget bridge (#317) vs persistent route bridge (ADR-32). */
  variant?: 'widget' | 'route'
  /** Route-only: async RPC from iframe (read/write skill data, queue agent follow-up, etc.). */
  onSkillBridgeRpc?: (op: SkillRouteBridgeOp, payload: unknown) => Promise<unknown>
  /** Called for accepted bridge messages after source + nonce checks */
  onBridge?: (msg: WidgetBridgeMessageFromChild) => void
  /** Delivered when the child used a nonce that does not match this iframe session */
  onBridgeReject?: (reason: 'nonce_mismatch') => void
  /** Policy or network failure */
  onError?: (message: string) => void
  title?: string
  /** When true, hide the sandbox status caption (domain routes). */
  compactChrome?: boolean
  iframeClassName?: string
  /** Route-only: push workspace changes into the iframe (LogicForge, etc.). */
  hostPiCwd?: string
}

/**
 * Sandbox iframe: allow-scripts only (no allow-same-origin). Content loaded via srcdoc after fetch + policy scan.
 */
export function SkillSurfaceSandbox({
  fixturePath,
  inlineHtmlFragment,
  widgetData = {},
  variant = 'widget',
  onSkillBridgeRpc,
  onBridge,
  onBridgeReject,
  onError,
  title = 'Skill surface',
  compactChrome = false,
  iframeClassName,
  hostPiCwd = '',
}: SkillSurfaceSandboxProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const nonceRef = useRef<string>(newBridgeNonce())
  const widgetDataKey = JSON.stringify(widgetData ?? {})
  const hasPath = typeof fixturePath === 'string' && fixturePath.trim().length > 0
  const hasInline =
    typeof inlineHtmlFragment === 'string' && inlineHtmlFragment.trim().length > 0
  const sourceKey = hasInline ? `inline:${inlineHtmlFragment!.length}` : `path:${fixturePath ?? ''}`
  const labelId = useId()
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detail, setDetail] = useState<string>('')

  // ── Widget resize state (widget variant only) ──
  const [widgetHeight, setWidgetHeight] = useState(420)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const onResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { startY: e.clientY, startH: widgetHeight }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }, [widgetHeight])

  useEffect(() => {
    if (variant !== 'widget') return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = e.clientY - dragRef.current.startY
      setWidgetHeight(Math.max(140, Math.min(2000, dragRef.current.startH + delta)))
    }
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [variant])

  const onErrorRef = useRef(onError)
  const onBridgeRef = useRef(onBridge)
  const onBridgeRejectRef = useRef(onBridgeReject)
  const onSkillBridgeRpcRef = useRef(onSkillBridgeRpc)
  onErrorRef.current = onError
  onBridgeRef.current = onBridge
  onBridgeRejectRef.current = onBridgeReject
  onSkillBridgeRpcRef.current = onSkillBridgeRpc

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const parentErrorsNotified = new Set<string>()

    if (hasPath === hasInline) {
      const msg = 'Provide exactly one of fixturePath or inlineHtmlFragment'
      setStatus('error')
      setDetail(msg)
      if (!parentErrorsNotified.has(msg)) {
        parentErrorsNotified.add(msg)
        onErrorRef.current?.(msg)
      }
      return
    }

    const nonce = nonceRef.current
    const ctrl = new AbortController()
    let cancelled = false

    void (async () => {
      setStatus('loading')
      setDetail('')
      try {
        let fragment: string
        let routeHeadHtml = ''
        if (hasPath) {
          const url = resolveWidgetFetchUrl(fixturePath!)
          const res = await fetch(url, { signal: ctrl.signal })
          if (!res.ok) {
            const msg = `Fetch ${fixturePath}: ${res.status}`
            if (cancelled) return
            setStatus('error')
            setDetail(msg)
            if (!parentErrorsNotified.has(msg)) {
              parentErrorsNotified.add(msg)
              onErrorRef.current?.(msg)
            }
            return
          }
          const raw = await res.text()
          if (variant === 'route') {
            const inlined = await inlineRouteFixtureAssets(raw, url, ctrl.signal)
            routeHeadHtml = inlined.headHtml
            fragment = inlined.bodyHtml
            const maxRoute = SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR.max_route_bytes
            if (inlined.byteLength > maxRoute) {
              const msg = `Route markup exceeds max_route_bytes (${maxRoute})`
              if (cancelled) return
              setStatus('error')
              setDetail(msg)
              if (!parentErrorsNotified.has(msg)) {
                parentErrorsNotified.add(msg)
                onErrorRef.current?.(msg)
              }
              return
            }
          } else {
            fragment = raw
          }
        } else {
          fragment = inlineHtmlFragment!
        }

        const maxB =
          variant === 'route' ?
            SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR.max_route_bytes
          : SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR.max_widget_bytes
        if (variant !== 'route' && fragment.length > maxB) {
          const msg = `Widget markup exceeds max_widget_bytes (${maxB})`
          if (cancelled) return
          setStatus('error')
          setDetail(msg)
          if (!parentErrorsNotified.has(msg)) {
            parentErrorsNotified.add(msg)
            onErrorRef.current?.(msg)
          }
          return
        }

        const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`
        const doc = new DOMParser().parseFromString(wrapped, 'text/html')
        try {
          assertWidgetMarkupPassesPolicy(doc)
        } catch (e) {
          if (e instanceof SkillSurfacePolicyError) {
            const msg = `${e.code}: ${e.message}`
            if (cancelled) return
            setStatus('error')
            setDetail(msg)
            if (!parentErrorsNotified.has(msg)) {
              parentErrorsNotified.add(msg)
              onErrorRef.current?.(msg)
            }
            return
          }
          throw e
        }
        const theme = skillSurfaceInjectedStyles()
        const dataJson = JSON.stringify(widgetData ?? {})
        const nonceJson = JSON.stringify(nonce)
        const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>${theme}</style>
<script>
window.__SYLO_NONCE__ = ${nonceJson};
window.__WIDGET_DATA__ = ${dataJson};
</script>
${routeHeadHtml}
</head>
<body>
${fragment}
</body>
</html>`
        if (cancelled) return
        iframe.setAttribute('srcdoc', srcdoc)
        setStatus('ready')
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        const msg = e instanceof Error ? e.message : String(e)
        if (cancelled) return
        setStatus('error')
        setDetail(msg)
        if (!parentErrorsNotified.has(msg)) {
          parentErrorsNotified.add(msg)
          onErrorRef.current?.(msg)
        }
      }
    })()

    return () => {
      cancelled = true
      ctrl.abort()
    }
    // Callbacks via refs so parent re-renders do not re-fetch fixtures.
  }, [fixturePath, hasInline, hasPath, inlineHtmlFragment, sourceKey, variant, widgetDataKey])

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      void (async () => {
        const iframeWin = iframeRef.current?.contentWindow
        if (!iframeWin || ev.source !== iframeWin) return
        if (variant === 'route') {
          const sm = parseSkillBridgeMessage(ev.data)
          if (!sm) return
          if (sm.nonce !== nonceRef.current) {
            iframeWin.postMessage(skillBridgeReply(sm.reqId, false, undefined, 'nonce_mismatch'), '*')
            onBridgeRejectRef.current?.('nonce_mismatch')
            return
          }
          try {
            const fn = onSkillBridgeRpcRef.current
            if (!fn) {
              iframeWin.postMessage(skillBridgeReply(sm.reqId, false, undefined, 'no_route_handler'), '*')
              return
            }
            const result = await fn(sm.op, sm.payload)
            iframeWin.postMessage(skillBridgeReply(sm.reqId, true, result), '*')
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e)
            iframeWin.postMessage(skillBridgeReply(sm.reqId, false, undefined, err), '*')
          }
          return
        }
        const msg = parseWidgetBridgeMessage(ev.data)
        if (!msg) return
        if (msg.nonce !== nonceRef.current) {
          onBridgeRejectRef.current?.('nonce_mismatch')
          return
        }
        onBridgeRef.current?.(msg)
      })()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [variant])

  useEffect(() => {
    if (variant !== 'route' || status !== 'ready') return
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage(
      skillBridgeEvent(nonceRef.current, 'workspaceChanged', {
        piCwd: typeof hostPiCwd === 'string' ? hostPiCwd : '',
      }),
      '*',
    )
  }, [hostPiCwd, status, variant])

  return (
    <div className={cn(variant === 'route' && 'flex min-h-0 flex-1 flex-col')}>
      {compactChrome ?
        status === 'error' && detail ?
          <div id={labelId} className="mb-1.5 text-[0.82rem] text-danger">
            {detail}
          </div>
        : null
      : <div id={labelId} className="mb-1.5 text-[0.82rem] text-text-secondary">
          {title} · sandbox=allow-scripts · nonce session · {status}
          {detail ? ` — ${detail}` : ''}
        </div>}
      <iframe
        ref={iframeRef}
        title={title}
        sandbox="allow-scripts"
        aria-labelledby={labelId}
        style={variant === 'widget' ? { height: widgetHeight } : undefined}
        className={cn(
          'w-full rounded-md border border-border bg-bg-primary',
          variant === 'route' ?
            'min-h-[calc(100dvh-10.5rem)] flex-1'
          : 'min-h-[140px] resize-y overflow-hidden',
          iframeClassName,
        )}
      />
      {variant === 'widget' && (
        <div
          onMouseDown={onResizeStart}
          className="mt-0 flex h-2.5 cursor-ns-resize items-center justify-center rounded-b-md border border-t-0 border-border bg-bg-secondary hover:bg-bg-tertiary transition-colors"
          title="Drag to resize"
        >
          <div className="h-1 w-8 rounded-full bg-border" />
        </div>
      )}
    </div>
  )
}
