import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { s2BackendsAfterS1Failure } from './search-tier.ts'

const baseConfig = {
  ollamaHost: '',
  rankModel: '',
  rewriteModel: '',
  rankingEnabled: true,
  relevancyThreshold: 0.55,
  rankMaxRetries: 3,
  maxSearchResults: 10,
  maxPagesPerSearch: 3,
  maxFetchCallsPerTurn: 5,
  maxSearchCallsPerTurn: 3,
  searchBackends: ['duckduckgo', 'mojeek', 'brave', 'startpage'],
  heavyTiersEnabled: true,
  previewImagesEnabled: false,
  maxPreviewImagesPerPage: 1,
}

describe('s2BackendsAfterS1Failure', () => {
  it('drops duckduckgo from configured backends', () => {
    assert.deepEqual(
      s2BackendsAfterS1Failure({
        ...baseConfig,
        searchBackends: ['duckduckgo', 'mojeek', 'brave'],
      }),
      ['mojeek', 'brave'],
    )
  })

  it('falls back to privacy defaults when only duckduckgo is configured', () => {
    assert.deepEqual(
      s2BackendsAfterS1Failure({
        ...baseConfig,
        searchBackends: ['duckduckgo'],
      }),
      ['mojeek', 'brave', 'startpage'],
    )
  })

  it('normalizes backend names', () => {
    assert.deepEqual(
      s2BackendsAfterS1Failure({
        ...baseConfig,
        searchBackends: [' DuckDuckGo ', 'Brave'],
      }),
      ['brave'],
    )
  })
})
