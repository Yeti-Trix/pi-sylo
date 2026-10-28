/**
 * sylo-restart-badge — lets the agent raise the host's persistent "Restart Required"
 * badge (issue #44). Sylo house rules (AGENTS.md): agents never restart Sylo
 * themselves — they tell the operator and stop. This tool is the visible follow-through:
 * a red, app-global badge that stays until the operator actually restarts
 * (clears at next launch, not on broker restart).
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

type ToolContentBlock = { type: 'text'; text: string }

export const SYLO_RESTART_BADGE_MESSAGE = 'sylo_restart_badge'

const MAX_REASON_CHARS = 300

function toolError(text: string): { content: ToolContentBlock[]; details: undefined } {
  return { content: [{ type: 'text', text }], details: undefined }
}

/**
 * Raise the "Restart Required" badge. Call this (once, after telling the operator
 * what needs a relaunch and why) when your change cannot take effect until Sylo
 * restarts: main-process/preload code, dependencies, skill surfaces, installer
 * work. Do NOT use it for renderer-only or broker-restart changes.
 */
export default function syloRestartBadge(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'sylo_restart_badge',
    label: 'Restart required badge',
    description:
      'Show a persistent red "Restart Required" badge in Sylo (bottom-right) until the operator ' +
      'restarts the app. Call ONCE, right after telling the operator that a change needs an ' +
      'application relaunch (main-process/preload code, dependencies, skill surfaces, installer ' +
      'updates). The badge stays across chats and app close; it clears at the next launch. ' +
      'Do not call it for changes that only need a broker restart or are already live.',
    parameters: Type.Object({
      reason: Type.String({
        description: 'One line: what this restart applies (e.g. "main-process change in apps/host — renderer work card fix").',
      }),
    }),
    async execute(toolCallId, args) {
      const reason = String((args as { reason?: unknown })?.reason ?? '').trim()
      if (!reason) {
        return toolError('reason is required — one line about what the restart applies.')
      }
      if (!process.send) {
        return toolError('sylo_restart_badge requires Sylo broker IPC (unavailable outside the Sylo host).')
      }
      const payload = {
        type: SYLO_RESTART_BADGE_MESSAGE,
        toolCallId,
        reason: reason.slice(0, MAX_REASON_CHARS),
        source: process.env.SYLO_BADGE_SOURCE_CWD ?? process.cwd(),
        ts: Date.now(),
      }
      try {
        process.send(payload)
      } catch (e) {
        return toolError(`Could not reach the Sylo host: ${String((e as Error)?.message ?? e)}`)
      }
      return {
        content: [
          {
            type: 'text',
            text:
              'Restart Required badge is now showing (red, bottom-right). It stays visible on every tab ' +
              'until the operator restarts Sylo. Stop your turn here and let the operator relaunch.',
          },
        ],
        details: undefined,
      }
    },
  })
}