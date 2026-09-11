/**
 * Terminal session manager (apps pane, Phase 5).
 *
 * One node-pty pseudo-terminal per apps-pane Terminal tab. Sessions live in
 * the main process so they survive tab switches, conversation switches and
 * panel close/open; they are killed on explicit dispose (tab close) or main
 * window close.
 *
 * Output ordering: main buffers each session's output until the renderer
 * attaches (`terminal:attach`); the buffered backlog is then flushed through
 * the SAME `terminal:data` event channel as live output, so the renderer
 * never sees live bytes before the backlog.
 */

import * as os from 'node:os'

// node-pty is native (N-API prebuilds) and CJS — lazy-imported (ESM dynamic
// import) so a broken native binding degrades to "terminal unavailable"
// instead of crashing boot. Main is ESM ("type": "module"), hence no require.
type PtyModule = typeof import('node-pty')
let ptyMod: PtyModule | null = null
let ptyLoadError: string | null = null
async function loadPty(): Promise<PtyModule | null> {
  if (ptyMod || ptyLoadError) return ptyMod
  try {
    const mod = (await import('node-pty')) as unknown as { default?: PtyModule } & PtyModule
    ptyMod = (mod.default ?? mod) as PtyModule
  } catch (err) {
    ptyLoadError = err instanceof Error ? err.message : String(err)
  }
  return ptyMod
}

const BACKLOG_MAX_BYTES = 512 * 1024

/** Structural subset of node-pty's IPty we rely on (keeps the module
 *  lazy-importable without a top-level type import). */
type PtyHandle = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
}

type TerminalSession = {
  id: string
  pty: PtyHandle | null
  /** Buffered output until attach (flushed through terminal:data on attach). */
  backlog: string
  attached: boolean
  exited: boolean
  exitCode: number | null
}

const sessions = new Map<string, TerminalSession>()
let seq = 0

type MainWindowGetter = () => { webContents: { send: (ch: string, payload: unknown) => void } } | undefined
let getMainWindow: MainWindowGetter = () => undefined

export function bindTerminalWindowGetter(fn: MainWindowGetter): void {
  getMainWindow = fn
}

export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    // PowerShell — the Windows default in Cursor/VS Code terminals.
    return { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  return { file: process.env.SHELL || '/bin/bash', args: [] as string[] }
}

export async function createTerminal(opts: {
  cwd?: string
  cols?: number
  rows?: number
}): Promise<{ id: string }> {
  const id = `term-${Date.now().toString(36)}-${++seq}`
  const shell = defaultShell()
  const cwd = opts.cwd && opts.cwd.trim() ? opts.cwd.trim() : os.homedir()
  try {
    const ptyApi = await loadPty()
    if (!ptyApi) throw new Error(ptyLoadError ?? 'node-pty unavailable')
    const p = ptyApi.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: clampCols(opts.cols),
      rows: clampRows(opts.rows),
      cwd,
      env: { ...process.env } as unknown as Record<string, string>,
    })
    const session: TerminalSession = { id, pty: p, backlog: '', attached: false, exited: false, exitCode: null }
    sessions.set(id, session)
    p.onData((data: string) => {
      if (!session.attached) {
        session.backlog += data
        if (session.backlog.length > BACKLOG_MAX_BYTES) {
          session.backlog = session.backlog.slice(-BACKLOG_MAX_BYTES)
        }
        return
      }
      getMainWindow()?.webContents.send('terminal:data', { id, data })
    })
    p.onExit(({ exitCode }: { exitCode: number }) => {
      session.exited = true
      session.exitCode = exitCode
      session.pty = null
      const note = `\r\n\x1b[90m[process exited · code ${exitCode}]\x1b[0m\r\n`
      getMainWindow()?.webContents.send('terminal:data', { id, data: note })
      getMainWindow()?.webContents.send('terminal:exit', { id, exitCode })
    })
    return { id }
  } catch (err) {
    // Shell spawn failed (missing shell, bad cwd, broken native binding…):
    // surface it inside the pane instead of a dead tab.
    const message = err instanceof Error ? err.message : String(err)
    const session: TerminalSession = {
      id,
      pty: null,
      backlog: `\x1b[90m[terminal failed to start: ${message}]\x1b[0m\r\n`,
      attached: false,
      exited: true,
      exitCode: -1,
    }
    sessions.set(id, session)
    return { id }
  }
}

function clampCols(cols?: number): number {
  return Math.min(Math.max(Math.floor(cols ?? 80), 2), 500)
}
function clampRows(rows?: number): number {
  return Math.min(Math.max(Math.floor(rows ?? 24), 2), 300)
}

export function attachTerminal(id: string): boolean {
  const s = sessions.get(id)
  if (!s || s.attached) return !!s
  s.attached = true
  if (s.backlog) {
    getMainWindow()?.webContents.send('terminal:data', { id, data: s.backlog })
    s.backlog = ''
  }
  return true
}

export function writeTerminal(id: string, data: string): void {
  const s = sessions.get(id)
  if (!s || s.exited || !s.pty) return
  try {
    s.pty.write(data)
  } catch {
    /* session died between check and write — ignore */
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  if (!s || s.exited || !s.pty) return
  try {
    s.pty.resize(clampCols(cols), clampRows(rows))
  } catch {
    /* resize races with exit — ignore */
  }
}

export function disposeTerminal(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  if (s.pty) {
    try {
      s.pty.kill()
    } catch {
      /* already dead */
    }
  }
}

export function disposeAllTerminals(): void {
  for (const id of [...sessions.keys()]) disposeTerminal(id)
}

export function listTerminalSessions(): number {
  return sessions.size
}