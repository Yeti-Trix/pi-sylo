/**
 * Conversation-scoped plan file. The planner's output is written to
 * `.sylo/plans/<conversationId>.md` so another chat in the same workspace
 * cannot pick it up. A leftover `current.md` is only a legacy pointer and is
 * never followed unless its conversation_id matches.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  ensureSectionGoals,
  isPlanFinished,
  parsePlanConversationId,
  parsePlanHidden,
  parsePlanStatus,
  planBodyWithoutFrontmatter,
  planGoalsComplete,
  tickPlanGoals,
  type PlanStatus,
} from './plan-checklist.ts'

export const PLAN_DIR_SEGMENTS = ['.sylo', 'plans'] as const
export const CURRENT_PLAN_NAME = 'current.md'

export function isPlannerAgentName(name: string): boolean {
  const n = name.trim().toLowerCase()
  return n === 'planner' || n.endsWith('-planner') || n.endsWith('_planner')
}

export function isReviewerAgentName(name: string): boolean {
  const n = name.trim().toLowerCase()
  return n === 'reviewer' || n.endsWith('-reviewer') || n.endsWith('_reviewer')
}

export function isSafePlanConversationId(id: string): boolean {
  const t = id.trim()
  return t.length > 0 && t !== 'current' && /^[A-Za-z0-9._-]+$/.test(t)
}

export function currentPlanAbs(cwd: string): string {
  return join(cwd, ...PLAN_DIR_SEGMENTS, CURRENT_PLAN_NAME)
}

export function currentPlanRel(): string {
  return [...PLAN_DIR_SEGMENTS, CURRENT_PLAN_NAME].join('/')
}

export function conversationPlanRel(conversationId: string): string {
  return [...PLAN_DIR_SEGMENTS, `${conversationId.trim()}.md`].join('/')
}

export function conversationPlanAbs(cwd: string, conversationId: string): string {
  return join(cwd, ...PLAN_DIR_SEGMENTS, `${conversationId.trim()}.md`)
}

function formatPlanDate(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd}-${d.getFullYear()}`
}

function ensurePlansDir(cwd: string): string {
  const dir = join(cwd, ...PLAN_DIR_SEGMENTS)
  mkdirSync(dir, { recursive: true })
  const ignore = join(dir, '.gitignore')
  if (!existsSync(ignore)) {
    writeFileSync(ignore, '*\n!.gitignore\n', 'utf8')
  }
  return dir
}

export function formatPlanFile(
  body: string,
  meta?: { conversationId?: string; status?: PlanStatus; hidden?: boolean },
): string {
  const lines = [
    '---',
    'source: planner',
    `updated: ${formatPlanDate()}`,
    `status: ${meta?.status ?? 'active'}`,
  ]
  if (meta?.hidden) lines.push('hidden: true')
  if (meta?.conversationId?.trim()) {
    lines.push(`conversation_id: ${meta.conversationId.trim()}`)
  }
  lines.push('---', '', body.trim(), '')
  return lines.join('\n')
}

function unlinkIfExists(abs: string): boolean {
  try {
    if (!existsSync(abs)) return false
    unlinkSync(abs)
    return true
  } catch {
    return false
  }
}

function readIfExists(abs: string): string | null {
  try {
    if (!existsSync(abs)) return null
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

function currentPlanOwner(cwd: string): string | undefined {
  const raw = readIfExists(currentPlanAbs(cwd))
  return raw ? parsePlanConversationId(raw) : undefined
}

/**
 * Write this conversation's plan. Does not write a workspace-global current.md.
 * Returns the workspace-relative path, or null when conversationId is missing.
 */
export function writeCurrentPlan(
  cwd: string,
  body: string,
  meta?: { conversationId?: string },
): string | null {
  const text = ensureSectionGoals(body.trim())
  const convId = meta?.conversationId?.trim() ?? ''
  if (!cwd.trim() || !text || !isSafePlanConversationId(convId)) return null
  try {
    ensurePlansDir(cwd)
    const abs = conversationPlanAbs(cwd, convId)
    writeFileSync(abs, formatPlanFile(text, { conversationId: convId }), 'utf8')
    unlinkIfExists(currentPlanAbs(cwd))
    try {
      return relative(cwd, abs).replace(/\\/g, '/')
    } catch {
      return conversationPlanRel(convId)
    }
  } catch {
    return null
  }
}

/**
 * Close goals a review passed. `goals` names the reviewed sections; `'all'` is a
 * whole-plan review. Returns true when the file changed.
 */
