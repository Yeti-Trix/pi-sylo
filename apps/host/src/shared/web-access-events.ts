/** IPC audit events from sylo-web-access extension → Sylo host (mirrors packages/sylo-web-access/extensions/sylo-host.ts). */

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
