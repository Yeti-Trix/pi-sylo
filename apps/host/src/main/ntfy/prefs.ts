import * as db from '../database.js'

/**
 * ntfy connection prefs for the host. Mirrors the companion prefs pattern
 * (`apps/host/src/main/companion/prefs.ts`): a small key/value store via
 * `db.getPref` / `db.setPref`. The token is a secret and stays in this local
 * pref store — it is never written to git.
 */
export interface NtfyPrefs {
  enabled: boolean
  /** ntfy server base URL, no trailing slash. Default is the public ntfy.sh (prototype); switch to the self-hosted tailnet URL in Phase 5. */
  serverUrl: string
  /** Optional bearer token (auth). Empty = anonymous (public ntfy.sh). */
  token: string
  /** This node's name, lowercase alnum + hyphen (e.g. "server", "gaming", "work"). Drives the command inbox topic. */
  nodeName: string
  /** Topic the phone subscribes to for notifications, e.g. "sylo-notify". ntfy topics are a single path segment — no slashes. */
  notifyTopic: string
}

const PREF_ENABLED = 'sylo.ntfy.enabled'
const PREF_SERVER_URL = 'sylo.ntfy.server_url'
const PREF_TOKEN = 'sylo.ntfy.token'
const PREF_NODE_NAME = 'sylo.ntfy.node_name'
const PREF_NOTIFY_TOPIC = 'sylo.ntfy.notify_topic'

export const NTFY_DEFAULT_SERVER = 'https://ntfy.sh'
export const NTFY_DEFAULT_NOTIFY_TOPIC = 'sylo-notify'

function normalizeUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return NTFY_DEFAULT_SERVER
  let u = raw.trim()
  while (u.endsWith('/')) u = u.slice(0, -1)
  return u
}

function normalizeNodeName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
}

function normalizeTopic(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  return raw.trim().replace(/\s+/g, '')
}

export function readNtfyPrefs(): NtfyPrefs {
  return {
    enabled: Boolean(db.getPref(PREF_ENABLED, false)),
    serverUrl: normalizeUrl(db.getPref(PREF_SERVER_URL, NTFY_DEFAULT_SERVER)),
    token: String(db.getPref(PREF_TOKEN, '') || ''),
    nodeName: normalizeNodeName(db.getPref(PREF_NODE_NAME, '')),
    notifyTopic: normalizeTopic(
      db.getPref(PREF_NOTIFY_TOPIC, NTFY_DEFAULT_NOTIFY_TOPIC),
      NTFY_DEFAULT_NOTIFY_TOPIC,
    ),
  }
}

export function writeNtfyPrefs(patch: Partial<NtfyPrefs>): NtfyPrefs {
  const current = readNtfyPrefs()
  const next: NtfyPrefs = {
    enabled: patch.enabled ?? current.enabled,
    serverUrl: patch.serverUrl !== undefined ? normalizeUrl(patch.serverUrl) : current.serverUrl,
    token: patch.token !== undefined ? String(patch.token || '') : current.token,
    nodeName: patch.nodeName !== undefined ? normalizeNodeName(patch.nodeName) : current.nodeName,
    notifyTopic:
      patch.notifyTopic !== undefined
        ? normalizeTopic(patch.notifyTopic, current.notifyTopic)
        : current.notifyTopic,
  }
  db.setPref(PREF_ENABLED, next.enabled)
  db.setPref(PREF_SERVER_URL, next.serverUrl)
  db.setPref(PREF_TOKEN, next.token)
  db.setPref(PREF_NODE_NAME, next.nodeName)
  db.setPref(PREF_NOTIFY_TOPIC, next.notifyTopic)
  return next
}

/** This node's command inbox topic: `sylo-<nodeName>` (e.g. `sylo-workstation`, `sylo-lab`). Phone + other nodes publish here. Single path segment — ntfy truncates `/`-separated paths to the first segment. */
export function commandTopicFor(prefs: NtfyPrefs): string {
  return `sylo-${prefs.nodeName || 'unknown'}`
}

/** This node's supervisor control topic: `sylo-<nodeName>-control` (e.g. `sylo-workstation-control`). The phone companion publishes `restart` here and the standalone sylo-supervisor service (independent of Sylo) subscribes. Single path segment. */
export function controlTopicFor(prefs: NtfyPrefs): string {
  return `sylo-${prefs.nodeName || 'unknown'}-control`
}

/** Enough is configured to actually connect (enabled + server + node name). */
export function isNtfyConfigured(prefs?: NtfyPrefs): boolean {
  const p = prefs ?? readNtfyPrefs()
  return p.enabled && p.serverUrl.length > 0 && p.nodeName.length > 0
}