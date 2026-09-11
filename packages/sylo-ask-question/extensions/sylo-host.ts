import { randomUUID } from 'node:crypto'

export const ASK_QUESTION_MESSAGE = 'sylo_ask_question'
export const ASK_QUESTION_RESULT_MESSAGE = 'sylo_ask_question_result'

export type AskQuestionOption = {
  id: string
  label: string
}

export type AskQuestionSpec = {
  id: string
  prompt: string
  options: AskQuestionOption[]
  allow_multiple?: boolean
}

export type AskQuestionAnswer = {
  id: string
  selectedOptionIds: string[]
  otherText?: string
}

export type AskQuestionHostRequest = {
  requestId: string
  toolCallId: string
  title?: string
  questions: AskQuestionSpec[]
}

export type AskQuestionHostResult =
  | { ok: true; answers: AskQuestionAnswer[] }
  | { ok: false; cancelled: true; error: string }

/**
 * Block until the operator submits answers in Sylo chat (or the turn is aborted).
 * No idle timeout — this is an interactive wait, like Cursor AskQuestion.
 */
export function waitForAskQuestionAnswers(
  req: Omit<AskQuestionHostRequest, 'requestId'>,
  signal?: AbortSignal,
): Promise<AskQuestionHostResult> {
  if (!process.send) {
    return Promise.resolve({
      ok: false,
      cancelled: true,
      error: 'sylo_ask_question requires Sylo broker IPC',
    })
  }
  if (signal?.aborted) {
    return Promise.resolve({
      ok: false,
      cancelled: true,
      error: 'Cancelled: operator stopped the turn',
    })
  }

  const requestId = randomUUID()
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: AskQuestionHostResult) => {
      if (settled) return
      settled = true
      process.off('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }

    const onAbort = () => {
      finish({
        ok: false,
        cancelled: true,
        error: 'Cancelled: operator stopped the turn',
      })
    }

    const onMessage = (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const m = msg as {
        type?: string
        requestId?: string
        ok?: boolean
        cancelled?: boolean
        answers?: AskQuestionAnswer[]
        error?: string
      }
      if (m.type !== ASK_QUESTION_RESULT_MESSAGE || m.requestId !== requestId) return
      if (m.ok && Array.isArray(m.answers)) {
        finish({ ok: true, answers: m.answers })
        return
      }
      finish({
        ok: false,
        cancelled: true,
        error: typeof m.error === 'string' && m.error.trim() ? m.error : 'Question cancelled',
      })
    }

    process.on('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    process.send!({
      type: ASK_QUESTION_MESSAGE,
      requestId,
      toolCallId: req.toolCallId,
      title: req.title,
      questions: req.questions,
    })
  })
}
