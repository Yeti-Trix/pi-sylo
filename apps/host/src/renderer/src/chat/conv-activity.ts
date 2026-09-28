/**
 * Chat-list row status: what the little indicator beside each chat title shows.
 *
 * `question` outranks `running` — a running turn that is paused on an ask-question
 * is not making progress, and the operator needs to know an answer is owed. The
 * pending-question set comes from the ask-question client store
 * (`pendingQuestionConversationIds`); it is cleared whenever a turn ends or a new
 * one starts, so it can only describe a live, answerable question.
 */
export type ConvActivityStatus = 'question' | 'running' | 'unread' | 'read'

export function convActivityStatus(
  convId: string,
  sending: ReadonlySet<string>,
  unread: ReadonlySet<string>,
  questions: ReadonlySet<string>,
): ConvActivityStatus {
  if (questions.has(convId)) return 'question'
  if (sending.has(convId)) return 'running'
  if (unread.has(convId)) return 'unread'
  return 'read'
}