import React, { useMemo } from 'react'
import { cn } from './lib/cn'
import {
  auditWorkflowTiming,
  buildSummaryBars,
  classifyStoredTelemetryRaw,
  collapseConsecutiveTimelineEvents,
  extractToolRuns,
  findTurnEnvelope,
  formatCollapsedTimelineLine,
  formatDurationMs,
  mergedWorkflowTelemetry,
  summarizeToolArgsPreview,
  totalSpanMs,
  type WorkflowStampedEntry,
} from './workflowTimeline'

export type WorkflowMsgSubset = {
  id: string
  tool_calls_json: string | null
  created_at: number
  status: string
}

type Props = {
  message: WorkflowMsgSubset
  liveTelemetry: Record<string, WorkflowStampedEntry[]>
  /** created_at of the user message immediately before this assistant reply, when known */
  precedingUserCreatedAt?: number | null
  onClose: () => void
}

const muted = 'text-[0.8rem] text-text-secondary'

const tableCell = 'border border-border px-2 py-1.5 text-left'

const tableHeadCell = cn(tableCell, 'bg-bg-tertiary font-semibold text-text-secondary')

export function WorkflowModal({
  message,
  liveTelemetry,
  precedingUserCreatedAt,
  onClose,
}: Props): React.ReactElement {
  const rows = useMemo(
    () => mergedWorkflowTelemetry(message, liveTelemetry),
    [liveTelemetry, message],
  )

  const storageKind = useMemo(() => classifyStoredTelemetryRaw(message.tool_calls_json), [
    message.tool_calls_json,
  ])

  const toolRuns = useMemo(() => extractToolRuns(rows), [rows])

  const turnEnv = useMemo(() => findTurnEnvelope(rows), [rows])

  const spanTelemetry = useMemo(() => totalSpanMs(rows), [rows])

  const spanTurnEnvelope = useMemo(() => {
    if (turnEnv.turnStartTs !== null && turnEnv.turnEndTs !== null)
      return Math.max(0, turnEnv.turnEndTs - turnEnv.turnStartTs)
    return null
  }, [turnEnv.turnEndTs, turnEnv.turnStartTs])

  const summaryBars = useMemo(() => buildSummaryBars(rows, toolRuns), [rows, toolRuns])

  const maxBarMs = summaryBars.length ? Math.max(...summaryBars.map((b) => b.ms), 1) : 1

  const showLegacyWarn = storageKind === 'legacy_plain' || storageKind === 'mixed'

  const timingAudit = useMemo(
    () =>
      auditWorkflowTiming({
        assistantCreatedAt: message.created_at,
        precedingUserCreatedAt: precedingUserCreatedAt ?? null,
        entries: rows,
      }),
    [message.created_at, precedingUserCreatedAt, rows],
  )

  const collapsedTimeline = useMemo(() => collapseConsecutiveTimelineEvents(rows), [rows])

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-[rgb(8_10_14/0.72)] px-4 py-12"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[640px] rounded-[10px] border border-border bg-bg-secondary px-[18px] py-4 shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="workflow-title" className="m-0 text-base font-semibold">
            Message workflow
          </h2>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-inherit text-[0.75rem] text-accent underline underline-offset-2 hover:text-[#8cb4ff]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <p className={cn(muted, '[&_code]:text-[0.82em] [&_code]:text-accent')}>
          Pi streams lifecycle events plus <strong>tool_execution_*</strong> (args on start; duration bounded by start→end).
          There is no separate SDK event meaning “loaded tool registry”: the assistant listing capabilities in prose is ordinary{' '}
          <code>text_delta</code> merged into your reply below. Thinking channels appear as{' '}
          <code>message_update</code> variants such as{' '}
          <code>thinking_*</code> — useful for spinners only; durations here are collapsed.
        </p>

        {showLegacyWarn ?
          <p
            className="my-3 rounded-md border border-accent-muted bg-accent/10 p-2.5 text-[0.82rem] leading-[1.45]"
            role="note"
          >
            <strong>Timing note:</strong> this assistant message predates stamped telemetry. Rows were reconstructed with synthetic
            spacing (often 50&nbsp;ms), so granular bars are unreliable. Ask a fresh question after updating Sylo for real timings.
          </p>
        : null}

        {rows.length === 0 ?
          <p className={muted}>No telemetry rows for this message yet.</p>
        : <>
            <div className="mb-1 mt-3 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 text-[0.84rem]">
              <div>
                <span className={muted}>Raw events logged</span> <strong>{rows.length}</strong>
              </div>
              <div>
                <span className={muted}>Telemetry window</span>{' '}
                <strong>{spanTelemetry !== null ? formatDurationMs(spanTelemetry) : '—'}</strong>
              </div>
              <div>
                <span className={muted}>Turn envelope </span>{' '}
                <abbr
                  title="turn_start timestamp to turn_end (Pi lifecycle), when present"
                  className="cursor-help text-[0.8rem] text-text-secondary underline decoration-dotted"
                >
                  (Pi turn)
                </abbr>{' '}
                <strong>
                  {spanTurnEnvelope !== null ? formatDurationMs(spanTurnEnvelope) : '—'}
                </strong>
              </div>
            </div>
            <p className={cn(muted, 'mt-1.5 text-[0.78rem]')}>
              Use <strong>turn envelope</strong> as nearest proxy for “how long until this reply finished”; it excludes text-only gaps
              you do not serialize in SQLite. Actual tool timings are listed next.
            </p>

            {timingAudit.gaps.length > 0 ?
              <details className="mt-3.5" open>
                <summary className="mt-5 mb-1.5 cursor-pointer text-[0.92rem] font-semibold">
                  Timing gaps (not on chat cards)
                </summary>
                <p className={cn(muted, 'mt-1 text-[0.78rem]')}>
                  Inline “Thought” / tool durations only cover their own block. Intervals below are usually missing from the bubble.
                  Chat-visible total: <strong>{formatDurationMs(timingAudit.chatVisibleMs)}</strong>
                  {timingAudit.untrackedInWindowMs !== null ?
                    <>
                      {' '}
                      · untracked inside telemetry window:{' '}
                      <strong>{formatDurationMs(timingAudit.untrackedInWindowMs)}</strong>
                    </>
                  : null}
                  {timingAudit.flags.length > 0 ?
                    <span className={muted}> · flags: {timingAudit.flags.join(', ')}</span>
                  : null}
                </p>
                <table className="mt-4 w-full border-collapse text-[0.82rem]">
                  <thead>
                    <tr>
                      <th className={tableHeadCell}>Interval</th>
                      <th className={tableHeadCell}>Duration</th>
                      <th className={tableHeadCell}>Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timingAudit.gaps.map((g) => (
                      <tr key={g.id}>
                        <td className={tableCell} title={g.detail}>
                          {g.label}
                        </td>
                        <td className={tableCell}>{formatDurationMs(g.ms)}</td>
                        <td className={cn(tableCell, muted)}>{g.stage.replace(/_/g, ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            : null}

            {toolRuns.length > 0 ?
              <>
                <h3 className="mt-5 mb-1.5 text-[0.92rem] font-semibold">Tool executions</h3>
                <table className="mt-2 w-full border-collapse text-[0.82rem]">
                  <thead>
                    <tr>
                      <th className={tableHeadCell}>Tool</th>
                      <th className={tableHeadCell}>Args (truncated)</th>
                      <th className={tableHeadCell}>Wall duration</th>
                      <th className={tableHeadCell}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolRuns.map((run) => (
                      <tr key={`${run.toolCallId}-${run.startTs}`}>
                        <td className={tableCell}>
                          <code className="font-mono">{run.toolName}</code>
                        </td>
                        <td
                          className={cn(
                            tableCell,
                            'max-h-[140px] overflow-y-auto break-words font-mono text-[0.76rem] text-text-secondary',
                          )}
                        >
                          {summarizeToolArgsPreview(run.args, 560)}
                        </td>
                        <td className={tableCell}>
                          {run.durationMs !== null ? formatDurationMs(run.durationMs) : 'still running'}
                        </td>
                        <td className={tableCell}>
                          {run.isError === true ? 'error' : run.durationMs !== null ? 'ok' : 'open'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            :
              <p className={cn(muted, 'mt-3')}>
                No tool executions were streamed for this reply (capabilities listed in prose are just answer text unless a tool fired).
              </p>
            }

            {summaryBars.length > 0 ?
              <>
                <h3 className="mt-5 mb-1.5 text-[0.92rem] font-semibold">Collapsed durations</h3>
                <p className={cn(muted, '-mt-1 text-[0.8rem]')}>
                  Thinking deltas merge into contiguous blocks; tool bars reuse start→end wall time.
                </p>
                <div className="mt-3" aria-label="Collapsed duration chart">
                  {summaryBars.map((s) => (
                    <div
                      key={s.key}
                      className="mb-2 grid grid-cols-[1fr_minmax(80px,45%)_auto] items-center gap-2.5"
                    >
                      <div className="truncate text-[0.78rem] text-text-secondary" title={s.label}>
                        {s.label}
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-[5px] bg-bg-tertiary">
                        <div
                          className="h-full min-w-[3px] rounded-[5px] bg-gradient-to-r from-accent-muted to-accent transition-[width] duration-200 ease-in-out"
                          style={{
                            width: `${Math.max(4, (s.ms / maxBarMs) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="whitespace-nowrap text-right text-[0.75rem] text-text-primary">
                        {formatDurationMs(s.ms)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            : null}

            <details className="mt-4">
              <summary className={cn(muted, 'cursor-pointer')}>
                Raw event timeline
                {collapsedTimeline.length < rows.length ?
                  ` (${rows.length} raw → ${collapsedTimeline.length} rows)`
                : null}
              </summary>
              <p className={cn(muted, 'mb-2 text-[0.76rem]')}>
                Consecutive identical events (e.g. many <code>thinking delta</code> or tool streaming ticks) merge into
                one row with count and span. Gaps are between merged groups.
              </p>
              <ol className="mt-2 list-decimal pl-5 text-[0.82rem]">
                {collapsedTimeline.map((row, i) => {
                  const prevEndTs = i > 0 ? collapsedTimeline[i - 1]!.endTs : null
                  const line = formatCollapsedTimelineLine(row, i, prevEndTs)
                  const body = line.replace(/^\d+\.\s+/, '')
                  return (
                    <li key={row.key} className="my-1">
                      <span className={muted}>{body}</span>
                    </li>
                  )
                })}
              </ol>
            </details>
          </>
        }
      </div>
    </div>
  )
}
