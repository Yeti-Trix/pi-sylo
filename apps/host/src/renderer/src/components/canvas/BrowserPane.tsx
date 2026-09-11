import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { btnGhostSm, mutedText } from '../../panels/ui-classes'

/**
 * Apps-pane Browser tab (Phase 6): one sandboxed <webview> guest per tab,
 * running in the `persist:apps-pane` partition — cookies/storage are
 * isolated from the app's own session AND from other tabs' logins being
 * wiped (persist keeps them across app restarts).
 *
 * The webview element lives only while mounted; CanvasPanel keeps every
 * browser tab's wrapper mounted (hidden unless active) so navigation state
 * survives tab switches. The last URL per tab is kept in a module map so a
 * pane reopens where it was closed.
 *
 * No node integration in guests (main window has webviewTag: true; guest
 * defaults are sandboxed + contextIsolated). External new-window targets
 * open in the operator's default browser.
 */

/** Last URL per browser tab — survives pane unmount (panel close). */
const srcByTab = new Map<string, string>()

/** Current URL for a browser tab (undefined until it navigates once) — used
 *  by pool-tab persistence to save/restore the last page. */
export function storedSrcForTab(tabId: string): string | undefined {
  return srcByTab.get(tabId)
}

/** Typed shim: 'webview' isn't in React's intrinsic elements. */
const Webview = 'webview' as unknown as React.FC<Record<string, unknown>>

function normalizeUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('about:')) return s
  // Bare domain / search-terms heuristic: single word + dot → https, else DuckDuckGo.
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(s)) return `https://${s}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
}

export function BrowserPane({
  tabId,
  initialUrl,
  className,
}: {
  tabId: string
  /** Restored pool tab: URL to open when this tab has never navigated. */
  initialUrl?: string
  className?: string
}): React.ReactElement {
  const [src, setSrc] = useState(() => srcByTab.get(tabId) ?? initialUrl ?? '')
  const [urlDraft, setUrlDraft] = useState(src)
  const [loading, setLoading] = useState(false)
  // Seed the module map once so back/forward + reload see the restored URL.
  useEffect(() => {
    if (initialUrl && !srcByTab.has(tabId)) srcByTab.set(tabId, initialUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Electron's WebviewTag type ships with electron's renderer types; use a
  // minimal structural type so the pane compiles standalone.
  type WvEl = HTMLElement & {
    goBack(): void
    goForward(): void
    reload(): void
    stop(): void
    addEventListener(type: string, cb: (e: { url: string }) => void): void
    removeEventListener(type: string, cb: (e: { url: string }) => void): void
  }
  const wvRef = useRef<WvEl | null>(null)

  const displayUrl = urlDraft

  useEffect(() => {
    const wv = wvRef.current
    if (!wv) return
    const onDidNavigate = (e: { url: string }) => {
      setUrlDraft(e.url)
      srcByTab.set(tabId, e.url)
    }
    const onStart = () => setLoading(true)
    const onStop = () => setLoading(false)
    const onNewWindow = (e: { url: string }) => {
      if (e.url) void window.sylo.shell.openExternal(e.url)
    }
    wv.addEventListener('did-navigate', onDidNavigate)
    wv.addEventListener('did-navigate-in-page', onDidNavigate)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('new-window', onNewWindow)
    return () => {
      wv.removeEventListener('did-navigate', onDidNavigate)
      wv.removeEventListener('did-navigate-in-page', onDidNavigate)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('new-window', onNewWindow)
    }
  }, [src, tabId])

  const go = useCallback(
    (raw: string) => {
      const next = normalizeUrl(raw)
      if (!next) return
      setSrc(next)
      setUrlDraft(next)
      srcByTab.set(tabId, next)
    },
    [tabId],
  )

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        go((e.target as HTMLInputElement).value)
      }
    },
    [go],
  )

  const wvProps = useMemo(
    () => ({
      ref: wvRef as unknown as React.Ref<HTMLElement>,
      partition: 'persist:apps-pane',
      src,
      className: 'h-full w-full flex-1 bg-white',
    }),
    [src],
  )

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <button
          type="button"
          className={cn(btnGhostSm, 'px-1.5')}
          title="Back"
          aria-label="Back"
          onClick={() => wvRef.current?.goBack()}
        >
          ←
        </button>
        <button
          type="button"
          className={cn(btnGhostSm, 'px-1.5')}
          title="Forward"
          aria-label="Forward"
          onClick={() => wvRef.current?.goForward()}
        >
          →
        </button>
        <button
          type="button"
          className={cn(btnGhostSm, 'px-1.5')}
          title={loading ? 'Stop' : 'Reload'}
          aria-label={loading ? 'Stop' : 'Reload'}
          onClick={() => {
            if (loading) wvRef.current?.stop()
            else wvRef.current?.reload()
          }}
        >
          {loading ? '×' : '↻'}
        </button>
        <input
          className="h-7 min-w-0 flex-1 rounded-full border border-border bg-bg-primary px-3 font-[inherit] text-[0.76rem] text-text-primary placeholder:text-text-muted outline-none focus:border-accent/55"
          value={displayUrl}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search or enter address"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className={cn(btnGhostSm, 'px-1.5')}
          title="Open in default browser"
          aria-label="Open in default browser"
          onClick={() => {
            const u = src || urlDraft
            if (u) void window.sylo.shell.openExternal(normalizeUrl(u))
          }}
        >
          ↗
        </button>
      </div>
      {src ?
        <Webview {...wvProps} />
      : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span aria-hidden className="font-mono text-[1.6rem] leading-none text-text-muted">◎</span>
          <p className={cn(mutedText, 'm-0 max-w-[38ch] text-[0.8rem]')}>
            Type an address above to browse in a sandboxed pane. Cookies live in a
            partition isolated from Sylo's own session.
          </p>
        </div>
      )}
    </div>
  )
}