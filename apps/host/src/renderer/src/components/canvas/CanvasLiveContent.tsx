import React, { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { mutedText } from '../../panels/ui-classes'
import { ChatMarkdown } from '../../ChatMarkdown'
import type { CanvasLiveSubscription } from './canvasTypes'
import {
  TaskDetailDrawer,
} from '../../panels/tasks/TaskDetailDrawer'
import type { AgentTaskRow } from '../../panels/tasks/task-types'
import type {
  ChatPresenceRow as WorkspaceChatPresenceRow,
  SubagentBoardData,
  SubagentRunBoardRow,
} from '../../../../shared/subagent-tasks-types'

/**
 * Host-owned live canvas renderer. Sibling to `CanvasContent` (which renders
 * the snapshot kinds svg/mermaid/markdown and is NOT touched here). The host
 * owns all canvas renderers — see `CanvasContent.tsx` for the precedent.
 *
 * Live kinds:
 *   `'task-board'`  — a task list bound to a `liveId`. The board
 *                     live-updates as the agent mutates the list via the
 *                     `sylo_task_*` tools, AND the operator can click a
 *                     checkbox to toggle done/todo and edit per-task notes
 *                     inline. Operator edits fire `canvas:task-apply-edit`
 *                     → main → broker → store → `sylo-tasks:changed` → the
 *                     board reconciles (eventual consistency).
 *
 * Popout note: a popped-out canvas cannot receive `canvas:show` (snapshot path
 * is main-window-only). Live canvas solves this — the popout subscribes to
 * the same `liveId` and the main process fans `canvas:live-update` to it.
 * Operator edits work from the popout too (the IPC is renderer→main, not
 * main-window-specific).
 */

// Local mirror of `packages/sylo-tasks/shared/types.ts` shapes. Defined here
// (not imported across the package boundary) to avoid a cross-package `.ts`
// import tripping TS6307 in the web tsconfig — same precedent the main
// process follows with its `unknown` snapshot type. Keep in sync with the
// package types if they change.
type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'skipped'
type TaskBoardTask = {
  id: string
  list_id: string
  title: string
  status: TaskStatus
  notes?: string
  due?: string
  /** Id of the sylo-scheduler reminder for this task's due (Phase 6). Shown as
   *  a "⏰ reminder" chip when set. */
  reminder_schedule_id?: string
  blocked_by: string[]
  blocks: string[]
  created_at: number
  updated_at: number
}
type TaskBoardList = {
  id: string
  title: string
  mode: 'agent_driven' | 'operator_driven'
  description?: string
  created_at: number
  updated_at: number
}
type TaskBoardData = { list: TaskBoardList; tasks: TaskBoardTask[] }

type Props = {
  sub: CanvasLiveSubscription | null
  /** Docked canvas only — switch the main window to this chat (row “Open chat” action). */
  onOpenChat?: (conversationId: string) => void
}

export function CanvasLiveContent({ sub, onOpenChat }: Props): React.ReactElement {
  if (!sub) {
    return (
      <p className={cn(mutedText, 'm-0 text-[0.85rem] leading-[1.45]')}>
        No live canvas subscription.
      </p>
    )
  }

  if (sub.kind === 'task-board') {
    return <TaskBoard sub={sub} />
  }

  if (sub.kind === 'subagent-runs') {
    return <SubagentRunsBoard sub={sub} onOpenChat={onOpenChat} />
  }

  return (
    <p className={cn(mutedText, 'p-2 text-[0.85rem]')}>
      Unknown live canvas kind: <code>{sub.kind}</code>
    </p>
  )
}

// ── task-board ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
  skipped: 'Skipped',
}

/** Tailwind class string for the status pill + glyph. */
function statusClasses(status: TaskStatus): string {
  switch (status) {
    case 'done':
      return 'text-success'
    case 'in_progress':
      return 'text-accent'
    case 'blocked':
      return 'text-danger'
    case 'skipped':
      return 'text-text-secondary'
    default:
      return 'text-text-secondary'
  }
}

/** Glyph drawn inside the checkbox box. */
function statusGlyph(status: TaskStatus): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'in_progress':
      return '•'
    case 'blocked':
      return '!'
    case 'skipped':
      return '–'
    default:
      return ''
  }
}

function isOverdue(due: string | undefined, status: TaskStatus): boolean {
  if (!due || status === 'done' || status === 'skipped') return false
  // due is YYYY-MM-DD; compare to today (local date) as YYYY-MM-DD.
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return due < todayStr
}

