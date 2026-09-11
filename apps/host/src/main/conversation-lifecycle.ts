import { existsSync, unlinkSync } from 'node:fs'
import * as db from './database.js'
import type { ConversationRow } from './database.js'
import { absoluteSessionPathForConversation } from './sylo-session-paths.js'
import { deleteWebAccessImagesForConversation } from './web-access-images.js'
import { deleteTtsAudioForConversation } from './tts-audio.js'
import { deleteOwnedChatAttachmentsForConversation } from './chat-owned-attachments.js'
import { clearScheduledPromptLastConversationId } from './scheduled-prompts-db.js'
import { closeWorkspaceScheduleDb } from './workspace-db.js'

export const CONVERSATION_RETENTION_DAYS = 30
export const CONVERSATION_RETENTION_MS = CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000

function sessionFolderSegmentForWorkspace(workspaceId: string): string {
  const wid = workspaceId.trim() || db.defaultWorkspaceId()
  const ws = db.getWorkspace(wid)
  return ws?.path_segment?.trim() || ws?.id || '_inbox'
}

export function deletePiSessionFile(agentDir: string, row: ConversationRow): void {
  const wid = row.workspace_id?.trim() || db.defaultWorkspaceId()
  const segment = sessionFolderSegmentForWorkspace(wid)
  const sessionAbs = absoluteSessionPathForConversation(agentDir, row, segment)
  try {
    if (existsSync(sessionAbs)) unlinkSync(sessionAbs)
  } catch {
    /* best-effort */
  }
}

/** Remove SQLite row, Pi session jsonl, owned attachments, web-access images, and TTS artifacts for one chat. */
export function fullyRemoveConversation(
  userDataPath: string,
  agentDir: string,
  conversationId: string,
): boolean {
  const row = db.getConversation(conversationId)
  if (!row) return false
  // Attachments must be swept before messages are deleted (paths live in message text).
  deleteOwnedChatAttachmentsForConversation(userDataPath, conversationId)
  clearScheduledPromptLastConversationId(conversationId)
  deletePiSessionFile(agentDir, row)
  db.deleteConversation(conversationId)
  deleteWebAccessImagesForConversation(userDataPath, conversationId)
  deleteTtsAudioForConversation(userDataPath, conversationId)
  return true
}

/**
 * Delete a workspace and everything associated with it that lives *outside* the
 * workspace folder: all its conversations + messages, Pi session jsonl files
 * (under the agent dir), chat-owned attachments, web-access images, and TTS
 * audio, plus the per-conversation `agent_tasks` / `web_access` / `think_tank`
 * rows. The per-workspace scheduled-prompts DB and tasks JSON live *inside* the
 * workspace folder and ride with whatever the operator did with the folder
 * (kept or deleted); their cached schedule-DB connection is evicted here.
 *
 * Refuses to delete the last workspace or the primary workspace.
 * Returns false when the guard rejects the deletion.
 */
export function deleteWorkspaceFully(
  userDataPath: string,
  agentDir: string,
  workspaceId: string,
): boolean {
  const wid = workspaceId.trim()
  if (!wid) return false
  // Guard against deleting the last / primary workspace (mirrors the old
  // `deleteWorkspace` guard so the row-only delete can't be bypassed).
  const all = db.listWorkspaces()
  if (all.length <= 1) return false
  if (wid === db.defaultWorkspaceId()) return false

  const convs = db.listConversations(wid)
  const activeRaw = db.getPref('sylo.ui.active_conversation_id', '') as unknown
  const activeId = typeof activeRaw === 'string' ? activeRaw.trim() : ''

  for (const c of convs) {
    try {
      fullyRemoveConversation(userDataPath, agentDir, c.id)
    } catch (err) {
      console.warn('[sylo] deleteWorkspaceFully: failed to remove conversation', c.id, err)
    }
  }

  if (activeId && convs.some((c) => c.id === activeId)) {
    db.setPref('sylo.ui.active_conversation_id', '')
  }

  // Evict the cached per-workspace schedule-DB connection (the on-disk file lives
  // inside the workspace folder and may already be gone).
  closeWorkspaceScheduleDb(wid)

  return db.deleteWorkspaceRow(wid)
}

/**
 * Retention sweep (runs at startup): chats with no activity in the retention
 * window are ARCHIVED, not deleted — the transcript, messages, attachments
 * and session file all stay, the chat just leaves the sidebar main list
 * (Cursor-style archive, retrievable via the sidebar's Archived section).
 * Empty chats (zero messages) are still hard-deleted: there is nothing in
 * them to lose. Clears the active-chat pref if the active chat was archived.
 */
export function archiveStaleConversations(userDataPath: string, agentDir: string): { archivedIds: string[]; deletedIds: string[] } {
  const cutoff = Date.now() - CONVERSATION_RETENTION_MS
  const stale = db.listConversationsUpdatedBefore(cutoff)
  const archivedIds: string[] = []
  const deletedIds: string[] = []
  for (const row of stale) {
    try {
      if (db.conversationHasMessages(row.id)) {
        db.setConversationArchived(row.id, true)
        archivedIds.push(row.id)
      } else {
        // Empty chat — nothing to preserve.
        if (fullyRemoveConversation(userDataPath, agentDir, row.id)) deletedIds.push(row.id)
      }
    } catch (err) {
      console.warn('[sylo] archiveStaleConversations: failed to process conversation', row.id, err)
    }
  }
  const activeRaw = db.getPref('sylo.ui.active_conversation_id', '') as string
  const active = typeof activeRaw === 'string' ? activeRaw.trim() : ''
  if (active && archivedIds.includes(active)) {
    db.setPref('sylo.ui.active_conversation_id', '')
  }
  return { archivedIds, deletedIds }
}
