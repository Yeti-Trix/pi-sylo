import {
  CHATGPT_CODEX_PROVIDER,
  SYLO_MODEL_PROVIDERS,
  type SyloModelProvider,
} from './chatgpt-codex.js'

/** Env vars Pi also accepts when auth.json has no entry for that provider. */
export const API_PROVIDER_ENV_VARS: Partial<Record<SyloModelProvider, string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

/** True when `~/.pi/agent/auth.json` has a usable API key or OAuth token for one provider. */
export function providerHasStoredCredential(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false
  const rec = entry as { type?: unknown; key?: unknown; access?: unknown; refresh?: unknown }
  if (typeof rec.key === 'string' && rec.key.trim() !== '') return true
  if (rec.type !== 'oauth') return false
  return (
    (typeof rec.access === 'string' && rec.access.trim() !== '') ||
    (typeof rec.refresh === 'string' && rec.refresh.trim() !== '')
  )
}

/**
 * Chat / subagent pickers list only providers that can actually run a turn.
 * Settings still shows the full catalog so a new provider can be signed in.
 */
export function listConfiguredModelProviders(facts: {
  ollamaReachable: boolean
  chatgptConnected: boolean
  hasCredential: Readonly<Record<string, boolean>> | ((provider: string) => boolean)
  alwaysInclude?: readonly string[]
}): SyloModelProvider[] {
  const hasCred =
    typeof facts.hasCredential === 'function' ?
      facts.hasCredential
    : (p: string) => Boolean((facts.hasCredential as Readonly<Record<string, boolean>>)[p])
  const extras = new Set((facts.alwaysInclude ?? []).map((p) => p.trim()).filter(Boolean))
  return SYLO_MODEL_PROVIDERS.filter((p) => {
    if (extras.has(p)) return true
    if (p === 'ollama') return facts.ollamaReachable
    if (p === CHATGPT_CODEX_PROVIDER) return facts.chatgptConnected
    return hasCred(p)
  })
}

/** Keep a currently selected provider visible even if its credential was removed. */
export function mergeVisibleProviders(
  configured: readonly string[],
  extras: readonly (string | null | undefined)[] = [],
): SyloModelProvider[] {
  const extraSet = new Set(
    extras.map((p) => (p ?? '').trim()).filter((p): p is string => p !== ''),
  )
  return SYLO_MODEL_PROVIDERS.filter((p) => configured.includes(p) || extraSet.has(p))
}