/** Per-task optimistic override applied on top of the live snapshot until the
 *  next `canvas:live-update` reconciles. Cleared whenever `sub` changes (a new
 *  snapshot arrived). Keys are task ids. */
type Override = { status?: TaskStatus; notes?: string }

function TaskBoard({
  sub,
}: {
  sub: CanvasLiveSubscription
}): React.ReactElement {
  const data = (sub.data ?? null) as TaskBoardData | null

  // Optimistic overrides: show the operator's click/edit instantly; the next
  // live update replaces `sub.data` and we drop the overrides (the real store
  // value is now authoritative). If the edit failed, the update never comes and
  // the override sticks until the next agent mutation — acceptable for v1.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  // Clear overrides whenever a fresh snapshot arrives (sub is a new object per
  // canvas:live-update). Keeps the board from drifting if an edit silently
  // failed and a later unrelated update lands.
  useEffect(() => {
    setOverrides({})
  }, [sub])

  if (!data || !data.list || !Array.isArray(data.tasks)) {
    return (
      <p className={cn(mutedText, 'm-0 text-[0.85rem] leading-[1.45]')}>
        No task list bound to this canvas.
      </p>
    )
  }

  const { list, tasks } = data
  const byId = new Map<string, TaskBoardTask>()
  for (const t of tasks) byId.set(t.id, t)

  const effStatus = (t: TaskBoardTask): TaskStatus => overrides[t.id]?.status ?? t.status
  const effNotes = (t: TaskBoardTask): string | undefined => {
    const o = overrides[t.id]
    if (o && o.notes !== undefined) return o.notes || undefined
    return t.notes
  }

  const counts = {
    total: tasks.length,
    done: tasks.filter((t) => effStatus(t) === 'done').length,
    inProgress: tasks.filter((t) => effStatus(t) === 'in_progress').length,
    blocked: tasks.filter((t) => effStatus(t) === 'blocked').length,
    skipped: tasks.filter((t) => effStatus(t) === 'skipped').length,
  }

  function toggleStatus(t: TaskBoardTask): void {
    const cur = effStatus(t)
    // 3-click cycle the operator asked for: todo → in_progress → done →
    // todo (reset). `blocked` / `skipped` are agent-managed states outside the
    // cycle; a click still enters the cycle at `in_progress` (the operator is
    // actively engaging the task), so any click makes forward progress.
    const next: TaskStatus =
      cur === 'todo' || cur === 'blocked' || cur === 'skipped' ? 'in_progress'
      : cur === 'in_progress' ? 'done'
      : 'todo' // done → reset
    setOverrides((o) => ({ ...o, [t.id]: { ...o[t.id], status: next } }))
    void window.sylo.canvas
      .taskApplyEdit({ liveId: sub.liveId, taskId: t.id, status: next })
      .then((r) => {
        if (!r?.ok) {
          // Revert on failure: drop this override so the next live update
          // re-establishes the real status.
          setOverrides((o) => {
            const { [t.id]: _drop, ...rest } = o
            return rest
          })
        }
      })
  }

  function saveNotes(t: TaskBoardTask, notes: string): void {
    const trimmed = notes.trim()
    setOverrides((o) => ({ ...o, [t.id]: { ...o[t.id], notes: trimmed } }))
    void window.sylo.canvas
      .taskApplyEdit({ liveId: sub.liveId, taskId: t.id, notes: trimmed ? trimmed : null })
      .then((r) => {
        if (!r?.ok) {
          setOverrides((o) => {
            const { [t.id]: _drop, ...rest } = o
            return rest
          })
        }
      })
  }

  return (
    <div className="flex h-full min-h-[inherit] flex-col gap-3">
      {/* Header */}
      <div className="shrink-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="m-0 text-[1.05rem] font-semibold text-text-primary">
            {list.title}
          </h2>
          <span
            className={cn(
              'rounded-full border border-border bg-bg-tertiary px-2 py-0.5 text-[0.7rem] uppercase tracking-wide',
              list.mode === 'agent_driven' ? 'text-accent' : 'text-text-secondary',
            )}
            title={
              list.mode === 'agent_driven'
                ? 'Agent owns the structure; operator checks items off and adds notes'
                : 'Operator owns the structure; agent reads and advises'
            }
          >
            {list.mode === 'agent_driven' ? 'agent-driven' : 'operator-driven'}
          </span>
        </div>
                {list.description ?
          <div className={cn(mutedText, 'mt-1 text-[0.82rem] leading-[1.45]')}>
            <ChatMarkdown text={list.description} />
          </div>
        : null}
      </div>

      {/* Summary */}
      <div className={cn(mutedText, 'shrink-0 text-[0.78rem]')}>
        {counts.total} task{counts.total === 1 ? '' : 's'} ·{' '}
        <span className="text-success">{counts.done} done</span>
        {counts.inProgress > 0 ? <> · <span className="text-accent">{counts.inProgress} in progress</span></> : null}
        {counts.blocked > 0 ? <> · <span className="text-danger">{counts.blocked} blocked</span></> : null}
        {counts.skipped > 0 ? <> · {counts.skipped} skipped</> : null}
      </div>

      {/* Tasks */}
      <ul className="m-0 flex list-none flex-col gap-2 overflow-auto p-0">
        {tasks.length === 0 ?
          <li className={cn(mutedText, 'text-[0.85rem]')}>No tasks yet.</li>
        : tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            byId={byId}
            effectiveStatus={effStatus(t)}
            effectiveNotes={effNotes(t)}
            onToggle={() => toggleStatus(t)}
            onSaveNotes={(notes) => saveNotes(t, notes)}
          />
        ))}
      </ul>

    </div>
  )
}

