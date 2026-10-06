/**
 * Run: npm run test:branch-compaction-state -w apps/host
 *
 * Covers the branch-derived compaction guard that replaced the per-session-object
 * `lastCompaction` bookkeeping in the broker: staleness must survive switchSession
 * reloads (which replace the session object) and compactions that ran on an
 * overflow/dedicated broker (entry written to the session file before exit).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readBranchCompactionState } from '../../out/test/branch-compaction-state.mjs'

/** ISO timestamp helper (Pi session entries store ISO strings; messages use epoch ms). */
const iso = (ms) => new Date(ms).toISOString()

function sessionWithEntries(entries) {
  return { sessionManager: { getBranch: () => entries } }
}

function compactionEntry(atMs) {
  return { type: 'compaction', id: `c${atMs}`, parentId: null, timestamp: iso(atMs) }
}

function messageEntry(atMs) {
  return { type: 'message', id: `m${atMs}`, parentId: null, timestamp: iso(atMs) }
}

describe('readBranchCompactionState', () => {
  test('no session / no manager → no guard, no refusal', () => {
    assert.deepEqual(readBranchCompactionState(undefined), { guardAt: null, endsWithCompaction: false })
    assert.deepEqual(readBranchCompactionState(null), { guardAt: null, endsWithCompaction: false })
    assert.deepEqual(readBranchCompactionState({}), { guardAt: null, endsWithCompaction: false })
  })

  test('branch without compaction → no guard, no refusal', () => {
    const st = readBranchCompactionState(sessionWithEntries([messageEntry(1000), messageEntry(2000)]))
    assert.equal(st.guardAt, null)
    assert.equal(st.endsWithCompaction, false)
  })

  test('branch ending with compaction → refusal flag + guard at its timestamp', () => {
    // The switch-back state: only pre-compaction history plus the compaction entry.
    const t0 = 1_700_000_000_000
    const st = readBranchCompactionState(
      sessionWithEntries([messageEntry(t0), compactionEntry(t0 + 5_000)]),
    )
    assert.equal(st.endsWithCompaction, true)
    assert.equal(st.guardAt, t0 + 5_000)
  })

  test('fresh turns after the compaction → no refusal, guard still set', () => {
    const t0 = 1_700_000_000_000
    const st = readBranchCompactionState(
      sessionWithEntries([
        compactionEntry(t0),
        messageEntry(t0 + 60_000),
        messageEntry(t0 + 70_000),
      ]),
    )
    assert.equal(st.endsWithCompaction, false)
    assert.equal(st.guardAt, t0)
  })

  test('branch_summary also sets the staleness guard, but never the refusal flag', () => {
    const t0 = 1_700_000_000_000
    const endsWithSummary = readBranchCompactionState(
      sessionWithEntries([messageEntry(t0), { type: 'branch_summary', id: 'b1', parentId: null, timestamp: iso(t0 + 9_000) }]),
    )
    assert.equal(endsWithSummary.guardAt, t0 + 9_000)
    assert.equal(endsWithSummary.endsWithCompaction, false)
  })

  test('newest context-replacing entry wins', () => {
    const t0 = 1_700_000_000_000
    const st = readBranchCompactionState(
      sessionWithEntries([
        compactionEntry(t0),
        messageEntry(t0 + 10_000),
        compactionEntry(t0 + 20_000),
      ]),
    )
    assert.equal(st.guardAt, t0 + 20_000)
    assert.equal(st.endsWithCompaction, true)
  })

  test('unreadable timestamps → no guard instead of a bogus one', () => {
    const st = readBranchCompactionState(
      sessionWithEntries([{ type: 'compaction', id: 'c', parentId: null, timestamp: 'not-a-date' }]),
    )
    assert.equal(st.guardAt, null)
    assert.equal(st.endsWithCompaction, true, 'refusal flag does not depend on the timestamp')
  })

  test('getBranch throwing → degraded to no guard, no refusal', () => {
    const st = readBranchCompactionState({
      sessionManager: {
        getBranch() {
          throw new Error('boom')
        },
      },
    })
    assert.deepEqual(st, { guardAt: null, endsWithCompaction: false })
  })
})