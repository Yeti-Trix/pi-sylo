import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { btnGhostSm, mutedText } from '../../panels/ui-classes'

/**
 * Phase 5 — freehand draw mode for the Canvas. Operator clicks "Draw" on the
 * canvas bottom control bar and the panel switches to this sketch surface. Mouse
 * (or pen/touch via Pointer Events) draws freehand strokes. Controls (below the
 * sketch): clear, undo, pen color, stroke width, and a dark/light background
 * toggle. The sketch is pull-based: every change is mirrored (debounced) to the
 * host via `window.sylo.canvas.setSketchImage`, and the broker's `canvas_sketch`
 * tool reads it back as an image from normal chat ("look at my sketch"). The
 * removed draw-panel send box was replaced by that tool.
 *
 * Stroke layer: drawing is kept on a transparent offscreen canvas
 * (`strokeRef`); the visible canvas is a composite of the current background
 * fill + the stroke layer. This lets the operator swap the background (dark ↔
 * light) without erasing or double-painting the strokes — toggling bg just
 * recomposites. The mirrored PNG is the composited visible canvas, so it
 * always carries an opaque background (better for the model's vision).
 *
 * Persistence: the stroke layer (strokes only, transparent) is stashed as a
 * PNG data URL into `backupRef` (held by the parent, lifted to App so it
 * survives CanvasPanel unmount on tab switches). On remount the strokes are
 * restored and composited onto the current bg. In-memory only — the sketch does
 * not survive a Sylo restart (the host drops the mirrored PNG at startup).
 *
 * Docked-only for v1. Drawing on a popped-out canvas is a future enhancement
 * (the popout is bound to a live `liveId`; draw mode is a separate, local
 * renderer mode).
 */

type Props = {
  /** Parent-held backup of the last stroke layer (PNG data URL, transparent).
   *  Lifted to App so the sketch survives CanvasPanel unmount (tab switches). */
  backupRef: React.MutableRefObject<string | null>
}

const BG_DARK = '#0f1115'
const BG_LIGHT = '#ffffff'
const COLORS = ['#e6e9ef', '#1a1d23', '#6b9fff', '#ff6b6b', '#69db7c', '#f5c518', '#c08bff']
const WIDTHS = [2, 4, 7]

