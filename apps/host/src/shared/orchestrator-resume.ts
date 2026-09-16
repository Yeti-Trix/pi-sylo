/**
 * After a crashed / empty parent turn, local orchestrators plan in the thinking
 * channel instead of calling the planner subagent. This wrapper is the host-side
 * force — the same reason `@planner` exists.
 */

export const ORCHESTRATOR_RESUME_TAG = 'sylo_orchestrator_resume'

const TRIVIAL_ACK =
  /^(thanks|thank you|thx|ok|okay|k|got it|cool|sure|yep|yeah|yes)\.?$/i

const RESUME_LIKE =
  /\b(continue|resume|keep going|pick up|did you finish|are you (done|finished)|finish (it|this|the work)|try again|try once more|use (the )?(planner|subagents?))\b/i

const SHORT_RESUME = /^(go on|and then\??|next\??|continue\??|resume\??)$/i

export function isTrivialAck(text: string): boolean {
  return TRIVIAL_ACK.test(text.trim())
}

export function isResumeLikeRequest(text: string): boolean {
  const t = text.trim()
  if (!t || isTrivialAck(t)) return false
  return RESUME_LIKE.test(t) || SHORT_RESUME.test(t)
}

export function lastAssistantLooksIncomplete(content: string, status?: string): boolean {
  if (status === 'failed') return true
  const c = content.trim()
  if (!c) return true
  return (
    /\(error\)/i.test(c) ||
    /Model returned no text/i.test(c) ||
    /never wrote a reply/i.test(c) ||
    /spent the turn thinking/i.test(c) ||
    /filled the model's context window/i.test(c) ||
    /hit its per-reply token cap/i.test(c) ||
    /completed without producing any text/i.test(c) ||
    /No reply text after the last step/i.test(c)
  )
}

export function shouldInjectOrchestratorResume(opts: {
  userText: string
  lastAssistantStatus?: string
  lastAssistantContent?: string
  conversationUsedSubagents: boolean
  alreadyForcedMention: boolean
}): boolean {
  if (opts.alreadyForcedMention) return false
  if (isTrivialAck(opts.userText)) return false
  const incomplete = lastAssistantLooksIncomplete(
    opts.lastAssistantContent ?? '',
    opts.lastAssistantStatus,
  )
  if (incomplete) return true
  return opts.conversationUsedSubagents && isResumeLikeRequest(opts.userText)
}

export const PLAN_SCOPE_TAG = 'sylo_plan_scope'

export type PlanScope = {
  /** Workspace-relative path to THIS chat's plan, or null when it has none. */
  planRel: string | null
  done: number
  total: number
  nextGoal?: string
}

/**
 * The section loop, stated for the orchestrator: one worker per unticked `##`
 * goal, and the reviewer only once every goal is ticked. Left to itself the
 * parent runs worker-once-then-reviewer and abandons the remaining sections.
 */
function planProgressDirectives(scope: PlanScope): string[] {
  if (!scope.planRel) {
    return [
      'This chat has no plan file. Do not read or execute any file in `.sylo/plans/` — those belong to other chats.',
    ]
  }
  const out = [
    `This chat's plan is \`${scope.planRel}\` (${scope.done}/${scope.total} goals done). Follow and tick only that file; other files in \`.sylo/plans/\` belong to other chats.`,
  ]
  if (scope.done >= scope.total && scope.total > 0) {
    out.push(
      'Every goal is ticked. Run `reviewer` once over all of the work, then report. Do not start new sections.',
    )
    return out
  }
  out.push(
    'Dispatch one `worker` per unticked `## [ ]` goal, in file order, and hand it that section only.',
    scope.nextGoal ? `The next section is "${scope.nextGoal}".` : '',
    'When that worker returns and the goal is ticked, immediately dispatch the next unticked section — keep going until none are left. Do NOT run `reviewer` until every goal is ticked, and do not stop after the first section.',
  )
  return out.filter(Boolean)
}

export function composePlanScopeNote(conversationId: string, scope: PlanScope): string {
  return [
    `<${PLAN_SCOPE_TAG}>`,
    `This conversation id is ${conversationId}.`,
    ...planProgressDirectives(scope),
    `</${PLAN_SCOPE_TAG}>`,
  ].join(' ')
}

export function composeOrchestratorResumePrompt(userText: string, scope?: PlanScope): string {
  const planDirective =
    scope?.planRel ?
      planProgressDirectives(scope).join(' ')
    : 'This chat has no plan file. Call `subagent` with agent "planner" (goal, constraints, and what already ran). Do not follow another conversation\'s plan.'
  const directives = [
    'You are the orchestrator, not the planner and not the worker.',
    'Do not write an implementation plan in this chat or in the thinking channel.',
    planDirective,
    'Then report the child output. Do not redo the plan yourself.',
  ]
  return [
    `<${ORCHESTRATOR_RESUME_TAG}>`,
    directives.join(' '),
    `</${ORCHESTRATOR_RESUME_TAG}>`,
    '',
    `<operator_request>\n${userText.trim()}\n</operator_request>`,
  ].join('\n')
}
