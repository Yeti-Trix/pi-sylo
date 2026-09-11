import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { cn } from '../../lib/cn'
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

/** Caps for terminal → chat sharing (keeps the composer usable). */
const SHARE_MAX_LINES = 300
const SHARE_MAX_CHARS = 40_000

export function TerminalPane({
  tabId,
  terminals,
  className,
  onShareToChat,
}: {
  tabId: string
  terminals: TerminalRegistry
  className?: string
  /** Called with the pane's current buffer text when the operator clicks
   *  "Share" — the host prefills the chat composer with it. */
  onShareToChat?: (text: string) => void
}): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** Live xterm instance — lets the Share button read what the operator sees
   *  (including alt-screen apps like vim, which never reach the registry's
   *  byte buffer in a line-decodable form). */
  const termRef = useRef<Terminal | null>(null)

  const shareBuffer = () => {
    const term = termRef.current
    if (!term || !onShareToChat) return
    const buf = term.buffer.active
    const lines: string[] = []
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y)
      lines.push(line ? line.translateToString(true) : '')
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    let text = lines.slice(-SHARE_MAX_LINES).join('\n')
    if (text.length > SHARE_MAX_CHARS) text = text.slice(-SHARE_MAX_CHARS)
    if (!text.trim()) return
    onShareToChat(text)
  }

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
    termRef.current = term

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
      termRef.current = null
      term.dispose()
    }
  }, [tabId, terminals])

  return (
    <div className={cn('group/term relative flex min-h-0 min-w-0', className)}>
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1" style={{ minHeight: 0, minWidth: 0 }} />
      {onShareToChat ?
        <button
          type="button"
          title="Send the terminal output to the chat composer"
          aria-label="Share terminal output with the agent"
          className={cn(
            'absolute right-2 top-1.5 z-10 flex shrink-0 items-center gap-1 rounded border border-border bg-[#161616]/90',
            'px-1.5 py-0.5 text-[0.66rem] leading-none text-text-secondary opacity-0 backdrop-blur-sm',
            'transition-opacity duration-[120ms] hover:border-accent-muted hover:text-text-primary',
            'focus-visible:opacity-100 group-hover/term:opacity-100',
          )}
          onClick={shareBuffer}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
            aria-hidden="true"
          >
            <path d="m12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
          Share
        </button>
      : null}
    </div>
  )
}