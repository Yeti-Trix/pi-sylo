/**
 * Forced subagent invocation via `@agent` mentions in the composer.
 *
 * The `subagent` tool already lets the orchestrator delegate on its own
 * judgment. A mention is the operator overriding that judgment: the named
 * agents run *before* the orchestrator sees the turn, so a pinned planner model
 * does the planning even when the chat model would rather do it itself.
 */

import {
  TEXT_AFTER_ATTACHMENTS_SEP,
  USER_ATTACHMENT_PREAMBLE,
} from './chat-user-attachment-prompt.js'

/** Matches one `@name` token. Names come from agent frontmatter, so allow `.`/`-`/`_`. */
const MENTION_TOKEN = /^@([A-Za-z0-9][A-Za-z0-9._-]*)/

export type SubagentRunOutcome = {
  agent: string
  /** Provider/id the child was spawned with, for the transcript note. */
  model?: string
  status: 'succeeded' | 'failed' | 'cancelled'
  output: string
}

export type ParsedSubagentMentions = {
  /** Resolved agent names to run, in mention order. Empty means "normal send". */
  agents: string[]
  /** The request left after stripping the leading mention run. */
  task: string
}

/**
 * Resolve a mention to a real agent name: exact match first (case-insensitive),
 * then a unique prefix so `@plan` reaches `planner` without the operator having
 * to type the whole persona name.
 */
export function resolveAgentMention(token: string, knownAgents: readonly string[]): string | null {
  const needle = token.trim().toLowerCase()
  if (!needle) return null
  const exact = knownAgents.find((a) => a.toLowerCase() === needle)
  if (exact) return exact
  const prefixed = knownAgents.filter((a) => a.toLowerCase().startsWith(needle))
  return prefixed.length === 1 ? prefixed[0]! : null
}

/**
 * Parse the *leading* run of `@agent` mentions off a composer message.
 *
 * Only leading mentions force a run — an `@` further into the prose is almost
 * always the operator talking about an agent rather than invoking one, and
 * silently spawning a child for that would be worse than ignoring it. An
 * unresolvable mention stops parsing and stays in the task text.
 */
export function parseSubagentMentions(
  text: string,
  knownAgents: readonly string[],
): ParsedSubagentMentions {
  const agents: string[] = []
  let rest = text.replace(/^\s+/, '')

  for (;;) {
    const match = MENTION_TOKEN.exec(rest)
    if (!match) break
    const resolved = resolveAgentMention(match[1]!, knownAgents)
    if (!resolved) break
    if (!agents.includes(resolved)) agents.push(resolved)
    rest = rest.slice(match[0].length).replace(/^[ \t]+/, '')
  }

  if (agents.length === 0) return { agents: [], task: text }
  return { agents, task: rest.trim() }
}

/**
 * Split a composer body into its staged-attachment block and the typed prose.
 *
 * The composer puts attachment paths *before* the operator's message, so a
 * mention typed at the start of the message is no longer at the start of the
 * body. Parsing the raw body means staging any file or image silently turns a
 * forced `@agent` send back into an ordinary one.
 */
function splitAttachmentBlock(body: string): { block: string; prose: string } {
  if (!body.startsWith(USER_ATTACHMENT_PREAMBLE)) return { block: '', prose: body }
  const idx = body.indexOf(TEXT_AFTER_ATTACHMENTS_SEP)
  if (idx < 0) return { block: body, prose: '' }
  return {
    block: body.slice(0, idx),
    prose: body.slice(idx + TEXT_AFTER_ATTACHMENTS_SEP.length),
  }
}

/**
 * Cheap pre-check before paying for a persona listing on every send.
 * Attachment-aware, so it agrees with `parseSubagentMentionsInBody`.
 */
export function mightCarryMention(body: string): boolean {
  return splitAttachmentBlock(body).prose.trimStart().startsWith('@')
}

/**
 * Mentions in a full composer body, keeping any attachment block in the task.
 *
 * Subagents need the staged paths as much as the chat model does — `@planner
 * review this` with a file attached is useless to the planner if the paths are
 * stripped — so the block is carried into the task rather than discarded.
 */
export function parseSubagentMentionsInBody(
  body: string,
  knownAgents: readonly string[],
): ParsedSubagentMentions {
  const { block, prose } = splitAttachmentBlock(body)
  if (!block) return parseSubagentMentions(body, knownAgents)
  const parsed = parseSubagentMentions(prose, knownAgents)
  // No resolvable mention, or a mention with nothing asked of it, is a normal send.
  if (parsed.agents.length === 0 || !parsed.task) return { agents: [], task: body }
  return {
    agents: parsed.agents,
    task: `${block}${TEXT_AFTER_ATTACHMENTS_SEP}${parsed.task}`,
  }
}

export type MentionSegment =
  | { kind: 'text'; text: string }
  | {
      kind: 'mention'
      /** As the operator typed it, e.g. `@plan` for a prefix match. */
      text: string
      /** Resolved persona name. */
      agent: string
      /** True only for the leading run — the mentions that actually forced a run. */
      forced: boolean
    }

