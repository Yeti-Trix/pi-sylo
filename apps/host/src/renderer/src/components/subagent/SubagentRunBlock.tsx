import React, { useEffect, useMemo, useState } from 'react'

import { cn } from '../../lib/cn'
import { detailsOpenFromToggleEvent } from '../../panels/capability/helpers'
import { ChainStepper } from '../../panels/tasks/ChainStepper'
import { TaskDetailDrawer } from '../../panels/tasks/TaskDetailDrawer'
import { TaskRow } from '../../panels/tasks/TaskRow'
import { batchProgress, statusLabel } from '../../panels/tasks/task-helpers'
import {
  chatMsgAssistant,
  chatMsgBubble,
  chatMsgHead,
  chatMsgRoleRow,
  chatSegmentChevron,
  chatSegmentPulse,
  chatSegmentRootClass,
  chatSegmentSummary,
  mutedText,
} from '../../panels/ui-classes'

import type { SubagentTaskBatch } from './matchSubagentBatches'

function batchTitle(batch: SubagentTaskBatch): string {
  if (batch.mode === 'single') {
    return batch.tasks[0]?.agent_name ?? 'subagent'
  }
  if (batch.mode === 'chain') {
    return `chain · ${batch.tasks.length} steps`
  }
  const { done, total, running } = batchProgress(batch.tasks)
  return `parallel · ${running > 0 ? `${running} live` : `${done}/${total} done`}`
}

function batchStatusLabel(batch: SubagentTaskBatch): string {
  if (batch.tasks.some((t) => t.status === 'running')) return 'running'
  if (batch.tasks.every((t) => t.status === 'succeeded')) return 'ok'
  if (batch.tasks.some((t) => t.status === 'failed')) return 'error'
  if (batch.tasks.some((t) => t.status === 'cancelled')) return 'cancelled'
  if (batch.tasks.some((t) => t.status === 'orphaned')) return 'orphaned'
  return 'done'
}

export function SubagentRunBlockPending({ segmentId }: { segmentId: string }): React.ReactElement {
  return (
    <div
      id={`subagent-run-pending-${segmentId}`}
      data-subagent-running="true"
      className={cn(chatMsgBubble, chatMsgAssistant, 'mx-0 mt-1.5 w-auto min-w-0 border-dashed border-accent/25')}
    >
      <div className={chatMsgHead}>
        <div className={cn(chatMsgRoleRow, chatSegmentPulse)}>Subagent · starting…</div>
      </div>
      <p className={cn(mutedText, 'm-0 px-1 pb-2 text-[0.82rem]')}>
        Child session is spinning up. Live output will appear here.
      </p>
    </div>
  )
}

export function SubagentRunBlock({
  batch,
  segmentId,
  onNotice,
}: {
  batch: SubagentTaskBatch
  segmentId: string
  onNotice?: (message: string) => void
}): React.ReactElement {
  const anyRunning = batch.tasks.some((t) => t.status === 'running')
  const [open, setOpen] = useState(anyRunning)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const live = batch.tasks.find((t) => t.status === 'running')
    return live?.id ?? batch.tasks[0]?.id ?? null
  })

  useEffect(() => {
    if (anyRunning) setOpen(true)
  }, [anyRunning])

  useEffect(() => {
    if (selectedId && batch.tasks.some((t) => t.id === selectedId)) return
    const live = batch.tasks.find((t) => t.status === 'running')
    setSelectedId(live?.id ?? batch.tasks[0]?.id ?? null)
  }, [batch.tasks, selectedId])

  const selectedTask = batch.tasks.find((t) => t.id === selectedId) ?? null
  const chainTasks = batch.mode === 'chain' && batch.tasks.length > 1 ? batch.tasks : null
  const status = batchStatusLabel(batch)
  const title = batchTitle(batch)

  const cls = useMemo(
    () =>
      chatSegmentRootClass('tool', {
        isError: status === 'error',
      }),
    [status],
  )

  return (
    <details
      id={`subagent-run-${batch.batchKey}`}
      data-subagent-running={anyRunning ? 'true' : 'false'}
      className={cn(cls, 'mx-0 mt-1.5')}
      open={open}
      onToggle={(e) => setOpen(detailsOpenFromToggleEvent(e))}
    >
      <summary className={chatSegmentSummary}>
        <span
          className={cn(
            'text-[0.72rem] text-text-secondary',
            anyRunning && chatSegmentPulse,
          )}
          aria-hidden="true"
        >
          ◇
        </span>
        <span className={chatMsgRoleRow}>
          Subagent · {title}
        </span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[0.68rem] font-medium uppercase tracking-[0.03em]',
            anyRunning ?
              'border-accent/40 bg-accent/10 text-accent'
            : status === 'error' ?
              'border-danger/40 bg-danger/10 text-danger'
            : 'border-border bg-bg-tertiary text-text-secondary',
          )}
        >
          {anyRunning ? 'running' : statusLabel(batch.tasks[0]!.status)}
        </span>
        <span className={chatSegmentChevron} aria-hidden="true" />
      </summary>
      <div
        className={cn(
          chatMsgBubble,
          chatMsgAssistant,
          'mt-1 w-auto min-w-0 border border-border/80 bg-bg-secondary/60',
        )}
      >
        {batch.mode === 'parallel' && batch.tasks.length > 1 ?
          <div className="mb-3 flex flex-col gap-1.5">
            {batch.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                compact
                onSelect={() => setSelectedId(task.id)}
              />
            ))}
          </div>
        : null}

        {chainTasks ?
          <div className="mb-3">
            <ChainStepper tasks={chainTasks} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        : null}

        <TaskDetailDrawer
          embedded
          task={selectedTask}
          chainTasks={chainTasks}
          onSelectTask={setSelectedId}
          onRetry={onNotice ?? (() => {})}
          onCancel={onNotice}
        />
      </div>
    </details>
  )
}
