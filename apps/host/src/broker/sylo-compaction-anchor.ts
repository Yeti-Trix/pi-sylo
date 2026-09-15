import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/**
 * After Pi compaction, the summary is injected as a user-role message with
 * Goal / Next Steps. Auto-compact also runs *before* the just-sent prompt is
 * appended. Models then treat Next Steps as the task and drop the live request
 * or the prior goal. This extension inserts an ephemeral reminder after the
 * summary (not persisted — no extra session JSONL writes).
 */

export const COMPACTION_ANCHOR_MARKER = '[Sylo compaction note]'

const COMPACTION_SUMMARY_PREFIX =
  'The conversation history before this point was compacted into the following summary:'

const MAX_REQUEST_CHARS = 1200
const MAX_PRESERVED_REQUESTS = 2

export type CompactionAnchorMessage = {
  role: string
  content?: unknown
  summary?: unknown
  timestamp?: number
}

export function clipRequestText(text: string, maxChars = MAX_REQUEST_CHARS): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}\n…[truncated]`
}

export function userTextFromMessage(message: CompactionAnchorMessage): string {
  if (message.role !== 'user') return ''
  const content = message.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const rec = block as { type?: unknown; text?: unknown }
    if (rec.type === 'text' && typeof rec.text === 'string' && rec.text.trim()) {
      parts.push(rec.text)
    }
  }
  return parts.join('\n').trim()
}

export function extractUserTexts(messages: CompactionAnchorMessage[]): string[] {
  const out: string[] = []
  for (const message of messages) {
    const text = userTextFromMessage(message)
    if (text) out.push(text)
  }
  return out
}

export function lastUserText(messages: CompactionAnchorMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = userTextFromMessage(messages[i]!)
    if (text && !text.startsWith(COMPACTION_ANCHOR_MARKER)) return text
  }
  return ''
}

export function isCompactionSummaryMessage(message: CompactionAnchorMessage): boolean {
  if (message.role === 'compactionSummary') return true
  if (message.role !== 'user') return false
  const text = userTextFromMessage(message)
  return text.startsWith(COMPACTION_SUMMARY_PREFIX)
}

export function isCompactionAnchorMessage(message: CompactionAnchorMessage): boolean {
  return userTextFromMessage(message).startsWith(COMPACTION_ANCHOR_MARKER)
}

export function formatCompactionAnchor(opts: {
  liveUserRequest: string
  preservedUserRequests: string[]
}): string {
  const live = clipRequestText(opts.liveUserRequest)
  const preserved = uniquePreservedRequests(opts.preservedUserRequests, live)
  const lines = [
    COMPACTION_ANCHOR_MARKER,
    'A context summary is in this conversation as BACKGROUND only. It is not the current task.',
    "Answer the latest user request directly. If the summary's Next Steps conflict with that request, ignore the Next Steps.",
  ]
  if (live) {
    lines.push('', 'Live user request:', '"""', live, '"""')
  }
  if (preserved.length > 0) {
    lines.push(
      '',
      'Requests from before this compaction (still the active task unless the live request replaced them):',
    )
    for (const req of preserved) {
      lines.push('"""', req, '"""')
    }
  }
  return lines.join('\n')
}

export function uniquePreservedRequests(requests: string[], liveUserRequest: string): string[] {
  const live = clipRequestText(liveUserRequest)
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = requests.length - 1; i >= 0 && out.length < MAX_PRESERVED_REQUESTS; i--) {
    const clipped = clipRequestText(requests[i] ?? '')
    if (!clipped || clipped === live || seen.has(clipped)) continue
    seen.add(clipped)
    out.push(clipped)
  }
  return out.reverse()
}

export function applyCompactionAnchor(
  messages: CompactionAnchorMessage[],
  preservedUserRequests: string[],
): CompactionAnchorMessage[] {
  if (messages.some(isCompactionAnchorMessage)) return messages
  const idx = messages.findIndex(isCompactionSummaryMessage)
  if (idx < 0) return messages
  const anchor: CompactionAnchorMessage = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: formatCompactionAnchor({
          liveUserRequest: lastUserText(messages),
          preservedUserRequests,
        }),
      },
    ],
    timestamp: Date.now(),
  }
  return [...messages.slice(0, idx + 1), anchor, ...messages.slice(idx + 1)]
}

export default function syloCompactionAnchor(pi: ExtensionAPI): void {
  let preservedUserRequests: string[] = []

  pi.on('session_before_compact', (event) => {
    const fromHistory = extractUserTexts(event.preparation.messagesToSummarize)
    const fromSplitTurn = extractUserTexts(event.preparation.turnPrefixMessages)
    preservedUserRequests = [...fromHistory, ...fromSplitTurn]
  })

  pi.on('context', (event) => {
    const next = applyCompactionAnchor(event.messages, preservedUserRequests)
    if (next === event.messages) return
    return { messages: next as typeof event.messages }
  })
}
