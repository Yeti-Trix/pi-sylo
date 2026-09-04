/**
 * Sylo host audit bridge for web-access events.
 *
 * Emits structured search/rank/fetch/rewrite/error events to the Electron main
 * process over fork IPC (no-op outside the Sylo broker). The host persists
 * these for the Web access audit UI. Mirrors the sylo-subagents host bridge.
 */
import { randomUUID } from 'node:crypto'

export type SyloWebAccessEvent =
  | { type: 'search_start'; runId: string; tool: 'search' | 'fetch'; query?: string; url?: string }
  | {
      type: 'search_results'
      runId: string
      tier: string
      count: number
      query?: string
    }
  | {
      type: 'rank'
      runId: string
      kept: number
      dropped: number
      threshold: number
      scores: Array<{ url: string; score: number }>
    }
  | { type: 'fetch'; runId: string; url: string; tier: string; bytes: number; adequate: boolean }
  | { type: 'rewrite'; runId: string; url: string; relevant: boolean }
  | { type: 'error'; runId: string; stage: string; message: string }
  | { type: 'run_end'; runId: string; status: 'ok' | 'error' }
  | {
      type: 'brave_quota'
      limit: number | null
      remaining: number | null
      resetSeconds: number | null
      fetchedAt: number
    }

export function newWebAccessRunId(): string {
  return randomUUID()
}

/** Notify the Sylo host of a web-access event. No-op when not running under fork IPC. */
export function notifyWebAccess(event: SyloWebAccessEvent): void {
  const snd = process.send?.bind(process) as ((msg: unknown) => boolean) | undefined
  if (!snd) return
  snd({ type: 'sylo_web_access', event })
}
