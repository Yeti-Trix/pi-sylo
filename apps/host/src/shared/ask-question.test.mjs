/**
 * Run: npm run test:ask-question -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ASK_QUESTION_OTHER_ID,
  answersComplete,
  parseAskQuestionArgs,
} from '../../out/test/ask-question.mjs'

describe('parseAskQuestionArgs', () => {
  test('accepts a batched Cursor-style payload', () => {
    const parsed = parseAskQuestionArgs({
      title: 'Next step',
      questions: [
        {
          id: 'q1',
          prompt: 'Approach?',
          options: [
            { id: 'a', label: 'Small fix' },
            { id: 'b', label: 'Refactor' },
          ],
        },
        {
          id: 'q2',
          prompt: 'Tests?',
          options: [
            { id: 'yes', label: 'Add tests' },
            { id: 'no', label: 'Skip tests' },
          ],
          allow_multiple: false,
        },
      ],
    })
    assert.ok(parsed)
    assert.equal(parsed.title, 'Next step')
    assert.equal(parsed.questions.length, 2)
    assert.equal(parsed.questions[0].options.length, 2)
  })

  test('rejects a question with fewer than two options', () => {
    const parsed = parseAskQuestionArgs({
      questions: [{ id: 'q1', prompt: 'Only one', options: [{ id: 'a', label: 'A' }] }],
    })
    assert.equal(parsed, null)
  })
})

describe('answersComplete', () => {
  const questions = [
    {
      id: 'q1',
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
  ]

  test('requires Other text when Other is selected', () => {
    assert.equal(
      answersComplete(questions, [{ id: 'q1', selectedOptionIds: [ASK_QUESTION_OTHER_ID] }]),
      false,
    )
    assert.equal(
      answersComplete(questions, [
        { id: 'q1', selectedOptionIds: [ASK_QUESTION_OTHER_ID], otherText: 'custom' },
      ]),
      true,
    )
  })
})
