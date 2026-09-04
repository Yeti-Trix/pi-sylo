import { join, relative } from 'node:path'
import type { ConversationRow } from './database.js'

/** Relative path from Pi agent dir to the default session file for this chat. */
export function defaultPiSessionRelPath(conversationId: string, sessionFolderSegment: string): string {
  const seg = (sessionFolderSegment || '_inbox').trim()
  return join('sessions', 'sylo', seg, `${conversationId}.jsonl`).replace(/\\/g, '/')
}

/** Absolute session path for DB row (uses override after fork if present). */
export function absoluteSessionPathForConversation(
  agentDirAbs: string,
  row: Pick<ConversationRow, 'id' | 'pi_session_relpath'>,
  sessionFolderSegment: string,
): string {
  const rel = row.pi_session_relpath?.trim() || defaultPiSessionRelPath(row.id, sessionFolderSegment)
  return join(agentDirAbs, rel)
}

export function relativeSessionPathFromAbsolute(agentDirAbs: string, sessionFileAbs: string): string {
  return relative(agentDirAbs, sessionFileAbs).replace(/\\/g, '/')
}
