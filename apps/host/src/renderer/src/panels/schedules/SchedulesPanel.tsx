import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { cn } from '../../lib/cn'
import {
  btnDangerSm,
  btnGhostSm,
  btnPrimarySm,
  card,
  fieldLabel,
  input,
  leadText,
  mutedText,
  panelTitle,
  select,
  textarea,
} from '../ui-classes'

type ScheduleRecurrence = 'once' | 'daily' | 'weekly' | 'monthly'

type ScheduledPromptRow = {
  id: string
  workspace_id: string
  title: string
  prompt_text: string
  recurrence: ScheduleRecurrence
  start_at: number
  time_local: string
  day_of_week: number | null
  day_of_month: number | null
  max_runs: number | null
  run_count: number
  catchup_on_startup: number
  enabled: number
  reuse_conversation: number
  next_run_at: number
  last_run_at: number | null
  last_conversation_id: string | null
  last_run_status: string | null
  created_at: number
  updated_at: number
}

const RECURRENCE_LABELS: Record<ScheduleRecurrence, string> = {
  once: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatWhen(row: ScheduledPromptRow): string {
  const next = new Date(row.next_run_at).toLocaleString()
  if (row.recurrence === 'once') return next
  const parts = [RECURRENCE_LABELS[row.recurrence], row.time_local]
  if (row.recurrence === 'weekly' && row.day_of_week != null) {
    parts.push(DOW_LABELS[row.day_of_week] ?? '')
  }
  if (row.recurrence === 'monthly' && row.day_of_month != null) {
    parts.push(`day ${row.day_of_month}`)
  }
  return `${parts.filter(Boolean).join(' · ')} · next ${next}`
}

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocalValue(v: string): number {
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : Date.now()
}

const emptyForm = () => ({
  title: '',
  prompt_text: '',
  recurrence: 'daily' as ScheduleRecurrence,
  startLocal: toDatetimeLocalValue(Date.now()),
  time_local: '09:00',
  day_of_week: new Date().getDay(),
  day_of_month: new Date().getDate(),
  max_runs: '',
  catchup_on_startup: true,
  enabled: true,
  reuse_conversation: false,
})

function promptPreview(text: string, maxLen = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return `${oneLine.slice(0, maxLen).trimEnd()}…`
}

function runsLabel(row: ScheduledPromptRow): string {
  const max = row.max_runs != null ? ` / ${row.max_runs}` : ''
  return `Runs ${row.run_count}${max}`
}

type ScheduleRunRow = {
  id: number
  fired_at: number
  status: 'ok' | 'error'
  conversation_id: string | null
  brief: string | null
  duration_ms: number | null
}

/** Countdown-only next-fire label for an enabled schedule (history context). */
function runsWhen(ts: number): string {
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
function nextFireLabel(row: ScheduledPromptRow): string | null {
  if (!row.enabled) return null
  const ms = row.next_run_at - Date.now()
  if (ms <= 0) return 'due now'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `next: in ${min} min`
  const hr = Math.round(min / 60)
  if (hr < 48) return `next: in ${hr} h`
  return `next: in ${Math.round(hr / 24)} d`
}

function ScheduleRow({
  row,
  busy,
  onEdit,
  onFireNow,
  onDelete,
  onOpenConversation,
  onPinOutput,
}: {
  row: ScheduledPromptRow
  busy: boolean
  onEdit: () => void
  onFireNow: () => void
  onDelete: () => void
  onOpenConversation?: (conversationId: string) => void
  /** Pin a run's output: open the conversation in chat + prefill the composer. */
  onPinOutput?: (conversationId: string) => void
}): React.ReactElement {
  const [runs, setRuns] = useState<ScheduleRunRow[]>([])

  // History loads (and RE-loads) whenever the row is OPEN (details) — cheap
  // (single indexed select, cap 20) and always fresh per expand.
  useEffect(() => {
    let dead = false
    const load = () => {
      void window.sylo.schedules
        .listRuns(row.id)
        .then((r) => {
          if (!dead) setRuns([...r])
        })
        .catch(() => {
          /* history is optional */
        })
    }
    load()
    const u = window.sylo.schedules.onChanged((p) => {
      if (p?.workspaceId === row.workspace_id) load()
    })
    return () => {
      dead = true
      u()
    }
  }, [row.id, row.workspace_id])
  return (
    <details className={cn(card, 'group/schedule')}>
      <summary
        className={cn(
          'flex cursor-pointer list-none flex-wrap items-start justify-between gap-2',
          '[&::-webkit-details-marker]:hidden [&::marker]:content-none',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium text-text-primary">{row.title || 'Untitled schedule'}</div>
          <p
            className={cn(
              mutedText,
              'm-0 mt-1 line-clamp-2 text-[0.78rem] leading-snug group-open/schedule:hidden',
            )}
          >
            {promptPreview(row.prompt_text)}
          </p>
          <div className={cn(mutedText, 'mt-1 text-[0.78rem]')}>{runsLabel(row)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className={btnGhostSm}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              onEdit()
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className={btnGhostSm}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              onFireNow()
            }}
          >
            Run now
          </button>
          <button
            type="button"
            className={btnDangerSm}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              onDelete()
            }}
          >
            Delete
          </button>
        </div>
      </summary>
      <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
        <div className={cn(mutedText, 'text-[0.78rem]')}>{formatWhen(row)}</div>
        <div className={cn(mutedText, 'text-[0.78rem]')}>
          {!row.enabled ? 'Disabled · ' : ''}
          {row.catchup_on_startup ? 'Catchup on startup' : 'No startup catchup'}
          {' · '}
          {row.reuse_conversation === 1 ? 'Same chat' : 'New chat'}
        </div>
        <p className="m-0 whitespace-pre-wrap text-[0.82rem] text-text-secondary">{row.prompt_text}</p>
        {row.last_conversation_id ?
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(btnGhostSm, 'self-start text-[0.75rem]')}
              onClick={() => onOpenConversation?.(row.last_conversation_id!)}
            >
              Open last run chat
            </button>
            {onPinOutput ?
              <button
                type="button"
                className={cn(btnGhostSm, 'self-start text-[0.75rem]')}
                title="Jump to the last run's conversation and prefill the composer to continue from its output"
                onClick={() => onPinOutput?.(row.last_conversation_id!)}
              >
                Pin last output
              </button>
            : null}
          </div>
        : null}
        {/* Recent runs (task 14): capped log (20/schedule), survives restart. */}
        <div className="mt-1 border-t border-border pt-2">
          <div className={cn(mutedText, 'flex items-center justify-between gap-2 text-[0.74rem]')}>
            <span>{nextFireLabel(row) ?? 'not scheduled'}</span>
            <span>{runs.length > 0 ? `${runs.length} recent${runs.length >= 20 ? '+' : ''}` : 'no runs recorded yet'}</span>
          </div>
          {runs.length > 0 ?
            <div className="mt-1 flex flex-col gap-0.5">
              {runs.slice(0, 5).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex cursor-pointer items-center gap-2 rounded border-none bg-transparent px-1 py-0.5 text-left text-[0.74rem] hover:bg-bg-tertiary"
                  {...(r.conversation_id ? { onClick: () => onOpenConversation?.(r.conversation_id!) } : {})}
                  title={r.conversation_id ? 'Open the run conversation' : 'No conversation recorded'}
                  style={r.conversation_id ? undefined : { cursor: 'default' }}
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: r.status === 'ok' ? '#9ece6a' : '#f6553d' }}
                    title={r.status === 'ok' ? 'Fired' : 'Failed'}
                  />
                  <span className={mutedText}>{runsWhen(r.fired_at)}</span>
                  <span className={cn(mutedText, 'truncate')}>
                    {r.status === 'error' ? 'error' : 'fired'}
                    {r.duration_ms != null ? ` · ${r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${Math.round(r.duration_ms / 1000)}s`}` : ''}
                  </span>
                </button>
              ))}
            </div>
          : null}
        </div>
      </div>
    </details>
  )
}

export function SchedulesPanel({
  workspaceId,
  workspaceName,
  onOpenConversation,
  onPinOutput,
}: {
  workspaceId: string
  workspaceName: string
  onOpenConversation?: (conversationId: string) => void
  /** Task 14: open the run conversation + prefill the composer with a usable reference (App owns prefillChatPrompt). */
  onPinOutput?: (conversationId: string, schedule: ScheduledPromptRow) => void
}): React.ReactElement {
  const [rows, setRows] = useState<ScheduledPromptRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const list = (await window.sylo.schedules.list(workspaceId)) as ScheduledPromptRow[]
      setRows(list)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const off = window.sylo.schedules.onChanged((p) => {
      if (p.workspaceId === workspaceId) void reload()
    })
    return off
  }, [workspaceId, reload])

  const startCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setError(null)
  }

  const startEdit = (row: ScheduledPromptRow) => {
    setEditingId(row.id)
    setForm({
      title: row.title,
      prompt_text: row.prompt_text,
      recurrence: row.recurrence,
      startLocal: toDatetimeLocalValue(row.start_at),
      time_local: row.time_local,
      day_of_week: row.day_of_week ?? new Date().getDay(),
      day_of_month: row.day_of_month ?? new Date().getDate(),
      max_runs: row.max_runs != null ? String(row.max_runs) : '',
      catchup_on_startup: row.catchup_on_startup === 1,
      enabled: row.enabled === 1,
      reuse_conversation: row.reuse_conversation === 1,
    })
    setError(null)
  }

  const buildPayload = useMemo(() => {
    const start_at = fromDatetimeLocalValue(form.startLocal)
    const maxRunsRaw = form.max_runs.trim()
    const max_runs = maxRunsRaw ? Number.parseInt(maxRunsRaw, 10) : null
    return {
      title: form.title,
      prompt_text: form.prompt_text,
      recurrence: form.recurrence,
      start_at,
      time_local: form.time_local,
      day_of_week: form.recurrence === 'weekly' ? form.day_of_week : undefined,
      day_of_month: form.recurrence === 'monthly' ? form.day_of_month : undefined,
      max_runs: max_runs != null && Number.isFinite(max_runs) ? max_runs : null,
      catchup_on_startup: form.catchup_on_startup,
      enabled: form.enabled,
      reuse_conversation: form.reuse_conversation,
    }
  }, [form])

  const save = async () => {
    if (!form.prompt_text.trim()) {
      setError('Prompt text is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (editingId) {
        await window.sylo.schedules.update(editingId, buildPayload)
      } else {
        await window.sylo.schedules.create(workspaceId, buildPayload)
      }
      setEditingId(null)
      setForm(emptyForm())
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await window.sylo.schedules.delete(id)
      if (editingId === id) startCreate()
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const fireNow = async (id: string) => {
    setBusy(true)
    try {
      const result = await window.sylo.schedules.fireNow(id)
      if (result.ok && result.conversationId && onOpenConversation) {
        onOpenConversation(result.conversationId)
      }
      await reload()
    } finally {
      setBusy(false)
    }
  }

  if (!workspaceId) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-3">
        <h2 className={panelTitle}>Schedules</h2>
        <p className={cn(mutedText, leadText)}>Select a workspace to manage scheduled prompts.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1180px] flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={panelTitle}>Schedules</h2>
          <p className={cn(mutedText, 'm-0 text-[0.82rem]')}>
            Prompt schedules for{' '}
            <strong className="font-medium text-text-primary">{workspaceName || 'this workspace'}</strong>
            {loading ? ' · refreshing…' : ` · ${rows.length} total`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGhostSm} onClick={() => void reload()}>
            Refresh
          </button>
          <button type="button" className={btnPrimarySm} onClick={startCreate}>
            New schedule
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className={cn(card, 'flex shrink-0 flex-col gap-3 lg:w-[min(100%,26rem)] lg:overflow-y-auto')}>
          <h3 className="m-0 text-[0.9rem] font-semibold">{editingId ? 'Edit schedule' : 'New schedule'}</h3>
        {error ? <p className="m-0 text-[0.82rem] text-red-400">{error}</p> : null}
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Title</span>
          <input
            className={input}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Morning brief"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Prompt</span>
          <textarea
            className={textarea}
            rows={4}
            value={form.prompt_text}
            onChange={(e) => setForm((f) => ({ ...f, prompt_text: e.target.value }))}
            placeholder="What the agent should do when this schedule fires…"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Recurrence</span>
            <select
              className={select}
              value={form.recurrence}
              onChange={(e) =>
                setForm((f) => ({ ...f, recurrence: e.target.value as ScheduleRecurrence }))
              }
            >
              {(Object.keys(RECURRENCE_LABELS) as ScheduleRecurrence[]).map((k) => (
                <option key={k} value={k}>
                  {RECURRENCE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>
              {form.recurrence === 'once' ? 'Run at (local)' : 'Start date (local)'}
            </span>
            <input
              className={input}
              type="datetime-local"
              value={form.startLocal}
              onChange={(e) => setForm((f) => ({ ...f, startLocal: e.target.value }))}
            />
          </label>
          {form.recurrence !== 'once' ?
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Time (HH:MM local)</span>
              <input
                className={input}
                value={form.time_local}
                onChange={(e) => setForm((f) => ({ ...f, time_local: e.target.value }))}
                placeholder="09:00"
              />
            </label>
          : null}
          {form.recurrence === 'weekly' ?
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Day of week</span>
              <select
                className={select}
                value={form.day_of_week}
                onChange={(e) =>
                  setForm((f) => ({ ...f, day_of_week: Number.parseInt(e.target.value, 10) }))
                }
              >
                {DOW_LABELS.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          : null}
          {form.recurrence === 'monthly' ?
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Day of month</span>
              <input
                className={input}
                type="number"
                min={1}
                max={31}
                value={form.day_of_month}
                onChange={(e) =>
                  setForm((f) => ({ ...f, day_of_month: Number.parseInt(e.target.value, 10) || 1 }))
                }
              />
            </label>
          : null}
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Max runs (blank = indefinite)</span>
            <input
              className={input}
              value={form.max_runs}
              onChange={(e) => setForm((f) => ({ ...f, max_runs: e.target.value }))}
              placeholder="e.g. 10"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Chat per run</span>
            <select
              className={select}
              value={form.reuse_conversation ? '1' : '0'}
              onChange={(e) =>
                setForm((f) => ({ ...f, reuse_conversation: e.target.value === '1' }))
              }
            >
              <option value="0">New chat each run</option>
              <option value="1">Continue in same chat</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-[0.82rem]">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.catchup_on_startup}
              onChange={(e) => setForm((f) => ({ ...f, catchup_on_startup: e.target.checked }))}
            />
            Catch up once on startup if missed
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Enabled
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimarySm} disabled={busy} onClick={() => void save()}>
            {editingId ? 'Save changes' : 'Create schedule'}
          </button>
          {editingId ?
            <button type="button" className={btnGhostSm} disabled={busy} onClick={startCreate}>
              Cancel edit
            </button>
          : null}
        </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
        {rows.length === 0 ?
          <p className={cn(mutedText, leadText)}>
            No schedules yet. Create one in the form or ask the agent in chat.
          </p>
        : rows.map((row) => (
          <ScheduleRow
            key={row.id}
            row={row}
            busy={busy}
            onEdit={() => startEdit(row)}
            onFireNow={() => void fireNow(row.id)}
            onDelete={() => void remove(row.id)}
            onOpenConversation={onOpenConversation} onPinOutput={(cid) => onPinOutput?.(cid, row!)}
          />
        ))}
        </div>
      </div>
    </div>
  )
}
