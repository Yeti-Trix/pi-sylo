import { randomUUID } from 'node:crypto'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

/**
 * `sylo_runs_list` (F2, workspace agent visibility): ONE tool call that shows an
 * orchestrator what every chat's agents and subagent runs in its workspace are doing,
 * including the files each run touches. The intended use is BEFORE dispatching a
 * background run or editing files — two chats editing the same area within an hour of
 * each other has actually happened; this is the cheap check that prevents it.
 *
 * Runs as a broker-child extension: the answer comes from the Sylo host over the same
 * request/reply IPC pattern think-tank uses (`sylo_runs_rpc`). Outside a Sylo host
 * (plain `pi` usage) the tool reports that cleanly instead of erroring.
 */

type ChatPresenceRow = {
  conversationId: string
  title: string
  activeTurn: boolean
  lastPrompt: string | null
  model: string | null
  updatedAt: number
}

type RunRow = {
  taskId: string
  runId: string
  agent: string
  mode: string
  status: string
  startedAt: number | null
  endedAt: number | null
  model: string | null
  tokens: number | null
  question: string | null
  conversationId: string
  conversationTitle: string | null
  title: string | null
  files: string[]
  resultSummary: string | null
}

type RunsSnapshot = {
  workspaceKey: string
  generatedAt: number
  chats: ChatPresenceRow[]
  rows: RunRow[]
}

const RPC_TIMEOUT_MS = 30_000

function runsRpc(workspaceKey: string): Promise<RunsSnapshot> {
  if (!process.send) {
    return Promise.reject(new Error('sylo_runs_list requires the Sylo host broker IPC (plain Pi has no workspace).'))
  }
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off('message', onMessage)
      reject(new Error('sylo_runs_list timed out'))
    }, RPC_TIMEOUT_MS)

    const onMessage = (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const m = msg as { type?: string; requestId?: string; ok?: boolean; result?: RunsSnapshot; error?: string }
      if (m.type !== 'sylo_runs_rpc_result' || m.requestId !== requestId) return
      clearTimeout(timer)
      process.off('message', onMessage)
      if (m.ok && m.result) resolve(m.result)
      else reject(new Error(m.error ?? 'sylo_runs_list RPC failed'))
    }

    process.on('message', onMessage)
    process.send!({ type: 'sylo_runs_rpc', requestId, op: 'list', workspaceKey })
  })
}

function relTime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '?'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const STATUS_LABEL: Record<string, string> = {
  running: '● RUNNING',
  awaiting_input: '⏸ AWAITING INPUT',
  succeeded: '✓ finished',
  failed: '✕ failed',
  cancelled: '■ stopped',
  orphaned: '? lost',
}

function clip(text: string, cap: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat
}

export function registerRunsListTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'sylo_runs_list',
    label: 'Sylo runs list',
    description: [
      'Ask what every OTHER chat in this workspace is doing — its main agent (live turn, latest assignment, since when) and every subagent run (persona, status, owning chat, model, files touched).',
      'Call this BEFORE dispatching a subagent or editing files: if another chat is working the same files or area, coordinate instead of colliding.',
    ].join(' '),
    parameters: Type.Object({}),
    async execute() {
      const workspaceKey = process.env.SYLO_PI_CWD?.trim() || process.cwd()
      let snap: RunsSnapshot
      try {
        snap = await runsRpc(workspaceKey)
      } catch (e) {
        return { content: [{ type: 'text', text: `sylo_runs_list failed: ${e instanceof Error ? e.message : String(e)}` }], details: undefined }
      }
      const lines: string[] = [`Workspace subagent/agent activity (as of ${new Date(snap.generatedAt).toLocaleTimeString()}):`]
      const chats = snap.chats.slice(0, 20)
      if (chats.length === 0) {
        lines.push('', '(no other chats in this workspace)')
      } else {
        lines.push('', '### Chats')
        for (const chat of chats) {
          lines.push(
            chat.activeTurn ?
              `- ● **${clip(chat.title, 60)}** — turn running${chat.lastPrompt ? ` — working on: ${clip(chat.lastPrompt, 120)}` : ''}${chat.model ? ` — ${chat.model}` : ''}`
            : `- (idle ${relTime(chat.updatedAt)}) **${clip(chat.title, 60)}**${chat.model ? ` — ${chat.model}` : ''}`,
          )
        }
      }
      const rows = snap.rows
      if (rows.length === 0) {
        lines.push('', '(no subagent runs recorded in this workspace)')
      } else {
        lines.push('', '### Subagent runs (newest state first)')
        for (const row of rows.slice(0, 40)) {
          const stamp = row.status === 'running' ? `started ${relTime(row.startedAt)}` : relTime(row.endedAt)
          const files = row.files.length > 0 ? ` — files: ${row.files.slice(0, 6).join(', ')}${row.files.length > 6 ? ` (+${row.files.length - 6})` : ''}` : ''
          const question = row.question && row.status === 'awaiting_input' ? ` — ❓ ${clip(row.question, 160)}` : ''
          lines.push(
            `- ${STATUS_LABEL[row.status] ?? row.status} — <${row.agent}> — ${clip(row.title ?? '', 100)} — chat: ${clip(row.conversationTitle ?? 'unknown', 60)} — ${row.model ?? 'inherited model'} — ${stamp}${files}${question}`,
          )
          if (row.resultSummary && row.status !== 'running') {
            lines.push(`  ⤷ ${clip(row.resultSummary, 220)}`)
          }
        }
        if (rows.length > 40) lines.push(`  … ${rows.length - 40} older runs omitted`)
      }
      return { content: [{ type: 'text', text: lines.join('\n') }], details: undefined }
    },
  })
}