function TaskRow({
  task,
  byId,
  effectiveStatus,
  effectiveNotes,
  onToggle,
  onSaveNotes,
}: {
  task: TaskBoardTask
  byId: Map<string, TaskBoardTask>
  effectiveStatus: TaskStatus
  effectiveNotes: string | undefined
  onToggle: () => void
  onSaveNotes: (notes: string) => void
}): React.ReactElement {
  const overdue = isOverdue(task.due, effectiveStatus)
  const strike = effectiveStatus === 'done' || effectiveStatus === 'skipped'

  // Inline notes editor state. `editing` tracks whether the textarea is open;
  // `draft` holds the in-progress text. We seed draft from the effective notes
  // when editing begins so the operator edits the current value.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

    function beginEdit(): void {
    setDraft(effectiveNotes ?? '')
    setEditing(true)
  }
  // Click the rendered notes to edit them, but ignore clicks on links / code
  // paths inside the markdown so those navigate/resolve instead of opening
  // the textarea.
  function onNotesClick(e: React.MouseEvent): void {
    const target = e.target as HTMLElement | null
    if (target?.closest('a, code, pre')) return
    beginEdit()
  }
  function commitEdit(): void {
    if (editing) {
      onSaveNotes(draft)
      setEditing(false)
    }
  }
  function cancelEdit(): void {
    setEditing(false)
  }

  // Resolve blocker titles for a friendlier "blocked by …" line.
  const blockerTitles = task.blocked_by
    .map((bid) => byId.get(bid)?.title)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)

  return (
    <li className="rounded-lg border border-border bg-bg-primary px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        {/* Clickable checkbox: toggles done/todo. Other statuses show a glyph
            (read-only) since they're agent-managed — clicking still snaps to
            done so the operator can check off anything. */}
        <button
          type="button"
          aria-label={STATUS_LABEL[effectiveStatus]}
          title={`Click to cycle status: todo → in progress → done → reset. Currently ${STATUS_LABEL[effectiveStatus]}.`}
          onClick={onToggle}
          className={cn(
            'mt-0.5 flex h-[1.1rem] w-[1.1rem] shrink-0 cursor-pointer items-center justify-center rounded border text-[0.78rem] leading-none transition-colors hover:border-accent-muted',
            statusClasses(effectiveStatus),
            effectiveStatus === 'todo'
              ? 'border-border bg-bg-secondary'
              : 'border-current bg-transparent',
          )}
        >
          {statusGlyph(effectiveStatus)}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={cn(
                'text-[0.9rem] font-medium',
                strike ? 'text-text-secondary line-through' : 'text-text-primary',
              )}
            >
              {task.title}
            </span>
            <span className={cn('text-[0.72rem] uppercase tracking-wide', statusClasses(effectiveStatus))}>
              {STATUS_LABEL[effectiveStatus]}
            </span>
            {task.due ?
              <span
                className={cn(
                  'text-[0.74rem] tabular-nums',
                  overdue ? 'text-danger' : 'text-text-secondary',
                )}
                title={overdue ? `Overdue (was due ${task.due})` : `Due ${task.due}`}
              >
                due {task.due}
              </span>
            : null}
            {task.reminder_schedule_id ?
              <span
                className="text-[0.74rem] text-accent"
                title="A sylo-scheduler reminder is set for this task's due date"
              >
                ⏰ reminder
              </span>
            : null}
          </div>

          {/* Notes: inline-editable. Click the text (or "Add note") to edit;
              Enter or blur saves, Escape cancels. */}
          {editing ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitEdit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              rows={8}
              placeholder="Notes for this task (markdown)…"
              className="mt-1 w-full resize-y rounded-md border border-accent-muted bg-bg-secondary px-2 py-1 text-[0.78rem] leading-[1.4] text-text-primary placeholder:text-text-secondary focus:outline-none"
            />
                    ) : effectiveNotes ? (
            <div
              onClick={onNotesClick}
              title="Click to edit notes"
              className={cn(
                mutedText,
                'mt-1 cursor-text text-[0.78rem] leading-[1.4] hover:text-text-primary',
              )}
            >
              <ChatMarkdown text={effectiveNotes ?? ''} />
            </div>
          ) : (
            <button
              type="button"
              onClick={beginEdit}
              className="mt-1 text-[0.74rem] text-text-secondary hover:text-accent"
            >
              + add note
            </button>
          )}

          {blockerTitles.length > 0 ?
            <p className={cn(mutedText, 'm-0 mt-1 text-[0.74rem]')}>
              blocked by: {blockerTitles.join(' · ')}
            </p>
          : null}
        </div>
      </div>
    </li>
  )
}
// ── subagent-runs board ─────────────────────────────────────────────────────

