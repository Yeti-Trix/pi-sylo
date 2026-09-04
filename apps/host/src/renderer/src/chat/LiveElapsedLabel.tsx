import React, { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { chatSegmentPulse } from '../panels/ui-classes'
import { formatDurationMs } from '../workflowTimeline'

export function LiveElapsedLabel({
  startTs,
  className,
  prefix = '',
  title = 'Elapsed time',
}: {
  startTs: number
  className?: string
  prefix?: string
  title?: string
}): React.ReactElement {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [startTs])
  const ms = Math.max(0, now - startTs)
  return (
    <span
      className={cn('shrink-0 tabular-nums', chatSegmentPulse, className)}
      title={title}
      aria-live="polite"
      role="status"
    >
      {prefix}
      {formatDurationMs(ms)}
    </span>
  )
}
