import { useEffect, useMemo, useRef } from 'react'

/**
 * Terminal session registry (renderer side, Phase 5).
 *
 * One pty session per apps-pane Terminal tab, keyed by tab id. The PTY lives
 * in the main process; this registry mirrors its output into a per-session
 * buffer so a fresh xterm instance can replay the full scrollback on every
 * mount (tab switches unmount the pane, but sessions + scrollback survive).
 *
 * Listeners are registered once (empty deps) and read the map via refs —
 * same pattern as `useCanvasTabs`.
 */

export type TerminalSession = {
  tabId: string
  /** pty session id from the main process (null until create resolves). */
  ptyId: string | null
  /** Start cwd captured at ensure() — used by pool-tab persistence. */
  cwd: string
  /** Seed a restored session’s buffer from pool-tab persistence (must be
   *  called after ensure(), before pty output appends). */
  seedBacklog: (tabId: string, text: string) => void
  /** Full output so far (backlog + live), replayed into xterm on mount. */
  buffer: string
  exited: boolean
  exitCode: number | null
  /** Set when the session failed to start (spawn error / broken native). */
  error: string | null
}

export type TerminalRegistry = {
  /** Create the pty for this tab (no-op when one already exists). */
  ensure: (tabId: string, cwd: string, cols?: number, rows?: number) => void
  get: (tabId: string) => TerminalSession | undefined
  /** Kill the pty + drop the buffer (tab closed). */
  dispose: (tabId: string) => void
  write: (tabId: string, data: string) => void
  resize: (tabId: string, cols: number, rows: number) => void
  /** Subscribe to new output chunks (called AFTER the chunk hit the buffer). */
  subscribe: (tabId: string, cb: (chunk: string) => void) => () => void
}

const BUFFER_MAX_BYTES = 2 * 1024 * 1024

export function useTerminalSessions(): TerminalRegistry {
  const sessionsRef = useRef<Map<string, TerminalSession>>(new Map())
  const subsRef = useRef<Map<string, Set<(chunk: string) => void>>>(new Map())
  /** Version bump used to re-render nothing — sessions are read imperatively. */
  const versionRef = useRef(0)

  useEffect(() => {
    const onData = window.sylo.terminal?.onData
    const onExit = window.sylo.terminal?.onExit
    const unsubs: Array<() => void> = []
    if (onData) {
      unsubs.push(
        onData(({ id, data }) => {
          for (const [tabId, s] of sessionsRef.current) {
            if (s.ptyId !== id) continue
            s.buffer += data
            if (s.buffer.length > BUFFER_MAX_BYTES) s.buffer = s.buffer.slice(-BUFFER_MAX_BYTES)
            subsRef.current.get(tabId)?.forEach((cb) => cb(data))
            return
          }
        }),
      )
    }
    if (onExit) {
      unsubs.push(
        onExit(({ id, exitCode }) => {
          for (const s of sessionsRef.current.values()) {
            if (s.ptyId === id) {
              s.exited = true
              s.exitCode = exitCode
              return
            }
          }
        }),
      )
    }
    return () => unsubs.forEach((u) => u())
  }, [])

  return useMemo<TerminalRegistry>(() => {
    const append = (tabId: string, chunk: string) => {
      const s = sessionsRef.current.get(tabId)
      if (!s) return
      s.buffer += chunk
      if (s.buffer.length > BUFFER_MAX_BYTES) s.buffer = s.buffer.slice(-BUFFER_MAX_BYTES)
      subsRef.current.get(tabId)?.forEach((cb) => cb(chunk))
versionRef.current++
    }
    return {
      ensure(tabId, cwd, cols, rows) {
        if (sessionsRef.current.has(tabId)) return
        const s: TerminalSession = {
          tabId,
          ptyId: null,
          cwd,
          buffer: '',
          exited: false,
          exitCode: null,
          error: null,
        }
        sessionsRef.current.set(tabId, s)
        subsRef.current.set(tabId, new Set())
        void (async () => {
          try {
            const r = await window.sylo.terminal.create({ cwd, cols, rows })
            // Tab may have been closed while the create was in flight.
            if (!sessionsRef.current.has(tabId)) {
              window.sylo.terminal.dispose(r.id)
              return
            }
            s.ptyId = r.id
            await window.sylo.terminal.attach(r.id)
          } catch (err) {
            s.error = err instanceof Error ? err.message : String(err)
            s.exited = true
            append(tabId, `\x1b[90m[terminal unavailable: ${s.error}]\x1b[0m\r\n`)
          }
        })()
      },
      seedBacklog(tabId, text) {
        const st = sessionsRef.current.get(tabId)
        if (!st || !text) return
        st.buffer = text + st.buffer
        if (st.buffer.length > BUFFER_MAX_BYTES) st.buffer = st.buffer.slice(-BUFFER_MAX_BYTES)
        versionRef.current++
      },
      get: (tabId) => sessionsRef.current.get(tabId),
      dispose(tabId) {
        const s = sessionsRef.current.get(tabId)
        sessionsRef.current.delete(tabId)
        subsRef.current.delete(tabId)
        if (s?.ptyId) window.sylo.terminal.dispose(s.ptyId)
      },
      write(tabId, data) {
        const s = sessionsRef.current.get(tabId)
        if (!s?.ptyId || s.exited) return
        window.sylo.terminal.write(s.ptyId, data)
      },
      resize(tabId, cols, rows) {
        const s = sessionsRef.current.get(tabId)
        if (!s?.ptyId || s.exited) return
        window.sylo.terminal.resize(s.ptyId, cols, rows)
      },
      subscribe(tabId, cb) {
        let set = subsRef.current.get(tabId)
        if (!set) {
          set = new Set()
          subsRef.current.set(tabId, set)
        }
        set.add(cb)
        return () => {
          set.delete(cb)
        }
      },
    }
  }, [])
}