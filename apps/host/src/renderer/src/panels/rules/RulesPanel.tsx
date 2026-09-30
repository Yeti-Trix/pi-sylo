import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { cn } from '../../lib/cn'
import {
  btnDangerSm,
  btnGhostSm,
  btnPrimarySm,
  fieldLabel,
  mutedText,
  panelTitle,
  select,
  textarea,
} from '../ui-classes'

/**
 * Rules panel (task 12, Cursor-parity AGENTS.md manager): view/edit the
 * ACTIVE workspace's AGENTS.md, plus the other workspaces that have one.
 * The GLOBAL rules file is managed through the existing globalAgents bridge
 * (Settings → Global AI instructions owns its deploy contract; the panel
 * surfaces its source path + an inline editor over the same save path).
 *
 * Save semantics: explicit button only; the editor tracks a dirty flag, and
 * the GLOBAL file always asks first (it affects every workspace on every
 * machine via the git-synced sylo-user commons). Missing files are created
 * only through the explicit "Create with template" flow.
 */

type WorkspaceLite = { id: string; name: string }

const WORKSPACE_AGENTS_TEMPLATE = `# Workspace AI instructions

Instructions for this workspace only. Loaded by the agent at each session
start (Pi picks this file up on the NEXT session — restart the chat's
session or send a new turn after edits).

Global standing principles live in the global rules file instead.
`

const RULE_SNIPPETS: { label: string; text: string }[] = [
  { label: 'Typecheck before finishing', text: 'Always run typecheck and build before considering work finished.' },
  { label: 'Concise replies', text: 'Keep replies concise; explain only non-obvious decisions.' },
  { label: 'Ask before deleting', text: 'Never delete files or data without asking first.' },
  { label: 'Small diffs', text: 'Keep changes small and reviewable; avoid drive-by refactors.' },
  { label: 'No silent destructive ops', text: 'Destructive actions must be confirmed before running.' },
]

type SectionKey = 'workspace' | 'global' | 'other'

