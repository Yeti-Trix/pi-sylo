import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChatMarkdown } from '../ChatMarkdown'
import {
  SubagentRunBlock,
  SubagentRunBlockPending,
} from '../components/subagent/SubagentRunBlock'
import { AskQuestionBlock } from './AskQuestionBlock'
import { SYLO_ASK_QUESTION_TOOL } from '../../../shared/ask-question'
import { LogicForgeIoReviewAction } from '../components/logicforge/LogicForgeIoReviewAction'
import { logicForgeMatchRunDir } from '../components/logicforge/logicForgeMatchRunDir'
import { mapSubagentBatchesToMessage } from '../components/subagent/matchSubagentBatches'
import { UserMessageBody } from '../UserMessageBody'
import { splitUserMessageAttachments } from '../chatUserAttachments'
import { cn } from '../lib/cn'
import { detailsOpenFromToggleEvent } from '../panels/capability/helpers'
import {
  chatInlineCode,
  chatInterleaved,
  chatMsgAssistant,
  chatMsgBody,
  chatMsgBodyUser,
  chatMsgBubble,
  chatMsgHead,
  chatMsgRoleRow,
  chatMsgRow,
  chatMsgRowAssistant,
  chatMsgRowUser,
  chatMsgStatusMuted,
  chatMsgUser,
  chatQueueEdit,
  chatQueueEditBtn,
  chatSegmentArgs,
  chatSegmentBody,
  chatSegmentChevron,
  chatSegmentEmpty,
  chatSegmentGap,
  chatSegmentGapLabel,
  chatSegmentGapLine,
  chatSegmentGapMs,
  chatSegmentGapTotal,
  chatSegmentIcon,
  chatSegmentKv,
  chatSegmentKvLabel,
  chatSegmentLabel,
  chatSegmentMeta,
  chatSegmentPre,
  chatSegmentPulse,
  chatSegmentRootClass,
  chatSegmentStatusBase,
  chatSegmentStatusErr,
  chatSegmentStatusLive,
  chatSegmentStatusOk,
  chatSegmentSummary,
  chatSegmentThinkingText,
  mutedText,
} from '../panels/ui-classes'
import {
  assistantTurnDurationMs,
  buildAssistantSegments,
  compactionSegmentLabel,
  formatDurationMs,
  gapsForOrderedChatSegments,
  labelLeadChatGap,
  liveOpenChatGap,
  mergedWorkflowTelemetry,
  summarizeToolArgsPreview,
  type AssistantSegment,
  type WorkflowStampedEntry,
} from '../workflowTimeline'
import { LiveElapsedLabel } from './LiveElapsedLabel'
import { CompactionNotice } from './CompactionNotice'
import type { ConversationPauseSnapshot } from './askQuestionClient'
import { compactionTriggerLabel } from '../../../shared/compaction-notice'
import {
  thinkTankSeatBubbleClass,
  thinkTankSeatRoleClass,
} from '../components/think-tank/thinkTankSeatTone'
import {
  collectToolResultAudios,
  collectToolResultImages,
  toolImageSrc,
  toolResultImageGalleryCopy,
  toolResultSummaryLine,
  type ToolResultImage,
} from './toolResultContent'
import { AssistantAudioGallery } from './ToolResultAudioPlayer'
import { ToolResultMedia } from './ToolResultMedia'
import type { AgentTaskRow } from '../panels/tasks/task-types'

export type ChatMessageRowModel = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_calls_json: string | null
  status: 'streaming' | 'complete' | 'failed' | 'cancelled'
  created_at: number
  /** Edit-resend (Claude parity): original text + timestamp for edited user messages. */
  original_text?: string | null
  edited?: number | null
}

export type ThinkTankBubbleMeta = {
  seatId: string
  seatLabel: string
  seatAgent: string
  cycle: number
  stance?: string
  phase?: 'debate' | 'final_report'
}

type ChatMessageRowProps = {
  m: ChatMessageRowModel
  liveDeltaForId: string
  /** Live workflow rows for this message only (not the full conversation map). */
  liveWorkflowForMessage: WorkflowStampedEntry[]
  segmentOverrides: Record<string, boolean>
  onSegmentToggle: (key: string, next: boolean) => void
  subagentTasks?: AgentTaskRow[]
  onSubagentNotice?: (message: string) => void
  onOpenLogicForgeIoReview?: (runDir: string) => void
  localImageUrl?: (path: string) => string | null
  thinkTank?: ThinkTankBubbleMeta
  workspaceId?: string
  /** Agent checkpoint (per-turn undo): this assistant reply has a pre-turn
   *  snapshot, so the operator can restore the workspace to before it. */
  canUndoTurn?: boolean
  onUndoTurn?: () => void
  /** Ask-question pause state for this conversation's turn (from the
   *  askQuestionClient ledger): live turn timers freeze while an answer is owed
   *  and resume from the frozen value after. `undefined`/NO_QUESTION_PAUSE when
   *  nothing is pending — identity-stable so memoized rows do not re-render. */
  turnPause?: ConversationPauseSnapshot
  /** Edit & resend (Claude parity, user rows only): the row renders an inline
   *  editor; on save, the edited text + the original message's attachments are
   *  handed up (App routes them to `chat.editAndResend`, which truncates after
   *  the message and reruns the turn). */
  onEditMessage?: (newText: string, attachments: { path: string; name: string }[]) => void
  /** Retry (Claude parity, task 03): true ONLY for the timeline's last
   *  assistant row; click reruns that turn from the same user message. */
  canRetryTurn?: boolean
  onRetryTurn?: () => void
  /** Per-turn file-change card (task 07, Cursor/Claude-Code parity): stats
   *  from the turn's checkpoint manifest diff. Rendered only when the turn
   *  actually changed files. */
  turnChanges?: { modified: string[]; added: string[]; deleted: string[] }
  /** Opens the read-only diff side pane for this turn (checkpoint diff IPC). */
  onReviewDiff?: () => void
  /** Plan mode (task 11): this plan-mode reply is the timeline's last and idle
   *  — renders Approve & execute / Discard under the reply. Discard is a NO-OP
   *  (nothing to undo — the plan turn cannot mutate the workspace). */
  planApprovable?: boolean
  onApprovePlan?: () => void
}

