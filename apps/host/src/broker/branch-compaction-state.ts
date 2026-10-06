/**
 * Compaction facts derived from the live session BRANCH (leaf chain) instead of
 * in-memory event tracking.
 *
 * Why branch-derived: `runtime.switchSession` reloads the session from disk and
 * REPLACES the session object, so any guard keyed on session object identity is
 * void after a chat switch-away-and-back — the pre-compaction assistant usage row
 * kept in the branch tail was then treated as a fresh reading on every rebind
 * (footer stuck at the stale pre-compaction token total; deferred auto-compact
 * re-fired on every stats broadcast and Pi refused with "Already compacted",
 * stacking failed-compaction cards — see the root-cause chain of that bug).
 * Compactions that ran on an overflow/dedicated broker were likewise invisible to
 * any later session: the compaction entry is written to the session file before
 * that broker exits, and the next rebind reads it back. Reading the branch covers
 * both cases and needs no event bookkeeping at all.
 */
export type BranchCompactionState = {
  /**
   * Epoch ms of the most recent `compaction` / `branch_summary` entry on the
   * active branch. Any provider usage reading taken BEFORE it describes the
   * pre-compaction context and is stale for context-window stats. null = no
   * compaction/summary on the branch (or unusable timestamps) — no guard.
   */
  guardAt: number | null
  /**
   * True when the branch's LAST entry is a compaction: Pi's `prepareCompaction()`
   * returns undefined in this state, so another compaction attempt fails with
   * "Already compacted" until fresh entries are appended after it.
   */
  endsWithCompaction: boolean
}

/**
 * Structural session shape (no Pi import, so this bundles standalone for tests).
 * `SessionEntry.timestamp` is an ISO string; branch message timestamps read by the
 * stats scanner are epoch numbers — both are wall clock and directly comparable
 * after Date.parse.
 */
export type BranchStateSessionLike = {
  sessionManager: { getBranch(): Array<{ type: string; timestamp?: string }> }
}

export function readBranchCompactionState(
  sess: BranchStateSessionLike | undefined | null,
): BranchCompactionState {
  if (!sess?.sessionManager) return { guardAt: null, endsWithCompaction: false }
  try {
    const branch = sess.sessionManager.getBranch()
    if (!Array.isArray(branch) || branch.length === 0) {
      return { guardAt: null, endsWithCompaction: false }
    }
    const endsWithCompaction = branch[branch.length - 1]?.type === 'compaction'
    let guardAt: number | null = null
    // Scan backward along the leaf chain for the freshest context-replacing entry.
    // branch_summary replaces the context too — usage recorded before either
    // entry type describes the pre-summary context.
    for (let i = branch.length - 1; i >= 0; i--) {
      const e = branch[i]
      if (
        (e?.type === 'compaction' || e?.type === 'branch_summary') &&
        typeof e.timestamp === 'string'
      ) {
        const ts = Date.parse(e.timestamp)
        if (Number.isFinite(ts)) guardAt = ts
        break
      }
    }
    return { guardAt, endsWithCompaction }
  } catch {
    return { guardAt: null, endsWithCompaction: false }
  }
}