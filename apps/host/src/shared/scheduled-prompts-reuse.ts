import type { ScheduledPromptRow } from './scheduled-prompts-types.js'

/**
 * A conversation row as seen by the reuse decision — only the flags the decision
 * needs. `undefined` means the pointed-at conversation no longer exists.
 */
export type ScheduleReuseCandidate =
  | { archived_at?: number | null; workspace_id: string | null }
  | undefined

/**
 * Decide whether a scheduled fire should reuse the schedule's last conversation.
 *
 * Reuse only when all of these hold:
 * - the schedule's chat mode is "continue in same chat" (`reuse_conversation === 1`),
 * - a `last_conversation_id` pointer exists (maintained on every run, regardless of mode),
 * - the pointed-at conversation still exists, is not archived, and still belongs to
 *   the schedule's workspace.
 *
 * Self-healing: any miss (first run, deleted chat, archived chat, cross-workspace
 * move, mode off) returns `false` and the caller creates a new conversation, which
 * becomes the new target via the run-recording pointer write.
 */
export function shouldReuseScheduleConversation(
  schedule: Pick<
    ScheduledPromptRow,
    'reuse_conversation' | 'last_conversation_id' | 'workspace_id'
  >,
  candidate: ScheduleReuseCandidate,
): boolean {
  if (schedule.reuse_conversation !== 1) return false
  const pointer = (schedule.last_conversation_id ?? '').trim()
  if (!pointer) return false
  if (!candidate) return false
  if (candidate.archived_at != null) return false
  if ((candidate.workspace_id ?? '') !== (schedule.workspace_id ?? '')) return false
  return true
}