function segmentOverridesEqualForMessage(
  prev: Record<string, boolean>,
  next: Record<string, boolean>,
  messageId: string,
): boolean {
  const prefix = `${messageId}:`
  for (const key of Object.keys(prev)) {
    if (!key.startsWith(prefix)) continue
    if (prev[key] !== next[key]) return false
  }
  for (const key of Object.keys(next)) {
    if (!key.startsWith(prefix)) continue
    if (prev[key] !== next[key]) return false
  }
  return true
}

/**
 * Compact wall-clock stamp for a chat card's top-right corner.
 * Same calendar day -> time only; otherwise short date + time.
 * User card = when the user sent it; assistant card = when the reply was initiated.
 */
function formatCardTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return time
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${date}, ${time}`
}

function messageRowPropsEqual(prev: ChatMessageRowProps, next: ChatMessageRowProps): boolean {
  const pm = prev.m
  const nm = next.m
  if (
    pm.id !== nm.id ||
    pm.role !== nm.role ||
    pm.content !== nm.content ||
    pm.status !== nm.status ||
    pm.tool_calls_json !== nm.tool_calls_json ||
    pm.created_at !== nm.created_at ||
    pm.original_text !== nm.original_text ||
    pm.edited !== nm.edited
  ) {
    return false
  }
  if (prev.liveDeltaForId !== next.liveDeltaForId) return false
  if (prev.liveWorkflowForMessage !== next.liveWorkflowForMessage) return false
  if (prev.localImageUrl !== next.localImageUrl) return false
  if (prev.workspaceId !== next.workspaceId) return false
  if (prev.canUndoTurn !== next.canUndoTurn) return false
  if (prev.onUndoTurn !== next.onUndoTurn) return false
  if (prev.turnPause !== next.turnPause) return false
  if (prev.onEditMessage !== next.onEditMessage) return false
  if (prev.canRetryTurn !== next.canRetryTurn) return false
  if (prev.onRetryTurn !== next.onRetryTurn) return false
  if (prev.turnChanges !== next.turnChanges) return false
  if (prev.onReviewDiff !== next.onReviewDiff) return false
  if (prev.planApprovable !== next.planApprovable) return false
  if (prev.onApprovePlan !== next.onApprovePlan) return false
  if (prev.onSegmentToggle !== next.onSegmentToggle) return false
  if (prev.subagentTasks !== next.subagentTasks) return false
  if (prev.onSubagentNotice !== next.onSubagentNotice) return false
  if (prev.onOpenLogicForgeIoReview !== next.onOpenLogicForgeIoReview) return false
  const pc = prev.thinkTank
  const nc = next.thinkTank
  if (pc?.seatAgent !== nc?.seatAgent || pc?.seatLabel !== nc?.seatLabel || pc?.cycle !== nc?.cycle) {
    return false
  }
  if (pc?.stance !== nc?.stance) return false
  return segmentOverridesEqualForMessage(prev.segmentOverrides, next.segmentOverrides, nm.id)
}

type InlineSegmentProps = {
  segment: AssistantSegment
  autoOpen: boolean
  override: boolean | undefined
  /** False once the turn's final message is in — everything defaults collapsed. */
  messageStreaming: boolean
  onToggle: (next: boolean) => void
  resolveImageUrl?: (path: string) => string | null
}

/**
 * Gallery of images pulled from a message's tool results, surfaced above the
 * assistant answer so they aren't buried inside the collapsed tool row.
 */
function AssistantImageGallery({
  images,
  toolName,
  resolveImageUrl,
}: {
  images: ToolResultImage[]
  toolName?: string
  resolveImageUrl?: (path: string) => string | null
}): React.ReactElement | null {
  const resolved = images
    .map((img) => ({ img, src: toolImageSrc(img, resolveImageUrl) }))
    .filter((x): x is { img: ToolResultImage; src: string } => Boolean(x.src))
  if (resolved.length === 0) return null
  const copy = toolResultImageGalleryCopy(images, toolName)
  return (
    <div className="my-2 flex flex-col gap-1.5">
      <span className="text-[0.7rem] uppercase tracking-wide text-text-secondary">
        {copy.heading}
      </span>
      <div className="flex flex-wrap gap-2">
        {resolved.map(({ img, src }, i) => {
          const href = img.source === 'web' ? (img.sourceUrl ?? src) : src
          const title =
            img.source === 'web' && img.sourceUrl ? `Open source: ${img.sourceUrl}`
            : img.documentPath ? `From PDF: ${img.documentPath}`
            : img.caption
          return (
            <a
              key={`${(img.localPath ?? img.dataUrl ?? '').slice(0, 48)}-${i}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="overflow-hidden rounded-lg border border-border bg-bg-primary"
              title={title}
            >
              <img
                src={src}
                alt={img.caption}
                className="max-h-44 w-auto max-w-[260px] object-contain bg-black/20"
                loading="lazy"
              />
            </a>
          )
        })}
      </div>
      <span className={cn(mutedText, 'text-[0.68rem]')}>{copy.footnote}</span>
    </div>
  )
}

