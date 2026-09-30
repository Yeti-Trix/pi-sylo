import React, { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { chatSegmentPulse } from '../panels/ui-classes'
import { formatDurationMs } from '../workflowTimeline'
import type { ConversationPauseSnapshot } from './askQuestionClient'

/**
 * Live elapsed label. `pause` freezes the count while the turn is parked on an
 * unanswered ask-question: pause semantics — the display holds at the frozen
 * value, and when the answer lands the timer resumes FROM that value, because
 * every paused interval is subtracted from the wall clock:
 *
 *   paused   -> pausedSinceTs - startTs - pausedTotalMs   (constant)
 *   running  -> now - startTs - pausedTotalMs
 *
 * (pausedTotalMs grows by each closed pause, so the resume lands exactly on the
 * frozen number instead of jumping to include the wait.)
 */
export function LiveElapsedLabel({
  startTs,
  className,
  prefix = '',
  title = 'Elapsed time',
  pause,
}: {
  startTs: number
  className?: string
  prefix?: string
  title?: string
  pause?: ConversationPauseSnapshot
}): React.ReactElement {
  const paused = pause?.paused === true && pause?.pausedSinceTs != null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // Frozen while paused — no ticking; resync `now` immediately on resume so the
    // first frame after the answer already sits on the resumed value.
    if (paused) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [paused])
  const anchorTs = paused ? pause!.pausedSinceTs! : now
  const ms = Math.max(0, anchorTs - startTs - (pause?.pausedTotalMs ?? 0))
  return (
    <span
      className={cn('shrink-0 tabular-nums', !paused && chatSegmentPulse, className)}
      title={paused ? `${title} (paused — waiting for your answer)` : title}
      aria-live="polite"
      role="status"
    >
      {prefix}
      {formatDurationMs(ms)}
    </span>
  )
}
