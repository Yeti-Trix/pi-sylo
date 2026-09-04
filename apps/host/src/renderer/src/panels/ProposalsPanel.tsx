import { useCallback, useEffect, useState } from 'react'

import { cn } from '../lib/cn'
import {
  btnDangerSm,
  btnGhostSm,
  btnPrimarySm,
  card,
  cardTitle,
  input,
  leadText,
  mutedText,
  panelTitle,
  rowItem,
  textarea,
} from './ui-classes'

type ProposalItem = {
  root: string
  kind: 'commons' | 'workspace'
  label: string
  relPath: string
  fileName: string
  id: string
  title: string
  status: string
  scope: string
  target: string
  source: string
  body: string
  proposedChange: string
  frontmatterError?: string
}

type ProposalsList = {
  ok: true
  commonsDir: string
  pending: ProposalItem[]
  recent: Array<{
    root: string
    kind: 'commons' | 'workspace'
    label: string
    status: string
    fileName: string
    mtimeMs: number
  }>
}

export function ProposalsPanel(): React.ReactElement {
  const [data, setData] = useState<ProposalsList | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<ProposalItem | null>(null)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState('')
  const [rejectMode, setRejectMode] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const r = await window.sylo.proposals.list()
    if (r.ok) {
      setData(r)
      setErr(null)
    } else {
      setErr(r.error)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sameItem = (a: ProposalItem | null, b: ProposalItem) =>
    Boolean(a) && a!.root === b.root && a!.relPath === b.relPath

  async function doApply(item: ProposalItem): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      const r = await window.sylo.proposals.apply(item.root, item.relPath, editing ? editBody : undefined)
      if (r.ok) {
        setNotice(
          `Applied ${item.id} (${item.label})\n${r.pushOk ? 'committed + pushed' : r.detail || 'committed locally'}`,
        )
      } else {
        setNotice(`Apply failed: ${r.error}${'detail' in r && r.detail ? `\n${r.detail}` : ''}`)
      }
      setSelected(null)
      setEditing(false)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function doReject(item: ProposalItem): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      const r = await window.sylo.proposals.reject(item.root, item.relPath, reason)
      setNotice(
        r.ok
          ? `Rejected ${item.id} (kept in rejected/ of ${item.label})\n${r.pushOk ? 'committed + pushed' : r.detail || 'no commit (not a git repo)'}`
          : `Reject failed: ${r.error}`,
      )
      setSelected(null)
      setRejectMode(false)
      setReason('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const pending = data?.pending ?? []

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className={panelTitle}>Proposals</h2>
          <p className={leadText}>
            Skill / memory changes the agent proposed from conversations, scanned across every repo
            Sylo knows (commons + workspace projects). Approve or reject — nothing applies
            without you, and every decision is a git commit in the target repo.
          </p>
        </div>
        <button type="button" className={btnGhostSm} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {err && <div className={cn(card, 'mb-3 text-red-400')}>Failed to load proposals: {err}</div>}

      <div className="mb-4">
        <h3 className={cn(cardTitle, 'mt-1')}>Pending review ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className={mutedText}>Queue is clear — no proposals waiting.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {pending.map((p) => (
              <li key={`${p.root}:${p.relPath}`} className={rowItem}>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className={cn(
                      'bg-transparent p-0 text-left text-[0.88rem] font-semibold underline-offset-2 hover:underline',
                      sameItem(selected, p) && 'underline',
                    )}
                    onClick={() => {
                      setSelected(sameItem(selected, p) ? null : p)
                      setEditing(false)
                      setRejectMode(false)
                      setNotice(null)
                    }}
                  >
                    {p.id} — {p.title}
                  </button>
                  <span className={cn('text-[0.7rem] uppercase', mutedText)}>
                    {p.kind === 'workspace' ? p.label : `${p.label}`} · {p.scope}
                  </span>
                </div>
                <div className={cn('mt-1 text-[0.8rem]', mutedText)}>target: {p.target}</div>

                {sameItem(selected, p) && (
                  <div className="mt-3 flex flex-col gap-3">
                    {p.frontmatterError && (
                      <div className="text-[0.8rem] text-amber-400">
                        Frontmatter problem: {p.frontmatterError}
                      </div>
                    )}
                    <div className="text-[0.8rem]">
                      <span className="font-semibold">Rationale / source:</span> {p.source || '—'}
                      {p.kind === 'workspace' && (
                        <span className={cn('ml-2', mutedText)}>
                          (workspace repo — commits stay local, no auto-push)
                        </span>
                      )}
                    </div>
                    {editing ? (
                      <textarea
                        className={textarea}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        spellCheck={false}
                      />
                    ) : (
                      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-bg-primary p-2.5 font-mono text-[0.75rem] leading-[1.45] whitespace-pre-wrap">
                        {p.proposedChange || p.body}
                      </pre>
                    )}
                    {rejectMode ? (
                      <div className="flex flex-col gap-2">
                        <input
                          className={input}
                          placeholder="Why reject? (kept in the audit trail)"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={btnDangerSm}
                            disabled={busy}
                            onClick={() => void doReject(p)}
                          >
                            Confirm reject
                          </button>
                          <button
                            type="button"
                            className={btnGhostSm}
                            onClick={() => setRejectMode(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={btnPrimarySm}
                          disabled={busy}
                          onClick={() => void doApply(p)}
                        >
                          {editing ? 'Apply edited version' : 'Approve & apply'}
                        </button>
                        <button
                          type="button"
                          className={btnGhostSm}
                          disabled={busy}
                          onClick={() => {
                            setEditing(!editing)
                            setEditBody(p.body)
                          }}
                        >
                          {editing ? 'Discard edits' : 'Edit before apply'}
                        </button>
                        <button
                          type="button"
                          className={btnDangerSm}
                          disabled={busy}
                          onClick={() => setRejectMode(true)}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {notice && <div className={cn(card, 'mb-3 text-[0.82rem] whitespace-pre-wrap')}>{notice}</div>}

      <h3 className={cardTitle}>Recent decisions</h3>
      {data && data.recent.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {data.recent.map((r) => (
            <li key={`${r.root}:${r.status}:${r.fileName}:${r.mtimeMs}`} className={cn('text-[0.8rem]', mutedText)}>
              <span
                className={cn(
                  'mr-2 font-semibold',
                  r.status === 'applied' ? 'text-emerald-400' : 'text-red-400',
                )}
              >
                {r.status}
              </span>
              {r.fileName} <span className="opacity-60">({r.label})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={mutedText}>Nothing applied or rejected yet.</p>
      )}
    </div>
  )
}