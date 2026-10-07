import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../../lib/cn'
import { detailsOpenFromToggleEvent } from '../../panels/capability/helpers'
import { ChainStepper } from '../../panels/tasks/ChainStepper'
import { TaskDetailDrawer } from '../../panels/tasks/TaskDetailDrawer'
import { TaskRow } from '../../panels/tasks/TaskRow'
import { batchProgress, statusLabel, taskModelLabel } from '../../panels/tasks/task-helpers'
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
import { batchWorstStatus, pickFocusTask } from './subagentFocus'
import { registerSubagentBatchTarget, subagentPillDomId } from './subagentBatchTargets'

function batchTitle(batch: SubagentTaskBatch, focusId: string | null): string {
  const focusIx = batch.tasks.findIndex((t) => t.id === focusId)
  const focus = batch.tasks[focusIx] ?? batch.tasks.find((t) => t.status === 'running') ?? batch.tasks[0]
  const model = focus ? taskModelLabel(focus) : null
  const withModel = (label: string) => (model ? `${label} · ${model}` : label)
  if (batch.mode === 'single') {
    return withModel(focus?.agent_name ?? 'subagent')
  }
  if (batch.mode === 'chain') {
    // Not "N steps": a chain registers each step as it starts, so the count is only
    // the steps so far. Name the step on screen instead, which is the live one.
    const step = focus?.step_index ?? (focusIx >= 0 ? focusIx + 1 : batch.tasks.length)
    return withModel(`chain · step ${step} · ${focus?.agent_name ?? 'subagent'}`)
  }
  const { done, total, running } = batchProgress(batch.tasks)
  return withModel(`parallel · ${running > 0 ? `${running} live` : `${done}/${total} done`}`)
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
  messageId,
  onNotice,
}: {
  batch: SubagentTaskBatch
  segmentId: string
  /** Owns this pill in the timeline — registered so composer-strip "Go to"
   *  can scroll the (virtualized) list to this message and open the pill. */
  messageId?: string
  onNotice?: (message: string) => void
}): React.ReactElement {
  const anyRunning = batch.tasks.some((t) => t.status === 'running')
  // Operator (pills rework): the card stays COLLAPSED until clicked — a running
  // batch reads as one compact pill line, and nothing expands or follows a run
  // unprompted. Each run row below is itself a click-to-expand pill.
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (messageId) registerSubagentBatchTarget(batch.batchKey, messageId)
  }, [batch.batchKey, messageId])


  const selectTask = useCallback(
    (id: string) => {
      // Click the run's pill to expand it; click again to collapse it.
      setSelectedId((prev) => (prev === id ? null : id))
    },
    [],
  )

  const selectedTask = batch.tasks.find((t) => t.id === selectedId) ?? null
  const chainTasks = batch.mode === 'chain' && batch.tasks.length > 1 ? batch.tasks : null
  const status = batchStatusLabel(batch)
  const title = batchTitle(batch, selectedId)

  const cls = useMemo(
    () =>
      chatSegmentRootClass('tool', {
        isError: status === 'error',
      }),
    [status],
  )

  return (
        <details
      id={subagentPillDomId(batch.batchKey)}
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
            !anyRunning && status === 'ok' && 'text-[rgb(52_211_153)]',
            !anyRunning && status !== 'ok' && status !== 'done' && status !== 'cancelled' &&
              'text-[rgb(241_106_80)]',
          )}
          aria-hidden="true"
        >
          {anyRunning ? '◇' : status === 'ok' ? '✓' : status === 'cancelled' || status === 'done' ? '■' : '✕'}
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
          {anyRunning ? 'running' : status === 'ok' ? 'completed' : statusLabel(batchWorstStatus(batch.tasks))}
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
                onSelect={() => selectTask(task.id)}
              />
            ))}
          </div>
        : null}

        {chainTasks ?
          <div className="mb-3">
            <ChainStepper tasks={chainTasks} selectedId={selectedId} onSelect={selectTask} />
          </div>
        : null}

                {selectedTask ?
          <TaskDetailDrawer
            embedded
            task={selectedTask}
            // The stepper above is this block's; the drawer renders its own for the
            // Tasks panel, and inline that stacked two identical steppers.
            chainTasks={null}
            onSelectTask={selectTask}
            onRetry={onNotice ?? (() => {})}
            onCancel={onNotice}
          />
        : null}
      </div>
    </details>
  )
}
