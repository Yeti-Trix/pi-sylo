export type WorkflowEntryResult = {
  id: string
  title: string
  description: string
  source: string
  path: string
  filename: string
  editable: boolean
}

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
  return Promise.reject(new Error('Workflows UI requires Sylo desktop route bridge'))
}

export const bridge = {
  syloWorkflowsList: (payload?: { project_dir?: string }) =>
    rpc<{
      ok: true
      workflows: WorkflowEntryResult[]
      library: { operator_dir: string; bundled_dir: string; legacy_dir: string }
    }>('syloWorkflowsList', payload ?? {}),
  syloWorkflowRead: (payload: { project_dir: string; id: string }) =>
    rpc<{
      ok: true
      id: string
      title: string
      description: string
      source: string
      path: string
      editable: boolean
      body: string
      raw: string
    }>('syloWorkflowRead', payload),
  syloWorkflowSave: (payload: { content: string; previous_id?: string }) =>
    rpc<{ ok: true; workflow: WorkflowEntryResult }>('syloWorkflowSave', payload),
  syloWorkflowDelete: (payload: { id: string }) =>
    rpc<{ ok: true; deleted: WorkflowEntryResult }>('syloWorkflowDelete', payload),
  requestAgentAction: (payload: {
    prompt: string
    project_dir?: string
    delivery?: 'confirm_modal' | 'prefill_new_chat'
  }) => rpc<{ queued: true; prefill?: true }>('requestAgentAction', payload),
  readSkillData: (key: string) => rpc<unknown>('readSkillData', { key }),
  writeSkillData: (key: string, value: unknown) =>
    rpc<{ written: boolean }>('writeSkillData', { key, value }),
  workspaceResolvedPiCwd: () => rpc<string>('workspaceResolvedPiCwd', {}),
}