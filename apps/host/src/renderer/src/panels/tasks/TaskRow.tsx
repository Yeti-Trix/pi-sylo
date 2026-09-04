import React from 'react'

import { cn } from '../../lib/cn'
import { formatDuration, formatWhen, livePreviewText, statusLabel, statusTone } from './task-helpers'
import type { AgentTaskRow } from './task-types'

export function TaskRow({
  task,
  selected,
  compact,
  onSelect,
}: {
  task: AgentTaskRow
  selected: boolean
  compact?: boolean
  onSelect: () => void
}): React.ReactElement {
  const preview = livePreviewText(task)
  const duration = formatDuration(task.started_at, task.ended_at)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition-[border-color,background] duration-[120ms]',
        selected ?
          'border-accent/50 bg-accent/10'
        : 'border-border bg-bg-primary hover:border-accent/30 hover:bg-bg-secondary',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.88rem] font-semibold text-text-primary">{task.agent_name}</span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[0.68rem] font-medium uppercase tracking-[0.03em]',
            statusTone(task.status),
          )}
        >
          {statusLabel(task.status)}
        </span>
        <span className="ml-auto shrink-0 text-[0.72rem] text-text-secondary">{duration}</span>
      </div>
      {!compact ?
        <>
          <p className="mb-0 mt-1.5 line-clamp-2 text-[0.82rem] leading-[1.4] text-text-primary">
            {task.title}
          </p>
          {preview ?
            <p className="mb-0 mt-1 line-clamp-2 text-[0.78rem] leading-[1.35] text-text-secondary">
              {preview}
            </p>
          : null}
          <p className="mb-0 mt-1.5 text-[0.72rem] text-text-secondary">
            {task.mode} · started {formatWhen(task.started_at)}
          </p>
        </>
      : null}
    </button>
  )
}
