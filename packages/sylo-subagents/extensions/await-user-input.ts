/**
 * Subagent child companion extension (issue #27 P3) — true pause/resume.
 *
 * Loaded by the SUBAGENT child pi process (spawned by the sylo-subagents
 * extension with `-e <this file>`). Registers `await_user_input`: when the
 * subagent hits a decision only the operator can make, the tool PARKS the run —
 * the child process stays alive with its full session context — polling a
 * mailbox file the parent/host writes when the operator replies.
 *
 * Wire format (files under `SYLO_AWAIT_MAILBOX`):
 *   <runId>.answer.json = { answer: string, answered_by?: string, at: number }
 *
 * Env contract set by the parent at spawn:
 *   SYLO_AWAIT_RUN_ID          — the parent-registered run id
 *   SYLO_AWAIT_MAILBOX         — mailbox directory
 *   SYLO_AWAIT_CEILING_SECONDS — max park time (default 600); after that the
 *                                tool returns "no answer in time" guidance so
 *                                the run finishes instead of hanging forever.
 *
 * The parked run emits onUpdate heartbeats (~25s) so the parent's stall guard
 * (kill-on-silence) never kills a healthy parked run.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

const POLL_INTERVAL_MS = 1000
const HEARTBEAT_INTERVAL_MS = 25_000
const DEFAULT_CEILING_SECONDS = 600

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function readAnswerFile(filePath: string): { answer: string; answered_by?: string; at?: number } | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as { answer?: unknown; answered_by?: unknown; at?: unknown }
    if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
      return {
        answer: parsed.answer,
        ...(typeof parsed.answered_by === 'string' ? { answered_by: parsed.answered_by } : {}),
        ...(typeof parsed.at === 'number' ? { at: parsed.at } : {}),
      }
    }
    return null
  } catch {
    // Missing file = no answer yet. Corrupt/partial file = treat as absent and
    // keep waiting (the writer is expected to write atomically via rename).
    return null
  }
}

export default function awaitUserInputExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'await_user_input',
    label: 'Await user input',
    description:
      'Pause this subagent run to get a decision from the operator. Call it ONCE with a crisp question when you are missing information only the operator can provide (a decision, a choice, credentials, a business rule). Do NOT guess. The run parks with your context intact and continues when the answer arrives; if nobody answers in time you must proceed with best judgment and note the assumption in your final output.',
    parameters: Type.Object({
      question: Type.String({ description: 'One crisp question the operator can answer in a sentence or two. Include concrete options when there are any.' }),
      what_i_tried: Type.Optional(
        Type.String({ description: 'Short summary of what you already tried/checked so the operator sees you are blocked, not lazy.' }),
      ),
      context_digest: Type.Optional(
        Type.String({ description: 'Two-sentence recap of the task state, so the operator can answer without scrolling.' }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const runId = process.env.SYLO_AWAIT_RUN_ID?.trim() ?? ''
      const mailboxDir = process.env.SYLO_AWAIT_MAILBOX?.trim() ?? ''
      if (!runId || !mailboxDir) {
        // Not running under a Sylo-dispatched parent (e.g. a manual `pi - e` test):
        // never park forever.
        return {
          content: [
            {
              type: 'text',
              text: `await_user_input is unavailable outside a Sylo-dispatched run (no mailbox configured). Proceed with best judgment for: "${params.question}".`,
            },
          ],
          details: undefined,
        }
      }
      const answerPath = path.join(mailboxDir, `${runId}.answer.json`)
      const ceilingMs = envInt('SYLO_AWAIT_CEILING_SECONDS', DEFAULT_CEILING_SECONDS) * 1000
      const deadline = Date.now() + ceilingMs
      // Heartbeats keep the parent's stall guard from killing a healthy parked run.
      const heartbeat = setInterval(() => {
        try {
          const remainingMin = Math.max(0, Math.ceil((deadline - Date.now()) / 60_000))
          onUpdate?.({
            content: [
              { type: 'text', text: `[parked] Waiting for the operator's answer (~${remainingMin}min left)…` },
            ],
            details: undefined,
          })
        } catch {
          /* parent may already be gone */
        }
      }, HEARTBEAT_INTERVAL_MS)
      heartbeat.unref?.()
      try {
        while (Date.now() < deadline) {
          if (signal?.aborted) {
            return {
              content: [{ type: 'text', text: 'Run was aborted while waiting for input.' }],
              details: undefined,
            }
          }
          const answer = readAnswerFile(answerPath)
          if (answer) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Operator's answer to "${params.question}": ${answer.answer}\n\nContinue the task now, incorporating this answer. Do not re-ask the same question; state assumptions if any remain.`,
                },
              ],
              details: undefined,
            }
          }
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, POLL_INTERVAL_MS)
            t.unref?.()
          })
        }
        return {
          content: [
            {
              type: 'text',
              text: `No answer arrived within ${Math.round(ceilingMs / 60000)} minute(s). Proceed with your best judgment for "${params.question}", note the assumption explicitly in your final output, and keep it reversible.`,
            },
          ],
          details: undefined,
        }
      } finally {
        clearInterval(heartbeat)
      }
    },
  })
}