// Workspace-scoped (F1/F2): rows + presence chats come from the shared contract
// (apps/host/src/shared) built in main from agent_tasks — the old conversation-scoped
// local duplicates are gone: one chat's runs list used to look like the whole
// workspace, which is how a result delivered to the wrong chat went unnoticed.
const RUN_STATUS_DOT: Record<SubagentRunBoardRow['status'], string> = {
  running: '●',
  awaiting_input: '⏸',
  succeeded: '✓',
  failed: '✕',
  cancelled: '■',
  orphaned: '?',
}
const RUN_STATUS_LABEL: Record<SubagentRunBoardRow['status'], string> = {
  running: 'running',
  awaiting_input: 'awaiting your answer',
  succeeded: 'finished',
  failed: 'failed',
  cancelled: 'stopped',
  orphaned: 'lost (broker restart)',
}
const RUN_STATUS_CLASS: Record<SubagentRunBoardRow['status'], string> = {
  running: 'text-accent',
  awaiting_input: 'text-warning',
  succeeded: 'text-success',
  failed: 'text-danger',
  cancelled: 'text-text-secondary',
  orphaned: 'text-danger',
}

function elapsedLabel(row: SubagentRunBoardRow): string {
  const start = row.startedAt ?? Date.now()
  const end = row.endedAt ?? Date.now()
  const ms = Math.max(0, end - start)
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return `${min}m${sec > 0 ? ` ${sec}s` : ''}`
}

/** When a finished/stale thing changed, in operator words. */
function relWhen(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Presence row — one chat's main agent, live first (F2: “what are they working on?”). */
function PresenceChatRow({
  chat,
  onOpenChat,
}: {
  chat: WorkspaceChatPresenceRow
  onOpenChat?: (conversationId: string) => void
}): React.ReactElement {
  const prompt = chat.lastPrompt?.trim() || null
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-bg-tertiary/30 px-2.5 py-1.5">
      <span
        className={cn(
          'mt-[0.32rem] inline-block size-2 shrink-0 rounded-full',
          chat.activeTurn ? 'animate-pulse bg-[rgb(245_158_11)]' : 'bg-[rgb(255_255_255/0.25)]',
        )}
        title={chat.activeTurn ? 'A turn is running in this chat' : 'Idle'}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[0.82rem] font-semibold text-text-primary">{chat.title}</span>
          {chat.model ?
            <span className={cn(mutedText, 'truncate font-mono text-[0.7rem]')} title={chat.model}>
              {chat.model}
            </span>
          : null}
        </div>
        {chat.activeTurn ?
          <p className={cn(mutedText, 'mb-0 mt-0.5 truncate text-[0.78rem]')} title={prompt ?? ''}>
            working on: {prompt ?? '…'}
          </p>
        : prompt ?
          <p className={cn(mutedText, 'mb-0 mt-0.5 truncate text-[0.74rem] text-text-secondary')} title={prompt ?? ''}>
            last: {prompt}
          </p>
        : null}
      </div>
      {onOpenChat ?
        <button
          type="button"
          className="mt-0.5 shrink-0 border-0 bg-transparent p-0 text-[0.72rem] text-accent hover:underline"
          onClick={() => onOpenChat(chat.conversationId)}
        >
          open chat
        </button>
      : null}
    </div>
  )
}

