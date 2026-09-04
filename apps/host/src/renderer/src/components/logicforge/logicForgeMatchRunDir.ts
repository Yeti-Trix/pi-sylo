import type { AssistantSegment } from '../../workflowTimeline'

/** Extract run_dir from a completed logicforge_match_report tool segment. */
export function logicForgeMatchRunDir(seg: AssistantSegment): string | null {
  if (seg.kind !== 'tool') return null
  if (seg.toolName !== 'logicforge_match_report') return null
  if (seg.isError || seg.endTs === null) return null

  const fromArgs = readRunDir(seg.args)
  if (fromArgs) return fromArgs

  return readRunDirFromPreview(seg.resultPreview)
}

function readRunDir(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = (value as Record<string, unknown>).run_dir
  if (typeof raw !== 'string' || !raw.trim()) return null
  return normalizeRunDir(raw.trim())
}

function readRunDirFromPreview(preview: unknown): string | null {
  if (preview == null) return null
  if (typeof preview === 'string') {
    try {
      return readRunDirFromPreview(JSON.parse(preview))
    } catch {
      const m = /run[_ ]?dir["':\s]+([^\s"']+)/i.exec(preview)
      return m?.[1] ? normalizeRunDir(m[1]) : null
    }
  }
  const direct = readRunDir(preview)
  if (direct) return direct
  if (typeof preview === 'object' && !Array.isArray(preview)) {
    const o = preview as Record<string, unknown>
    if (typeof o.text === 'string') {
      try {
        return readRunDirFromPreview(JSON.parse(o.text))
      } catch {
        /* ignore */
      }
    }
    if (Array.isArray(o.content)) {
      for (const block of o.content) {
        const hit = readRunDirFromPreview(block)
        if (hit) return hit
      }
    }
  }
  return null
}

function normalizeRunDir(raw: string): string {
  const trimmed = raw.trim().replace(/[/\\]+$/, '')
  if (trimmed.split(/[/\\]/).pop()?.toLowerCase() === 'parse') {
    return trimmed.replace(/[/\\]parse[/\\]?$/i, '')
  }
  return trimmed
}
