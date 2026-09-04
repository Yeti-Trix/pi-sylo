/**
 * skill-route bridge: postMessage RPC to the host (Sylo desktop). The host
 * validates `event.source === iframe.contentWindow` + nonce, dispatches the op
 * in `handleSkillRouteBridge`, and replies with `sylo-skill-bridge-reply`.
 *
 * The host injects the active workspace's resolved cwd into every `tasks*`
 * call, so this bridge never needs to resolve it for data ops. `workspaceCwd`
 * is fetched once via `workspaceResolvedPiCwd` only for a header subtitle.
 */

function hasDesktopNonce(): boolean {
  const nonce = (window as unknown as { __SYLO_NONCE__?: string }).__SYLO_NONCE__
  return typeof nonce === 'string' && nonce.length > 0
}

function rpcViaPostMessage<T>(op: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const reqId = `r-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as {
        kind?: string
        reqId?: string
        ok?: boolean
        result?: T
        error?: string
      }
      if (!d || d.kind !== 'sylo-skill-bridge-reply' || d.reqId !== reqId) return
      window.removeEventListener('message', onMsg)
      if (d.ok) resolve(d.result as T)
      else reject(new Error(d.error || 'bridge_error'))
    }
    window.addEventListener('message', onMsg)
    window.parent.postMessage(
      {
        v: 1,
        kind: 'sylo-skill-bridge',
        nonce: (window as unknown as { __SYLO_NONCE__?: string }).__SYLO_NONCE__,
        reqId,
        op,
        payload: payload ?? {},
      },
      '*',
    )
  })
}

function rpc<T>(op: string, payload?: unknown): Promise<T> {
  if (hasDesktopNonce()) return rpcViaPostMessage<T>(op, payload)
  // No companion-server fallback for v1 (tasks is desktop-only).
  return Promise.reject(new Error('not_desktop'))
}

export type WriteResult<T> = { ok: true; result: T } | { ok: false; error: string }

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'skipped'

export type Task = {
  id: string
  list_id: string
  title: string
  status: TaskStatus
  notes?: string
  due?: string
  reminder_schedule_id?: string
  blocked_by: string[]
  blocks: string[]
  created_at: number
  updated_at: number
}

export type TaskList = {
  id: string
  title: string
  mode: 'agent_driven' | 'operator_driven'
  description?: string
  created_at: number
  updated_at: number
}

export type TasksWorkspaceSnapshot = {
  lists: TaskList[]
  tasks: Task[]
}

function unwrap<T>(p: Promise<WriteResult<T>>): Promise<T> {
  return p.then((r) => {
    if (!r.ok) throw new Error(r.error)
    return r.result
  })
}

export const bridge = {
  snapshotGet: () => unwrap<TasksWorkspaceSnapshot | null>(rpc<WriteResult<TasksWorkspaceSnapshot | null>>('tasksSnapshotGet', {})),
  listGet: (listId: string) =>
    unwrap<{ list: TaskList; tasks: Task[] } | null>(
      rpc<WriteResult<{ list: TaskList; tasks: Task[] } | null>>('tasksListGet', { listId }),
    ),
  listCreate: (args: { title: string; mode?: string; description?: string }) =>
    unwrap<TaskList>(rpc<WriteResult<TaskList>>('tasksListCreate', args)),
  listDelete: (listId: string) =>
    unwrap<boolean>(rpc<WriteResult<boolean>>('tasksListDelete', { listId })),
  taskAdd: (args: {
    list_id: string
    title: string
    status?: string
    notes?: string
    due?: string
    blocked_by?: string[]
  }) => unwrap<Task>(rpc<WriteResult<Task>>('tasksTaskAdd', args)),
  taskUpdate: (args: {
    id: string
    title?: string
    status?: string
    notes?: string | null
    due?: string | null
    blocked_by?: string[]
  }) => unwrap<Task | null>(rpc<WriteResult<Task | null>>('tasksTaskUpdate', args)),
  taskDelete: (taskId: string) => unwrap<boolean>(rpc<WriteResult<boolean>>('tasksTaskDelete', { taskId })),
  workspaceCwd: () => rpc<string>('workspaceResolvedPiCwd', {}),
}