import React, { useEffect, useState } from 'react'

import type { AgentTaskRow } from '../../panels/tasks/task-types'
import { formatDuration } from '../../panels/tasks/task-helpers'
import { cn } from '../../lib/cn'
import { btnDangerSm, btnGhostSm, mutedText } from '../../panels/ui-classes'

/**
 * Composer-tail strip (operator: "that pops up at the bottom … lets me know
 * some are running"). Clicking the label opens a small popover listing every
 * running run with a per-row "Go to" that scrolls the chat to that dispatch's
 * pill, opens it and flash-highlights it (see gotoSubagentBatch in App).
 */
export function SubagentRunsStrip({
  running,
  onGoTo,
  onStopAll,
}: {
  running: AgentTaskRow[]
  onGoTo: (batchKey: string) => void
  onStopAll: () => Promise<void>
}): React.ReactElement | null {
  const [stopBusy, setStopBusy] = useState(false)
  const [open, setOpen] = useState(false)
  // 1s tick so the per-row elapsed labels stay live while the strip exists.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  if (running.length <= 0) return null

  const batchKeyOf = (t: AgentTaskRow): string => t.group_run_id ?? t.id

  return (
    <div className="relative flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent/8 px-2.5 py-1.5">
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          mutedText,
          'm-0 border-0 bg-transparent p-0 text-[0.78rem] font-medium text-accent hover:underline',
        )}
        onClick={() => setOpen((prev) => !prev)}
        title="List the running subagents"
      >
        {running.length === 1 ? '1 subagent running' : `${running.length} subagents running`}
        <span className="ml-1 inline-block text-[0.65rem]" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      <span className="text-[0.72rem] text-text-secondary">·</span>
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
      {open ?
        <div className="absolute bottom-full left-0 z-20 mb-2 flex max-h-64 w-[min(24rem,90vw)] flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-bg-primary p-1.5 shadow-lg">
          {running.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-tertiary/70"
            >
              <span
                className="text-[0.72rem] text-accent"
                aria-hidden="true"
              >
                ◇
              </span>
              <span className="shrink-0 text-[0.76rem] font-medium text-text-primary">
                {t.agent_name}
              </span>
              <span
                className={cn(mutedText, 'min-w-0 flex-1 truncate text-[0.72rem]', 'font-mono')}
                title={t.title}
              >
                {t.title}
              </span>
              <span className="shrink-0 text-[0.7rem] tabular-nums text-text-secondary">
                {formatDuration(t.started_at, null, now)}
              </span>
              <button
                type="button"
                className={cn(btnGhostSm, 'shrink-0')}
                title="Scroll this chat to the dispatch pill and open it"
                onClick={() => {
                  setOpen(false)
                  onGoTo(batchKeyOf(t))
                }}
              >
                Go to
              </button>
            </div>
          ))}
        </div>
      : null}
    </div>
  )
}