/** Live tail for a running row — re-rendered on the board's own ~2s ticker while
 *  the run is in flight (data patches already carry the tail). Clicking a finished
 *  run opens its full report via the shared TaskDetailDrawer (tasks/get). */
function SubagentRunsBoard({
  sub,
  onOpenChat,
}: {
  sub: CanvasLiveSubscription
  onOpenChat?: (conversationId: string) => void
}): React.ReactElement {
  const [, tick] = useState(0)
  useEffect(() => {
    // Ticker keeps elapsed labels live between data patches.
    const t = setInterval(() => tick((n) => n + 1), 2000)
    return () => clearInterval(t)
  }, [])
  const [detail, setDetail] = useState<{ row: SubagentRunBoardRow; task: AgentTaskRow | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const data = sub.data as SubagentBoardData | undefined
  const chats = data?.chats ?? []
  const activeChats = chats.filter((c) => c.activeTurn)
  const idleChats = chats.filter((c) => !c.activeTurn).slice(0, 12)
  const rows = data?.rows ?? []
  const running = rows.filter((r) => r.status === 'running')
  const awaiting = rows.filter((r) => r.status === 'awaiting_input')
  const done = rows.filter((r) => r.status !== 'running' && r.status !== 'awaiting_input')
  const shownDone = done.slice(-12)

  const openDetail = (row: SubagentRunBoardRow): void => {
    setDetail({ row, task: null })
    void window.sylo.tasks.get(row.taskId).then((task) => {
      setDetail((prev) => (prev && prev.row.taskId === row.taskId ? { row, task } : prev))
    })
  }

  if (rows.length === 0 && chats.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <p className={cn(mutedText, 'm-0 text-[0.85rem] leading-[1.5]')}>
          No subagent runs for this workspace yet.
        </p>
        <p className={cn(mutedText, 'm-0 text-[0.8rem] leading-[1.5]')}>
          The agent dispatches personas with the <code className="rounded bg-bg-tertiary px-1 font-mono text-[0.78rem]">subagent</code> tool
          (background is the default — completions arrive as messages), or with an
          {' @mention '}of a persona name. This board lists every run in every chat of this
          workspace with live output, plus what each chat is working on.
        </p>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col gap-3 p-3">
      {chats.length > 0 ?
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-[0.72rem] font-semibold tracking-wide text-text-secondary uppercase">
            Active agents · {chats.filter((c) => c.activeTurn).length}/{chats.length}
          </p>
          {activeChats.map((chat) => (
            <PresenceChatRow key={chat.conversationId} chat={chat} onOpenChat={onOpenChat} />
          ))}
          {idleChats.map((chat) => (
            <PresenceChatRow key={chat.conversationId} chat={chat} onOpenChat={onOpenChat} />
          ))}
        </div>
      : null}
      {[
        { key: 'running' as const, title: 'Running', list: running },
        { key: 'awaiting' as const, title: 'Awaiting input', list: awaiting },
        { key: 'done' as const, title: 'Finished', list: shownDone },
      ].map((section) =>
        section.list.length === 0 ? null : (
          <div key={section.key} className="flex flex-col gap-2">
            <p className="m-0 text-[0.72rem] font-semibold tracking-wide text-text-secondary uppercase">
              {section.title} · {section.list.length}
            </p>
            {section.list.map((row) => (
              <SubagentRunRow key={row.taskId} row={row} onOpenChat={onOpenChat} onOpenDetail={() => openDetail(row)} />
            ))}
          </div>
        ),
      )}
      {done.length > shownDone.length ?
        <p className={cn(mutedText, 'm-0 text-[0.72rem]')}>
          {done.length - shownDone.length} older finished run{done.length - shownDone.length === 1 ? '' : 's'} hidden — full history in the Tasks view.
        </p>
      : null}
      {notice ?
        <p className="mb-0 text-[0.76rem] text-warning">{notice}</p>
      : null}
      {detail ?
        <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto rounded-lg border border-border bg-bg-secondary p-3">
          <div className="flex items-center justify-between gap-2">
            <p className={cn(mutedText, 'm-0 text-[0.76rem]')}>
              {detail.row.conversationTitle ? `via ${detail.row.conversationTitle} · ` : ''}run{'\u200b'}{detail.row.runId.slice(0, 8)}
            </p>
            <button
              type="button"
            className="border-0 bg-transparent p-0 text-[0.78rem] text-accent hover:underline"
              onClick={() => {
                setDetail(null)
                setNotice(null)
              }}
            >
              ✕ close
            </button>
          </div>
          <div className="mt-2 min-h-0 flex-1">
            <TaskDetailDrawer
              embedded
              task={detail.task}
              chainTasks={null}
              onSelectTask={() => {}}
              onRetry={(message) => setNotice(message)}
              onCancel={(message) => setNotice(message)}
            />
          </div>
        </div>
      : null}
    </div>
  )
}

function SubagentRunRow({
  row,
  onOpenChat,
  onOpenDetail,
}: {
  row: SubagentRunBoardRow
  onOpenChat?: (conversationId: string) => void
  onOpenDetail?: () => void
}): React.ReactElement {
  const live = row.status === 'running'
  const usage =
    row.tokens != null && row.tokens > 0 ?
      `${row.tokens > 1000 ? `${(row.tokens / 1000).toFixed(1)}k` : row.tokens} tok`
    : null
  const tail = row.partialTail ?? null
  const taskTitle = row.title ?? row.agent
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-tertiary/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('text-[0.8rem] font-semibold', RUN_STATUS_CLASS[row.status])}>
          {RUN_STATUS_DOT[row.status]} {RUN_STATUS_LABEL[row.status]}
        </span>
        <code className="font-mono text-[0.84rem] font-semibold text-text-primary">{row.agent}</code>
        <span className={cn(mutedText, 'text-[0.72rem]')}>
          {row.mode}
          {row.stepIndex != null ? ` · step ${row.stepIndex}` : ''} · {live ? elapsedLabel(row) : relWhen(row.endedAt ?? Date.now())}
        </span>
        {row.model ?
          <span className={cn(mutedText, 'truncate text-[0.72rem]')} title={row.model}>
            {row.model}
          </span>
        : null}
        {usage ? <span className={cn(mutedText, 'text-[0.72rem]')}>{usage}</span> : null}
        {row.conversationTitle ?
          <span
            className="ml-auto max-w-[160px] shrink-0 truncate rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[0.68rem] text-text-secondary"
            title={row.conversationTitle}
          >
            {row.conversationTitle.length > 40 ? `${row.conversationTitle.trim().slice(0, 40)}…` : row.conversationTitle}
          </span>
        : null}
      </div>
      <button
        type="button"
        className="border-0 bg-transparent p-0 text-left text-[0.8rem] font-medium text-text-primary hover:text-accent"
        onClick={onOpenDetail}
        title="Open the run's full report"
      >
        {taskTitle.length > 140 ? `${taskTitle.slice(0, 140)}…` : taskTitle}
      </button>
      {row.files.length > 0 ?
        <p className="mb-0 text-[0.72rem] leading-[1.4] text-text-secondary" title={row.files.join(', ')}>
          {row.files.slice(0, 3).join(' · ')}{row.files.length > 3 ? ` · +${row.files.length - 3}` : ''}
        </p>
      : null}
      {row.question && row.status === 'awaiting_input' ?
        <p className="m-0 text-[0.8rem] leading-[1.45] text-warning">❓ {row.question}</p>
      : null}
      {tail && row.toolName ?
        <p className={cn(mutedText, 'm-0 truncate font-mono text-[0.74rem]')} title={row.toolPreview ?? ''}>
          ⚙ {row.toolName} — {row.toolPreview ?? ''}
        </p>
      : null}
      {tail ?
        <pre className="m-0 max-h-24 overflow-hidden font-mono text-[0.74rem] leading-[1.4] whitespace-pre-wrap text-text-secondary">
          {tail.length > 700 ? `${tail.slice(-700)}` : tail}
        </pre>
      : null}
    </div>
  )
}
