import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChatMarkdown } from '../ChatMarkdown'
import {
  SubagentRunBlock,
  SubagentRunBlockPending,
} from '../components/subagent/SubagentRunBlock'
import { LogicForgeIoReviewAction } from '../components/logicforge/LogicForgeIoReviewAction'
import { logicForgeMatchRunDir } from '../components/logicforge/logicForgeMatchRunDir'
import { mapSubagentBatchesToMessage } from '../components/subagent/matchSubagentBatches'
import { UserMessageBody } from '../UserMessageBody'
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
    pm.created_at !== nm.created_at
  ) {
    return false
  }
  if (prev.liveDeltaForId !== next.liveDeltaForId) return false
  if (prev.liveWorkflowForMessage !== next.liveWorkflowForMessage) return false
  if (prev.localImageUrl !== next.localImageUrl) return false
  if (prev.workspaceId !== next.workspaceId) return false
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
    segment.kind === 'thinking' ? segment.live
    : segment.kind === 'tool' ? segment.endTs === null
    : segment.kind === 'compaction' ? segment.live
    : false
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
          <span className={chatSegmentLabel}>
            {isLive ? 'Compacting context…' : 'Context compacted'}
          </span>
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
            className={cn(chatSegmentIcon, 'text-[rgb(107_159_255/0.9)]', isLive && chatSegmentPulse)}
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
            segment.isError ? 'text-[rgb(255_107_107)]' : 'text-text-secondary',
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
}: {
  label: string
  ms?: number
  liveStartTs?: number
  /** Assistant message created_at — shows live turn total when step timer is a sub-span. */
  turnStartTs?: number
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
  const turnTotalMs = showTurnTotal ? Math.max(0, now - turnStartTs) : 0
  const hint = BETWEEN_GAP_HINT[label] ?? 'Untracked wall time between stamped events.'
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
          className={cn(chatSegmentGapTotal, chatSegmentPulse)}
          title="Elapsed since this assistant reply started"
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
  let cursor = 0
  ordered.forEach((seg, i) => {
    const rawOffset = seg.textOffset ?? body.length
    const offset = Math.max(cursor, Math.min(rawOffset, body.length))
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
    if (gap) {
      pieces.push(
        <InlineTimingGap key={`gap-before-${seg.id}`} ms={gap.ms} label={gap.label} />,
      )
    }
    const isLive =
      seg.kind === 'thinking' ? seg.live
      : seg.kind === 'tool' ? seg.endTs === null
      : seg.kind === 'compaction' ? seg.live
      : false
    const autoOpen = isLive
    const key = `${messageId}:${seg.id}`
    pieces.push(
      <InlineAssistantSegment
        key={`seg-${seg.id}-${i}`}
        segment={seg}
        autoOpen={autoOpen}
        override={overrides[key]}
        onToggle={(next) => onToggle(key, next)}
        resolveImageUrl={resolveImageUrl}
      />,
    )
    if (seg.kind === 'tool' && seg.toolName === 'subagent') {
      const batch = subagentBatchBySegment.get(seg.id)
      if (batch) {
        pieces.push(
          <SubagentRunBlock
            key={`subagent-block-${seg.id}`}
            batch={batch}
            segmentId={seg.id}
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
        pieces.push(
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
        pieces.push(
          <AssistantAudioGallery
            key={`seg-audio-${seg.id}-${i}`}
            audios={segAudios}
            resolveFileUrl={resolveImageUrl}
          />,
        )
      }
    }
  })

  if (cursor < body.length) {
    const tail = body.slice(cursor)
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
          />
        </div>
      )
    }
    return <ChatMarkdown text={body} resolveImageUrl={resolveImageUrl} workspaceId={workspaceId} />
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
    <div className={cn(chatMsgRow, m.role === 'user' ? chatMsgRowUser : chatMsgRowAssistant)}>
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
              />
            : m.role === 'assistant' && m.status === 'cancelled' ?
              <span className={chatMsgStatusMuted}> · stopped</span>
            : m.role === 'assistant' && m.status === 'failed' ?
              <span className={chatMsgStatusMuted}> · failed</span>
            : m.role === 'assistant' && finalDurationMs !== null ?
              <span className={chatMsgStatusMuted}> · {formatDurationMs(finalDurationMs)}</span>
            : null}
          </div>
          <span
            className="text-[0.68rem] text-text-secondary tabular-nums whitespace-nowrap shrink-0"
            title={new Date(m.created_at).toLocaleString()}
            aria-label={`${m.role === 'user' ? 'Sent' : 'Started'} at ${new Date(m.created_at).toLocaleString()}`}
          >
            {formatCardTimestamp(m.created_at)}
          </span>
        </div>
        <div className={cn(chatMsgBody, m.role === 'user' && chatMsgBodyUser)}>
          {showTyping ?
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
              />
            : <ChatMarkdown text={body} resolveImageUrl={localImageUrl} workspaceId={workspaceId} />
          : m.role === 'user' ?
            <UserMessageBody content={body} localImageUrl={localImageUrl} />
          : body
          }
        </div>
      </div>
    </div>
  )
}, messageRowPropsEqual)
