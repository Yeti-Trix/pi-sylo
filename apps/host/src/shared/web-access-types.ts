/** Persisted web-access audit run (one sylo_web_search or sylo_web_fetch invocation). */

export type WebAccessToolKind = 'search' | 'fetch'

export type WebAccessRunStatus = 'running' | 'ok' | 'error'

export interface WebAccessRunRow {
  id: string
  conversation_id: string | null
  turn_id: string | null
  tool: WebAccessToolKind
  query: string | null
  url: string | null
  status: WebAccessRunStatus
  search_tier: string | null
  result_count: number | null
  rank_kept: number | null
  rank_dropped: number | null
  rank_threshold: number | null
  rank_scores_json: string | null
  fetches_json: string | null
  error_stage: string | null
  error_message: string | null
  started_at: number
  ended_at: number | null
}

export interface WebAccessStats {
  totalRuns: number
  searchRuns: number
  fetchRuns: number
  errorRuns: number
  last24h: number
  tierCounts: Record<string, number>
}
