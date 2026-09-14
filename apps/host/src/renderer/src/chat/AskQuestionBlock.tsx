import React, { useEffect, useMemo, useState } from 'react'

import {
  ASK_QUESTION_OTHER_ID,
  answersComplete,
  displayAskQuestionOptionLabel,
  parseAskQuestionAnswersFromResult,
  parseAskQuestionArgs,
  type AskQuestionAnswer,
  type AskQuestionOption,
  type AskQuestionSpec,
} from '../../../shared/ask-question'
import { cn } from '../lib/cn'
import {
  askQuestionBody,
  askQuestionCard,
  askQuestionFooter,
  askQuestionHead,
  askQuestionSummary,
  askQuestionOption,
  askQuestionOptionDisabled,
  askQuestionOptionSelected,
  askQuestionOptions,
  askQuestionOtherInput,
  askQuestionPrompt,
  btnPrimarySm,
  chatSegmentArgs,
  chatSegmentChevron,
  chatSegmentLabel,
  chatSegmentStatusBase,
  chatSegmentStatusErr,
  chatSegmentStatusOk,
  mutedText,
} from '../panels/ui-classes'
import type { AssistantSegment } from '../workflowTimeline'
import {
  clearAskQuestionPrompt,
  getAskQuestionPrompt,
  submitAskQuestion,
  subscribeAskQuestionPrompts,
} from './askQuestionClient'

const OTHER_LABEL = 'Other'

function emptyAnswers(questions: AskQuestionSpec[]): AskQuestionAnswer[] {
  return questions.map((q) => ({ id: q.id, selectedOptionIds: [] }))
}

function toggleSelection(
  current: string[],
  optionId: string,
  allowMultiple: boolean,
): string[] {
  if (allowMultiple) {
    return current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId]
  }
  return current.includes(optionId) && current.length === 1 ? [] : [optionId]
}

function optionLabel(question: AskQuestionSpec, optionId: string, otherText?: string): string {
  if (optionId === ASK_QUESTION_OTHER_ID) {
    const extra = otherText?.trim()
    return extra ? `${OTHER_LABEL}: ${extra}` : OTHER_LABEL
  }
  const option = question.options.find((o) => o.id === optionId)
  return option ? displayAskQuestionOptionLabel(option) : optionId
}

function visibleOptions(question: AskQuestionSpec): AskQuestionOption[] {
  const options = [...question.options]
  if (!options.some((o) => o.id === ASK_QUESTION_OTHER_ID)) {
    options.push({ id: ASK_QUESTION_OTHER_ID, label: OTHER_LABEL })
  }
  return options
}

function collapsedAnswerPreview(
  questions: AskQuestionSpec[],
  answers: AskQuestionAnswer[],
): string {
  const parts = questions.map((q) => {
    const answer = answers.find((a) => a.id === q.id)
    const selected = answer?.selectedOptionIds ?? []
    if (selected.length === 0) return null
    return selected.map((id) => optionLabel(q, id, answer?.otherText)).join(', ')
  })
  return parts.filter((p): p is string => !!p).join(' · ')
}

