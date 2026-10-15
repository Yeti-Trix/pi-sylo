import React from 'react'

import { cn } from '../../lib/cn'
import {
  chatSegmentBody,
  chatSegmentChevron,
  chatSegmentIcon,
  chatSegmentLabel,
  chatSegmentRootClass,
  chatSegmentSummary,
  chatSegmentThinkingText,
} from '../ui-classes'
import type { SubagentTraceEntry } from './task-types'

function formatTraceMs(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)} ms`
}

/** One replayed entry of a run's working trace, styled like the main chat's
 *  working stream: tool calls as compact pills (name + arg preview + duration,
 *  red mark when the call errored), reasoning as a collapsible pill, assistant
 *  text as a short muted paragraph in between.
 *
 *  Shared by the two places that replay a run's trace: the chat's
 *  TaskDetailDrawer and the Agent canvas panel's expanded run row
 *  (CanvasLiveContent) — the operator asked for the same trace feed in both. */
export function TracePill({ entry }: { entry: SubagentTraceEntry }): React.ReactElement {
  if (entry.k === 'tool') {
    const ms = formatTraceMs(entry.ms)
    return (
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-lg border bg-bg-tertiary/70 px-2.5 py-1.5',
          entry.err ? 'border-danger/40' : 'border-border/70',
        )}
        title={[entry.preview, entry.tail].filter(Boolean).join(' · ')}
      >
        <span className={cn('shrink-0', entry.err ? 'text-[rgb(241_106_80)]' : 'text-text-secondary')} aria-hidden="true">
          {entry.err ? '✕' : '⚙'}
        </span>
        <span className="shrink-0 text-[0.76rem] font-semibold text-text-primary">{entry.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[0.72rem] text-text-secondary">{entry.preview}</span>
        {entry.err ?
          <span className="shrink-0 rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.03em] text-danger">
            error
          </span>
        : ms ?
          <span className="shrink-0 text-[0.66rem] text-text-secondary">{ms}</span>
        : null}
      </div>
    )
  }
  if (entry.k === 'think') {
    return (
      <details className={cn(chatSegmentRootClass('thinking', {}), 'min-w-0')}>
        <summary className={chatSegmentSummary}>
          <span className={cn(chatSegmentIcon, 'text-[rgb(107_159_255/0.9)]')} aria-hidden="true">
            ◆
          </span>
          <span className={chatSegmentLabel}>Reasoning</span>
          <span className={chatSegmentChevron} aria-hidden="true" />
        </summary>
        <div className={chatSegmentBody}>
          <pre className={chatSegmentThinkingText}>{entry.text}</pre>
        </div>
      </details>
    )
  }
  return <p className="mb-0 mt-0 line-clamp-3 whitespace-pre-wrap px-1 text-[0.76rem] leading-[1.45] text-text-primary/85">{entry.text}</p>
}