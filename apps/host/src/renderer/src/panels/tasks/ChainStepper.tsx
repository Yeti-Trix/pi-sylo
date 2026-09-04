import React from 'react'

import { cn } from '../../lib/cn'
import { statusLabel, statusTone } from './task-helpers'
import type { AgentTaskRow } from './task-types'

export function ChainStepper({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: AgentTaskRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}): React.ReactElement {
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {tasks.map((task, index) => {
        const active = task.id === selectedId
        return (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onSelect(task.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-[border-color,background] duration-[120ms]',
                active ?
                  'border-accent/50 bg-accent/10'
                : 'border-border bg-bg-primary hover:border-accent/30 hover:bg-bg-secondary',
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg-tertiary text-[0.72rem] font-semibold text-text-secondary">
                {task.step_index ?? index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.82rem] text-text-primary">
                {task.agent_name}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium uppercase tracking-[0.03em]',
                  statusTone(task.status),
                )}
              >
                {statusLabel(task.status)}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
