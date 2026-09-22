/**
 * Diagnose an assistant turn that ended with no user-visible text.
 *
 * Local / thinking models often spend the whole output budget in the thinking
 * channel, or fill the context window with tool results, then stop. The old
 * generic "chat-only" hint was wrong for those cases and blocked the cutoff
 * path. This module decides whether one cheap recovery prompt is safe.
 */

export type SessionMessage = {
  role?: string
  stopReason?: string
  errorMessage?: string
  content?: unknown
  usage?: { output?: number; totalTokens?: number }
}

export const EMPTY_REPLY_CONTINUE_PROMPT = [
  '<sylo_status_only this_message_only="true">',
  'Write the operator-visible status of what already ran: completed, failed, remains.',
  'Do not write an implementation plan. Do not call tools on THIS message only.',
  'Later operator messages may use the subagent tool again — this restriction is one-shot.',
  '</sylo_status_only>',
].join(' ')

export type EmptyReplyKind =
  | 'ok'
  | 'aborted'
  | 'provider_error'
  | 'context_full'
  | 'output_capped'
  | 'thinking_only'
  | 'tools_no_text'
  | 'chat_only'
  | 'empty'

export type EmptyReplyDecision = {
  kind: EmptyReplyKind
  /** Shown when the model still has no text. Null = nothing to report. */
  userMessage: string | null
  autoContinue: boolean
  continuePrompt: string | null
}

function blocks(content: unknown): Record<string, unknown>[] {
  if (!Array.isArray(content)) return []
  return content.filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object')
}

export function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  let out = ''
  for (const b of blocks(content)) {
    if (b.type === 'text' && typeof b.text === 'string') out += b.text
  }
  return out
}

export function thinkingFromContent(content: unknown): string {
  let out = ''
  for (const b of blocks(content)) {
    if (b.type === 'thinking' && typeof b.thinking === 'string') out += b.thinking
  }
  return out
}

const TOOL_PART_TYPES = new Set(['toolCall', 'tool_use', 'functionCall', 'function_call'])

export function contentHasToolCall(content: unknown): boolean {
  return blocks(content).some((b) => typeof b.type === 'string' && TOOL_PART_TYPES.has(b.type))
}

export function isToolResultRole(role: string | undefined): boolean {
  return role === 'tool' || role === 'toolResult' || role === 'tool_result'
}

export function lastAssistantIndex(messages: readonly SessionMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') return i
  }
  return -1
}

export function turnAfterLastUser(messages: readonly SessionMessage[]): SessionMessage[] {
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      lastUser = i
      break
    }
  }
  return lastUser < 0 ? [...messages] : messages.slice(lastUser + 1)
}

export function turnUsedTools(messages: readonly SessionMessage[]): boolean {
  return turnAfterLastUser(messages).some(
    (m) => isToolResultRole(m.role) || contentHasToolCall(m.content),
  )
}

export function lastAssistantText(messages: readonly SessionMessage[]): string {
  const idx = lastAssistantIndex(messages)
  if (idx < 0) return ''
  return textFromContent(messages[idx]!.content)
}

export function lastAssistantCutoff(
  messages: readonly SessionMessage[],
): { output: number; total: number } | null {
  const idx = lastAssistantIndex(messages)
  if (idx < 0) return null
  const a = messages[idx]!
  if (a.stopReason !== 'length') return null
  return { output: a.usage?.output ?? 0, total: a.usage?.totalTokens ?? 0 }
}

function none(): EmptyReplyDecision {
  return { kind: 'ok', userMessage: null, autoContinue: false, continuePrompt: null }
}

function recoverable(kind: EmptyReplyKind, userMessage: string): EmptyReplyDecision {
  return {
    kind,
    userMessage,
    autoContinue: true,
    continuePrompt: EMPTY_REPLY_CONTINUE_PROMPT,
  }
}

function terminal(kind: EmptyReplyKind, userMessage: string): EmptyReplyDecision {
  return { kind, userMessage, autoContinue: false, continuePrompt: null }
}

export function decideEmptyReply(opts: {
  messages: readonly SessionMessage[]
  chatOnly: boolean
  contextWindow?: number | null
  maxTokens?: number | null
}): EmptyReplyDecision {
  const { messages, chatOnly, contextWindow, maxTokens } = opts
  const idx = lastAssistantIndex(messages)
  if (idx < 0) {
    return terminal('empty', 'The model returned no assistant message.')
  }

  const a = messages[idx]!
  const text = textFromContent(a.content).trim()
  const thinking = thinkingFromContent(a.content).trim()
  const usedTools = turnUsedTools(messages)
  const output = a.usage?.output ?? 0
  const total = a.usage?.totalTokens ?? 0

  if (a.stopReason === 'aborted') {
    return { kind: 'aborted', userMessage: null, autoContinue: false, continuePrompt: null }
  }
  if (a.stopReason === 'error') {
    const detail =
      typeof a.errorMessage === 'string' && a.errorMessage.trim()
        ? a.errorMessage.trim()
        : 'Model returned an error with no details.'
    return terminal('provider_error', detail)
  }
  if (text) return none()

  const window =
    typeof contextWindow === 'number' && contextWindow > 0 ? contextWindow : null
  const cap = typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : null
  const contextFull = window != null && total >= window * 0.97
  const outputCapped =
    !contextFull &&
    (a.stopReason === 'length' || (cap != null && output >= cap * 0.98))

  if (contextFull) {
    return terminal(
      'context_full',
      "This chat filled the model's context window, leaving no room to write a reply. Compact the chat or start a new one. Lowering the thinking level also leaves more room.",
    )
  }

  if (chatOnly) {
    return terminal(
      'chat_only',
      'Model returned no text. Chat-only is on — start a new chat and restart the broker after saving Settings if you meant to allow tools.',
    )
  }

  if (outputCapped) {
    return recoverable(
      'output_capped',
      'The model hit its per-reply token cap (often by thinking) and wrote no answer text.',
    )
  }
  if (usedTools) {
    return recoverable(
      'tools_no_text',
      'The model ran tools but never wrote a reply summarizing what it did.',
    )
  }
  if (thinking) {
    return recoverable(
      'thinking_only',
      'The model spent the turn thinking and wrote no reply text.',
    )
  }
  return recoverable('empty', 'The model returned no reply text.')
}