function InlineAssistantSegment({
  segment,
  autoOpen,
  override,
  messageStreaming,
  onToggle,
  resolveImageUrl,
}: InlineSegmentProps): React.ReactElement {
  const open = override ?? autoOpen
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const programmaticRef = useRef(false)
  useLayoutEffect(() => {
    const el = detailsRef.current
    if (!el) return
    if (el.open !== open) {
      programmaticRef.current = true
      el.open = open
    }
  }, [open])
  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (programmaticRef.current) {
      programmaticRef.current = false
      return
    }
    onToggle(detailsOpenFromToggleEvent(e))
  }
  const isLive =
    (segment.kind === 'thinking' ? segment.live
    : segment.kind === 'tool' ? segment.endTs === null
    : segment.kind === 'compaction' ? segment.live
    : false) && messageStreaming
  const cls = chatSegmentRootClass(
    segment.kind,
    { isError: segment.kind === 'tool' && segment.isError },
  )

  if (segment.kind === 'compaction') {
    const ms =
      segment.endTs !== null ? Math.max(0, segment.endTs - segment.startTs) : null
    const tokenLabel =
      segment.tokensBefore != null && segment.tokensAfter != null ?
        `${segment.tokensBefore.toLocaleString()} → ${segment.tokensAfter.toLocaleString()} tokens`
      : segment.tokensBefore != null ?
        `${segment.tokensBefore.toLocaleString()} tokens before`
      : segment.tokensAfter != null ?
        `${segment.tokensAfter.toLocaleString()} tokens after`
      : null
    return (
      <details ref={detailsRef} className={cls} onToggle={handleToggle}>
        <summary className={chatSegmentSummary}>
          <span
            className={cn(
              chatSegmentIcon,
              'text-[rgb(245_158_11/0.95)]',
              isLive && chatSegmentPulse,
            )}
            aria-hidden="true"
          >
            ⧉
          </span>
          <span className={chatSegmentLabel}>{compactionSegmentLabel(segment)}</span>
          {tokenLabel ?
            <span className={chatSegmentMeta}>{tokenLabel}</span>
          : null}
          {ms !== null ?
            <span className={chatSegmentMeta}>{formatDurationMs(ms)}</span>
          : isLive ?
            <span className={cn(chatSegmentMeta, chatSegmentPulse)}>live</span>
          : null}
          <span className={chatSegmentChevron} aria-hidden="true" />
        </summary>
        <div className={chatSegmentBody}>
          <p className={cn(mutedText, 'text-[0.78rem] leading-[1.45]')}>
            {isLive ?
              'Pi is summarizing older turns to free context window space.'
            : segment.aborted ?
              'Older history was not summarized. The full conversation is still in context.'
            : segment.errorMessage ?
              segment.errorMessage
            : 'Older turns were summarized. Recent messages are kept; facts from before this boundary may be missing.'}
          </p>
          <p className={cn(mutedText, 'mt-1 text-[0.74rem]')}>
            Trigger: {compactionTriggerLabel(
              segment.reason === 'manual' || segment.reason === 'overflow' ?
                segment.reason
              : 'threshold',
            )}
          </p>
          {segment.summary?.trim() ?
            <pre className={cn(chatSegmentThinkingText, 'mt-2')}>{segment.summary}</pre>
          : null}
        </div>
      </details>
    )
  }

  if (segment.kind === 'thinking') {
    const ms = segment.endTs !== null ? Math.max(0, segment.endTs - segment.startTs) : null
    const trimmed = segment.text.trim()
    return (
      <details ref={detailsRef} className={cls} onToggle={handleToggle}>
        <summary className={chatSegmentSummary}>
          <span
            className={cn(chatSegmentIcon, 'text-[rgb(255_255_255/0.75)]', isLive && chatSegmentPulse)}
            aria-hidden="true"
          >
            ◆
          </span>
          <span className={chatSegmentLabel}>{isLive ? 'Reasoning…' : 'Reasoning'}</span>
          {ms !== null ?
            <span className={chatSegmentMeta}>{formatDurationMs(ms)}</span>
          : isLive ?
            <span className={cn(chatSegmentMeta, chatSegmentPulse)}>live</span>
          : null}
          <span className={chatSegmentChevron} aria-hidden="true" />
        </summary>
        <div className={chatSegmentBody}>
          {trimmed ?
            <pre className={chatSegmentThinkingText}>{segment.text}</pre>
          : <p className={cn(mutedText, chatSegmentEmpty)}>
              (No reasoning text streamed for this block — provider only emitted timing markers.)
            </p>
          }
        </div>
      </details>
    )
  }

  const argsLine = summarizeToolArgsPreview(segment.args, 120)
  const argsFull = summarizeToolArgsPreview(segment.args, 4000)
  const resultBrief = toolResultSummaryLine(segment.resultPreview)
  const statusLabel =
    segment.endTs === null ? 'running'
    : segment.isError ? 'error'
    : 'ok'
  return (
    <details ref={detailsRef} className={cls} onToggle={handleToggle}>
      <summary className={chatSegmentSummary}>
        <span
          className={cn(
            chatSegmentIcon,
            segment.isError ? 'text-[rgb(241_106_80)]' : 'text-text-secondary',
            segment.endTs === null && chatSegmentPulse,
          )}
          aria-hidden="true"
        >
          ⚙
        </span>
        <span className={chatSegmentLabel}>
          <code className={chatInlineCode}>{segment.toolName}</code>
        </span>
        <span className={chatSegmentArgs} title={argsLine}>
          {argsLine}
        </span>
        <span
          className={cn(
            chatSegmentStatusBase,
            segment.isError ? chatSegmentStatusErr
            : segment.endTs === null ? chatSegmentStatusLive
            : chatSegmentStatusOk,
          )}
        >
          {statusLabel}
        </span>
        {segment.durationMs !== null ?
          <span className={chatSegmentMeta}>{formatDurationMs(segment.durationMs)}</span>
        : segment.endTs === null ?
          <span className={cn(chatSegmentMeta, chatSegmentPulse)}>…</span>
        : null}
        <span className={chatSegmentChevron} aria-hidden="true" />
      </summary>
      <div className={chatSegmentBody}>
        <div className={chatSegmentKv}>
          <span className={chatSegmentKvLabel}>args</span>
          <pre className={chatSegmentPre}>{argsFull}</pre>
        </div>
        {segment.endTs !== null ?
          <>
            <ToolResultMedia
              resultPreview={segment.resultPreview}
              resolveImageUrl={resolveImageUrl}
              hideImages
              hideAudios
              toolName={segment.toolName}
            />
            {!resultBrief && segment.resultPreview == null ?
              <p className={cn(mutedText, chatSegmentEmpty)}>(No result preview captured.)</p>
            : null}
          </>
        : null}
      </div>
    </details>
  )
}

