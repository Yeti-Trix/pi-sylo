import React from 'react'
import { canvasResizeHandleCol } from '../../panels/ui-classes'

type Props = {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
}

export function CanvasResizeHandle({
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: Props): React.ReactElement {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize canvas"
      title="Drag to resize canvas"
      className={canvasResizeHandleCol}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
