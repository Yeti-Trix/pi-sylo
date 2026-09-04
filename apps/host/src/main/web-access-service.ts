import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { SyloWebAccessEvent } from '../shared/web-access-events.js'
import { webAccessBraveQuotaPath } from './web-access-config.js'
import * as store from './web-access-db.js'

export function handleWebAccessHostEvent(
  conversationId: string | null,
  turnId: string | null,
  event: SyloWebAccessEvent,
  userDataPath: string,
): void {
  switch (event.type) {
    case 'search_start':
      store.insertWebAccessRunStart({
        id: event.runId,
        conversationId,
        turnId,
        tool: event.tool,
        query: event.query,
        url: event.url,
      })
      break
    case 'search_results':
      store.patchWebAccessRun(event.runId, {
        search_tier: event.tier,
        result_count: event.count,
      })
      break
    case 'rank':
      store.patchWebAccessRun(event.runId, {
        rank_kept: event.kept,
        rank_dropped: event.dropped,
        rank_threshold: event.threshold,
        rank_scores_json: JSON.stringify(event.scores),
      })
      break
    case 'fetch':
      store.appendFetchToRun(event.runId, {
        url: event.url,
        tier: event.tier,
        bytes: event.bytes,
        adequate: event.adequate,
      })
      break
    case 'rewrite':
      store.appendFetchToRun(event.runId, {
        url: event.url,
        tier: 'rewrite',
        bytes: 0,
        adequate: true,
        relevant: event.relevant,
      })
      break
    case 'error':
      store.patchWebAccessRun(event.runId, {
        status: 'error',
        error_stage: event.stage,
        error_message: event.message.slice(0, 2000),
        ended_at: Date.now(),
      })
      break
        case 'run_end':
      store.patchWebAccessRun(event.runId, {
        status: event.status,
        ended_at: Date.now(),
      })
      break
    case 'brave_quota':
      try {
        const path = webAccessBraveQuotaPath(userDataPath)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(
          path,
          JSON.stringify(
            {
              limit: event.limit,
              remaining: event.remaining,
              reset_seconds: event.resetSeconds,
              fetched_at: event.fetchedAt,
            },
            null,
            2,
          ),
          'utf8',
        )
      } catch {
        // Best-effort telemetry snapshot; never fail the run on write error.
      }
      break
  }
}

export const webAccessStore = store