const BETWEEN_GAP_HINT: Record<string, string> = {
  'Waiting for first output':
    'Assistant row exists; broker is running the turn. Includes model load / time-to-first-token before any reasoning or tool event is stamped.',
  'Preparing tool call':
    'After the reasoning block ended until tool_execution_start. The model is deciding arguments; the host is not in the tool yet.',
  'Processing tool results':
    'After the tool finished until the next reasoning block starts. Often model inference on tool output; answer text may stream here but is not timed on this row.',
  'Between tool calls': 'Idle or model work between two tool runs.',
  'Between reasoning blocks': 'Gap between two reasoning spans.',
}

function InlineTimingGap({
  label,
  ms,
  liveStartTs,
  turnStartTs,
  turnPause,
}: {
  label: string
  ms?: number
  liveStartTs?: number
  /** Assistant message created_at — shows live turn total when step timer is a sub-span. */
  turnStartTs?: number
  /** Ask-question turn pause: totals freeze while an answer is owed. */
  turnPause?: ConversationPauseSnapshot
}): React.ReactElement {
  const isLive = liveStartTs !== undefined
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isLive) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [isLive, liveStartTs])
  const displayMs = isLive ? Math.max(0, now - liveStartTs) : (ms ?? 0)
  const showTurnTotal =
    isLive && turnStartTs !== undefined && liveStartTs !== undefined && turnStartTs < liveStartTs
  // While the turn is parked on an unanswered question the turn total freezes at
  // the pause start (operator wait is not agent run time); after the answer it
  // resumes from that frozen value because each pause interval is subtracted.
  const turnPaused = turnPause?.paused === true && turnPause?.pausedSinceTs != null
  const turnAnchorTs = turnPaused ? turnPause!.pausedSinceTs! : now
  const turnTotalMs =
    showTurnTotal ? Math.max(0, turnAnchorTs - turnStartTs - (turnPause?.pausedTotalMs ?? 0)) : 0
  const hint = BETWEEN_GAP_HINT[label] ?? 'Untracked wall time between stamped events.'
  const turnTotalTitle =
    turnPaused ?
      'Elapsed since this assistant reply started (paused — waiting for your answer)'
    : 'Elapsed since this assistant reply started'
  const ariaLabel =
    showTurnTotal ?
      `${label}: ${formatDurationMs(displayMs)}, ${formatDurationMs(turnTotalMs)} total`
    : `${label}: ${formatDurationMs(displayMs)}`
  return (
    <div
      className={chatSegmentGap}
      role="status"
      aria-label={ariaLabel}
      title={hint}
    >
      <span className={chatSegmentGapLine} aria-hidden="true" />
      <span className={cn(chatSegmentGapLabel, isLive && 'text-text-primary')}>{label}</span>
      <span className={cn(chatSegmentGapMs, isLive && chatSegmentPulse)}>
        {formatDurationMs(displayMs)}
      </span>
      {showTurnTotal ?
        <span
          className={cn(chatSegmentGapTotal, !turnPaused && chatSegmentPulse)}
          title={turnTotalTitle}
        >
          · {formatDurationMs(turnTotalMs)} total
        </span>
      : null}
      <span className={chatSegmentGapLine} aria-hidden="true" />
    </div>
  )
}

