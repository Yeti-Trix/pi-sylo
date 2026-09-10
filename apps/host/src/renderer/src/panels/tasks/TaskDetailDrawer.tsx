import React, { useEffect, useRef, useState } from 'react'

import { ChatMarkdown } from '../../ChatMarkdown'
import { cn } from '../../lib/cn'
import { detailsOpenFromToggleEvent } from '../capability/helpers'
import {
  btnDangerSm,
  btnPrimarySm,
  chatMsgBody,
  chatSegmentBody,
  chatSegmentChevron,
  chatSegmentIcon,
  chatSegmentLabel,
  chatSegmentMeta,
  chatSegmentPulse,
  chatSegmentRootClass,
  chatSegmentSummary,
  chatSegmentThinkingText,
  mutedText,
} from '../ui-classes'
import { ChainStepper } from './ChainStepper'
import {
  formatDuration,
  formatWhen,
  livePreviewText,
  parseResultJson,
  parseTaskSpec,
  statusLabel,
  statusTone,
  taskModelLabel,
  taskThinkingText,
} from './task-helpers'
import type { AgentTaskRow } from './task-types'

export function TaskDetailDrawer({
  task,
  chainTasks,
  onSelectTask,
  onRetry,
  onCancel,
  embedded,
}: {
  task: AgentTaskRow | null
  chainTasks: AgentTaskRow[] | null
  onSelectTask: (id: string) => void
  onRetry: (message: string) => void
  onCancel?: (message: string) => void
  /** Inline in chat — no fixed full-height shell. */
  embedded?: boolean
}): React.ReactElement {
  const [retryBusy, setRetryBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [thinkingOverride, setThinkingOverride] = useState<boolean | undefined>(undefined)
  const wasThinkingLive = useRef(false)
  const thinkingLiveNow =
    !!task && task.status === 'running' && parseTaskSpec(task.spec_json).lastThinkingLive === true

  useEffect(() => {
    setThinkingOverride(undefined)
    wasThinkingLive.current = false
  }, [task?.id])

  useEffect(() => {
    if (thinkingLiveNow && !wasThinkingLive.current) setThinkingOverride(undefined)
    wasThinkingLive.current = thinkingLiveNow
  }, [thinkingLiveNow])

  if (!task) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-secondary px-4 py-8 text-center',
          embedded ? 'min-h-[120px]' : 'h-full min-h-[240px]',
        )}
      >
        <p className={cn(mutedText, 'm-0 text-[0.85rem]')}>Select a task to inspect details.</p>
      </div>
    )
  }

  const spec = parseTaskSpec(task.spec_json)
  const result = parseResultJson(task.result_json)
  const preview = livePreviewText(task)
  const resultText =
    typeof result?.resultText === 'string' ? result.resultText
    : typeof result?.error === 'string' ? result.error
    : task.result_summary
  const output = (task.status === 'running' ? preview : null) || resultText
  const thinking = taskThinkingText(task)
  const thinkingLive = task.status === 'running' && spec.lastThinkingLive === true
  const model = taskModelLabel(task)

  const usage = result?.usage as
    | { input?: number; output?: number; cost?: number; turns?: number }
    | undefined

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col rounded-lg',
        embedded ? 'border-0 bg-transparent' : 'h-full border border-border bg-bg-secondary',
      )}
    >
      <div className="border-b border-border px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-[0.95rem] font-semibold text-text-primary">{task.agent_name}</h3>
          {model ?
            <span className="font-mono text-[0.74rem] text-text-secondary" title="Model this run used">
              {model}
            </span>
          : null}
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[0.68rem] font-medium uppercase tracking-[0.03em]',
              statusTone(task.status),
            )}
          >
            {statusLabel(task.status)}
          </span>
          <span className="ml-auto text-[0.72rem] text-text-secondary">
            {formatDuration(task.started_at, task.ended_at)}
          </span>
        </div>
        <p className="mb-0 mt-1.5 text-[0.82rem] leading-[1.45] text-text-primary">{task.title}</p>
        <p className={cn(mutedText, 'mb-0 mt-1 text-[0.74rem]')}>
          {task.mode}
          {task.step_index !== null ? ` · step ${task.step_index}` : ''} · {formatWhen(task.started_at)}
          {task.status_reason ? ` · ${task.status_reason}` : ''}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3.5 py-3">
        {chainTasks && chainTasks.length > 1 ?
          <div className="mb-4">
            <p className={cn(mutedText, 'mb-2 text-[0.78rem] font-medium uppercase tracking-[0.04em]')}>
              Chain steps
            </p>
            <ChainStepper tasks={chainTasks} selectedId={task.id} onSelect={onSelectTask} />
          </div>
        : null}

        {thinking ?
          <details
            className={cn(chatSegmentRootClass('thinking', {}), 'mb-3')}
            open={thinkingOverride ?? task.status === 'running'}
            onToggle={(e) => setThinkingOverride(detailsOpenFromToggleEvent(e))}
          >
            <summary className={chatSegmentSummary}>
              <span
                className={cn(
                  chatSegmentIcon,
                  'text-[rgb(107_159_255/0.9)]',
                  thinkingLive && chatSegmentPulse,
                )}
                aria-hidden="true"
              >
                ◆
              </span>
              <span className={chatSegmentLabel}>{thinkingLive ? 'Reasoning…' : 'Reasoning'}</span>
              {thinkingLive ?
                <span className={cn(chatSegmentMeta, chatSegmentPulse)}>live</span>
              : null}
              <span className={chatSegmentChevron} aria-hidden="true" />
            </summary>
            <div className={chatSegmentBody}>
              <pre className={chatSegmentThinkingText}>{thinking}</pre>
            </div>
          </details>
        : null}

        {spec.lastToolName ?
          <p className={cn(mutedText, 'mb-3 text-[0.78rem]')}>
            <code className="font-mono text-[0.8rem] text-text-primary">{spec.lastToolName}</code>
            {spec.lastToolPreview ?
              <span> — {spec.lastToolPreview}</span>
            : null}
          </p>
        : null}

        {output ?
          <div className={cn(chatMsgBody, 'mb-4')}>
            <ChatMarkdown text={output} />
          </div>
        : task.status === 'running' && !thinking && !spec.lastToolName ?
          <p className={cn(mutedText, 'm-0 text-[0.82rem]')}>Waiting for subagent output…</p>
        : null}

        {usage ?
          <section>
            <p className={cn(mutedText, 'mb-1.5 text-[0.78rem] font-medium uppercase tracking-[0.04em]')}>
              Usage
            </p>
            <p className="mb-0 text-[0.82rem] text-text-primary">
              in {usage.input ?? 0} · out {usage.output ?? 0}
              {typeof usage.turns === 'number' ? ` · ${usage.turns} turns` : ''}
              {typeof usage.cost === 'number' && usage.cost > 0 ?
                ` · $${usage.cost.toFixed(4)}`
              : null}
            </p>
          </section>
        : null}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border px-3.5 py-3">
        {task.status === 'running' ?
          <button
            type="button"
            className={btnDangerSm}
            disabled={cancelBusy}
            onClick={() => {
              setCancelBusy(true)
              void window.sylo.tasks
                .cancel(task.id)
                .then((r) => {
                  if (r.ok) {
                    onCancel?.('Subagent run cancelled.')
                  } else if (r.error === 'not_running') {
                    onCancel?.('That run is no longer active; refresh the list.')
                  } else {
                    onCancel?.('Could not cancel this run.')
                  }
                })
                .finally(() => setCancelBusy(false))
            }}
          >
            Stop run
          </button>
        : null}
        <button
          type="button"
          className={btnPrimarySm}
          disabled={retryBusy}
          onClick={() => {
            setRetryBusy(true)
            void (async () => {
              const r = await window.sylo.tasks.retry(task.id)
              if (r.ok) {
                const snippet = JSON.stringify(
                  {
                    agent: r.agent,
                    task: r.task,
                    ...(r.mode === 'chain' && r.stepIndex !== undefined ?
                      { chain: [{ agent: r.agent, task: r.task }] }
                    : r.mode === 'parallel' ?
                      { tasks: [{ agent: r.agent, task: r.task }] }
                    : { agent: r.agent, task: r.task }),
                  },
                  null,
                  2,
                )
                await navigator.clipboard.writeText(snippet)
                onRetry(`Copied subagent JSON for ${r.agent}. Paste into chat or ask the assistant to re-run.`)
              } else {
                onRetry('Could not load retry spec for this task.')
              }
            })().finally(() => setRetryBusy(false))
          }}
        >
          Copy subagent JSON
        </button>
      </div>
    </div>
  )
}
