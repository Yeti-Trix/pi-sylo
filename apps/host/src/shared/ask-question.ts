/** Cursor-style in-chat multiple-choice questions (sylo_ask_question). */

export const SYLO_ASK_QUESTION_TOOL = 'sylo_ask_question'
export const ASK_QUESTION_OTHER_ID = 'other'

export type AskQuestionOption = {
  id: string
  label: string
  recommended?: boolean
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

const RECOMMENDED_SUFFIX_RE = /\s*\(\s*recommended\s*\)\s*$/i

function stripRecommendedSuffix(label: string): { label: string; recommended: boolean } {
  const match = RECOMMENDED_SUFFIX_RE.exec(label)
  if (!match) return { label, recommended: false }
  return { label: label.slice(0, match.index).trim(), recommended: true }
}

export function orderAskQuestionOptions(options: AskQuestionOption[]): AskQuestionOption[] {
  const recommended = options.filter((o) => o.recommended)
  if (recommended.length === 0) return options
  const rest = options.filter((o) => !o.recommended)
  return [...recommended, ...rest]
}

export function displayAskQuestionOptionLabel(option: AskQuestionOption): string {
  if (!option.recommended) return option.label
  if (RECOMMENDED_SUFFIX_RE.test(option.label)) return option.label
  return `${option.label} (recommended)`
}

function parseOptions(raw: unknown): AskQuestionOption[] {
  if (!Array.isArray(raw)) return []
  const out: AskQuestionOption[] = []
  for (const item of raw) {
    const o = asRecord(item)
    if (!o) continue
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const rawLabel = typeof o.label === 'string' ? o.label.trim() : ''
    if (!id || !rawLabel) continue
    const stripped = stripRecommendedSuffix(rawLabel)
    const recommended = o.recommended === true || stripped.recommended
    out.push({
      id,
      label: stripped.label,
      ...(recommended ? { recommended: true } : {}),
    })
  }
  return orderAskQuestionOptions(out)
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
