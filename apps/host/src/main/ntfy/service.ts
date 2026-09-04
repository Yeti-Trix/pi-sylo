import {
  commandTopicFor,
  isNtfyConfigured,
  readNtfyPrefs,
  writeNtfyPrefs,
  type NtfyPrefs,
} from './prefs.js'
import {
  publish,
  subscribe,
  type NtfyMessage,
  type NtfyPriority,
  type NtfySubscription,
} from './client.js'

export type NtfyCommandHandler = (msg: NtfyMessage) => void

let subscription: NtfySubscription | undefined

/**
 * Publish a notification to the phone's notify topic. Fire-and-forget from
 * event hooks; no-op (returns false) if ntfy is not configured/enabled.
 */
export async function publishNtfyNotification(
  title: string,
  body: string,
  priority?: NtfyPriority,
): Promise<boolean> {
  const prefs = readNtfyPrefs()
  if (!isNtfyConfigured(prefs)) return false
  return publish(prefs, prefs.notifyTopic, { title, body, priority })
}

/**
 * Start the subscriber on this node's command inbox topic. Incoming messages
 * are handed to `onCommand` (Phase 2 wires this to fire an arbitrary prompt into
 * a new chat). No-op if not configured; idempotent if already running.
 */
export function startNtfyService(onCommand: NtfyCommandHandler): void {
  const prefs = readNtfyPrefs()
  if (!isNtfyConfigured(prefs)) {
    console.log('[sylo ntfy] not configured; skipping subscribe')
    return
  }
  if (subscription) return
  const topic = commandTopicFor(prefs)
  console.log(`[sylo ntfy] subscribing to command topic "${topic}" on ${prefs.serverUrl}`)
  subscription = subscribe(prefs, topic, (m) => {
    try {
      onCommand(m)
    } catch (e) {
      console.error('[sylo ntfy] command handler error:', e)
    }
  })
}

export function stopNtfyService(): void {
  subscription?.stop()
  subscription = undefined
}

export {
  commandTopicFor,
  isNtfyConfigured,
  readNtfyPrefs,
  writeNtfyPrefs,
  type NtfyPrefs,
  type NtfyMessage,
  type NtfyPriority,
}