import React, { useEffect, useId, useMemo, useState } from 'react'
import mermaid from 'mermaid'
import { cn } from '../../lib/cn'
import { mutedText } from '../../panels/ui-classes'
import { ChatMarkdown } from '../../ChatMarkdown'
import {
  looksLikeLocalImagePath,
  normalizeLocalImagePath,
  resolveRelativeImagePath,
} from '../../chatMarkdownImage'
import type { CanvasPayload } from './canvasTypes'
import { extractSvgMarkup } from './sanitizeSvg'

let mermaidReady = false

function ensureMermaid(): void {
  if (mermaidReady) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'strict',
    fontFamily: 'system-ui, Segoe UI, sans-serif',
  })
  mermaidReady = true
}

type Props = {
  payload: CanvasPayload | null
  interactive?: boolean
  onOpenPopout?: () => void
  /** Bumped by the canvas header's Refresh button. For file-backed SVGs it
   *  cache-busts the `sylo-file://` URL; for mermaid it forces a re-render
   *  (render id changes, so re-rendering can't collide with the old node). */
  reloadNonce?: number
}

export function CanvasContent({
  payload,
  interactive = false,
  onOpenPopout,
  reloadNonce = 0,
}: Props): React.ReactElement {
  const reactId = useId().replace(/:/g, '')
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(null)
  const [mermaidError, setMermaidError] = useState<string | null>(null)

  const inlineSvg = useMemo(() => {
    if (!payload || payload.kind !== 'svg' || payload.filePath) return null
    return extractSvgMarkup(payload.content ?? '')
  }, [payload])

  const fileUrl = useMemo(() => {
    if (!payload || payload.kind !== 'svg' || !payload.filePath?.trim()) return ''
    const base = window.sylo.files.localImageUrl(payload.filePath.trim())
    // Refresh: query-bust the protocol URL so Electron re-reads the file
    // instead of serving the cached preview.
    return reloadNonce > 0 ? `${base}&v=${reloadNonce}` : base
  }, [payload, reloadNonce])

  // Directory the markdown content was loaded from, so relative image refs
  // (e.g. `![](images/pic.png)`) resolve against the .md file's location.
  const markdownBaseDir = useMemo(() => {
    const sp = payload?.kind === 'markdown' ? payload.sourcePath?.trim() : ''
    if (!sp) return ''
    const dir = sp.replace(/[\\/][^\\/]*$/, '')
    return dir || sp
  }, [payload?.kind, payload?.sourcePath])

  // Markdown images: absolute local paths go through the sylo-file:// preview
  // URL; relative refs resolve against `markdownBaseDir`. Remote URLs are
  // handled upstream in `resolveChatMarkdownImageSrc` (returns them as-is).
  const markdownResolveImageUrl = useMemo(
    () => (src: string): string | null => {
      if (!src?.trim()) return null
      const s = src.trim()
      if (looksLikeLocalImagePath(s)) {
        return window.sylo.files.localImageUrl(normalizeLocalImagePath(s))
      }
      if (markdownBaseDir) {
        const abs = resolveRelativeImagePath(markdownBaseDir, s)
        if (abs) return window.sylo.files.localImageUrl(abs)
      }
      return null
    },
    [markdownBaseDir],
  )

  const toolCallId = payload?.toolCallId ?? 'popout'

  useEffect(() => {
    if (!payload || payload.kind !== 'mermaid') {
      setMermaidSvg(null)
      setMermaidError(null)
      return
    }
    const source = (payload.content ?? '').trim()
    if (!source) {
      setMermaidSvg(null)
      setMermaidError('Mermaid source is empty.')
      return
    }
    let cancelled = false
    ensureMermaid()
    const renderId = `sylo-mermaid-${reactId}-${toolCallId.slice(0, 8)}${reloadNonce > 0 ? `-r${reloadNonce}` : ''}`
    void mermaid
      .render(renderId, source)
      .then((result) => {
        if (!cancelled) {
          setMermaidSvg(result.svg)
          setMermaidError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMermaidSvg(null)
          setMermaidError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [payload, reactId, toolCallId, reloadNonce])

  if (!payload) {
    return (
      <p className={cn(mutedText, 'm-0 text-[0.85rem] leading-[1.45]')}>
        Nothing on the canvas yet. Ask the agent to render SVG or Mermaid with{' '}
        <code>show_canvas</code>, drop a local <code>.md</code> or <code>.svg</code> file
        here, or click content here after it appears.
      </p>
    )
  }

  const canPopout =
    interactive &&
    !!onOpenPopout &&
    (payload.kind === 'mermaid'
      ? !!(payload.content ?? '').trim()
      : payload.kind === 'markdown'
        ? !!(payload.content ?? '').trim()
        : !!(inlineSvg || (payload.filePath && fileUrl)))

  // Markdown is a scrollable text document — don't make the whole body a
  // click-to-popout target (selecting/clicking text would fire popout). The
  // header "Pop out" button still works because `canPopout` is true.
  const popoutClickable = canPopout && payload.kind !== 'markdown'

  const popoutProps =
    popoutClickable
      ? {
          role: 'button' as const,
          tabIndex: 0,
          title: 'Open in a new window (move to another monitor)',
          className: cn(
            'min-h-[120px] cursor-pointer rounded-md outline-none transition-colors hover:bg-bg-tertiary/40 focus-visible:ring-2 focus-visible:ring-accent/50',
          ),
          onClick: onOpenPopout,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpenPopout()
            }
          },
        }
      : { className: 'min-h-[120px]' }

  return (
    <div {...popoutProps}>
      {payload.kind === 'svg' && payload.filePath && fileUrl ?
        <div className="flex h-full min-h-[inherit] items-center justify-center p-2">
          <img
            src={fileUrl}
            alt={payload.title ?? 'SVG'}
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        </div>
      : payload.kind === 'svg' && inlineSvg ?
        <div
          className="mx-auto flex max-w-full items-center justify-center p-2 [&_svg]:max-h-full [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: inlineSvg }}
        />
      : payload.kind === 'svg' ?
        <p className={cn(mutedText, 'p-2 text-[0.85rem]')}>
          No valid SVG content. Pass inline <code>&lt;svg&gt;…</code> markup or an absolute{' '}
          <code>filePath</code>.
        </p>
      : payload.kind === 'mermaid' && mermaidSvg ?
        <div
          className="mx-auto flex max-w-full justify-center p-2 [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: mermaidSvg }}
        />
      : payload.kind === 'mermaid' && mermaidError ?
        <p className={cn(mutedText, 'p-2 text-[0.85rem]')}>Mermaid error: {mermaidError}</p>
      : payload.kind === 'mermaid' ?
        <p className={cn(mutedText, 'p-2 text-[0.85rem]')}>Rendering diagram…</p>
      : payload.kind === 'markdown' && (payload.content ?? '').trim() ?
        <div className="mx-auto max-w-3xl p-2">
          <div className="chat-md max-w-none text-[0.9rem] leading-[1.55] text-text-primary">
            <ChatMarkdown text={payload.content ?? ''} resolveImageUrl={markdownResolveImageUrl} />
          </div>
        </div>
      : payload.kind === 'markdown' ?
        <p className={cn(mutedText, 'p-2 text-[0.85rem]')}>
          No markdown content. Pass inline <code>content</code> or an absolute <code>filePath</code> to a <code>.md</code> file.
        </p>
      : null}
      {popoutClickable ?
        <p className={cn(mutedText, 'px-2 pb-2 text-center text-[0.72rem]')}>
          Click to open in a new window
        </p>
      : null}
    </div>
  )
}