export function tickReviewedGoals(
  cwd: string,
  conversationId: string,
  goals: readonly string[] | 'all',
): boolean {
  if (!cwd.trim() || !isSafePlanConversationId(conversationId)) return false
  const convId = conversationId.trim()
  const abs = conversationPlanAbs(cwd, convId)
  const raw = readIfExists(abs)
  if (!raw) return false
  const next = tickPlanGoals(raw, goals)
  if (next === raw) return false
  try {
    writeFileSync(abs, next, 'utf8')
    return true
  } catch {
    return false
  }
}

/** Rewrite only the frontmatter, carrying over whatever the patch does not set. */
function rewritePlanMeta(
  cwd: string,
  conversationId: string,
  patch: { status?: PlanStatus; hidden?: boolean },
): boolean {
  if (!cwd.trim() || !isSafePlanConversationId(conversationId)) return false
  const convId = conversationId.trim()
  const abs = conversationPlanAbs(cwd, convId)
  const raw = readIfExists(abs)
  if (!raw) return false
  const status = patch.status ?? parsePlanStatus(raw)
  const hidden = patch.hidden ?? parsePlanHidden(raw)
  const next = formatPlanFile(planBodyWithoutFrontmatter(raw), {
    conversationId: convId,
    status,
    hidden,
  })
  if (next === raw) return false
  try {
    writeFileSync(abs, next, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Reviewer sign-off. The plan is NOT deleted here — the operator still needs to
 * see the finished goals above the composer. The next send hides it.
 *
 * A review that ran while goals are still open is not sign-off: the reviewer's own
 * verdict in that case is "incomplete". Badging the plan `reviewed` at 0/3 told the
 * operator the opposite, so the status only moves once every goal is ticked.
 */
export function markPlanReviewed(cwd: string, conversationId: string): boolean {
  const raw = readPlanMarkdown(cwd, conversationId)
  if (!raw || !planGoalsComplete(raw)) return false
  return rewritePlanMeta(cwd, conversationId, { status: 'reviewed' })
}

/**
 * Take a finished plan off the goals bar once the operator sends something new.
 *
 * The file stays on disk. Deleting it here meant a later "continue" — after a
 * crash, an End, or closing the app — had no goals left to bring back, and the
 * orchestrator lost the record of what had already passed review.
 */
export function hideFinishedPlan(cwd: string, conversationId: string): boolean {
  const raw = readPlanMarkdown(cwd, conversationId)
  if (!raw || !isPlanFinished(raw) || parsePlanHidden(raw)) return false
  return rewritePlanMeta(cwd, conversationId, { hidden: true })
}

/** Put this chat's plan back on the goals bar, ticks intact. */
export function restorePlan(cwd: string, conversationId: string): boolean {
  const raw = readPlanMarkdown(cwd, conversationId)
  if (!raw || !parsePlanHidden(raw)) return false
  return rewritePlanMeta(cwd, conversationId, { hidden: false })
}


/** Remove this conversation's plan. Without an id, only a leftover current.md. */
export function removeCurrentPlan(cwd: string, conversationId?: string): boolean {
  if (!cwd.trim()) return false
  let removed = false
  const convId = conversationId?.trim()
  if (convId && isSafePlanConversationId(convId)) {
    if (unlinkIfExists(conversationPlanAbs(cwd, convId))) removed = true
    const owner = currentPlanOwner(cwd)
    if (!owner || owner === convId) {
      if (unlinkIfExists(currentPlanAbs(cwd))) removed = true
    }
    return removed
  }
  return unlinkIfExists(currentPlanAbs(cwd))
}

/**
 * Drop a leftover workspace current.md when it does not belong to this chat.
 * Leaves `.sylo/plans/<otherConversation>.md` alone so that chat can resume.
 */
export function retractForeignCurrentPlan(cwd: string, conversationId: string): boolean {
  if (!cwd.trim() || !isSafePlanConversationId(conversationId)) return false
  const raw = readIfExists(currentPlanAbs(cwd))
  if (!raw) return false
  const owner = parsePlanConversationId(raw)
  if (owner === conversationId.trim()) return false
  return unlinkIfExists(currentPlanAbs(cwd))
}

/** This conversation's plan only. Never another chat's file. */
export function readPlanMarkdown(cwd: string, conversationId?: string): string | null {
  if (!cwd.trim()) return null
  const convId = conversationId?.trim()
  if (!convId || !isSafePlanConversationId(convId)) return null
  const scoped = readIfExists(conversationPlanAbs(cwd, convId))
  if (scoped) {
    const owner = parsePlanConversationId(scoped)
    if (owner && owner !== convId) return null
    return scoped
  }
  const current = readIfExists(currentPlanAbs(cwd))
  if (!current) return null
  const owner = parsePlanConversationId(current)
  return owner === convId ? current : null
}
