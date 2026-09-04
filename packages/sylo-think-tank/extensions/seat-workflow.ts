import type { Message } from '@earendil-works/pi-ai'

export type StampedWorkflowEntry = { ts: number; event: Record<string, unknown> }

function nextTs(cursor: { t: number }): number {
  cursor.t += 50
  return cursor.t
}

/** Map Pi `--mode json` NDJSON lines to workflow rows the Sylo chat UI understands. */
export function workflowEntryFromPiJsonLine(
  parsed: Record<string, unknown>,
  fallbackTs: number,
): StampedWorkflowEntry | null {
  const t = parsed.type
  if (typeof t !== 'string') return null
  const ts =
    typeof parsed.ts === 'number' ? parsed.ts
    : typeof parsed.timestamp === 'number' ? parsed.timestamp
    : fallbackTs

  switch (t) {
    case 'tool_execution_start':
    case 'tool_execution_end':
    case 'tool_execution_update':
    case 'thinking_start':
    case 'thinking_delta':
    case 'thinking_end':
    case 'text_delta':
      return { ts, event: parsed }
    case 'message_update': {
      const am = (parsed as { assistantMessageEvent?: Record<string, unknown> }).assistantMessageEvent
      if (!am || typeof am.type !== 'string') return null
      if (am.type === 'text_delta' && typeof am.delta === 'string') {
        return { ts, event: { type: 'text_delta', delta: am.delta } }
      }
      if (am.type === 'thinking_start' || am.type === 'thinking_end') {
        return {
          ts,
          event: {
            type: am.type,
            contentIndex: am.contentIndex ?? null,
          },
        }
      }
      if (am.type === 'thinking_delta' && typeof am.delta === 'string') {
        return {
          ts,
          event: {
            type: 'thinking_delta',
            contentIndex: am.contentIndex ?? null,
            delta: am.delta,
          },
        }
      }
      return null
    }
    default:
      return null
  }
}

function summarizeToolResult(result: unknown): unknown {
  if (result === null || result === undefined) return result
  if (typeof result === 'string') return result.slice(0, 8000)
  try {
    return JSON.parse(JSON.stringify(result))
  } catch {
    return String(result).slice(0, 8000)
  }
}

/** Build workflow rows from completed Pi messages when streaming events were sparse. */
export function workflowFromMessages(messages: Message[], baseTs: number): StampedWorkflowEntry[] {
  const out: StampedWorkflowEntry[] = []
  const cursor = { t: baseTs }
  const pendingTools = new Map<string, { toolName: string; args: unknown }>()

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const part of msg.content) {
        if (part.type === 'thinking') {
          const thinkingText = 'thinking' in part && typeof part.thinking === 'string' ? part.thinking : ''
          out.push({ ts: nextTs(cursor), event: { type: 'thinking_start' } })
          if (thinkingText) {
            out.push({ ts: nextTs(cursor), event: { type: 'thinking_delta', delta: thinkingText } })
          }
          out.push({ ts: nextTs(cursor), event: { type: 'thinking_end' } })
        } else if (part.type === 'toolCall') {
          const toolCallId = String(part.id ?? `tool-${out.length}`)
          const toolName = String(part.name ?? 'tool')
          pendingTools.set(toolCallId, { toolName, args: part.arguments })
          out.push({
            ts: nextTs(cursor),
            event: {
              type: 'tool_execution_start',
              toolCallId,
              toolName,
              args: part.arguments ?? {},
            },
          })
        }
      }
    }

    if (msg.role === 'toolResult') {
      const p = msg as { toolCallId?: string; content?: unknown; isError?: boolean; toolName?: string }
      const toolCallId = String(p.toolCallId ?? '')
      const pending = pendingTools.get(toolCallId)
      out.push({
        ts: nextTs(cursor),
        event: {
          type: 'tool_execution_end',
          toolCallId: toolCallId || `tool-${out.length}`,
          toolName: pending?.toolName ?? p.toolName ?? 'tool',
          isError: Boolean(p.isError),
          resultSummary: summarizeToolResult(p.content),
        },
      })
    }
  }

  return out
}

export function mergeWorkflowEntries(
  streamed: StampedWorkflowEntry[],
  fromMessages: StampedWorkflowEntry[],
): StampedWorkflowEntry[] {
  if (streamed.length === 0) return fromMessages
  if (fromMessages.length === 0) return streamed
  const seen = new Set<string>()
  const merged = [...streamed, ...fromMessages]
  const out: StampedWorkflowEntry[] = []
  for (const row of merged.sort((a, b) => a.ts - b.ts)) {
    const key = `${row.ts}:${JSON.stringify(row.event)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

const MAX_REASONING_TRACE_CHARS = 6000

/** Concatenate Pi thinking deltas from a seat workflow JSON blob. */
export function extractThinkingFromWorkflow(workflowJson?: string | null): string {
  if (!workflowJson) return ''
  try {
    const rows = JSON.parse(workflowJson) as Array<{ event?: { type?: string; delta?: string } }>
    const parts: string[] = []
    for (const row of rows) {
      if (row.event?.type === 'thinking_delta' && typeof row.event.delta === 'string') {
        parts.push(row.event.delta)
      }
    }
    return parts.join('').trim()
  } catch {
    return ''
  }
}

/** Cap prior reasoning injected into the next seat turn (context budget). */
export function capReasoningTrace(text: string, maxChars = MAX_REASONING_TRACE_CHARS): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const omitted = trimmed.length - maxChars
  return `…(${omitted} chars truncated from start)\n\n${trimmed.slice(-maxChars)}`
}
