import React, { useState } from 'react'

import { cn } from '../../lib/cn'
import { btnDangerSm, btnPrimarySm, mutedText } from '../ui-classes'
import { ChainStepper } from './ChainStepper'
import {
  formatDuration,
  formatWhen,
  livePreviewText,
  parseResultJson,
  parseTaskSpec,
  statusLabel,
  statusTone,
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

        {preview && task.status === 'running' ?
          <section className="mb-4">
            <p className={cn(mutedText, 'mb-1.5 text-[0.78rem] font-medium uppercase tracking-[0.04em]')}>
              Live output
            </p>
            <pre className="m-0 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-primary p-2.5 font-mono text-[0.78rem] leading-[1.45] text-text-primary">
              {preview}
            </pre>
          </section>
        : null}

        {spec.lastToolName ?
          <section className="mb-4">
            <p className={cn(mutedText, 'mb-1.5 text-[0.78rem] font-medium uppercase tracking-[0.04em]')}>
              Last tool
            </p>
            <p className="mb-0 text-[0.82rem] text-text-primary">
              <code className="font-mono text-[0.8rem]">{spec.lastToolName}</code>
              {spec.lastToolPreview ?
                <span className="text-text-secondary"> — {spec.lastToolPreview}</span>
              : null}
            </p>
          </section>
        : null}

        {resultText ?
          <section className="mb-4">
            <p className={cn(mutedText, 'mb-1.5 text-[0.78rem] font-medium uppercase tracking-[0.04em]')}>
              Result
            </p>
            <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-primary p-2.5 font-mono text-[0.78rem] leading-[1.45] text-text-primary">
              {resultText}
            </pre>
          </section>
        : task.status === 'running' ?
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
