import type { ChatMessageRowModel } from './ConversationMessage'

/**
 * One timeline row per stored/chat message. (The multi-agent session blocks —
 * the former second union member — were removed with the deleted package in
 * issue #41; this module keeps the row type + builder the chat virtualizer,
 * estimates, and remote chat share.)
 */
export type ChatTimelineRow = {
  kind: 'message'
  key: string
  message: ChatMessageRowModel & { conversation_id?: string }
}

/** Flatten stored messages into timeline rows in storage order (key = message id). */
export function buildChatTimeline(args: {
  messages: Array<ChatMessageRowModel & { conversation_id?: string }>
}): ChatTimelineRow[] {
  return args.messages.map((m) => ({ kind: 'message', key: m.id, message: m }))
}