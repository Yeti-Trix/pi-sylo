import React, { useCallback, useEffect, useState } from 'react'

import { btnGhostSm, leadText, mutedText, panelTitle } from '../ui-classes'
import { cn } from '../../lib/cn'

/**
 * Checkpoint timeline per chat (task 13): every kept turn checkpoint for the
 * open conversation with what THAT turn changed (modified/added/deleted, from
 * the per-manifest hash stats — task 07 machinery), Preview + Restore actions.
 *
 * Read-only panel: Restore is the ONLY write and it routes through the EXISTING
 * Undo preview → restore flow the chat hover-Undo uses (`onPreviewRestore`),
 * including the safety capture and the every-file preview list — the operator
 * always sees exactly what will change. Restoring an older checkpoint rewrites
 * the whole pre-turn snapshot (documented in the modal + footer caption). This
 * is a WORKSPACE-ONLY rewind — conversation rewind is the edit-resend feature
 * (tasks 01–03); the two stay cleanly separated.
 */

type Entry = {
  assistantMessageId: string
  startedAt: number
  changes?: { modified: string[]; added: string[]; deleted: string[] }
}

type Props = {
  conversationId: string | undefined
  conversationTitle: string
  /** Opens the existing Undo preview modal for this turn (preview list +
   *  restore + safety capture happen there — the panel adds no restore path). */
  onPreviewRestore: (assistantMessageId: string) => void
}

function formatWhen(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return time
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}

export function CheckpointsPanel({
  conversationId,
  conversationTitle,
  onPreviewRestore,
}: Props): React.ReactElement {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setEntries([])
      setLoaded(true)
      return
    }
    setRefreshing(true)
    try {
      const list = (await window.sylo.checkpoints.list(conversationId)) as Entry[]
      setEntries(list)
    } catch {
      /* checkpoints are best-effort */
    } finally {
      setRefreshing(false)
      setLoaded(true)
    }
  }, [conversationId])

  // Fetch on open + when the conversation changes.
  useEffect(() => {
    void refresh()
  }, [refresh, loaded])

  // Live updates: turn starts/finish produce/adjust checkpoints — refetch on
  // chat-refresh events for this conversation (same signal the chat uses).
  useEffect(() => {
    if (!conversationId) return
    const u = window.sylo.chatEvents.onRefresh((p) => {
      if (p?.conversationId !== conversationId) return
      if (p.kind === 'turnFinished' || p.kind === 'turnStarted') void refresh()
    })
    return u
  }, [conversationId, refresh])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className={panelTitle}>
            Checkpoints — {conversationTitle?.trim() || 'chat'}
          </h2>
          <p className={cn(leadText, 'text-[0.78rem]')}>
            Snapshot of the workspace taken before each agent turn.
            Restoring an older point rewrites the whole workspace state (
            <em>files only</em> — the conversation is not rewound; that's what
            message Edit/Retry does).
          </p>
        </div>
        <button
          type="button"
          className={btnGhostSm}
          disabled={refreshing || !conversationId}
          title="Re-read the checkpoint list"
          onClick={() => void refresh()}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!conversationId ? (
        <p className={cn(mutedText, 'text-[0.82rem]')}>Open a chat first — this panel shows the checkpoints for the focused conversation.</p>
      ) : loaded && entries.length === 0 ? (
        <p className={cn(mutedText, 'text-[0.82rem]')}>
          No checkpoints kept for this chat yet. New turns capture one automatically (and
          anything the agent already changed since its last capture is only recoverable via git).
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
          {entries.map((e) => {
            const c = e.changes
            const mod = c?.modified.length ?? 0
            const add = c?.added.length ?? 0
            const del = c?.deleted.length ?? 0
            const total = mod + add + del
            return (
              <div
                key={e.assistantMessageId}
                className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[0.8rem] text-text-primary">
                    {formatWhen(e.startedAt)}
                  </span>
                  <span
                    className={cn(mutedText, 'shrink-0 whitespace-nowrap text-[0.72rem]')}
                    title="Files THIS turn changed (diffed against the previous turn's snapshot — matching what Undo would restore)"
                  >
                    {total === 0 ?
                      'no file changes'
                      : <>
                        <span className="text-[#e2c08d]">{mod} modified</span> ·{' '}
                        <span className="text-[#9ece6a]">{add} added</span> ·{' '}
                        <span className="text-[#f6b3a4]">{del} deleted</span>
                      </>}
                  </span>
                  <button
                    type="button"
                    className={btnGhostSm}
                    title="Preview what restoring this snapshot would change — the shared Undo modal lists every file before anything happens"
                    onClick={() => onPreviewRestore(e.assistantMessageId)}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className={btnGhostSm}
                    title="Restore this snapshot — goes through the same preview modal (nothing is written until you confirm there)"
                    onClick={() => onPreviewRestore(e.assistantMessageId)}
                  >
                    Restore
                  </button>
                </div>
                {total > 0 ?
                  <details>
                    <summary className={cn(mutedText, 'cursor-pointer select-none text-[0.7rem]')}>
                      files changed
                    </summary>
                    <div className="mt-1 flex flex-col gap-0.5 font-mono text-[0.7rem]">
                      {[
                        ...(c?.modified ?? []).map((rel) => ({ rel, cls: 'text-[#e2c08d]', g: 'M' })),
                        ...(c?.added ?? []).map((rel) => ({ rel, cls: 'text-[#9ece6a]', g: '+' })),
                        ...(c?.deleted ?? []).map((rel) => ({ rel, cls: 'text-[#f6b3a4]', g: '−' })),
                      ]
                        .slice(0, 12)
                        .map(({ rel, cls, g }) => (
                          <span key={rel} className={cn('break-all', cls)}>
                            {g} {rel}
                          </span>
                        ))}
                      {total > 12 ? <span className={mutedText}>+{total - 12} more</span> : null}
                    </div>
                  </details>
                : null}
              </div>
            )
          })}
        </div>
      )}
      <p className={cn(mutedText, 'border-t border-border pt-2 text-[0.7rem]')}>
        Retention: newest 5 turn snapshots per chat, 24h queued-turn safety snapshots, 7d safety
        captures; the whole store prunes oldest-first beyond 512MB. Restores always
        safety-capture the CURRENT state first (undo the undo from the chat's hover Undo).
      </p>
    </div>
  )
}