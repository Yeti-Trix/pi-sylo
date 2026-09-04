import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  bridge,
  type Task,
  type TaskList,
  type TaskStatus,
  type TasksWorkspaceSnapshot,
} from './bridge'

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'todo',
  in_progress: 'in progress',
  done: 'done',
  blocked: 'blocked',
  skipped: 'skipped',
}

/** Due date is past today (local) and the task isn't done/skipped. */
function isOverdue(due: string, status: TaskStatus): boolean {
  if (!due || status === 'done' || status === 'skipped') return false
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return due < todayStr
}

/** 3-click cycle matching the Canvas board: todo → in_progress → done → todo.
 *  `blocked`/`skipped` re-enter the cycle at in_progress on first click. */
function nextStatus(s: TaskStatus): TaskStatus {
  switch (s) {
    case 'todo':
      return 'in_progress'
    case 'in_progress':
      return 'done'
    case 'done':
      return 'todo'
    case 'blocked':
    case 'skipped':
      return 'in_progress'
  }
}

type ListStat = { total: number; done: number }

export function App() {
  const [snapshot, setSnapshot] = useState<TasksWorkspaceSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workspaceCwd, setWorkspaceCwd] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatingList, setCreatingList] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const snap = await bridge.snapshotGet()
      setSnapshot(snap)
      setError(null)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    bridge.workspaceCwd().then((c) => setWorkspaceCwd(typeof c === 'string' ? c : '')).catch(() => {})
  }, [refresh])

  const lists = snapshot?.lists ?? []
  const tasksByList = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of snapshot?.tasks ?? []) {
      const arr = m.get(t.list_id) ?? []
      arr.push(t)
      m.set(t.list_id, arr)
    }
    return m
  }, [snapshot])

  const statsByList = useMemo(() => {
    const m = new Map<string, ListStat>()
    for (const l of lists) {
      const ts = tasksByList.get(l.id) ?? []
      m.set(l.id, { total: ts.length, done: ts.filter((t) => t.status === 'done').length })
    }
    return m
  }, [lists, tasksByList])

  // Keep a valid selection when the snapshot changes (e.g. list deleted).
  useEffect(() => {
    if (!lists.length) {
      if (selectedId) setSelectedId(null)
      return
    }
    if (!selectedId || !lists.some((l) => l.id === selectedId)) {
      setSelectedId(lists[0].id)
    }
  }, [lists, selectedId])

  const selected = lists.find((l) => l.id === selectedId) ?? null
  const selectedTasks = selected ? tasksByList.get(selected.id) ?? [] : []

  const onCycleStatus = useCallback(
    async (t: Task) => {
      // Optimistic: the next refresh reconciles.
      try {
        await bridge.taskUpdate({ id: t.id, status: nextStatus(t.status) })
        await refresh()
      } catch (e) {
        setError(String((e as Error)?.message ?? e))
      }
    },
    [refresh],
  )

  return (
    <div className="app">
      <aside className="lists">
        <div className="lists-head">
          <h1>Tasks</h1>
          <span className="muted" style={{ fontSize: '0.72rem', marginLeft: 'auto' }}>
            {lists.length} {lists.length === 1 ? 'list' : 'lists'}
          </span>
        </div>
        <div className="lists-scroll">
          {loading && <div className="muted" style={{ padding: '0.75rem' }}>Loading…</div>}
          {!loading && lists.length === 0 && (
            <div className="muted" style={{ padding: '0.75rem', fontSize: '0.8rem' }}>
              No task lists in this workspace yet.
            </div>
          )}
          {lists.map((l) => {
            const st = statsByList.get(l.id) ?? { total: 0, done: 0 }
            return (
              <button
                key={l.id}
                className={`list-row${l.id === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(l.id)}
                title={l.description}
              >
                <span className="title">{l.title}</span>
                <span className="count">
                  {st.done}/{st.total}
                </span>
              </button>
            )
          })}
        </div>
        {creatingList ? (
          <NewListForm
            onCancel={() => setCreatingList(false)}
            onCreated={async () => {
              setCreatingList(false)
              await refresh()
            }}
          />
        ) : (
          <button className="list-new" onClick={() => setCreatingList(true)}>
            + New list
          </button>
        )}
      </aside>

      <main className="tasks">
        {error && <div className="error">{error}</div>}
        {!selected && !loading && (
          <div className="tasks-body">
            <div className="empty">
              {lists.length === 0
                ? 'Create a list to start tracking tasks in this workspace.'
                : 'Select a list on the left.'}
            </div>
          </div>
        )}
        {selected && (
          <ListDetail
            list={selected}
            tasks={selectedTasks}
            workspaceCwd={workspaceCwd}
            onCycleStatus={onCycleStatus}
            onRefresh={refresh}
            onError={setError}
          />
        )}
      </main>
    </div>
  )
}

function NewListForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'agent_driven' | 'operator_driven'>('agent_driven')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div className="new-list-form">
      <input
        autoFocus
        placeholder="List title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim() && !busy) {
            setBusy(true)
            bridge
              .listCreate({ title: title.trim(), mode, description: description.trim() || undefined })
              .then(onCreated)
              .catch(() => setBusy(false))
          }
        }}
      />
      <select value={mode} onChange={(e) => setMode(e.target.value as 'agent_driven' | 'operator_driven')}>
        <option value="agent_driven">agent-driven</option>
        <option value="operator_driven">operator-driven</option>
      </select>
      <textarea
        placeholder="Description (optional)"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="row">
        <button className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-accent"
          disabled={!title.trim() || busy}
          onClick={() => {
            setBusy(true)
            bridge
              .listCreate({ title: title.trim(), mode, description: description.trim() || undefined })
              .then(onCreated)
              .catch(() => setBusy(false))
          }}
        >
          Create
        </button>
      </div>
    </div>
  )
}

function ListDetail({
  list,
  tasks,
  workspaceCwd,
  onCycleStatus,
  onRefresh,
  onError,
}: {
  list: TaskList
  tasks: Task[]
  workspaceCwd: string
  onCycleStatus: (t: Task) => void
  onRefresh: () => Promise<void>
  onError: (e: string | null) => void
}) {
  const [quickAdd, setQuickAdd] = useState('')
  const [deleting, setDeleting] = useState(false)

    const sorted = useMemo(() => {
    // done tasks sink to the bottom; otherwise respect store-array order
    // (the order the agent set via after_task_id / moveTask), NOT created_at —
    // a spliced-in task has a fresh created_at and would otherwise jump to end.
    return [...tasks]
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const ad = a.t.status === 'done' ? 1 : 0
        const bd = b.t.status === 'done' ? 1 : 0
        if (ad !== bd) return ad - bd
        return a.i - b.i
      })
      .map(({ t }) => t)
  }, [tasks])

  const addQuick = async () => {
    const t = quickAdd.trim()
    if (!t) return
    try {
      await bridge.taskAdd({ list_id: list.id, title: t })
      setQuickAdd('')
      await onRefresh()
    } catch (e) {
      onError(String((e as Error)?.message ?? e))
    }
  }

  const removeList = async () => {
    if (deleting) return
    if (!confirm(`Delete list "${list.title}" and all ${tasks.length} task(s)?`)) return
    setDeleting(true)
    try {
      await bridge.listDelete(list.id)
      await onRefresh()
    } catch (e) {
      onError(String((e as Error)?.message ?? e))
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="tasks-head">
        <div className="meta">
          <h2 className="title">{list.title}</h2>
          {list.description && <p className="desc">{list.description}</p>}
          <div className="mode">
            {list.mode.replace('_', ' ')}
            {workspaceCwd && <span className="muted"> · {workspaceCwd}</span>}
          </div>
        </div>
        <button className="btn btn-danger" onClick={removeList} disabled={deleting}>
          Delete list
        </button>
      </div>
      <div className="tasks-body">
        <div className="quick-add">
          <textarea
            rows={4}
            placeholder="Add a task and press Enter… (Shift+Enter for a new line)"
            value={quickAdd}
            onChange={(e) => setQuickAdd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void addQuick()
              }
            }}
          />
          <button onClick={() => void addQuick()} disabled={!quickAdd.trim()}>
            Add
          </button>
        </div>
        {sorted.length === 0 && <div className="empty">No tasks yet. Add one above.</div>}
        {sorted.map((t) => (
          <TaskRow key={t.id} task={t} onCycleStatus={onCycleStatus} onRefresh={onRefresh} onError={onError} />
        ))}
      </div>
    </>
  )
}

function TaskRow({
  task,
  onCycleStatus,
  onRefresh,
  onError,
}: {
  task: Task
  onCycleStatus: (t: Task) => void
  onRefresh: () => Promise<void>
  onError: (e: string | null) => void
}) {
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [notesDraft, setNotesDraft] = useState(task.notes ?? '')
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setTitleDraft(task.title), [task.title])
  useEffect(() => setNotesDraft(task.notes ?? ''), [task.notes])

  const saveTitle = async () => {
    const t = titleDraft.trim()
    if (t && t !== task.title) {
      try {
        await bridge.taskUpdate({ id: task.id, title: t })
        await onRefresh()
      } catch (e) {
        onError(String((e as Error)?.message ?? e))
      }
    }
  }

  const saveNotes = async () => {
    if (notesTimer.current) {
      clearTimeout(notesTimer.current)
      notesTimer.current = null
    }
    try {
      await bridge.taskUpdate({ id: task.id, notes: notesDraft })
      await onRefresh()
    } catch (e) {
      onError(String((e as Error)?.message ?? e))
    }
  }

  const scheduleSaveNotes = () => {
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => void saveNotes(), 600)
  }

  const remove = async () => {
    if (!confirm('Delete this task?')) return
    try {
      await bridge.taskDelete(task.id)
      await onRefresh()
    } catch (e) {
      onError(String((e as Error)?.message ?? e))
    }
  }

  return (
    <div className={`task${task.status === 'done' ? ' done' : ''}`}>
      <button
        className="check"
        data-status={task.status}
        onClick={() => onCycleStatus(task)}
        title={`Click to cycle status: todo → in progress → done → reset. Currently ${STATUS_LABEL[task.status]}.`}
        aria-label="cycle status"
      />
      <div className="task-main">
        <div className="task-title-row">
          <input
            className="task-title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
          />
          <span className="pill" data-status={task.status}>
            {STATUS_LABEL[task.status]}
          </span>
          <div className="task-actions">
            <button className="icon-btn danger" onClick={remove} title="Delete task" aria-label="delete">
              ✕
            </button>
          </div>
        </div>
        <div className="task-meta">
          {task.due && (
            <span className={`chip due${isOverdue(task.due, task.status) ? ' overdue' : ''}`} title={isOverdue(task.due, task.status) ? `Overdue (was due ${task.due})` : `Due ${task.due}`}>
              due {task.due}
            </span>
          )}
          {task.reminder_schedule_id && (
            <span className="chip reminder" title="A sylo-scheduler reminder is set for this task's due date">⏰ reminder</span>
          )}
          {task.blocked_by.map((bid) => (
            <span key={bid} className="chip blocked" title={`Blocked by task ${bid.slice(0, 8)}`}>
              blocked by {bid.slice(0, 6)}…
            </span>
          ))}
        </div>
        <textarea
          className="task-notes"
          placeholder="Notes…"
          value={notesDraft}
          onChange={(e) => {
            setNotesDraft(e.target.value)
            scheduleSaveNotes()
          }}
          onBlur={() => void saveNotes()}
          rows={1}
        />
      </div>
    </div>
  )
}