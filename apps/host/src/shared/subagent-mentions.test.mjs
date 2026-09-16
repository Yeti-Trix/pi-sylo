/**
 * Run: npm run test:subagent-mentions -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  applyMentionCompletion,
  composeForcedSubagentPrompt,
  mentionQueryAtCaret,
  mightCarryMention,
  parseSubagentMentions,
  parseSubagentMentionsInBody,
  resolveAgentMention,
  splitMentionSegments,
} from '../../out/test/subagent-mentions.mjs'

const AGENTS = ['planner', 'reviewer', 'scout', 'worker', 'plan-b']

/** Exactly what the composer sends once a file is staged (attachments go first). */
const ATTACHMENT_BLOCK = [
  'Attached local files (absolute paths on this machine; contents are not copied into the message—tools should read from disk, e.g. docparser):',
  'Use only the absolute paths in the list below. Pasted or dropped attachments may live under Sylo app data (e.g. …\\sylo-paste-images\\…) and are not copied into the project folder; do not search the working directory for generic names like image.png unless that exact path is listed.',
  '- C:\\tmp\\shot.png  (name: shot.png)',
].join('\n')

const withAttachment = (typed) => `${ATTACHMENT_BLOCK}\n\n---\n\n${typed}`

describe('resolveAgentMention', () => {
  test('matches exactly, case-insensitively', () => {
    assert.equal(resolveAgentMention('Planner', AGENTS), 'planner')
  })

  test('resolves a unique prefix so @plan reaches the planner', () => {
    assert.equal(resolveAgentMention('plann', AGENTS), 'planner')
    assert.equal(resolveAgentMention('rev', AGENTS), 'reviewer')
  })

  test('refuses an ambiguous prefix rather than guessing', () => {
    // 'plan' prefixes both 'planner' and 'plan-b'.
    assert.equal(resolveAgentMention('plan', AGENTS), null)
  })

  test('returns null for an unknown agent', () => {
    assert.equal(resolveAgentMention('nope', AGENTS), null)
  })
})

describe('parseSubagentMentions', () => {
  test('pulls a single leading mention off the request', () => {
    const parsed = parseSubagentMentions('@planner build a login page', AGENTS)
    assert.deepEqual(parsed.agents, ['planner'])
    assert.equal(parsed.task, 'build a login page')
  })

  test('keeps chain order and de-duplicates', () => {
    const parsed = parseSubagentMentions('@planner @worker @planner ship it', AGENTS)
    assert.deepEqual(parsed.agents, ['planner', 'worker'])
    assert.equal(parsed.task, 'ship it')
  })

  test('ignores mentions that are not leading', () => {
    const parsed = parseSubagentMentions('ask the @planner about this', AGENTS)
    assert.deepEqual(parsed.agents, [])
    assert.equal(parsed.task, 'ask the @planner about this')
  })

  test('leaves an unresolvable mention in the task text', () => {
    const parsed = parseSubagentMentions('@ghost do a thing', AGENTS)
    assert.deepEqual(parsed.agents, [])
    assert.equal(parsed.task, '@ghost do a thing')
  })

  test('stops consuming at the first unknown mention', () => {
    const parsed = parseSubagentMentions('@planner @ghost do a thing', AGENTS)
    assert.deepEqual(parsed.agents, ['planner'])
    assert.equal(parsed.task, '@ghost do a thing')
  })

  test('reports an empty task when only a mention was typed', () => {
    const parsed = parseSubagentMentions('@planner', AGENTS)
    assert.deepEqual(parsed.agents, ['planner'])
    assert.equal(parsed.task, '')
  })

  test('preserves newlines in the request body', () => {
    const parsed = parseSubagentMentions('@scout find the auth code\nand list the files', AGENTS)
    assert.deepEqual(parsed.agents, ['scout'])
    assert.equal(parsed.task, 'find the auth code\nand list the files')
  })
})

describe('mentionQueryAtCaret', () => {
  test('opens on a fresh @ at the start', () => {
    assert.deepEqual(mentionQueryAtCaret('@pl', 3), { query: 'pl', start: 0, end: 3 })
  })

  test('opens after whitespace', () => {
    const span = mentionQueryAtCaret('@planner @wor', 13)
    assert.deepEqual(span, { query: 'wor', start: 9, end: 13 })
  })

  test('opens on a bare @ so the full list shows', () => {
    assert.deepEqual(mentionQueryAtCaret('@', 1), { query: '', start: 0, end: 1 })
  })

  test('stays closed mid-word (emails, handles)', () => {
    assert.equal(mentionQueryAtCaret('me@example', 10), null)
  })

  test('stays closed once whitespace follows the token', () => {
    assert.equal(mentionQueryAtCaret('@planner do', 11), null)
  })

  test('spans the whole token when the caret sits inside it', () => {
    // Caret after '@plan' in '@planner review'. A caret-bounded span would
    // complete to '@plannerner review'.
    const span = mentionQueryAtCaret('@planner review', 5)
    assert.deepEqual(span, { query: 'plan', start: 0, end: 8 })
    assert.equal(applyMentionCompletion('@planner review', span, 'planner').text, '@planner review')
  })
})