export function RulesPanel({
  workspaceId,
  workspaces,
}: {
  workspaceId: string | undefined
  workspaces: WorkspaceLite[]
}): React.ReactElement {
  const [section, setSection] = useState<SectionKey>('workspace')
  // Active workspace editor state
  const [path, setPath] = useState('')
  const [exists, setExists] = useState(false)
  const [original, setOriginal] = useState('')
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Global editor state (loaded on demand)
  const [globalState, setGlobalState] = useState<Awaited<ReturnType<typeof window.sylo.globalAgents.status>> | null>(null)
  const [globalDraft, setGlobalDraft] = useState('')
  const [globalLoaded, setGlobalLoaded] = useState(false)
  // Other workspaces (existence check per workspace)
  const [others, setOthers] = useState<{ id: string; name: string; exists: boolean; path: string }[]>([])
  // Other-workspace editor
  const [otherId, setOtherId] = useState<string | null>(null)
  const [otherPath, setOtherPath] = useState('')
  const [otherOriginal, setOtherOriginal] = useState('')
  const [otherDraft, setOtherDraft] = useState('')
  const [otherExists, setOtherExists] = useState(false)

  const loadWorkspace = useCallback(async () => {
    if (!workspaceId) return
    setBusy(true)
    try {
      const r = await window.sylo.rules.workspaceAgentsRead(workspaceId)
      if (r.ok) {
        setPath(r.path)
        setExists(r.exists)
        setOriginal(r.content)
        setDraft(r.content)
        setStatus(null)
      } else {
        setStatus(r.error)
        setPath('')
        setExists(false)
        setOriginal('')
        setDraft('')
      }
    } finally {
      setBusy(false)
    }
  }, [workspaceId])

  // Active + others load on workspace/section entry.
  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    if (section !== 'other' || !workspaceId) return
    void (async () => {
      const out: { id: string; name: string; exists: boolean; path: string }[] = []
      for (const ws of workspaces) {
        if (ws.id === workspaceId) continue
        const r = await window.sylo.rules.workspaceAgentsRead(ws.id)
        out.push(r.ok ? { id: ws.id, name: ws.name, exists: r.exists, path: r.path } : { id: ws.id, name: ws.name, exists: false, path: '' })
      }
      setOthers(out)
    })()
  }, [section, workspaceId, workspaces])

  useEffect(() => {
    if (section !== 'global' || globalLoaded) return
    void (async () => {
      try {
        const st = await window.sylo.globalAgents.status()
        setGlobalState(st)
        setGlobalDraft(st.content)
      } catch {
        setGlobalState(null)
      }
      setGlobalLoaded(true)
    })()
  }, [section, globalLoaded])

  const dirty = draft !== original
  const dirtyBytes = useMemo(() => new TextEncoder().encode(draft).length, [draft])

  const save = async () => {
    if (!workspaceId || !dirty) return
    setBusy(true)
    try {
      if (!exists) {
        // Never create silently — the template flow is an explicit button below.
        return
      }
      const r = await window.sylo.rules.workspaceAgentsWrite(workspaceId, draft)
      if (!r.ok) {
        setStatus(`Save failed: ${r.error}`)
        return
      }
      setOriginal(draft)
      setExists(true)
      setPath(r.path)
      setStatus(`Saved ${r.bytes} bytes → ${r.path}`)
    } finally {
      setBusy(false)
    }
  }

  const createWithTemplate = async () => {
    if (!workspaceId || exists) return
    setBusy(true)
    try {
      const r = await window.sylo.rules.workspaceAgentsWrite(workspaceId, WORKSPACE_AGENTS_TEMPLATE)
      if (r.ok) {
        setOriginal(WORKSPACE_AGENTS_TEMPLATE)
        setDraft(WORKSPACE_AGENTS_TEMPLATE)
        setExists(true)
        setPath(r.path)
        setStatus(`Created ${r.path} from the template`)
      } else {
        setStatus(`Create failed: ${r.error}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const saveGlobal = async () => {
    if (globalDraft === globalState?.content) return
    const ok = window.confirm(
      'Save the GLOBAL rules?\n\nThis file affects EVERY workspace on every machine (it is git-synced through the sylo-user commons) — every agent session loads it.',
    )
    if (!ok) return
    setBusy(true)
    try {
      const st = await window.sylo.globalAgents.save(globalDraft)
      if ('ok' in st && st.ok === false) {
        setStatus(`Global save failed: ${st.error ?? 'unknown error'}`)
        return
      }
      setGlobalState(st)
      setGlobalDraft(st.content)
      setStatus(`Global rules saved and deployed to ${st.targetPath}`)
    } finally {
      setBusy(false)
    }
  }

  const insertSnippet = (text: string, set: (fn: (d: string) => string) => void) => {
    set((d) => (d.trim().length === 0 ? text : `${d.replace(/\s+$/, '')}\n\n${text}`))
  }

  const loadOther = async (id: string) => {
    setOtherId(id)
    setBusy(true)
    try {
      const r = await window.sylo.rules.workspaceAgentsRead(id)
      if (r.ok) {
        setOtherPath(r.path)
        setOtherExists(r.exists)
        setOtherOriginal(r.content)
        setOtherDraft(r.content)
      }
    } finally {
      setBusy(false)
    }
  }

  const saveOther = async () => {
    if (!otherId || otherDraft === otherOriginal) return
    if (!otherExists && !window.confirm('Create AGENTS.md for this workspace with the current editor content?'))
      return
    setBusy(true)
    try {
      const r = await window.sylo.rules.workspaceAgentsWrite(otherId, otherDraft)
      if (r.ok) {
        setOtherOriginal(otherDraft)
        setOtherExists(true)
        setStatus(`Saved ${r.bytes} bytes → ${r.path}`)
      } else {
        setStatus(`Save failed: ${r.error}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const currentSectionHint =
    section === 'workspace' ?
      'Applies when the agent works in this workspace (sessions load it at start).'
    : section === 'global' ?
      'Loaded by EVERY session in EVERY workspace; git-synced across machines — edit carefully.'
    : 'Other workspaces with their rules files.'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className={panelTitle}>Rules</h2>
        <label className={cn(fieldLabel, 'ml-auto flex items-center gap-1 text-[0.74rem]')}>
          <span>Scope</span>
          <select
            className={select}
            value={section}
            onChange={(e) => setSection(e.target.value as SectionKey)}
          >
            <option value="workspace">Active workspace</option>
            <option value="global">Global</option>
            <option value="other">Other workspaces</option>
          </select>
        </label>
      </div>
      <p className={cn(mutedText, 'text-[0.78rem]')}>{currentSectionHint}</p>

      {section === 'workspace' ?
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[0.74rem]">
            <code className="min-w-0 flex-1 truncate rounded bg-bg-tertiary px-1.5 py-0.5">
              {path || 'no workspace selected'}
            </code>
            {exists ?
              <span className={mutedText}>{new TextEncoder().encode(original).length} bytes</span>
              : <span className={mutedText}>AGENTS.md does not exist yet</span>}
            <button type="button" className={btnGhostSm} disabled={!dirty || busy} onClick={() => void save()}>
              Save
            </button>
            <button
              type="button"
              className={btnGhostSm}
              disabled={!dirty || busy}
              onClick={() => setDraft(original)}
            >
              Revert
            </button>
          </div>
          {exists || dirty ? (
            <textarea
              value={draft}
              spellCheck={false}
              className={cn(textarea, 'min-h-0 flex-1 font-mono text-[0.78rem] leading-[1.5]')}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-2 rounded-lg border border-dashed border-border p-4">
              <span className={cn(mutedText, 'text-[0.8rem]')}>
                This workspace has no AGENTS.md. Creating one is explicit:
              </span>
              <button type="button" className={btnPrimarySm} disabled={busy} onClick={() => void createWithTemplate()}>
                Create with template…
              </button>
              <details>
                <summary className={cn(mutedText, 'cursor-pointer text-[0.74rem]')}>Template preview</summary>
                <pre className="mt-1 max-w-[520px] overflow-auto whitespace-pre-wrap text-[0.7rem] text-text-secondary">{WORKSPACE_AGENTS_TEMPLATE}</pre>
              </details>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
            <span className={cn(fieldLabel, 'text-[0.74rem]')}>Paste snippet:</span>
            {RULE_SNIPPETS.map((snip) => (
              <button
                key={snip.label}
                type="button"
                className={btnGhostSm}
                title={snip.text}
                onClick={() => insertSnippet(snip.text, setDraft)}
              >
                {snip.label}
              </button>
            ))}
            <span className={cn(mutedText, 'ml-auto text-[0.7rem]')}>
              {dirty ? `unsaved changes · ${dirtyBytes} bytes` : exists ? 'saved' : 'empty'}
            </span>
          </div>
        </div>
      : section === 'global' ?
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[0.74rem]">
            <code className="min-w-0 flex-1 truncate rounded bg-bg-tertiary px-1.5 py-0.5">
              {globalState?.sourcePath ?? 'loading…'}
            </code>
            {globalState?.targetExists ? (
              <span className={mutedText} title={`Deployed copy: ${globalState.targetPath}`}>
                {globalState.inSync ? 'in sync' : 'desynced'}
              </span>
            ) : null}
            <button type="button" className={btnDangerSm} disabled={busy || !globalLoaded} onClick={() => void saveGlobal()}>
              Save (warns)
            </button>
          </div>
          <textarea
            value={globalDraft}
            spellCheck={false}
            disabled={!globalLoaded}
            className={cn(textarea, 'min-h-0 flex-1 font-mono text-[0.78rem] leading-[1.5]')}
            onChange={(e) => setGlobalDraft(e.target.value)}
          />
        </div>
      : // other
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {others.length === 0 ? (
            <p className={cn(mutedText, 'text-[0.8rem]')}>No other workspaces.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {others.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    className={btnGhostSm}
                    onClick={() => void loadOther(ws.id)}
                    title={ws.exists ? ws.path : 'no AGENTS.md yet'}
                  >
                    {ws.name}{ws.exists ? '' : ' (none)'}
                  </button>
                ))}
              </div>
              {otherId ?
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <code className={cn(mutedText, 'truncate text-[0.72rem]')}>{otherPath}</code>
                  <textarea
                    value={otherDraft}
                    spellCheck={false}
                    className={cn(textarea, 'min-h-0 flex-1 font-mono text-[0.78rem] leading-[1.5]')}
                    onChange={(e) => setOtherDraft(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button type="button" className={btnPrimarySm} disabled={busy || otherDraft === otherOriginal} onClick={() => void saveOther()}>
                      Save
                    </button>
                    <button type="button" className={btnGhostSm} disabled={busy} onClick={() => setOtherDraft(otherOriginal)}>
                      Revert
                    </button>
                    {otherDraft === otherOriginal && otherExists ? <span className={cn(mutedText, 'text-[0.7rem]')}>saved</span> : null}
                  </div>
                </div>
              : null}
            </>
          )}
        </div>}

      {status ? <span className={cn(mutedText, 'text-[0.74rem]')}>{status}</span> : null}
      <p className={cn(mutedText, 'border-t border-border pt-2 text-[0.7rem]')}>
        The agent reads rules at session start — edits apply to the NEXT session (a running turn keeps its loaded copy).
      </p>
    </div>
  )
}