/** Cursor-style in-chat multiple-choice questions (sylo_ask_question). */

export const SYLO_ASK_QUESTION_TOOL = 'sylo_ask_question'
export const ASK_QUESTION_OTHER_ID = 'other'

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

export type AskQuestionPrompt = {
  requestId: string
  toolCallId: string
  conversationId?: string | null
  messageId?: string | null
  title?: string
  questions: AskQuestionSpec[]
}

export type AskQuestionSubmit = {
  requestId?: string
  toolCallId?: string
  answers: AskQuestionAnswer[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseOptions(raw: unknown): AskQuestionOption[] {
  if (!Array.isArray(raw)) return []
  const out: AskQuestionOption[] = []
  for (const item of raw) {
    const o = asRecord(item)
    if (!o) continue
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const label = typeof o.label === 'string' ? o.label.trim() : ''
    if (!id || !label) continue
    out.push({ id, label })
  }
  return out
}

export function parseAskQuestionSpecs(raw: unknown): AskQuestionSpec[] {
  if (!Array.isArray(raw)) return []
  const out: AskQuestionSpec[] = []
  for (const item of raw) {
    const q = asRecord(item)
    if (!q) continue
    const id = typeof q.id === 'string' ? q.id.trim() : ''
    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : ''
    const options = parseOptions(q.options)
    if (!id || !prompt || options.length < 2) continue
    out.push({
      id,
      prompt,
      options,
      allow_multiple: q.allow_multiple === true,
    })
  }
  return out
}

export function parseAskQuestionArgs(args: unknown): { title?: string; questions: AskQuestionSpec[] } | null {
  const root = asRecord(args)
  if (!root) return null
  const questions = parseAskQuestionSpecs(root.questions)
  if (questions.length === 0) return null
  const title = typeof root.title === 'string' ? root.title.trim() : ''
  return title ? { title, questions } : { questions }
}

export function parseAskQuestionAnswers(raw: unknown): AskQuestionAnswer[] {
  if (!Array.isArray(raw)) return []
  const out: AskQuestionAnswer[] = []
  for (const item of raw) {
    const a = asRecord(item)
    if (!a) continue
    const id = typeof a.id === 'string' ? a.id.trim() : ''
    if (!id) continue
    const selected = Array.isArray(a.selectedOptionIds)
      ? a.selectedOptionIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    const otherText = typeof a.otherText === 'string' ? a.otherText : undefined
    out.push({ id, selectedOptionIds: selected, ...(otherText ? { otherText } : {}) })
  }
  return out
}

export function parseAskQuestionAnswersFromResult(resultPreview: unknown): AskQuestionAnswer[] {
  const root = asRecord(resultPreview)
  if (!root) return []
  const details = asRecord(root.details)
  if (details && Array.isArray(details.answers)) {
    return parseAskQuestionAnswers(details.answers)
  }
  return []
}

export function answersComplete(questions: AskQuestionSpec[], answers: AskQuestionAnswer[]): boolean {
  const byId = new Map(answers.map((a) => [a.id, a]))
  for (const q of questions) {
    const a = byId.get(q.id)
    if (!a || a.selectedOptionIds.length === 0) return false
    if (a.selectedOptionIds.includes(ASK_QUESTION_OTHER_ID) && !a.otherText?.trim()) return false
    if (!q.allow_multiple && a.selectedOptionIds.length !== 1) return false
  }
  return true
}
