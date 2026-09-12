/**
 * terminal_read — agent-side window into the Sylo desktop terminal panes.
 *
 * The pty sessions + scrollback live in the Electron host while agent tools
 * live in pi packages (issue #7). The host mirrors every live pane's cwd +
 * scrollback tail to a JSON file (userData/terminal-bridge/state.json) and
 * passes its path to the broker as SYLO_TERMINAL_BRIDGE_FILE; this tool
 * reads it. Outside the Sylo desktop app the env var is absent and the
 * tool reports itself unavailable — inert on vanilla Pi by design.
 */
import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { readFileSync } from 'node:fs'
import { Type } from 'typebox'

type BridgeSession = {
  id: string
  title?: string
  cwd?: string
  exited?: boolean
  output?: string
}

function toolText(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined }
}

function loadSessions(): BridgeSession[] {
  const file = process.env.SYLO_TERMINAL_BRIDGE_FILE
  if (!file) return []
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: BridgeSession[] }
    return Array.isArray(j.sessions) ? j.sessions : []
  } catch {
    return []
  }
}

function tail(text: string | undefined, chars: number): string {
  if (!text) return ''
  return text.length > chars ? text.slice(-chars) : text
}

export default function syloTerminalBridgeExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'terminal_read',
    label: 'Read terminal pane',
    description:
      'Read the output (scrollback tail) of a Sylo desktop terminal pane, or list the live panes. ' +
      'Only available when running inside the Sylo desktop app; on vanilla Pi it reports itself unavailable.',
    promptSnippet:
      'terminal_read({ session?, chars? }) — read a Sylo desktop terminal pane\u2019s scrollback, or list live panes when session is omitted. Only inside the Sylo desktop app.',
    parameters: Type.Object({
      session: Type.Optional(
        Type.String({ description: 'Terminal tab id or title substring. Omit to list the live panes.' }),
      ),
      chars: Type.Optional(
        Type.Number({ description: 'Tail characters to return (default 6000, max 50000).' }),
      ),
    }),
    async execute(_toolCallId, params) {
      const sessions = loadSessions()
      if (sessions.length === 0) {
        return toolText(
          process.env.SYLO_TERMINAL_BRIDGE_FILE
            ? 'No live Sylo terminal panes right now. Open one in the docked apps pane (Tools menu \u2192 Terminal).'
            : 'terminal_read is only available inside the Sylo desktop app (no bridge file configured).',
        )
      }
      const sel = params.session?.trim()
      if (!sel) {
        const lines = sessions.map(
          (s) => `- ${s.id}${s.title ? ` (${s.title})` : ''}${s.exited ? ' [exited]' : ''} \u2014 cwd: ${s.cwd ?? '?'}, ${s.output?.length ?? 0} chars buffered`,
        )
        return toolText(`Live Sylo terminal panes:\n${lines.join('\n')}`)
      }
      const s =
        sessions.find((x) => x.id === sel) ??
        sessions.find((x) => (x.title ?? '').toLowerCase().includes(sel.toLowerCase())) ??
        sessions.find((x) => x.id.toLowerCase().includes(sel.toLowerCase()))
      if (!s) {
        return toolText(`No terminal pane matching "${sel}". Live panes: ${sessions.map((x) => x.id).join(', ')}`)
      }
      const chars = Math.min(Math.max(Math.floor(params.chars ?? 6000), 200), 50_000)
      const out = tail(s.output, chars) || '(no captured output yet)'
      const header = `[${s.id}${s.title ? ` \u2014 ${s.title}` : ''}${s.exited ? ', exited' : ''}] cwd: ${s.cwd ?? '?'} (last ${out.length} chars)\n`
      return toolText(header + out)
    },
  })
}