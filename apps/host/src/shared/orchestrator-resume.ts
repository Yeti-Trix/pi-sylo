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

/**
 * Asking for the previous run's goals back, either by resuming ("continue",
 * "finish it") or by naming them ("show the plan", "bring the checkboxes back").
 * Sylo hides a finished plan on the next send; this is what un-hides it.
 */
const PLAN_NOUN = /\b(plan|goals?|checklist|checkboxe?s?)\b/i
const PLAN_RECALL_VERB =
  /\b(show|see|bring|put|restore|re-?open|display|finish|complete|get back to)\b/i

export function isPlanRestoreRequest(text: string): boolean {
  const t = text.trim()
  if (!t || isTrivialAck(t)) return false
  if (isResumeLikeRequest(t)) return true
  // Either order: "show the goals", "put the checkboxes back up".
  return PLAN_NOUN.test(t) && PLAN_RECALL_VERB.test(t)
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
  /** Goals a reviewer has passed. */
  done: number
  total: number
  /** Goals a worker built that no reviewer has judged yet. */
  built?: number
  /** First section still needing a worker. */
  nextGoal?: string
  /** First built section still needing a review. */
  nextReview?: string
  /** On disk but off the goals bar: the operator moved on after it finished. */
  hidden?: boolean
}

/**
 * The section loop, stated for the orchestrator: one full stack per unticked `##`
 * goal, ending in the review that closes it. Left to itself the parent runs
 * worker-once-then-reviewer and abandons the remaining sections.
 */
function planProgressDirectives(scope: PlanScope): string[] {
  if (!scope.planRel) {
    return [
      'This chat has no plan file. Do not read or execute any file in `.sylo/plans/` — those belong to other chats.',
    ]
  }
  if (scope.hidden) {
    return [
      `This chat has a finished plan at \`${scope.planRel}\` (${scope.done}/${scope.total} goals done) from earlier work. The operator has moved past it, so it is off their goals bar. Treat the request above as new work and do NOT re-run those goals. If the operator asks to continue that plan, Sylo puts it back and reports its progress here.`,
    ]
  }
  const built = scope.built ?? 0
  const out = [
    `This chat's plan is \`${scope.planRel}\`: ${scope.done}/${scope.total} goals passed review${built > 0 ? `, ${built} built and awaiting review` : ''}. Follow only that file; other files in \`.sylo/plans/\` belong to other chats.`,
    'Never edit the plan file yourself. Sylo marks a section `## [~]` when its `worker` finishes and `## [x]` when a `reviewer` replies `VERDICT: PASS`. Pass `goal` (the exact `##` heading text) on every subagent step so it lands on the right section.',
  ]
  if (scope.done >= scope.total && scope.total > 0) {
    out.push('Every goal has passed review. Report the results. Do not start new sections.')
    return out
  }
  if (scope.nextReview) {
    out.push(
      `"${scope.nextReview}" is built but unreviewed — run a \`reviewer\` on it now, before any further building. Its reply must end with \`VERDICT: PASS\` or \`VERDICT: FAIL\`; without that line the section stays open and the review is wasted.`,
    )
  }
  out.push(
    'Work the sections one at a time in file order, each as its own run: `worker` to build it, then a `reviewer` on that same section. Do not start the next section until the current one has passed.',
    scope.nextGoal ? `The next section needing work is "${scope.nextGoal}".` : '',
    'A failed review reopens that section — send it straight back to a `worker` with the findings and review it again. Do not move past a failed section, do not stop after the first one, and do not re-dispatch a goal that is already `## [x]`.',
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

/**
 * Nudge a turn that has to pick up after a failed, empty, or cut-off one.
 *
 * This exists to stop the parent stalling — burning the turn drafting a plan in the
 * thinking channel and writing no answer. It is NOT a standing order to delegate: a
 * plan-driven chat gets the section protocol, but a chat with no plan is told to finish
 * the request, delegating only if the work is actually big enough to warrant it.
 * Demanding a `planner` here meant any follow-up after an error spawned subagents.
 */
export function composeOrchestratorResumePrompt(userText: string, scope?: PlanScope): string {
  const directives =
    scope?.planRel ?
      [
        'You are the orchestrator, not the planner and not the worker.',
        'Do not write an implementation plan in this chat or in the thinking channel.',
        planProgressDirectives(scope).join(' '),
        'Then report the child output. Do not redo the plan yourself.',
      ]
    : [
        'The previous turn did not finish. Pick that work up and complete the operator request above.',
        'Judge for yourself whether it needs subagents: answer it directly when you can, and delegate only when the work genuinely calls for it (several files or several steps, isolation, or the operator asked for a plan). A resumed turn does not need a plan just because it was resumed.',
        'If it does warrant a plan, call `subagent` with agent "planner" (goal, constraints, and what already ran) instead of writing the plan here — do not spend this turn planning in the thinking channel. Do not follow another conversation\'s plan.',
        'Report what you did, and where a subagent ran, report its output rather than redoing the work.',
      ]
  return [
    `<${ORCHESTRATOR_RESUME_TAG}>`,
    directives.join(' '),
    `</${ORCHESTRATOR_RESUME_TAG}>`,
    '',
    `<operator_request>\n${userText.trim()}\n</operator_request>`,
  ].join('\n')
}
