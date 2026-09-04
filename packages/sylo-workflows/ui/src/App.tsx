import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ConfirmModal } from './components/ConfirmModal'
import { bridge } from './bridge'
import { useResolvedWorkspace } from './hooks/useResolvedWorkspace'
import {
  buildWorkflowPrompt,
  DEFAULT_WORKFLOW_CONFIG,
  DEFAULT_WORKFLOW_ID,
  migrateWorkflowConfig,
  WORKFLOW_SKILL_DATA_KEY,
  type WorkflowConfig,
  type WorkflowListEntry,
} from './types/workflows'

const NEW_WORKFLOW_TEMPLATE = `---
id: new-workflow
title: New workflow
description: Short description for the workflow list
---

Describe what this workflow does and when to run it. This is a **prompt** loaded into chat — the agent follows it using whatever tools are available.

## Inputs (operator provides in chat)

Attach required files to the chat message before sending. If anything is missing, **ask and stop**.

## Steps

1. (describe tool order here)

## Rules

- Project folder = workspace Pi cwd (\`{workspace}\`)
`

export function App() {
  const { workspaceDir } = useResolvedWorkspace()
  const [workflows, setWorkflows] = useState<WorkflowListEntry[]>([])
  const [libraryDir, setLibraryDir] = useState('')
  const [config, setConfig] = useState<WorkflowConfig>(DEFAULT_WORKFLOW_CONFIG)
  const [draftRaw, setDraftRaw] = useState('')
  const [loadedId, setLoadedId] = useState('')
  const [loadedSource, setLoadedSource] = useState('')
  const [workflowLoading, setWorkflowLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [configReady, setConfigReady] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isNewDraft, setIsNewDraft] = useState(false)
  const hydratedRef = useRef(false)

  // Workflow script editor height — taller default, user-adjustable via the
  // textarea's native vertical resize handle. Persisted when storage is
  // available; the route runs in a sandboxed iframe (about:srcdoc) where
  // localStorage throws, so all access is guarded and degrades to the default.
  const SCRIPT_HEIGHT_KEY = 'sylo.workflows.scriptHeight'
  const [scriptHeight, setScriptHeight] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(SCRIPT_HEIGHT_KEY))
      return v && v > 0 ? v : 380
    } catch {
      return 380
    }
  })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = Math.round(e.contentRect.height)
        if (h <= 0) continue
        try {
          localStorage.setItem(SCRIPT_HEIGHT_KEY, String(h))
        } catch {
          /* sandboxed iframe — persistence unavailable, keep session-only */
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const loadWorkflowList = useCallback(async (projectDir: string) => {
    const data = await bridge.syloWorkflowsList({ project_dir: projectDir })
    setWorkflows(data.workflows)
    setLibraryDir(data.library.operator_dir)
  }, [])

  const loadWorkflowRaw = useCallback(async (workflowId: string, projectDir: string) => {
    if (!workflowId.trim() || workflowId === '__new__') {
      return
    }
    setWorkflowLoading(true)
    setError(null)
    try {
      const read = await bridge.syloWorkflowRead({
        project_dir: projectDir,
        id: workflowId,
      })
      setDraftRaw(read.raw)
      setLoadedId(read.id)
      setLoadedSource(read.source)
      setIsNewDraft(false)
    } catch (e) {
      setDraftRaw('')
      setLoadedId('')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorkflowLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const raw = await bridge.readSkillData(WORKFLOW_SKILL_DATA_KEY).catch(() => null)
        if (cancelled) return
        setConfig(migrateWorkflowConfig(raw))
      } catch {
        /* first visit */
      } finally {
        if (!cancelled) {
          hydratedRef.current = true
          setConfigReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!workspaceDir.trim()) {
      setWorkflows([])
      setLibraryDir('')
      return
    }
    void loadWorkflowList(workspaceDir.trim())
  }, [loadWorkflowList, workspaceDir])

  useEffect(() => {
    if (!hydratedRef.current) return
    void bridge.writeSkillData(WORKFLOW_SKILL_DATA_KEY, config).catch(() => {})
  }, [config])

  useEffect(() => {
    if (!configReady || !workspaceDir.trim() || isNewDraft) return
    void loadWorkflowRaw(config.selectedWorkflowId, workspaceDir.trim())
  }, [config.selectedWorkflowId, configReady, isNewDraft, loadWorkflowRaw, workspaceDir])

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === config.selectedWorkflowId),
    [workflows, config.selectedWorkflowId],
  )

  const canSave = draftRaw.trim().length > 0
  const canDelete = loadedSource === 'operator' && !isNewDraft && loadedId.trim().length > 0

  const refreshAfterMutation = async (nextId: string) => {
    if (!workspaceDir.trim()) return
    await loadWorkflowList(workspaceDir.trim())
    setConfig((prev) => ({ ...prev, selectedWorkflowId: nextId }))
  }

  const saveWorkflow = async () => {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const previousId = isNewDraft ? undefined : loadedId || config.selectedWorkflowId
      const saved = await bridge.syloWorkflowSave({
        content: draftRaw,
        previous_id: previousId,
      })
      setStatus(`Saved workflow \`${saved.workflow.id}\` to your library.`)
      setIsNewDraft(false)
      await refreshAfterMutation(saved.workflow.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteWorkflow = async () => {
    const id = loadedId || config.selectedWorkflowId
    if (!id.trim() || id === '__new__') return
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      await bridge.syloWorkflowDelete({ id })
      setStatus(`Deleted workflow \`${id}\`.`)
      setDeleteConfirm(false)
      const fallback = workflows.find((w) => w.id !== id)?.id ?? DEFAULT_WORKFLOW_ID
      setConfig((prev) => ({ ...prev, selectedWorkflowId: fallback }))
      await refreshAfterMutation(fallback)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startNewWorkflow = () => {
    setError(null)
    setStatus(null)
    setIsNewDraft(true)
    setLoadedId('new-workflow')
    setLoadedSource('operator')
    setDraftRaw(NEW_WORKFLOW_TEMPLATE)
    setConfig((prev) => ({ ...prev, selectedWorkflowId: '__new__' }))
  }

  const duplicateBundled = () => {
    if (!draftRaw.trim()) return
    const copy = draftRaw.replace(/^id:\s*.+$/m, 'id: my-workflow-copy')
    setIsNewDraft(true)
    setLoadedId('my-workflow-copy')
    setLoadedSource('operator')
    setDraftRaw(copy)
    setConfig((prev) => ({ ...prev, selectedWorkflowId: '__new__' }))
    setStatus('Duplicated to a new draft — edit id/title, then Save.')
  }

  const sendToAgent = async () => {
    setError(null)
    setStatus(null)
    if (!workspaceDir.trim()) {
      setError('Select a workspace in the Sylo sidebar first.')
      return
    }
    if (isNewDraft) {
      setError('Save the new workflow before sending to agent.')
      return
    }
    const workflowId = config.selectedWorkflowId.trim() || DEFAULT_WORKFLOW_ID
    setBusy(true)
    try {
      const read = await bridge.syloWorkflowRead({
        project_dir: workspaceDir.trim(),
        id: workflowId,
      })
      const prompt = buildWorkflowPrompt(
        { id: read.id, title: read.title, body: read.body },
        workspaceDir,
      )
      await bridge.requestAgentAction({
        prompt,
        project_dir: workspaceDir.trim(),
        delivery: 'prefill_new_chat',
      })
      setStatus('Chat opened with this workflow. Attach any files the workflow needs, then send.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'no_workspace_selected') setError('Select a workspace in the sidebar first.')
      else setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const workflowInList = workflows.some((w) => w.id === config.selectedWorkflowId)
  const showNewOption = config.selectedWorkflowId === '__new__'

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-6 overflow-y-auto">
      <div className="shrink-0">
        <h2 className="text-xl font-medium text-zinc-100 mb-2">Workflows</h2>
        <p className="text-sm text-zinc-400 max-w-3xl">
          A database of operator <strong className="text-zinc-300">prompt playbooks</strong> — saved
          markdown prompts loaded into chat on demand. Edit scripts here or duplicate bundled
          defaults, then <strong className="text-zinc-300">Send to agent</strong> and attach any
          files the workflow needs before Enter. Active workspace only sets{' '}
          <code className="text-zinc-400">{'{workspace}'}</code>.
        </p>
      </div>

      <div className="shrink-0 rounded border border-zinc-700/60 bg-zinc-900/40 px-3 py-2 text-sm max-w-3xl space-y-1">
        <div>
          <span className="text-zinc-500">Workspace (for runs): </span>
          <code className="text-zinc-300 break-all">{workspaceDir.trim() || '(none)'}</code>
        </div>
        {libraryDir && (
          <div>
            <span className="text-zinc-500">Your workflow library: </span>
            <code className="text-zinc-400 break-all text-xs">{libraryDir}</code>
          </div>
        )}
      </div>

      <label className="block shrink-0 text-sm text-zinc-400 max-w-xl">
        Workflow
        <select
          value={config.selectedWorkflowId}
          onChange={(e) => {
            setIsNewDraft(false)
            setConfig((prev) => ({ ...prev, selectedWorkflowId: e.target.value }))
          }}
          className="mt-1 w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
        >
          {showNewOption && <option value="__new__">New workflow (unsaved)</option>}
          {!workflowInList && config.selectedWorkflowId.trim() && !showNewOption && (
            <option value={config.selectedWorkflowId}>{config.selectedWorkflowId} (saved)</option>
          )}
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
              {w.source === 'operator' ? ' · yours' : w.source === 'bundled' ? ' · bundled' : ' · legacy'}
            </option>
          ))}
          {workflows.length === 0 && !showNewOption && (
            <option value={DEFAULT_WORKFLOW_ID}>I/O alias scaffold (bundled)</option>
          )}
        </select>
        {selectedWorkflow?.description && (
          <span className="mt-1 block text-xs text-zinc-500">{selectedWorkflow.description}</span>
        )}
        {loadedSource === 'bundled' && !isNewDraft && (
          <span className="mt-1 block text-xs text-amber-500/90">
            Bundled workflow — read-only here. Duplicate to save an editable copy under your
            library.
          </span>
        )}
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-300">Workflow script</h3>
          {loadedSource && !isNewDraft && (
            <span className="text-xs text-zinc-500">{loadedSource}</span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={workflowLoading ? 'Loading…' : draftRaw}
          onChange={(e) => setDraftRaw(e.target.value)}
          readOnly={workflowLoading || (loadedSource === 'bundled' && !isNewDraft)}
          spellCheck={false}
          className="w-full resize-y overflow-auto rounded border border-zinc-800/80 bg-zinc-950/50 p-4 text-xs text-zinc-300 font-mono disabled:opacity-60"
          style={{ height: scriptHeight, minHeight: 240 }}
          placeholder="Select a workflow"
        />
      </div>

      <div className="shrink-0 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={startNewWorkflow}
          className="rounded border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          New
        </button>
        <button
          type="button"
          disabled={busy || !canSave}
          onClick={() => void saveWorkflow()}
          className="rounded border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          Save
        </button>
        {loadedSource === 'bundled' && !isNewDraft && (
          <button
            type="button"
            disabled={busy || !draftRaw.trim()}
            onClick={duplicateBundled}
            className="rounded border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            Duplicate
          </button>
        )}
        <button
          type="button"
          disabled={busy || !canDelete}
          onClick={() => setDeleteConfirm(true)}
          className="rounded border border-red-900/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
        >
          Delete
        </button>
        <button
          type="button"
          disabled={busy || isNewDraft}
          onClick={() => void sendToAgent()}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Send to agent…'}
        </button>
      </div>

      <p className="shrink-0 text-xs text-zinc-500 max-w-3xl">
        Your custom workflows live under{' '}
        <code className="text-zinc-400">~/.pi/agent/workflows/</code>, shared across workspaces.
        Legacy LogicForge workflows (<code className="text-zinc-400">~/.pi/agent/logicforge/workflows/</code>)
        appear read-only here.
      </p>

      {status && <p className="shrink-0 text-sm text-green-400">{status}</p>}
      {error && <p className="shrink-0 text-sm text-red-400">{error}</p>}

      {deleteConfirm && (
        <ConfirmModal
          title="Delete workflow?"
          message={`Remove "${loadedId || config.selectedWorkflowId}" from your library? Bundled/legacy workflows cannot be deleted.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => void deleteWorkflow()}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </section>
  )
}