function InterleavedAssistantBody({
  messageId,
  body,
  segments,
  assistantCreatedAt,
  isStreaming,
  overrides,
  onToggle,
  resolveImageUrl,
  subagentTasks,
  onSubagentNotice,
  onOpenLogicForgeIoReview,
  workspaceId,
  turnPause,
}: {
  messageId: string
  body: string
  segments: AssistantSegment[]
  assistantCreatedAt: number
  isStreaming: boolean
  overrides: Record<string, boolean>
  onToggle: (key: string, next: boolean) => void
  resolveImageUrl?: (path: string) => string | null
  subagentTasks?: AgentTaskRow[]
  onSubagentNotice?: (message: string) => void
  onOpenLogicForgeIoReview?: (runDir: string) => void
  workspaceId?: string
  /** Ask-question turn pause: live turn totals freeze while an answer is owed. */
  turnPause?: ConversationPauseSnapshot
}): React.ReactElement {
  const subagentBatchBySegment = useMemo(
    () => mapSubagentBatchesToMessage(segments, subagentTasks ?? [], assistantCreatedAt),
    [segments, subagentTasks, assistantCreatedAt],
  )
  const ordered = segments.slice().sort((a, b) => {
    const ao = a.textOffset ?? Number.POSITIVE_INFINITY
    const bo = b.textOffset ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    return a.startTs - b.startTs
  })

  const gapByBeforeId = new Map(
    gapsForOrderedChatSegments(ordered, assistantCreatedAt).map((g) => [
      g.beforeSegmentId,
      { ms: g.ms, label: g.label },
    ]),
  )

  const pieces: React.ReactNode[] = []
  const galleries: React.ReactNode[] = []
  let cursor = 0
  /** Completed compaction that already renders as the persisted system-row card. */
  const isCardCoveredCompaction = (seg: AssistantSegment): boolean =>
    seg.kind === 'compaction' && !seg.live &&
    (seg.tokensBefore != null || seg.tokensAfter != null || Boolean(seg.summary?.trim()))
  // Cursor-style grouping: once the message completes, the whole work timeline
  // (reasoning + tool calls + between-steps text) collapses into ONE expandable
  // row; only tool-result galleries and the final answer text stay outside.
  let lastVisibleIndex = -1
  ordered.forEach((seg, i) => {
    if (!isCardCoveredCompaction(seg)) lastVisibleIndex = i
  })
  const grouped = !isStreaming && lastVisibleIndex >= 0
  let groupEndOffset = 0
  if (grouped) {
    let c = 0
    for (let i = 0; i <= lastVisibleIndex; i++) {
      const seg = ordered[i]!
      const rawOffset = seg.textOffset ?? body.length
      c = Math.max(c, Math.min(rawOffset, body.length))
    }
    groupEndOffset = c
  }
  ordered.forEach((seg, i) => {
    if (grouped && i > lastVisibleIndex) return
    const rawOffset = seg.textOffset ?? body.length
    const offset = Math.max(cursor, Math.min(rawOffset, body.length))
    // Completed compactions with a persisted notice (tokens/summary present) are
    // rendered once as the system-row card — skip the inline duplicate here.
    // Live "Compacting context…" still shows inline as the only indicator.
    const cardCoveredCompaction = isCardCoveredCompaction(seg)
    if (offset > cursor) {
      const chunk = body.slice(cursor, offset)
      if (chunk.trim().length > 0) {
        pieces.push(
          <ChatMarkdown
            key={`text-before-${seg.id}`}
            text={chunk}
            resolveImageUrl={resolveImageUrl}
            workspaceId={workspaceId}
          />,
        )
      }
      cursor = offset
    }
    const gap = gapByBeforeId.get(seg.id)
    if (gap && !cardCoveredCompaction) {
      pieces.push(
        <InlineTimingGap key={`gap-before-${seg.id}`} ms={gap.ms} label={gap.label} />,
      )
    }
    if (cardCoveredCompaction) return
    const isLive =
      seg.kind === 'thinking' ? seg.live
      : seg.kind === 'tool' ? seg.endTs === null
      : seg.kind === 'compaction' ? seg.live
      : false
    // Cursor-style collapse once the turn is done. While streaming, tools stay
    // collapsed (summary already previews args; subagent payloads are huge) and
    // reasoning still opens. Ask-question tools render as a dedicated card.
    const autoOpen = isStreaming && isLive && seg.kind !== 'tool'
    const key = `${messageId}:${seg.id}`
    const isAskQuestion = seg.kind === 'tool' && seg.toolName === SYLO_ASK_QUESTION_TOOL
    if (!isAskQuestion) {
      pieces.push(
        <InlineAssistantSegment
          key={`seg-${seg.id}-${i}`}
          segment={seg}
          autoOpen={autoOpen}
          override={overrides[key]}
          messageStreaming={isStreaming}
          onToggle={(next) => onToggle(key, next)}
          resolveImageUrl={resolveImageUrl}
        />,
      )
    }
    if (isAskQuestion) {
      pieces.push(<AskQuestionBlock key={`ask-question-${seg.id}`} segment={seg} />)
    }
    if (seg.kind === 'tool' && seg.toolName === 'subagent') {
      const batch = subagentBatchBySegment.get(seg.id)
      if (batch) {
        pieces.push(
          <SubagentRunBlock
            key={`subagent-block-${seg.id}`}
            batch={batch}
            segmentId={seg.id}
            live={seg.endTs === null}
            onNotice={onSubagentNotice}
          />,
        )
      } else if (seg.endTs === null) {
        pieces.push(
          <SubagentRunBlockPending key={`subagent-pending-${seg.id}`} segmentId={seg.id} />,
        )
      }
    }
    const logicForgeRunDir = logicForgeMatchRunDir(seg)
    if (logicForgeRunDir && onOpenLogicForgeIoReview) {
      pieces.push(
        <LogicForgeIoReviewAction
          key={`logicforge-review-${seg.id}`}
          runDir={logicForgeRunDir}
          onOpen={onOpenLogicForgeIoReview}
        />,
      )
    }
    if (seg.kind === 'tool' && seg.resultPreview != null) {
      const segImages = collectToolResultImages([seg.resultPreview])
      if (segImages.length > 0) {
        // Galleries stay outside the collapsed work group so images aren't
        // buried behind the expand chevron.
        ;(grouped ? galleries : pieces).push(
          <AssistantImageGallery
            key={`seg-images-${seg.id}-${i}`}
            images={segImages}
            toolName={seg.toolName}
            resolveImageUrl={resolveImageUrl}
          />,
        )
      }
      const segAudios = collectToolResultAudios([seg.resultPreview])
      if (segAudios.length > 0) {
        ;(grouped ? galleries : pieces).push(
          <AssistantAudioGallery
            key={`seg-audio-${seg.id}-${i}`}
            audios={segAudios}
            resolveFileUrl={resolveImageUrl}
          />,
        )
      }
    }
  })

  const tailStart = grouped ? groupEndOffset : cursor
  if (tailStart < body.length && !grouped) {
    const tail = body.slice(tailStart)
    if (tail.trim().length > 0) {
      pieces.push(
        <ChatMarkdown key={`text-tail-${messageId}`} text={tail} resolveImageUrl={resolveImageUrl} workspaceId={workspaceId} />,
      )
    }
  }

  const openGap = liveOpenChatGap(ordered, assistantCreatedAt, isStreaming)
  if (openGap) {
    pieces.push(
      <InlineTimingGap
        key="gap-open-live"
        label={openGap.label}
        liveStartTs={openGap.startTs}
        turnStartTs={assistantCreatedAt}
        turnPause={turnPause}
      />,
    )
  }

  if (pieces.length === 0) {
    if (openGap) {
      return (
        <div className={chatInterleaved}>
          <InlineTimingGap
            label={openGap.label}
            liveStartTs={openGap.startTs}
            turnStartTs={assistantCreatedAt}
            turnPause={turnPause}
          />
        </div>
      )
    }
    return <ChatMarkdown text={body} resolveImageUrl={resolveImageUrl} workspaceId={workspaceId} />
  }
  if (grouped) {
    const visibleSegs = ordered.filter((seg) => !isCardCoveredCompaction(seg))
    const toolCount = visibleSegs.filter((s) => s.kind === 'tool').length
    const thinkMs = visibleSegs.reduce(
      (acc, s) =>
        s.kind === 'thinking' && s.endTs != null ? acc + Math.max(0, s.endTs - s.startTs) : acc,
      0,
    )
    const firstVisible = visibleSegs[0]!
    const lastVisible = visibleSegs[visibleSegs.length - 1]!
    const spanMs = Math.max(0, (lastVisible.endTs ?? lastVisible.startTs) - firstVisible.startTs)
    const labelParts: string[] = []
    if (toolCount > 0) labelParts.push(`Ran ${toolCount} tool call${toolCount === 1 ? '' : 's'}`)
    if (thinkMs > 0) labelParts.push(`thought ${formatDurationMs(thinkMs)}`)
    if (labelParts.length === 0) labelParts.push('Work')
    labelParts.push(formatDurationMs(spanMs))
    const tail = tailStart < body.length ? body.slice(tailStart) : ''
    return (
      <div className={chatInterleaved}>
        <details className={chatSegmentRootClass('tool', {})}>
          <summary className={chatSegmentSummary}>
            <span className={cn(chatSegmentIcon, 'text-text-secondary')} aria-hidden="true">
              ⚙
            </span>
            <span className={chatSegmentLabel}>{labelParts.join(' · ')}</span>
            <span className={chatSegmentChevron} aria-hidden="true" />
          </summary>
          <div className="relative mt-1.5 ml-1 flex flex-col gap-1.5 pb-2.5 pl-3 pr-2.5">
            <span
              aria-hidden="true"
              className="absolute bottom-3 left-0 top-0 w-px bg-[rgb(255_255_255/0.14)]"
            />
            {pieces}
          </div>
        </details>
        {galleries.length > 0 ? galleries : null}
        {tail.trim().length > 0 ?
          <ChatMarkdown
            key={`text-tail-${messageId}`}
            text={tail}
            resolveImageUrl={resolveImageUrl}
            workspaceId={workspaceId}
          />
        : null}
      </div>
    )
  }
  return <div className={chatInterleaved}>{pieces}</div>
}

