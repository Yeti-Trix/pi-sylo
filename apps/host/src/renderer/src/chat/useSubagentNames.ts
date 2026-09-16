import { useEffect, useState } from 'react'

/**
 * Persona names for `@mention` highlighting, cached for the whole renderer.
 *
 * Every user bubble in the transcript needs this list, so fetching per component
 * would mean one IPC round trip per message on every scroll-back.
 */
let cache: string[] | null = null
let inflight: Promise<string[]> | null = null
const listeners = new Set<(names: string[]) => void>()

async function load(): Promise<string[]> {
  let names: string[] = []
  try {
    names = (await window.sylo.tasks.agents()).map((a) => a.name)
  } catch {
    // Highlighting is cosmetic: an unreadable list just means plain text.
    names = []
  }
  cache = names
  for (const notify of listeners) notify(names)
  return names
}

function ensureLoaded(): Promise<string[]> {
  if (cache) return Promise.resolve(cache)
  inflight ??= load().finally(() => {
    inflight = null
  })
  return inflight
}

/** Call after a persona is created or deleted so existing chips follow the new list. */
export function invalidateSubagentNames(): void {
  cache = null
  inflight = null
  void ensureLoaded()
}

export function useSubagentNames(): string[] {
  const [names, setNames] = useState<string[]>(cache ?? [])

  useEffect(() => {
    let active = true
    const notify = (next: string[]): void => {
      if (active) setNames(next)
    }
    listeners.add(notify)
    void ensureLoaded().then(notify)
    return () => {
      active = false
      listeners.delete(notify)
    }
  }, [])

  return names
}
