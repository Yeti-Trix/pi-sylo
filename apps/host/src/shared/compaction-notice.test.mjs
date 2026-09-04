/**
 * Run: node --test apps/host/src/shared/compaction-notice.test.mjs
 * (after: npx esbuild apps/host/src/shared/compaction-notice.ts --bundle --platform=node --format=esm --outfile=apps/host/out/test/compaction-notice.mjs --packages=external)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  compactionNoticeBody,
  compactionNoticeTitle,
  compactionTriggerLabel,
  formatCompactionNoticeContent,
  parseCompactionNoticeContent,
} from '../../out/test/compaction-notice.mjs'

describe('compaction-notice', () => {
  test('round-trips structured system message payload', () => {
    const raw = formatCompactionNoticeContent({
      kind: 'compaction',
      reason: 'threshold',
      tokensBefore: 72825,
      summary: 'We discussed health logging.',
    })
    const parsed = parseCompactionNoticeContent(raw)
    assert.ok(parsed)
    assert.equal(parsed.reason, 'threshold')
    assert.equal(parsed.tokensBefore, 72825)
    assert.equal(parsed.summary, 'We discussed health logging.')
    assert.equal(compactionNoticeTitle(parsed), 'Context compacted')
    assert.match(compactionNoticeBody(parsed), /72,825/)
    assert.equal(compactionTriggerLabel(parsed.reason), 'auto (context threshold)')
  })

  test('rejects non-compaction json', () => {
    assert.equal(parseCompactionNoticeContent('{"kind":"other"}'), null)
  })
})
