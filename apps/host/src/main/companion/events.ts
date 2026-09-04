export type CompanionEvent =
  | { channel: 'chat:refresh'; payload: { conversationId: string; kind: string } }
  | {
      channel: 'chat:stream'
      payload: { conversationId: string; messageId: string; delta: string }
    }
  | { channel: 'chat:tool'; payload: Record<string, unknown> }
  | { channel: 'broker:status'; payload: Record<string, unknown> }
  | { channel: 'broker:error'; payload: Record<string, unknown> }

type Listener = (event: CompanionEvent) => void

const listeners = new Set<Listener>()

export function emitCompanionEvent(event: CompanionEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (e) {
      console.error('[sylo companion] event listener error:', e)
    }
  }
}

export function subscribeCompanionEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