export const ChatConversationMessageRow = memo(function ChatConversationMessageRow({
  m,
  liveDeltaForId,
  liveWorkflowForMessage,
  segmentOverrides,
  onSegmentToggle,
  subagentTasks,
  onSubagentNotice,
  onOpenLogicForgeIoReview,
  localImageUrl,
  thinkTank,
  workspaceId,
  canUndoTurn,
  onUndoTurn,
  turnPause,
  onEditMessage,
  canRetryTurn,
  onRetryTurn,
  turnChanges,
  onReviewDiff,
  planApprovable,
  onApprovePlan,
}: ChatMessageRowProps): React.ReactElement {
  const liveWorkflowMap =
    liveWorkflowForMessage.length > 0 ? { [m.id]: liveWorkflowForMessage } : {}
  const telemetryRows =
    m.role === 'assistant' ? mergedWorkflowTelemetry(m, liveWorkflowMap) : []
  const segments = m.role === 'assistant' ? buildAssistantSegments(telemetryRows) : []
  const isStreaming = m.role === 'assistant' && m.status === 'streaming'
  const body =
    m.role === 'assistant' && !m.content && !liveDeltaForId && m.status === 'streaming' ?
      ''
    : m.content + liveDeltaForId

  const showTyping =
    m.role === 'assistant' &&
    m.status === 'streaming' &&
    !m.content &&
    !liveDeltaForId &&
    segments.length === 0

  const showInterleavedWorkflow = segments.length > 0 || isStreaming
  const [copied, setCopied] = useState(false)
  // Edit-resend (user rows): inline editor state. Attachments are parsed from
  // the persisted row and re-sent verbatim — v1 edits text only.
  const [editDraft, setEditDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const editAttsRef = useRef<{ path: string; name: string }[]>([])
  const [editingAtts, setEditingAtts] = useState<{ path: string; name: string }[]>([])
  const startEdit = () => {
    const { text, attachments } = splitUserMessageAttachments(m.content)
    editAttsRef.current = attachments
    setEditingAtts(attachments)
    setEditDraft(text)
    setEditing(true)
  }
  const cancelEdit = () => setEditing(false)
  const saveEdit = () => {
    const newText = editDraft.trim()
    const originalSplit = splitUserMessageAttachments(m.content).text
    setEditing(false)
    if (!newText || newText === originalSplit.trim() || !onEditMessage) return
    onEditMessage(newText, editAttsRef.current)
  }
  const finalDurationMs = useMemo(
    () => (m.role === 'assistant' ? assistantTurnDurationMs(telemetryRows, m.created_at) : null),
    [m.role, m.created_at, telemetryRows],
  )

  const roleLabel =
    thinkTank ?
      thinkTank.phase === 'final_report' ?
        `Think Tank · Final · ${thinkTank.seatLabel}`
      : `Think Tank · C${thinkTank.cycle} · ${thinkTank.seatLabel}`
    : m.role === 'user' ? 'You'
    : m.role === 'assistant' ? 'Assistant'
    : m.role

  if (m.role === 'system') {
    return <CompactionNotice content={m.content} />
  }

  const stanceSuffix =
    thinkTank?.stance && m.status === 'complete' ?
      ` · ${thinkTank.stance.replace(/_/g, ' ')}`
    : null

  return (
    <div className={cn(chatMsgRow, 'group', m.role === 'user' ? chatMsgRowUser : chatMsgRowAssistant)}>
      <div
        className={cn(
          chatMsgBubble,
          thinkTank ?
            thinkTankSeatBubbleClass(thinkTank.seatId, thinkTank.seatLabel, thinkTank.seatAgent)
          : m.role === 'user' ? chatMsgUser
          : chatMsgAssistant,
        )}
      >
        <div className={chatMsgHead}>
          <div className={chatMsgRoleRow}>
            <span className={thinkTank ? thinkTankSeatRoleClass(thinkTank.seatId, thinkTank.seatLabel, thinkTank.seatAgent) : undefined}>
              {roleLabel}
              {stanceSuffix}
            </span>
            {m.role === 'assistant' && isStreaming ?
              <LiveElapsedLabel
                startTs={m.created_at}
                className={chatMsgStatusMuted}
                prefix=" · "
                title="Elapsed for this reply"
                pause={turnPause}
              />
            : m.role === 'assistant' && m.status === 'cancelled' ?
              <span className={chatMsgStatusMuted}> · stopped</span>
            : m.role === 'assistant' && m.status === 'failed' ?
              <span className={chatMsgStatusMuted}> · failed</span>
            : m.role === 'assistant' && finalDurationMs !== null ?
              <span className={chatMsgStatusMuted}> · {formatDurationMs(finalDurationMs)}</span>
            : null}
          </div>
          <button
            type="button"
            title="Copy message text"
            aria-label="Copy message text"
            className="shrink-0 cursor-pointer rounded border-none bg-transparent px-1 py-0.5 text-[0.66rem] leading-none text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary focus:opacity-100"
            onClick={() => {
              void navigator.clipboard.writeText(m.content).then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1200)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          {m.role === 'user' && !editing && onEditMessage ?
            <button
              type="button"
              title="Edit & resend — rewinds the conversation after this message and reruns the turn"
              aria-label="Edit and resend this message"
              className="shrink-0 cursor-pointer rounded border-none bg-transparent px-1 py-0.5 text-[0.66rem] leading-none text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary focus:opacity-100"
              onClick={startEdit}
            >
              Edit
            </button>
          : null}
          {m.role === 'user' && m.edited ?
            <span
              className="shrink-0 rounded bg-[rgb(255_255_255/0.08)] px-1.5 py-0.5 text-[0.64rem] leading-none text-text-secondary"
              title={
                m.original_text ?
                  `Edited ${new Date(m.edited).toLocaleString()}\n
Original:\n${m.original_text}`
                : `Edited ${new Date(m.edited).toLocaleString()}`
              }
            >
              edited
            </span>
          : null}
          {m.role === 'assistant' && canRetryTurn ?
            <button
              type="button"
              title="Retry — discard this reply and rerun the turn from the same message"
              aria-label="Retry this reply"
              className="shrink-0 cursor-pointer rounded border-none bg-transparent px-1 py-0.5 text-[0.66rem] leading-none text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary focus:opacity-100"
              onClick={() => onRetryTurn?.()}
            >
              Retry
            </button>
          : null}
          {m.role === 'assistant' && canUndoTurn ?
            <button
              type="button"
              title="Restore the workspace to the state before this turn (current state is safety-captured first)"
              aria-label="Undo this agent turn"
              className="shrink-0 cursor-pointer rounded border-none bg-transparent px-1 py-0.5 text-[0.66rem] leading-none text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#f6b3a4] focus:opacity-100"
              onClick={() => onUndoTurn?.()}
            >
              Undo
            </button>
          : null}
          <span
            className="text-[0.68rem] text-text-secondary tabular-nums whitespace-nowrap shrink-0"
            title={new Date(m.created_at).toLocaleString()}
            aria-label={`${m.role === 'user' ? 'Sent' : 'Started'} at ${new Date(m.created_at).toLocaleString()}`}
          >
            {formatCardTimestamp(m.created_at)}
          </span>
        </div>
        <div className={cn(chatMsgBody, m.role === 'user' && chatMsgBodyUser)}>
          {editing && m.role === 'user' ?
            <>
              <textarea
                value={editDraft}
                autoFocus
                rows={Math.min(12, Math.max(3, editDraft.split('\n').length))}
                spellCheck={false}
                className={chatQueueEdit}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    cancelEdit()
                  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    saveEdit()
                  }
                }}
              />
              <div className="mt-1.5 flex items-center gap-2">
                <button type="button" className={chatQueueEditBtn} onClick={saveEdit} title="Save & resend — rewinds the conversation after this message and reruns the turn (Ctrl/Cmd+Enter)">
                  Save & resend
                </button>
                <button type="button" className={chatQueueEditBtn} onClick={cancelEdit} title="Discard the edit (Esc)">
                  Cancel
                </button>
                {editingAtts.length > 0 ?
                  <span className={cn(mutedText, 'truncate text-[0.72rem]')} title={editingAtts.map((a) => a.path).join('\n')}>
                    {editingAtts.length} attachment{editingAtts.length === 1 ? '' : 's'} kept
                  </span>
                : null}
              </div>
            </>
          : showTyping ?
            <InlineTimingGap label={labelLeadChatGap()} liveStartTs={m.created_at} />
          : m.role === 'assistant' ?
            showInterleavedWorkflow ?
              <InterleavedAssistantBody
                messageId={m.id}
                body={body}
                segments={segments}
                assistantCreatedAt={m.created_at}
                isStreaming={isStreaming}
                overrides={segmentOverrides}
                onToggle={(key, next) => onSegmentToggle(key, next)}
                resolveImageUrl={localImageUrl}
                subagentTasks={subagentTasks}
                onSubagentNotice={onSubagentNotice}
                onOpenLogicForgeIoReview={onOpenLogicForgeIoReview}
                workspaceId={workspaceId}
                turnPause={turnPause}
              />
            : <ChatMarkdown text={body} resolveImageUrl={localImageUrl} workspaceId={workspaceId} />
          : m.role === 'user' ?
            <UserMessageBody content={body} localImageUrl={localImageUrl} />
          : body
          }
        </div>
        {m.role === 'assistant' && turnChanges &&
         (turnChanges.modified.length + turnChanges.added.length + turnChanges.deleted.length > 0) ?
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1 text-[0.72rem]">
            <span className={cn(mutedText, 'whitespace-nowrap')} title="Files this turn changed (checkpoint manifest diff — Undo restores all of them)">
              <span className="text-[#e2c08d]">{turnChanges.modified.length} modified</span>
              {' · '}
              <span className="text-[#9ece6a]">{turnChanges.added.length} added</span>
              {' · '}
              <span className="text-[#f6b3a4]">{turnChanges.deleted.length} deleted</span>
            </span>
            {onReviewDiff ?
              <button
                type="button"
                className={chatQueueEditBtn}
                title="Open the read-only before/after diff (canvas pane)"
                onClick={() => onReviewDiff()}
              >
                Review diff
              </button>
            : null}
            {canUndoTurn && onUndoTurn ?
              <button
                type="button"
                className={chatQueueEditBtn}
                title="Restore the workspace to before this turn (same as hover Undo — safety-captured first)"
                onClick={() => onUndoTurn?.()}
              >
                Undo
              </button>
            : null}
            <details className="min-w-0">
              <summary className={cn(mutedText, 'cursor-pointer select-none')} title="Files changed by this turn">
                files
              </summary>
              <div className="mt-1 flex flex-col gap-0.5 font-mono text-[0.7rem]">
                {[
                  ...turnChanges.modified.map((rel) => ({ rel, cls: 'text-[#e2c08d]' })),
                  ...turnChanges.added.map((rel) => ({ rel, cls: 'text-[#9ece6a]' })),
                  ...turnChanges.deleted.map((rel) => ({ rel, cls: 'text-[#f6b3a4]' })),
                ]
                  .slice(0, 12)
                  .map(({ rel, cls }) => (
                    <span key={rel} className={cn('break-all', cls)}>{rel}</span>
                  ))}
                {turnChanges.modified.length + turnChanges.added.length + turnChanges.deleted.length > 12 ?
                  <span className={mutedText}>
                    +{turnChanges.modified.length + turnChanges.added.length + turnChanges.deleted.length - 12} more
                  </span>
                : null}
              </div>
            </details>
          </div>
        : null}
        {planApprovable && onApprovePlan ?
          <div className="mt-2 flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-2 py-1.5">
            <span className={cn(mutedText, 'min-w-0 flex-1 text-[0.72rem]')}>
              Plan mode — nothing executed yet.
            </span>
            <button
              type="button"
              className={cn(chatQueueEditBtn, 'border-accent text-accent')}
              title="Run this plan again with full tools (a new agent turn; never text-as-commands)"
              onClick={() => onApprovePlan()}
            >
              Approve & execute
            </button>
            <button
              type="button"
              className={chatQueueEditBtn}
              title="Do nothing — the plan turn could not change anything"
              onClick={() => undefined}
            >
              Discard
            </button>
          </div>
        : null}
        {m.role === 'assistant' && m.original_text ?
          <details className="mt-1">
            <summary
              className={cn(mutedText, 'cursor-pointer text-[0.72rem] select-none')}
              title={`Discarded attempt stored on retry — original reply from ${m.edited ? new Date(m.edited).toLocaleString() : 'the retried turn'}`}
            >
              Previous attempt
            </summary>
            <pre className={cn(mutedText, 'mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[0.76rem] leading-snug')}>
              {m.original_text}
            </pre>
          </details>
        : null}
      </div>
    </div>
  )
}, messageRowPropsEqual)