describe('splitMentionSegments', () => {
  const seg = (text) => splitMentionSegments(text, AGENTS)

  test('marks a leading mention as forced', () => {
    assert.deepEqual(seg('@planner build it'), [
      { kind: 'mention', text: '@planner', agent: 'planner', forced: true },
      { kind: 'text', text: ' build it' },
    ])
  })

  test('marks every mention in the leading run as forced', () => {
    const parts = seg('@scout @worker ship it')
    assert.deepEqual(
      parts.filter((p) => p.kind === 'mention').map((p) => [p.agent, p.forced]),
      [
        ['scout', true],
        ['worker', true],
      ],
    )
  })

  test('mid-sentence mentions are references, not forced', () => {
    // The case that looks like it should invoke agents but does not.
    const parts = seg('we need to use @planner @worker and @reviewer to finish')
    assert.deepEqual(
      parts.filter((p) => p.kind === 'mention').map((p) => [p.agent, p.forced]),
      [
        ['planner', false],
        ['worker', false],
        ['reviewer', false],
      ],
    )
  })

  test('leaves unknown handles as plain text', () => {
    assert.deepEqual(seg('ping @nobody about it'), [{ kind: 'text', text: 'ping @nobody about it' }])
  })

  test('does not treat an email as a mention', () => {
    assert.deepEqual(seg('mail me@planner.com'), [{ kind: 'text', text: 'mail me@planner.com' }])
  })

  test('round-trips the original text exactly', () => {
    const input = '@planner do X\nthen ask @reviewer about me@x.com'
    assert.equal(
      seg(input)
        .map((p) => p.text)
        .join(''),
      input,
    )
  })

  test('returns nothing for empty input', () => {
    assert.deepEqual(seg(''), [])
  })
})

describe('mightCarryMention', () => {
  test('sees a mention typed behind a staged attachment', () => {
    assert.equal(mightCarryMention(withAttachment('@planner redesign it')), true)
  })

  test('is false for ordinary sends', () => {
    assert.equal(mightCarryMention('just a question'), false)
    assert.equal(mightCarryMention(withAttachment('what is this file?')), false)
  })
})

describe('parseSubagentMentionsInBody', () => {
  test('finds the mention a staged attachment pushed off the front', () => {
    const parsed = parseSubagentMentionsInBody(withAttachment('@planner redesign it'), AGENTS)
    assert.deepEqual(parsed.agents, ['planner'])
  })

  test('keeps the attachment paths in the task so the subagent can read them', () => {
    const parsed = parseSubagentMentionsInBody(withAttachment('@planner redesign it'), AGENTS)
    assert.match(parsed.task, /shot\.png/)
    assert.match(parsed.task, /redesign it$/)
    assert.doesNotMatch(parsed.task, /@planner/)
  })

  test('declines to force when the attachment carries no request', () => {
    const parsed = parseSubagentMentionsInBody(withAttachment('@planner'), AGENTS)
    assert.deepEqual(parsed.agents, [])
  })

  test('leaves an attachment-only send alone', () => {
    const body = withAttachment('summarize this')
    assert.deepEqual(parseSubagentMentionsInBody(body, AGENTS), { agents: [], task: body })
  })

  test('behaves like the plain parser with no attachment block', () => {
    const parsed = parseSubagentMentionsInBody('@scout @worker ship it', AGENTS)
    assert.deepEqual(parsed.agents, ['scout', 'worker'])
    assert.equal(parsed.task, 'ship it')
  })
})

describe('applyMentionCompletion', () => {
  test('replaces the partial token and leaves a trailing space', () => {
    const next = applyMentionCompletion('@pl', { start: 0, end: 3 }, 'planner')
    assert.equal(next.text, '@planner ')
    assert.equal(next.caret, 9)
  })

  test('keeps text after the caret intact without stacking spaces', () => {
    const next = applyMentionCompletion('@sc rest', { start: 0, end: 3 }, 'scout')
    assert.equal(next.text, '@scout rest')
    assert.equal(next.caret, 6)
  })
})

describe('composeForcedSubagentPrompt', () => {
  test('carries the output and forbids redoing the work', () => {
    const prompt = composeForcedSubagentPrompt({
      userText: 'build a login page',
      outcomes: [
        { agent: 'planner', model: 'ollama/qwen3', status: 'succeeded', output: '1. add route' },
      ],
    })
    assert.match(prompt, /<operator_request>\nbuild a login page\n<\/operator_request>/)
    assert.match(prompt, /agent="planner"/)
    assert.match(prompt, /model="ollama\/qwen3"/)
    assert.match(prompt, /1\. add route/)
    assert.match(prompt, /Do NOT redo it/)
  })

  test('calls out a failed step instead of hiding it', () => {
    const prompt = composeForcedSubagentPrompt({
      userText: 'ship it',
      outcomes: [{ agent: 'worker', status: 'failed', output: 'spawn ENOENT' }],
    })
    assert.match(prompt, /worker failed/)
  })

  test('substitutes a placeholder for empty output', () => {
    const prompt = composeForcedSubagentPrompt({
      userText: 'ship it',
      outcomes: [{ agent: 'scout', status: 'succeeded', output: '   ' }],
    })
    assert.match(prompt, /\(no output\)/)
  })
})
