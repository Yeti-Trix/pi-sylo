import React, { useState } from 'react'
import { isImageAttachmentPath } from './chatUserAttachments'
import { cn } from './lib/cn'

const THUMB_BASE =
  'shrink-0 object-cover rounded-md border border-border bg-bg-tertiary'

const FALLBACK_BASE = 'shrink-0 text-accent/75 text-[0.85rem] leading-[1.4]'

type Props = {
  path: string
  name: string
  className?: string
  fallbackClassName?: string
  /** When set, used instead of `window.sylo.files.localImageUrl` (companion web UI). */
  resolveImageUrl?: (path: string) => string | null
}

/** Small preview for local image attachments (composer chips + sent user bubbles). */
export function AttachmentImageThumb({
  path,
  name,
  className,
  fallbackClassName,
  resolveImageUrl,
}: Props): React.ReactElement {
  const [failed, setFailed] = useState(false)

  if (failed || !isImageAttachmentPath(name, path)) {
    return (
      <span className={cn(FALLBACK_BASE, fallbackClassName)} aria-hidden="true">
        ◇
      </span>
    )
  }

  const src =
    resolveImageUrl?.(path) ??
    (typeof window !== 'undefined' ? window.sylo?.files?.localImageUrl(path) : null)
  if (!src) {
    return (
      <span className={cn(FALLBACK_BASE, fallbackClassName)} aria-hidden="true">
        ◇
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={cn(THUMB_BASE, className)}
      loading="lazy"
      draggable={false}
      title={name}
      onError={() => setFailed(true)}
    />
  )
}
