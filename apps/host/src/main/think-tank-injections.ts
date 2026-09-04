/** In-memory operator injection queue per live think tank session (single-user host). */

const queues = new Map<string, string[]>()

export function queueThinkTankInjection(sessionId: string, text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return queues.get(sessionId)?.length ?? 0
  const next = [...(queues.get(sessionId) ?? []), trimmed]
  queues.set(sessionId, next)
  return next.length
}

export function pendingThinkTankInjectionCount(sessionId: string): number {
  return queues.get(sessionId)?.length ?? 0
}

export function drainThinkTankInjections(sessionId: string): string[] {
  const drained = queues.get(sessionId) ?? []
  queues.delete(sessionId)
  return drained
}

export function clearThinkTankInjections(sessionId: string): void {
  queues.delete(sessionId)
}