export function AskQuestionBlock({
  segment,
}: {
  segment: Extract<AssistantSegment, { kind: 'tool' }>
}): React.ReactElement | null {
  const parsed = useMemo(() => parseAskQuestionArgs(segment.args), [segment.args])
  const submitted = useMemo(
    () => parseAskQuestionAnswersFromResult(segment.resultPreview),
    [segment.resultPreview],
  )
  const toolCallId = segment.toolCallId ?? ''
  const waiting = segment.endTs === null
  const [, setTick] = useState(0)
  const [draft, setDraft] = useState<AskQuestionAnswer[]>(() =>
    parsed ? emptyAnswers(parsed.questions) : [],
  )
  const [localSubmitted, setLocalSubmitted] = useState<AskQuestionAnswer[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return subscribeAskQuestionPrompts(() => setTick((n) => n + 1))
  }, [])

  useEffect(() => {
    if (!parsed) return
    setDraft((prev) => {
      const byId = new Map(prev.map((a) => [a.id, a]))
      return parsed.questions.map(
        (q) => byId.get(q.id) ?? { id: q.id, selectedOptionIds: [] },
      )
    })
  }, [parsed])

  if (!parsed) return null

  const pending = toolCallId ? getAskQuestionPrompt(toolCallId) : undefined
  const title = pending?.title ?? parsed.title
  const questions = pending?.questions ?? parsed.questions
  const requestId = pending?.requestId
  const resolvedAnswers = submitted.length > 0 ? submitted : localSubmitted
  const readOnly = !waiting || resolvedAnswers != null
  const answers = resolvedAnswers ?? draft
  const canSubmit =
    waiting && !readOnly && !busy && answersComplete(questions, draft) && (!!requestId || !!toolCallId)

  const setAnswer = (questionId: string, next: Partial<AskQuestionAnswer>) => {
    setDraft((prev) =>
      prev.map((a) => (a.id === questionId ? { ...a, ...next } : a)),
    )
  }

  const onSubmit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const result = await submitAskQuestion({
      requestId,
      toolCallId,
      answers: draft,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setLocalSubmitted(draft)
    if (toolCallId) clearAskQuestionPrompt(toolCallId)
  }

  const heading = title?.trim() || (questions.length === 1 ? 'Question' : 'Questions')
  const preview = collapsedAnswerPreview(questions, answers)
  const statusLabel = segment.isError ? 'Cancelled' : 'Submitted'
  const form = (
    <>
      <div className={askQuestionBody}>
        {questions.map((q) => {
          const answer = answers.find((a) => a.id === q.id)
          const selected = answer?.selectedOptionIds ?? []
          const otherOn = selected.includes(ASK_QUESTION_OTHER_ID)
          const inputType = q.allow_multiple ? 'checkbox' : 'radio'
          const options = visibleOptions(q)
          return (
            <fieldset key={q.id} className="m-0 min-w-0 border-0 p-0">
              <legend className={askQuestionPrompt}>{q.prompt}</legend>
              <div className={askQuestionOptions} role={q.allow_multiple ? 'group' : 'radiogroup'}>
                {options.map((opt) => {
                  const isOn = selected.includes(opt.id)
                  return (
                    <label
                      key={opt.id}
                      className={cn(
                        askQuestionOption,
                        isOn && askQuestionOptionSelected,
                        readOnly && askQuestionOptionDisabled,
                      )}
                    >
                      <input
                        type={inputType}
                        name={`${segment.id}-${q.id}`}
                        className="mt-0.5 accent-[rgb(107_159_255)]"
                        checked={isOn}
                        disabled={readOnly}
                        onChange={() => {
                          if (readOnly) return
                          setAnswer(q.id, {
                            selectedOptionIds: toggleSelection(selected, opt.id, !!q.allow_multiple),
                          })
                        }}
                      />
                      <span>{displayAskQuestionOptionLabel(opt)}</span>
                    </label>
                  )
                })}
              </div>
              {otherOn ?
                readOnly ?
                  answer?.otherText?.trim() ?
                    <p className={cn(mutedText, 'm-0 mt-1.5 px-2 text-[0.82rem]')}>
                      {answer.otherText.trim()}
                    </p>
                  : null
                : <input
                    className={askQuestionOtherInput}
                    type="text"
                    value={answer?.otherText ?? ''}
                    placeholder="Type your answer"
                    onChange={(e) => setAnswer(q.id, { otherText: e.target.value })}
                  />
              : null}
              {readOnly && selected.length > 0 ?
                <p className={cn(mutedText, 'm-0 mt-1 text-[0.76rem]')}>
                  Selected: {selected.map((id) => optionLabel(q, id, answer?.otherText)).join(', ')}
                </p>
              : null}
            </fieldset>
          )
        })}
      </div>
      {waiting && !readOnly ?
        <div className={askQuestionFooter}>
          {error ? <span className="mr-auto text-[0.76rem] text-[rgb(255_152_152)]">{error}</span> : null}
          <button type="button" className={btnPrimarySm} disabled={!canSubmit} onClick={() => void onSubmit()}>
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      : null}
    </>
  )

  if (!readOnly) {
    return (
      <div className={askQuestionCard} data-ask-question="pending">
        <div className={askQuestionHead}>{heading}</div>
        {form}
      </div>
    )
  }

  return (
    <details className={askQuestionCard} data-ask-question="done">
      <summary className={askQuestionSummary}>
        <span className={chatSegmentLabel}>{heading}</span>
        <span className={chatSegmentArgs} title={preview}>
          {preview}
        </span>
        <span
          className={cn(
            chatSegmentStatusBase,
            segment.isError ? chatSegmentStatusErr : chatSegmentStatusOk,
          )}
        >
          {statusLabel}
        </span>
        <span className={chatSegmentChevron} aria-hidden="true" />
      </summary>
      {form}
    </details>
  )
}
