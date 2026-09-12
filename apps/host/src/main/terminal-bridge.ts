import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Terminal bridge (issue #7): the host mirrors every live terminal pane's
 * cwd + scrollback tail to a JSON file; the sylo-terminal-bridge pi package
 * reads it via SYLO_TERMINAL_BRIDGE_FILE. Renderer-driven (the pane buffers
 * live there) — snapshots only update while the app is running.
 */
export type TerminalBridgeSession = {
  id: string
  title?: string
  cwd?: string
  exited?: boolean
  output?: string
}

export function terminalBridgeFile(): string {
  return join(app.getPath('userData'), 'terminal-bridge', 'state.json')
}

export function writeTerminalBridge(sessions: TerminalBridgeSession[]): boolean {
  try {
    const dir = join(app.getPath('userData'), 'terminal-bridge')
    mkdirSync(dir, { recursive: true })
    const clean = (Array.isArray(sessions) ? sessions : []).slice(0, 32).map((s) => ({
      id: String(s?.id ?? '').slice(0, 120),
      title: typeof s?.title === 'string' ? s.title.slice(0, 120) : undefined,
      cwd: typeof s?.cwd === 'string' ? s.cwd.slice(0, 500) : undefined,
      exited: !!s?.exited,
      output: typeof s?.output === 'string' ? s.output.slice(-80_000) : '',
    }))
    writeFileSync(terminalBridgeFile(), JSON.stringify({ updatedAt: Date.now(), sessions: clean }), 'utf8')
    return true
  } catch {
    return false
  }
}