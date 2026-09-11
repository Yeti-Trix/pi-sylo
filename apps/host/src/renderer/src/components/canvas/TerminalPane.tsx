import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { TerminalRegistry } from './useTerminalSessions'

/**
 * One xterm.js pane bound to a pty session in the registry (keyed by apps
 * tab id). A fresh xterm instance is created per mount and replays the
 * session buffer, so scrollback survives tab switches without keeping
 * xterm instances alive outside the DOM.
 *
 * Theme: Cursor-neutral grays — chrome never introduces color; the ANSI
 * palette below only governs program OUTPUT (ls, git, test runners), kept
 * slightly desaturated to sit quietly on the neutral shell.
 */

const TERM_THEME = {
  background: '#0d0d0d',
  foreground: '#ededed',
  cursor: '#d4d4d4',
  cursorAccent: '#0d0d0d',
  selectionBackground: 'rgba(255, 255, 255, 0.16)',
  // Standard ANSI, desaturated toward the neutral palette.
  black: '#1a1a1a',
  red: '#f16a50',
  green: '#3dd68c',
  yellow: '#e0af68',
  blue: '#7d8cc4',
  magenta: '#c586c0',
  cyan: '#6fb3be',
  white: '#d4d4d4',
  brightBlack: '#6b6b6b',
  brightRed: '#f6b3a4',
  brightGreen: '#7ce3ae',
  brightYellow: '#e8c583',
  brightBlue: '#9aa7d8',
  brightMagenta: '#d6a2d0',
  brightCyan: '#8fc7d1',
  brightWhite: '#ededed',
} as const

export function TerminalPane({
  tabId,
  terminals,
  className,
}: {
  tabId: string
  terminals: TerminalRegistry
  className?: string
}): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const session = terminals.get(tabId)
    if (!session) return

    const term = new Terminal({
      theme: { ...TERM_THEME },
      fontFamily:
        '"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 5000,
      convertEol: false,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      /* zero-size host on first paint — the ResizeObserver below refits */
    }
    // Replay everything the session has produced so far, then subscribe.
    if (session.buffer) term.write(session.buffer)
    const unsub = terminals.subscribe(tabId, (chunk) => term.write(chunk))

    term.onData((data) => terminals.write(tabId, data))

    const refit = () => {
      try {
        fit.fit()
        terminals.resize(tabId, term.cols, term.rows)
      } catch {
        /* host not laid out yet */
      }
    }
    const ro = new ResizeObserver(refit)
    ro.observe(host)
    refit()

    return () => {
      unsub()
      ro.disconnect()
      term.dispose()
    }
  }, [tabId, terminals])

  return <div ref={hostRef} className={className} style={{ minHeight: 0, minWidth: 0 }} />
}