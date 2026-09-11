import {
  parseAskQuestionSpecs,
  type AskQuestionPrompt,
  type AskQuestionSubmit,
} from '../../../shared/ask-question'

export function ingestAskQuestionPayload(raw: Record<string, unknown>): void {
  const requestId = typeof raw.requestId === 'string' ? raw.requestId.trim() : ''
  const toolCallId = typeof raw.toolCallId === 'string' ? raw.toolCallId.trim() : ''
  const questions = parseAskQuestionSpecs(raw.questions)
  if (!requestId || !toolCallId || questions.length === 0) return
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  upsertAskQuestionPrompt({
    requestId,
    toolCallId,
    conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : null,
    messageId: typeof raw.messageId === 'string' ? raw.messageId : null,
    ...(title ? { title } : {}),
    questions,
  })
}

type SubmitFn = (
  payload: AskQuestionSubmit,
) => Promise<{ ok: true } | { ok: false; error: string }>

let submitImpl: SubmitFn | null = null
const pendingByToolCallId = new Map<string, AskQuestionPrompt>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const cb of listeners) cb()
}

export function setAskQuestionSubmitImpl(fn: SubmitFn | null): void {
  submitImpl = fn
}

export function upsertAskQuestionPrompt(prompt: AskQuestionPrompt): void {
  const id = prompt.toolCallId.trim()
  if (!id) return
  pendingByToolCallId.set(id, prompt)
  notify()
}

export function clearAskQuestionPrompt(toolCallId: string): void {
  if (!pendingByToolCallId.delete(toolCallId)) return
  notify()
}

export function getAskQuestionPrompt(toolCallId: string): AskQuestionPrompt | undefined {
  return pendingByToolCallId.get(toolCallId)
}

export function subscribeAskQuestionPrompts(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export async function submitAskQuestion(
  payload: AskQuestionSubmit,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (submitImpl) return submitImpl(payload)
  if (typeof window !== 'undefined' && window.sylo?.askQuestion?.submit) {
    return window.sylo.askQuestion.submit(payload)
  }
  return { ok: false, error: 'ask_question_unavailable' }
}
