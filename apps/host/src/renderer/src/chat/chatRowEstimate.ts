import { splitUserMessageAttachments } from '../chatUserAttachments'
import type { ChatTimelineRow } from '../components/think-tank/buildChatTimeline'
import {
  debateTurnOpen,
  reportTurnOpen,
  thinkTankUiForEstimate,
  type ThinkTankSessionUiState,
} from '../components/think-tank/ThinkTankSessionBlock'
import type { ChatMessageRowModel } from './ConversationMessage'

const MAX_ESTIMATE_CACHE = 400
const estimateCache = new Map<string, number>()

type EstimateMsg = ChatMessageRowModel & { conversation_id?: string }

/**
 * Count tool/workflow segments without JSON.parse. estimateSize runs for every
 * row on scroll; parsing multi-MB tool_calls_json on that path stalls frames.
 */
function countApproxSegments(toolJson: string): number {
  if (!toolJson) return 0
  let n = 0
  let i = 0
  while ((i = toolJson.indexOf('"toolName"', i)) !== -1) {
    n += 1
    i += 10
  }
  return n
}

function rememberEstimate(key: string, value: number): number {
  if (estimateCache.size >= MAX_ESTIMATE_CACHE) {
    const first = estimateCache.keys().next().value
    if (first !== undefined) estimateCache.delete(first)
  }
  estimateCache.set(key, value)
  return value
}

function estimateChatRowHeight(m: EstimateMsg | undefined): number {
  if (!m) return 220
  const contentLen = m.content?.length ?? 0

  if (m.role === 'user') {
    const { text, attachments } = splitUserMessageAttachments(m.content ?? '')
    const newlineLines = (text.match(/\n/g)?.length ?? 0) + (text.length > 0 ? 1 : 0)
    const textLines = Math.max(newlineLines, Math.ceil(text.length / 72))
    const attachmentBlock = attachments.length > 0 ? 72 + attachments.length * 58 : 0
    return Math.min(2400, 56 + textLines * 22 + attachmentBlock)
  }

  if (m.role === 'assistant') {
    const toolJson = m.tool_calls_json ?? ''
    const segmentCount = countApproxSegments(toolJson)
    const textLines = Math.ceil(contentLen / 68)
    const streaming = m.status === 'streaming'
    // Completed turns collapse tools into one <details>. Counting raw JSON
    // length used to estimate 64k px rows; measuring the real ~200px card
    // then yanked the list by tens of thousands of pixels.
    const segmentBlocks = streaming ? segmentCount * 120 : segmentCount > 0 ? 48 : 0
    const streamingExtra = streaming ? 120 : 0
    return Math.min(64000, 96 + textLines * 21 + segmentBlocks + streamingExtra)
  }

  return Math.min(2400, 56 + Math.ceil(contentLen / 72) * 22)
}

function computeTimelineRowHeight(
  row: ChatTimelineRow,
  thinkTankUi: Record<string, ThinkTankSessionUiState | undefined>,
): number {
  if (row.kind === 'message') return estimateChatRowHeight(row.message as EstimateMsg)
  const ui = thinkTankUiForEstimate(row.sessionId, row.status, thinkTankUi)
  let height = 100
  const debateBubbles = row.bubbles.filter((b) => b.phase === 'debate')
  const reportBubbles = row.bubbles.filter((b) => b.phase === 'final_report')
  if (debateBubbles.length > 0) {
    height += 28
    for (const bubble of debateBubbles) {
      const open = debateTurnOpen(ui, bubble.id, row.status)
      height += open ?
        estimateChatRowHeight({
          id: bubble.id,
          role: 'assistant',
          content: bubble.body,
          tool_calls_json: bubble.tool_calls_json,
          status: bubble.status,
          created_at: bubble.created_at,
        }) + 48
      : 36
    }
  }
  if (reportBubbles.length > 0) {
    height += 36
    if (ui.reportsOpen) {
      height += 40
      for (const bubble of reportBubbles) {
        const open = reportTurnOpen(ui, bubble.id, row.status)
        height += open ?
          estimateChatRowHeight({
            id: bubble.id,
            role: 'assistant',
            content: bubble.body,
            tool_calls_json: bubble.tool_calls_json,
            status: bubble.status,
            created_at: bubble.created_at,
          })
        : 36
      }
    }
  }
  if (
    row.liveSession &&
    (row.liveSession.status === 'complete' ||
      row.liveSession.status === 'awaiting_pick' ||
      row.liveSession.error)
  ) {
    height += 160
  }
  return Math.min(64000, height)
}

function estimateCacheKey(
  row: ChatTimelineRow,
  thinkTankUi: Record<string, ThinkTankSessionUiState | undefined>,
): string {
  if (row.kind === 'message') {
    const m = row.message
    return `m:v2:${m.id}:${m.content.length}:${m.tool_calls_json?.length ?? 0}:${m.status}`
  }
  const ui = thinkTankUi[row.sessionId]
  const debate = ui ? Object.entries(ui.debateOpenById).sort().join(',') : ''
  const report = ui ? Object.entries(ui.reportOpenById).sort().join(',') : ''
  const bubbles = row.bubbles
    .map((b) => `${b.id}:${b.body.length}:${b.tool_calls_json?.length ?? 0}:${b.status}`)
    .join('|')
  return `t:${row.sessionId}:${row.status}:${ui?.reportsOpen ? 1 : 0}:${debate}:${report}:${bubbles}`
}

/** Cached height guess for the virtualizer. Measured DOM size wins once a row mounts. */
export function estimateTimelineRowHeight(
  row: ChatTimelineRow | undefined,
  thinkTankUi: Record<string, ThinkTankSessionUiState | undefined>,
): number {
  if (!row) return 220
  const key = estimateCacheKey(row, thinkTankUi)
  const hit = estimateCache.get(key)
  if (hit !== undefined) return hit
  return rememberEstimate(key, computeTimelineRowHeight(row, thinkTankUi))
}

/** Store the measured height so a later remount does not re-guess. */
export function rememberMeasuredTimelineRowHeight(
  row: ChatTimelineRow,
  thinkTankUi: Record<string, ThinkTankSessionUiState | undefined>,
  size: number,
): void {
  if (!(size > 0) || !Number.isFinite(size)) return
  rememberEstimate(estimateCacheKey(row, thinkTankUi), Math.round(size))
}
