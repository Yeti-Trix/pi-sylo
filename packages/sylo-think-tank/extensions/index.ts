import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { TextContent, ImageContent } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

type ToolContentBlock = TextContent | ImageContent

import {
  getThinkTankStatus,
  runThinkTankSession,
} from './debate-engine.ts'
import registerSeatImageFallback from './seat-image-fallback.ts'
import syloThinkTankSeatTools from './seat-tools.ts'
import { SYLO_THINK_TANK_SEAT_RUN_ENV } from './spawn-seat.ts'
import { thinkTankRpc } from './sylo-host.ts'
import { thinkTankTopicTitle } from './topic.ts'

function formatThinkTankRunError(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err)
  const lower = detail.toLowerCase()
  if (lower.includes('unknown think tank agent')) {
    return (
      `Think tank run failed: ${detail}\n\n` +
      'Seat persona file missing or renamed. Open **Think Tank → Settings**, pick a **Persona file**, save, then **Restart broker**.'
    )
  }
  if (lower.includes('rpc') || lower.includes('ipc')) {
    return `Think tank run failed: ${detail}\n\nRestart Sylo or use **Developer → Restart broker**.`
  }
  return (
    `Think tank run failed: ${detail}\n\n` +
    'If tools are missing: enable **Think Tank** under Capability manager → Sylo optional packages, enable the **think-tank** skill, then **Restart broker**.'
  )
}

function toolError(text: string): { content: ToolContentBlock[]; details: undefined } {
  return { content: [{ type: 'text', text }], details: undefined }
}

export default function syloThinkTankExtension(pi: ExtensionAPI): void {
  if (process.env[SYLO_THINK_TANK_SEAT_RUN_ENV] === '1') {
    registerSeatImageFallback(pi)
    syloThinkTankSeatTools(pi)
    return
  }

  pi.registerTool({
    name: 'sylo_think_tank_run',
    label: 'Think tank debate',
    description:
      'Start a multi-model think tank debate on a topic. Runs min 2 / max 10 cycles, then each seat writes a final report. ' +
      'Returns session_id and report previews. The session finalizes automatically when reports are ready — the Moderator final report is the decision brief. ' +
      'sylo_think_tank_pick remains available as an optional programmatic API but is not surfaced in the UI. ' +
      'Use when the operator says "Think Tank:", "send to think tank", or wants adversarial multi-model research. ' +
      'Put attachment summaries, file excerpts, and image descriptions in context when the operator pasted files or links.',
    parameters: Type.Object({
      topic: Type.String({ description: 'Debate question (required unless context alone is sufficient)' }),
      context: Type.Optional(
        Type.String({
          description:
            'Operator chat context NOT visible to think tank seats automatically: attachment summaries, ' +
            'read_file excerpts, link fetch summaries, image descriptions, prior chat turns, ' +
            'or full prior think tank final reports when continuing a multi-session thread. Required when operator pasted files/images/links.',
        }),
      ),
      min_cycles: Type.Optional(Type.Number({ minimum: 2, maximum: 10 })),
      max_cycles: Type.Optional(Type.Number({ minimum: 2, maximum: 10 })),
      source_conversation_id: Type.Optional(Type.String()),
      source_message_id: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const result = await runThinkTankSession({
          cwd: ctx.cwd,
          topic: params.topic,
          context: params.context,
          minCycles: params.min_cycles,
          maxCycles: params.max_cycles,
          sourceConversationId: params.source_conversation_id,
          sourceMessageId: params.source_message_id,
          signal,
        })
        const title = thinkTankTopicTitle(result.topic)
        const debugLines = result.debug.turns
          .map(
            (t) =>
              `- C${t.cycle} **${t.seatLabel}**: fragment=${t.debug.fragmentDetected} attempts=${t.debug.attempt}/${t.debug.maxAttempts} picked=${t.debug.pickedFrom} chars=${t.debug.bodyChars}${t.debug.retryReason ? ` retry=${t.debug.retryReason}` : ''}`,
          )
          .join('\n')
        const reportDebugLines = result.debug.reports
          .map(
            (r) =>
              `- **${r.seatLabel}**: valid=${r.validation.ok} reason=${r.validation.reason} attempts=${r.debug.attempt}/${r.debug.maxAttempts}`,
          )
          .join('\n')
        return {
          content: [
            {
              type: 'text',
              text:
                `# Think Tank session started\n\n` +
                `**Session:** \`${result.sessionId}\`\n` +
                `### Question\n\n${title}\n\n` +
                `**Cycles completed:** ${result.cyclesCompleted}\n` +
                `**Status:** ${result.status}\n\n` +
                `Full debate turns and color-coded final reports appear in the chat thread. ` +
                `The Moderator report is the decision brief; debater reports are supporting perspectives. ` +
                `The session is complete — no report pick is required. (sylo_think_tank_pick remains available as an optional programmatic API.)\n\n` +
                `## Seat spawn debug\n\n${debugLines || '_(none)_'}\n\n` +
                `## Final report validation\n\n${reportDebugLines || '_(none)_'}\n\n` +
                `## Final reports\n\n` +
                result.reports
                  .map((r) => `### ${r.seatLabel}\n\n${r.body}`)
                  .join('\n\n---\n\n'),
            },
                        { type: 'text', text: JSON.stringify(result, null, 2) },
          ],
          details: undefined,
        }
      } catch (err) {
        return toolError(formatThinkTankRunError(err))
      }
    },
  })

  pi.registerTool({
    name: 'sylo_think_tank_status',
    label: 'Think tank status',
    description: 'Get think tank session status, cycle progress, stances, and report ids.',
    parameters: Type.Object({
      session_id: Type.String({ description: 'Think Tank session UUID from sylo_think_tank_run' }),
    }),
    async execute(_toolCallId, params) {
      try {
        const session = await getThinkTankStatus(params.session_id)
        if (!session) return toolError(`No think tank session found: ${params.session_id}`)
        return {
          content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
          details: undefined,
        }
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err))
      }
    },
  })

  pi.registerTool({
    name: 'sylo_think_tank_pick',
    label: 'Think tank pick report',
    description:
      'Optional programmatic selection of a debater final report (Moderator reports are advisory only). ' +
      'Not surfaced in the UI — sessions finalize automatically when reports are ready. Use only when a caller explicitly wants to mark a debater report as selected.',
    parameters: Type.Object({
      session_id: Type.String(),
      report_id: Type.String({ description: 'Report id from sylo_think_tank_run or status' }),
    }),
    async execute(_toolCallId, params) {
      try {
                const res = await thinkTankRpc({ op: 'pick', sessionId: params.session_id, reportId: params.report_id })
        if (res.op !== 'pick') {
          return toolError(`Unexpected RPC result for pick: ${res.op}`)
        }
        return {
          content: [
            {
              type: 'text',
              text: `Think Tank session \`${params.session_id}\` complete. Selected report: \`${res.selectedReportId}\`.`,
            },
          ],
          details: undefined,
        }
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err))
      }
    },
  })
}
