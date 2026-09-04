import React, { useState } from 'react'

import { cn } from '../../lib/cn'
import { btnDangerSm, btnGhostSm, mutedText } from '../../panels/ui-classes'

export function SubagentRunsStrip({
  runningCount,
  onScrollToRunning,
  onStopAll,
}: {
  runningCount: number
  onScrollToRunning: () => void
  onStopAll: () => Promise<void>
}): React.ReactElement | null {
  const [stopBusy, setStopBusy] = useState(false)

  if (runningCount <= 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent/8 px-2.5 py-1.5">
      <button
        type="button"
        className={cn(mutedText, 'm-0 border-0 bg-transparent p-0 text-[0.78rem] font-medium text-accent hover:underline')}
        onClick={onScrollToRunning}
      >
        {runningCount === 1 ? '1 subagent running' : `${runningCount} subagents running`}
      </button>
      <span className="text-[0.72rem] text-text-secondary">·</span>
      <button type="button" className={btnGhostSm} onClick={onScrollToRunning}>
        Show in chat
      </button>
      <button
        type="button"
        className={btnDangerSm}
        disabled={stopBusy}
        onClick={() => {
          setStopBusy(true)
          void onStopAll().finally(() => setStopBusy(false))
        }}
      >
        Stop all
      </button>
    </div>
  )
}
