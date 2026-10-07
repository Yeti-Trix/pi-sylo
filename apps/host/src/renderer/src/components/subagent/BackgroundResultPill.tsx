import React, { useState } from 'react'

import { cn } from '../../lib/cn'
import { ChatMarkdown } from '../../ChatMarkdown'
import { detailsOpenFromToggleEvent } from '../../panels/capability/helpers'
import {
  chatMsgRoleRow,
  chatSegmentChevron,
  chatSegmentRootClass,
  chatSegmentSummary,
  mutedText,
} from '../../panels/ui-classes'

/**
 * Background-subagent completion, rendered as a compact operator pill in the
 * chat timeline (operator request: "when the subagent completes you basically
 * just have a working pill in chat and when done it changes to completed" —
 * no full-report blob by default).
 *
 * Main inserts these as `'system'` messages shaped like:
 *   ⏹ **Background subagent <agent> finished** (run `abcd1234` · model)
 *   **Task:** …
 *
 *   <markdown result body>
 * The pill collapses to one line (status dot + agent + completed + run id +
 * task snippet); expanding shows the full markdown report. Old history entries
 * get the same treatment because matching is by content prefix.
 */

export type BackgroundResultInfo = {
  status: 'succeeded' | 'failed' | 'cancelled'
  agent: string
  runShortId: string
  model: string | null
  task: string | null
  body: string
}

const HEAD_RE =
  /^(?:\u23F9|\u26A0\uFE0F?|\u25A0)\s\*\*Background subagent <[^>]+> (finished|failed|stopped)\*\*/

export function parseBackgroundResult(content: string): BackgroundResultInfo | null {
  const lines = content.split('\n')
  const m = HEAD_RE.exec(lines[0] ?? '')
  if (!m) return null
  const head = lines[0]
  const status: BackgroundResultInfo['status'] =
    m[1] === 'finished' ? 'succeeded' : m[1] === 'failed' ? 'failed' : 'cancelled'
  // Run id + model come from the parenthetical, e.g. `(run \`abcd1234\` · model/x)`.
  const paren = /\(run `([0-9a-f]{4,12})[^`]*`([^)]*)\)\s*$/.exec(head)
  const model = paren && paren[2].trim() ? paren[2].trim().replace(/^[·\s]+/, '') : null
  const agent = /<([^>]+)>/.exec(head)?.[1] ?? 'subagent'
  const taskLineIdx = lines.findIndex((l) => l.startsWith('**Task:** '))
  const task = taskLineIdx >= 0 ? lines[taskLineIdx].slice('**Task:** '.length).trim() : null
  // Body = everything after the task line + its blank separator; tolerate
  // variants (missing task line → whole tail after the head).
  const body =
    taskLineIdx >= 0 ? lines.slice(taskLineIdx + 2).join('\n').trim() : lines.slice(1).join('\n').trim()
  return { status, agent, runShortId: paren ? paren[1] : '', model, task, body }
}

const STATUS_META: Record<BackgroundResultInfo['status'], { dot: string; label: string; cls: string }> = {
  succeeded: { dot: '✓', label: 'completed', cls: 'text-success' },
  failed: { dot: '✕', label: 'failed', cls: 'text-danger' },
  cancelled: { dot: '■', label: 'stopped', cls: 'text-text-secondary' },
}

export function BackgroundResultPill({ content }: { content: string }): React.ReactElement {
  const info = parseBackgroundResult(content) ?? {
    status: 'cancelled' as const,
    agent: 'subagent',
    runShortId: '',
    model: null,
    task: null,
    body: content,
  }
  const meta = STATUS_META[info.status]
  const [open, setOpen] = useState(false)
  const taskSnippet =
    info.task && info.task.length > 72 ? `${info.task.slice(0, 72)}\u2026` : info.task

  return (
    <details
      className={cn(chatSegmentRootClass('tool', {}), 'mx-0 mt-1.5')}
      open={open}
      onToggle={(e) => setOpen(detailsOpenFromToggleEvent(e))}
    >
      <summary className={chatSegmentSummary}>
        <span className={cn('text-[0.74rem]', meta.cls)} aria-hidden="true">
          {meta.dot}
        </span>
        <span className={chatMsgRoleRow}>
          <code className="font-mono font-semibold">{info.agent}</code>
          <span className="text-[0.7rem] text-text-secondary"> · </span>
          {meta.label}
          {info.runShortId ?
            <span className="text-[0.7rem] text-text-secondary"> · run {info.runShortId}</span>
          : null}
          {taskSnippet ? <span className={cn(mutedText, 'truncate text-[0.78rem]')}>{taskSnippet}</span> : null}
        </span>
        <span className={chatSegmentChevron} aria-hidden="true" />
      </summary>
      <div className="mt-1 w-auto min-w-0 rounded-lg border border-border/80 bg-bg-secondary/60 px-3 py-2.5">
        {info.model || info.runShortId ?
          <p className={cn(mutedText, 'mb-1.5 mt-0 font-mono text-[0.72rem]')}>
            {info.model ? `${info.model} · ` : ''}run {info.runShortId}
          </p>
        : null}
        <div className="text-[0.86rem] leading-[1.5] text-text-primary">
          <ChatMarkdown text={info.body || '_(no output)_'} />
        </div>
      </div>
    </details>
  )
}

/** Chat routing predicate: system messages that carry a background completion. */
export function isBackgroundResultMessage(content: string): boolean {
  return HEAD_RE.test(content.split('\n')[0] ?? '')
}