/**
 * Split a message into plain text and `@agent` runs so the transcript can draw
 * mentions as chips instead of bare prose.
 *
 * Resolution matches `parseSubagentMentions` exactly, so what gets highlighted
 * is precisely what Sylo recognized — an unknown `@handle` stays plain text
 * rather than looking like an agent that failed to run. `forced` marks the
 * leading run, because only those invoke anything: naming agents mid-sentence
 * is a reference, and styling both identically would imply otherwise.
 */
export function splitMentionSegments(
  text: string,
  knownAgents: readonly string[],
): MentionSegment[] {
  const segments: MentionSegment[] = []
  let pending = ''
  let leading = true
  let i = 0

  const flush = (): void => {
    if (pending) {
      segments.push({ kind: 'text', text: pending })
      pending = ''
    }
  }

  while (i < text.length) {
    const char = text[i]!
    const atBoundary = i === 0 || /\s/.test(text[i - 1]!)
    if (char === '@' && atBoundary) {
      const match = MENTION_TOKEN.exec(text.slice(i))
      const resolved = match ? resolveAgentMention(match[1]!, knownAgents) : null
      if (match && resolved) {
        flush()
        segments.push({ kind: 'mention', text: match[0], agent: resolved, forced: leading })
        i += match[0].length
        continue
      }
    }
    // Whitespace keeps the leading run alive; anything else ends it.
    if (!/\s/.test(char)) leading = false
    pending += char
    i += 1
  }

  flush()
  return segments
}

/**
 * The `@`-token being typed at the caret, for the composer's autocomplete.
 * Returns null unless the caret sits inside a mention that starts a line or
 * follows whitespace, so emails and `foo@bar` never open the picker.
 */
export function mentionQueryAtCaret(
  text: string,
  caret: number,
): { query: string; start: number; end: number } | null {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null
  const query = upto.slice(at + 1)
  if (/[\s@]/.test(query)) return null
  if (query && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(query)) return null
  // Accepting must replace the whole token, not just the part left of the
  // caret: completing `@plan|ner` against a caret-bounded span yields
  // `@plannerner`. `query` stays caret-bounded so filtering follows typing.
  const rest = /^[A-Za-z0-9._-]*/.exec(text.slice(caret))?.[0] ?? ''
  return { query, start: at, end: caret + rest.length }
}

/** Replace the mention token at `start..end` with `@name `, returning text + new caret. */
export function applyMentionCompletion(
  text: string,
  span: { start: number; end: number },
  agentName: string,
): { text: string; caret: number } {
  const tail = text.slice(span.end)
  // Chaining mentions needs a separator, but don't stack one on a space the
  // operator already typed.
  const insert = /^\s/.test(tail) ? `@${agentName}` : `@${agentName} `
  return {
    text: text.slice(0, span.start) + insert + tail,
    caret: span.start + insert.length,
  }
}

function labelFor(outcome: SubagentRunOutcome): string {
  return outcome.model ? `${outcome.agent} (${outcome.model})` : outcome.agent
}

/**
 * Transcript note between the operator's message and the assistant reply.
 *
 * Plain text, not markdown: role=system rows that are not a compaction payload
 * render as a raw-text notice card.
 */
export function formatForcedSubagentNotice(agents: readonly string[]): string {
  const list = agents.map((a) => `@${a}`).join(' → ')
  const plural = agents.length === 1 ? 'this subagent' : 'these subagents'
  return `Forced subagent run: ${list}. The operator routed this turn to ${plural} with an @mention, so the pinned model does the work instead of the chat model deciding for itself.`
}

/**
 * The text actually sent to Pi after the forced run.
 *
 * The operator's raw message is what gets persisted as the user row; this
 * carries the subagent output so the orchestrator consumes the work rather than
 * repeating it — the exact failure that made `@mention` necessary.
 */
export function composeForcedSubagentPrompt(opts: {
  userText: string
  outcomes: readonly SubagentRunOutcome[]
}): string {
  const { userText, outcomes } = opts
  const blocks = outcomes.map((o) => {
    const attrs = [`agent="${o.agent}"`, o.model ? `model="${o.model}"` : '', `status="${o.status}"`]
      .filter(Boolean)
      .join(' ')
    return `<subagent_output ${attrs}>\n${o.output.trim() || '(no output)'}\n</subagent_output>`
  })

  const names = outcomes.map((o) => labelFor(o)).join(', ')
  const failed = outcomes.filter((o) => o.status !== 'succeeded')

  const directives = [
    `The operator forced this turn through ${outcomes.length === 1 ? 'subagent' : 'subagents'} ${names} using an \`@\` mention.`,
    'That work is already done — the output above is authoritative. Do NOT redo it, re-plan it, or call the `subagent` tool to repeat it.',
    'Report the results to the operator and act on them only as far as their request asks.',
  ]
  if (failed.length > 0) {
    directives.push(
      `Note: ${failed.map((o) => `${o.agent} ${o.status}`).join(', ')} — say so plainly instead of silently substituting your own work.`,
    )
  }

  return [
    `<operator_request>\n${userText.trim()}\n</operator_request>`,
    blocks.join('\n\n'),
    directives.join(' '),
  ].join('\n\n')
}