export function CanvasDraw({ backupRef }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  /** Transparent stroke layer (offscreen). Source of truth for the drawing. */
  const strokeRef = useRef<HTMLCanvasElement | null>(null)
  /** Throwaway offscreen canvas used to preserve strokes across a resize. */
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)
  const undoStackRef = useRef<string[]>([])
  const colorRef = useRef<string>(COLORS[0])
  const widthRef = useRef<number>(WIDTHS[1])
  const bgRef = useRef<string>(BG_DARK)

  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  const [bgLight, setBgLight] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  /** Debounce timer for the host sketch mirror (canvas:set-sketch-image). */
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    colorRef.current = color
  }, [color])
  useEffect(() => {
    widthRef.current = width
  }, [width])
  useEffect(() => {
    bgRef.current = bgLight ? BG_LIGHT : BG_DARK
  }, [bgLight])

  function ensureStroke(): HTMLCanvasElement {
    if (!strokeRef.current) strokeRef.current = document.createElement('canvas')
    return strokeRef.current
  }
  function getOffscreen(): HTMLCanvasElement {
    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas')
    return offscreenRef.current
  }

  /** Paint the visible canvas = background fill + stroke layer. Used on mount,
   *  resize, bg toggle, clear, and undo. */
  const composite = useCallback(() => {
    const canvas = canvasRef.current
    const stroke = strokeRef.current
    const wrap = wrapRef.current
    if (!canvas || !stroke || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = bgRef.current
    ctx.fillRect(0, 0, wrap.clientWidth, wrap.clientHeight)
    ctx.drawImage(stroke, 0, 0, wrap.clientWidth, wrap.clientHeight)
  }, [])

  /** (Re)size both canvases to the wrapper's CSS size (× DPR). If
   *  `restoreSrc` is given it is drawn into the stroke layer (scaled); otherwise
   *  the current strokes are captured first so resizes don't wipe them. Then
   *  recomposites the visible canvas. */
  const sizeCanvas = useCallback(
    (restoreSrc: CanvasImageSource | null) => {
      const canvas = canvasRef.current
      const wrap = wrapRef.current
      const stroke = ensureStroke()
      if (!canvas || !wrap) return
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.floor(wrap.clientWidth))
      const h = Math.max(1, Math.floor(wrap.clientHeight))
      // Capture current strokes before resizing (unless an explicit restore
      // source was given).
      let src: CanvasImageSource | null = restoreSrc
      if (!src && stroke.width > 0 && stroke.height > 0) {
        const off = getOffscreen()
        off.width = stroke.width
        off.height = stroke.height
        off.getContext('2d')!.drawImage(stroke, 0, 0)
        src = off
      }
      // Stroke layer.
      stroke.width = Math.floor(w * dpr)
      stroke.height = Math.floor(h * dpr)
      const sctx = stroke.getContext('2d')
      if (sctx) {
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        sctx.clearRect(0, 0, w, h)
        if (src) sctx.drawImage(src, 0, 0, w, h)
      }
            // Visible layer.
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      composite()
    },
    [composite],
  )

  /** True if the stroke layer has any visible pixels (alpha > 0). Probed on a
   *  downscaled copy — exact enough to distinguish "nothing drawn" from any
   *  stroke, and cheap even at full DPR size. */
  function strokesExist(): boolean {
    const stroke = strokeRef.current
    if (!stroke || stroke.width === 0 || stroke.height === 0) return false
    const probe = getOffscreen()
    probe.width = 48
    probe.height = 48
    const pctx = probe.getContext('2d')
    if (!pctx) return false
    pctx.clearRect(0, 0, 48, 48)
    pctx.drawImage(stroke, 0, 0, 48, 48)
    const data = pctx.getImageData(0, 0, 48, 48).data
    for (let i = 3; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 0) return true
    }
    return false
  }

  /** Mirror the current sketch into the host (debounced) so the broker's
   *  `canvas_sketch` tool can pull it from normal chat. Clears the mirror when
   *  the drawing area is empty. */
  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      const canvas = canvasRef.current
      if (!canvas || canvas.width === 0 || !strokesExist()) {
        void window.sylo.canvas.setSketchImage(null)
        return
      }
      // The composited bitmap carries the opaque background — better for vision.
      void window.sylo.canvas.setSketchImage(canvas.toDataURL('image/png'))
    }, 300)
  }, [])

  // Recomposite (and re-mirror) when the background flips — strokes are preserved.
  useEffect(() => {
    composite()
    scheduleSync()
  }, [bgLight, composite, scheduleSync])

  // Mount: restore the backup strokes (if any) and observe resizes. Unmount:
  // stash the stroke layer so a remount (toggle off→on or tab switch) restores
  // it, composited onto whatever bg is current.
  useEffect(() => {
    const backup = backupRef.current
    const doMount = () => {
      if (backup) {
        const img = new Image()
        img.onload = () => {
          sizeCanvas(img)
          scheduleSync()
        }
        img.onerror = () => sizeCanvas(null)
        img.src = backup
      } else {
        sizeCanvas(null)
      }
    }
    doMount()
    const ro = new ResizeObserver(() => sizeCanvas(null))
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => {
      ro.disconnect()
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      const s = strokeRef.current
      if (s && s.width > 0 && s.height > 0) backupRef.current = s.toDataURL('image/png')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pushUndo(): void {
    const s = strokeRef.current
    if (!s || s.width === 0) return
    const stack = undoStackRef.current
    stack.push(s.toDataURL('image/png'))
    if (stack.length > 30) stack.shift()
    setCanUndo(true)
  }

  function undo(): void {
    const stack = undoStackRef.current
    if (stack.length === 0) return
    const prev = stack.pop()!
    setCanUndo(stack.length > 0)
    const img = new Image()
    img.onload = () => {
      const stroke = strokeRef.current
      const wrap = wrapRef.current
      if (!stroke || !wrap) return
      const sctx = stroke.getContext('2d')
      if (!sctx) return
      const dpr = window.devicePixelRatio || 1
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      sctx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight)
      sctx.drawImage(img, 0, 0, wrap.clientWidth, wrap.clientHeight)
      composite()
      scheduleSync()
    }
    img.src = prev
  }

    function clearCanvas(): void {
    pushUndo()
    const stroke = strokeRef.current
    const wrap = wrapRef.current
    if (!stroke || !wrap) return
    const sctx = stroke.getContext('2d')
    if (!sctx) return
    const dpr = window.devicePixelRatio || 1
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    sctx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight)
    composite()
    scheduleSync()
  }

  /** Toggle bg dark ↔ light. Auto-switch the pen to a visible color if the
   *  current one would disappear on the new background. */
  function toggleBg(): void {
    setBgLight((light) => {
      const nextLight = !light
      const invisibleOnLight = colorRef.current === '#e6e9ef'
      const invisibleOnDark = colorRef.current === '#1a1d23'
      if (nextLight && invisibleOnLight) setColor('#1a1d23')
      else if (!nextLight && invisibleOnDark) setColor('#e6e9ef')
      return nextLight
    })
  }

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** Draw a dot onto a single context. */
  function dot(ctx: CanvasRenderingContext2D, p: { x: number; y: number }): void {
    ctx.fillStyle = colorRef.current
    ctx.beginPath()
    ctx.arc(p.x, p.y, widthRef.current / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  /** Draw a segment onto a single context. */
  function segment(
    ctx: CanvasRenderingContext2D,
    last: { x: number; y: number },
    p: { x: number; y: number },
  ): void {
    ctx.strokeStyle = colorRef.current
    ctx.lineWidth = widthRef.current
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    const canvas = canvasRef.current
    const stroke = strokeRef.current
    if (!canvas || !stroke) return
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    pushUndo()
    drawingRef.current = true
    const p = pointerPos(e)
    lastPtRef.current = p
    // Draw on both the stroke layer (source of truth) and the visible canvas
    // (immediate feedback — avoids a full composite per pointermove).
    const vctx = canvas.getContext('2d')
    const sctx = stroke.getContext('2d')
    if (vctx) dot(vctx, p)
    if (sctx) dot(sctx, p)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const stroke = strokeRef.current
    if (!canvas || !stroke) return
    const vctx = canvas.getContext('2d')
    const sctx = stroke.getContext('2d')
    if (!vctx || !sctx) return
    const p = pointerPos(e)
    const last = lastPtRef.current
    if (last) {
      segment(vctx, last, p)
      segment(sctx, last, p)
    }
    lastPtRef.current = p
  }

    function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPtRef.current = null
    scheduleSync()
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Drawing surface (top) */}
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border"
        style={{ backgroundColor: bgLight ? BG_LIGHT : BG_DARK }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {/* Controls (bottom, under the sketch) */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-bg-secondary px-2 py-1.5">
        <div className="flex items-center gap-1">
          <span className={cn(mutedText, 'text-[0.72rem]')}>Color</span>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Pen color ${c}`}
              title={c}
              onClick={() => setColor(c)}
              className={cn(
                'size-4 shrink-0 cursor-pointer rounded-full border transition-transform hover:scale-110',
                color === c ? 'border-accent ring-1 ring-accent' : 'border-border',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className={cn(mutedText, 'text-[0.72rem]')}>Size</span>
          {WIDTHS.map((wd) => (
            <button
              key={wd}
              type="button"
              title={`Stroke width ${wd}px`}
              onClick={() => setWidth(wd)}
              className={cn(
                'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border',
                width === wd ? 'border-accent bg-accent/15' : 'border-border hover:bg-bg-tertiary',
              )}
            >
              <span
                className="block rounded-full bg-text-primary"
                style={{ width: `${wd}px`, height: `${wd}px` }}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          className={cn(btnGhostSm, 'ml-1')}
          title="Toggle the sketch background between dark and light (strokes are preserved)"
          onClick={toggleBg}
        >
          {bgLight ? 'Light bg' : 'Dark bg'}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className={btnGhostSm}
            disabled={!canUndo}
            onClick={undo}
            title="Undo the last stroke"
          >
            Undo
          </button>
          <button type="button" className={btnGhostSm} onClick={clearCanvas} title="Clear the sketch">
            Clear
          </button>
        </div>
      </div>

    </div>
  )
}