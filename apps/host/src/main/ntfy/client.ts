import type { NtfyPrefs } from './prefs.js'

/** ntfy priority: 1=min, 3=default, 5=max (urgent). */
export type NtfyPriority = 1 | 2 | 3 | 4 | 5

/** A decoded ntfy JSON-stream event. */
export interface NtfyMessage {
  id: string
  time: number
  expires?: number
  event: 'open' | 'message' | 'poll_request' | 'keepalive'
  topic: string
  message?: string
  title?: string
  priority?: number
  tags?: string[]
}

export interface PublishOptions {
  body: string
  title?: string
  priority?: NtfyPriority
  tags?: string[]
  click?: string
}

/**
 * Publish a message to a topic. Returns true on HTTP 2xx. Never throws — logs
 * on failure so callers can fire-and-forget from event hooks.
 */
export async function publish(
  prefs: NtfyPrefs,
  topic: string,
  opts: PublishOptions,
): Promise<boolean> {
  const url = `${prefs.serverUrl}/${topic}`
  const headers: Record<string, string> = {}
  if (opts.title) headers['Title'] = opts.title
  if (opts.priority) headers['Priority'] = String(opts.priority)
  if (opts.tags && opts.tags.length) headers['Tags'] = opts.tags.join(',')
  if (opts.click) headers['Click'] = opts.click
  if (prefs.token) headers['Authorization'] = `Bearer ${prefs.token}`
  try {
    const res = await fetch(url, { method: 'POST', body: opts.body, headers })
    if (!res.ok) console.error(`[sylo ntfy] publish ${topic} -> http ${res.status}`)
    return res.ok
  } catch (e) {
    console.error('[sylo ntfy] publish failed:', e)
    return false
  }
}

export interface NtfySubscription {
  stop: () => void
}

/**
 * Subscribe to a topic's JSON stream (long-lived, with exponential-backoff
 * reconnect). Calls `onMessage` for each `message` event.
 *
 * Resume semantics: by default subscribes to **new** messages only (no replay
 * on fresh start, so a node restart does not re-fire old commands). Within a
 * session, the cursor advances to the last seen message id so a transient
 * reconnect resumes without replay. Pass `since` to replay history.
 */
export function subscribe(
  prefs: NtfyPrefs,
  topic: string,
  onMessage: (m: NtfyMessage) => void,
  opts?: { since?: string },
): NtfySubscription {
  let stopped = false
  let controller: AbortController | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let backoff = 1000
  let sinceParam = opts?.since

  const headers: Record<string, string> = {}
  if (prefs.token) headers['Authorization'] = `Bearer ${prefs.token}`

  async function loop(): Promise<void> {
    while (!stopped) {
      controller = new AbortController()
      try {
        const query = sinceParam ? `?since=${encodeURIComponent(sinceParam)}` : ''
        const url = `${prefs.serverUrl}/${topic}/json${query}`
        const res = await fetch(url, { signal: controller.signal, headers })
        if (!res.ok || !res.body) throw new Error(`http ${res.status}`)
        backoff = 1000
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            try {
              const obj = JSON.parse(line) as NtfyMessage
              if (obj.id && obj.event) sinceParam = obj.id // advance cursor for resume
              if (obj.event === 'message' && obj.message) onMessage(obj)
            } catch {
              /* ignore malformed line */
            }
          }
        }
      } catch (e) {
        if (stopped) break
        if ((e as Error).name === 'AbortError') break
        console.error('[sylo ntfy] subscribe error:', e)
      }
      if (stopped) break
      backoff = Math.min(backoff * 2, 30_000)
      await new Promise<void>((r) => {
        reconnectTimer = setTimeout(r, backoff)
      })
    }
  }

  void loop()

  return {
    stop: () => {
      stopped = true
      controller?.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    },
  }
}