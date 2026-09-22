import { useEffect, useMemo, useState } from 'react'
import { SYLO_MODEL_PROVIDERS, type SyloModelProvider } from '../../../shared/chatgpt-codex'
import { mergeVisibleProviders } from '../../../shared/configured-providers'

/**
 * Providers the chat / subagent pickers may offer: only those with a working
 * login (Ollama reachable, ChatGPT OAuth, or a stored API key). `extras` keeps
 * the current selection visible if its credential was removed.
 */
export function useConfiguredProviders(
  extras: readonly (string | null | undefined)[] = [],
  refreshKey?: string | number | boolean,
): SyloModelProvider[] {
  const [configured, setConfigured] = useState<string[] | null>(null)
  const extraKey = extras.map((e) => e ?? '').join('\0')

  useEffect(() => {
    let cancelled = false
    const load = window.sylo.models.configuredProviders
    if (typeof load !== 'function') {
      setConfigured([...SYLO_MODEL_PROVIDERS])
      return
    }
    void load()
      .then((rows) => {
        if (!cancelled) setConfigured(Array.isArray(rows) ? rows : [...SYLO_MODEL_PROVIDERS])
      })
      .catch(() => {
        if (!cancelled) setConfigured([...SYLO_MODEL_PROVIDERS])
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return useMemo(
    () => mergeVisibleProviders(configured ?? [], extraKey.split('\0')),
    [configured, extraKey],
  )
}
