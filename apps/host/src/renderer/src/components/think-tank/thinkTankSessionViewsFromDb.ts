/** Map SQLite think tank session rows to timeline metadata. */
export function thinkTankSessionViewsFromDb(
  sessions: Array<Record<string, unknown>>,
): import('./buildChatTimeline').ThinkTankSessionView[] {
  return sessions
    .map((session) => {
      const sessionId = String(session.id ?? '').trim()
      if (!sessionId) return null
      return {
        sessionId,
        topic: String(session.topic ?? '(think tank)'),
        status: String(session.status ?? 'debating'),
        sourceMessageId:
          typeof session.source_message_id === 'string' ? session.source_message_id
          : session.source_message_id ? String(session.source_message_id)
          : null,
        createdAt: Number(session.created_at ?? Date.now()),
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
}
