/**
 * sylo_ask_question — Cursor-style multiple-choice questions in chat.
 * The tool blocks until the operator selects answers and hits Submit.
 */
import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { waitForAskQuestionAnswers, type AskQuestionAnswer, type AskQuestionSpec } from './sylo-host.ts'

const OTHER_ID = 'other'

function toolText(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined }
}

function normalizeQuestions(raw: unknown): AskQuestionSpec[] {
  if (!Array.isArray(raw)) return []
  const out: AskQuestionSpec[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : ''
    const prompt = typeof q.prompt === 'string' && q.prompt.trim() ? q.prompt.trim() : ''
    if (!id || !prompt) continue
    const options: { id: string; label: string; recommended?: boolean }[] = []
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        if (!opt || typeof opt !== 'object') continue
        const o = opt as Record<string, unknown>
        const oid = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : ''
        const rawLabel = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : ''
        if (!oid || !rawLabel) continue
        const recommendedMark = /\s*\(\s*recommended\s*\)\s*$/i.exec(rawLabel)
        const label = recommendedMark ? rawLabel.slice(0, recommendedMark.index).trim() : rawLabel
        const recommended = o.recommended === true || !!recommendedMark
        options.push({ id: oid, label, ...(recommended ? { recommended: true } : {}) })
      }
    }
    if (options.length < 2) continue
    const recommended = options.filter((o) => o.recommended)
    const rest = options.filter((o) => !o.recommended)
    const ordered = recommended.length > 0 ? [...recommended, ...rest] : options
    out.push({
      id,
      prompt,
      options: ordered,
      allow_multiple: q.allow_multiple === true,
    })
  }
  return out
}

function formatAnswers(questions: AskQuestionSpec[], answers: AskQuestionAnswer[]): string {
  const byId = new Map(answers.map((a) => [a.id, a]))
  const lines: string[] = ['Operator answers:']
  for (const q of questions) {
    const a = byId.get(q.id)
    if (!a || a.selectedOptionIds.length === 0) {
      lines.push(`- ${q.prompt}: (no answer)`)
      continue
    }
    const labels = a.selectedOptionIds.map((oid) => {
      if (oid === OTHER_ID) {
        const extra = a.otherText?.trim()
        return extra ? `Other: ${extra}` : 'Other'
      }
      return q.options.find((o) => o.id === oid)?.label ?? oid
    })
    lines.push(`- ${q.prompt}: ${labels.join('; ')}`)
  }
  return lines.join('\n')
}

export default function syloAskQuestionExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'sylo_ask_question',
    label: 'Ask question',
    description:
      'Ask the operator one or more multiple-choice questions in chat and wait for Submit. ' +
      'Prefer one call with every question you need now — do not ask them one at a time. ' +
      'Use this instead of listing options in prose. Each question needs at least two options. ' +
      'When you have a recommendation, put that option first and set recommended: true (the UI adds "(recommended)"). ' +
      'Omit recommended when you are genuinely neutral. The operator can always pick Other.',
    promptSnippet:
      'sylo_ask_question({ title?, questions: [{ id, prompt, options: [{id,label,recommended?}], allow_multiple? }] }) — ' +
      'ask multiple-choice questions in chat and block until the operator submits. ' +
      'Put every question you need in one call. If you have a preference, first option + recommended: true.',
    promptGuidelines: [
      'When you need a decision, preference, or clarification with a finite set of options, call sylo_ask_question instead of listing choices in your reply.',
      'If you have more than one question, ask them all in a single sylo_ask_question call. Do not serialize questions across turns.',
      'When you have a recommendation, put that option first and set recommended: true on it. Do not write "(recommended)" in the label — the UI adds that. When you are genuinely unsure or neutral, omit recommended.',
      'Write option labels as complete, human-readable answers. Give each question and option a stable id.',
      'Do not repeat the same questions as markdown after calling the tool — the chat UI already shows them.',
    ],
    parameters: Type.Object({
      title: Type.Optional(
        Type.String({ description: 'Optional short heading shown above the question card.' }),
      ),
      questions: Type.Array(
        Type.Object({
          id: Type.String({ description: 'Stable id for this question (returned with the answer).' }),
          prompt: Type.String({ description: 'The question to show the operator.' }),
          options: Type.Array(
            Type.Object({
              id: Type.String({ description: 'Stable option id.' }),
              label: Type.String({
                description: 'Human-readable choice. Do not include "(recommended)" here.',
              }),
              recommended: Type.Optional(
                Type.Boolean({
                  description:
                    'True on the option you recommend. Put that option first. Omit when you have no preference.',
                }),
              ),
            }),
            { minItems: 2, description: 'At least two choices. The UI also adds Other.' },
          ),
          allow_multiple: Type.Optional(
            Type.Boolean({
              description: 'When true, the operator can select more than one option (checkboxes).',
            }),
          ),
        }),
        { minItems: 1, description: 'One or more questions. Prefer asking several at once.' },
      ),
    }),
    async execute(toolCallId, params, signal) {
      const questions = normalizeQuestions(params.questions)
      if (questions.length === 0) {
        return toolText(
          'sylo_ask_question failed: need at least one question with id, prompt, and two options.',
        )
      }
      const title = typeof params.title === 'string' ? params.title.trim() : ''
      const result = await waitForAskQuestionAnswers(
        {
          toolCallId,
          ...(title ? { title } : {}),
          questions,
        },
        signal,
      )
      if (!result.ok) {
        return { content: [{ type: 'text', text: result.error }], details: { cancelled: true } }
      }
      return {
        content: [{ type: 'text', text: formatAnswers(questions, result.answers) }],
        details: { answers: result.answers },
      }
    },
  })
}
