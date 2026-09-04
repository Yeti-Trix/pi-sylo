import { randomUUID } from 'node:crypto'

export type CanvasPopoutSnapshot = {
  kind: 'svg' | 'mermaid' | 'markdown'
  title?: string
  content?: string
  filePath?: string
  sourcePath?: string
  toolCallId?: string
}

const store = new Map<string, CanvasPopoutSnapshot>()

export function normalizeCanvasPopoutSnapshot(raw: unknown): CanvasPopoutSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = o.kind
  if (kind !== 'svg' && kind !== 'mermaid' && kind !== 'markdown') return null
  const title = typeof o.title === 'string' ? o.title : undefined
  const content = typeof o.content === 'string' ? o.content : undefined
  const filePath = typeof o.filePath === 'string' ? o.filePath.trim() : undefined
  const sourcePath = typeof o.sourcePath === 'string' ? o.sourcePath.trim() : undefined
  const toolCallId = typeof o.toolCallId === 'string' ? o.toolCallId : undefined
  const hasContent = content !== undefined && content.trim().length > 0
  const hasFile = filePath !== undefined && filePath.length > 0

  if (kind === 'mermaid') {
    if (!hasContent) return null
    return { kind, title, content, toolCallId }
  }

  if (kind === 'markdown') {
    // Main process reads `filePath` into `content` before stashing, so a valid
    // markdown snapshot always carries `content`. `sourcePath` is optional and
    // only used for header affordances.
    if (!hasContent) return null
    return {
      kind,
      title,
      content,
      ...(sourcePath ? { sourcePath } : {}),
      toolCallId,
    }
  }

  // svg
  if (hasContent === hasFile) return null
  return {
    kind,
    title,
    ...(hasContent ? { content } : {}),
    ...(hasFile ? { filePath } : {}),
    toolCallId,
  }
}

export function stashCanvasPopout(snapshot: CanvasPopoutSnapshot): string {
  const id = randomUUID()
  store.set(id, snapshot)
  return id
}

export function peekCanvasPopout(id: string): CanvasPopoutSnapshot | null {
  const key = id.trim()
  if (!key) return null
  return store.get(key) ?? null
}