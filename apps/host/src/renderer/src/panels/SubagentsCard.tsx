import { useCallback, useEffect, useState } from 'react'

import { useConfiguredProviders } from '../chat/useConfiguredProviders'
import { invalidateSubagentNames } from '../chat/useSubagentNames'
import { cn } from '../lib/cn'
import {
  CHATGPT_CODEX_MODELS,
  CHATGPT_CODEX_PROVIDER,
  SYLO_MODEL_PROVIDER_LABELS,
} from '../../../shared/chatgpt-codex'
import {
  PI_BUILTIN_TOOL_IDS,
  PI_BUILTIN_TOOL_LABELS,
  PI_TOOL_ACCESS_GROUPS,
  isPiBuiltinToolId,
  type PiBuiltinToolId,
} from '../../../shared/pi-builtin-tools'
import {
  parseSubagentPins,
  SUBAGENT_THINKING_LEVELS,
  type SubagentModelPin,
} from '../../../shared/subagent-model-pin'
import { OllamaModelSelect } from './ollama-ui'
import { Badge } from './Badge'
import { ConfirmButton } from './ConfirmButton'
import { toast } from './toast'
import {
  btnGhostSm,
  card,
  cardTitle,
  detailsBody,
  detailsSummary,
  errorText,
  fieldLabel,
  input,
  leadText,
  mutedText,
  select,
  textarea,
} from './ui-classes'

const caption = cn(mutedText, 'm-0 text-[0.78rem] leading-[1.4]')

type SubagentAgentInfo = Awaited<ReturnType<typeof window.sylo.tasks.agentsGlobal>>[number]

/** Provider + model pair and optional thinking, shared by the all-subagents default and each per-agent override. */
function SubagentModelFields({
  idPrefix,
  label,
  inheritLabel,
  thinkingInheritLabel,
  pin,
  onChange,
  ollamaTags,
  providers,
}: {
  idPrefix: string
  label: string
  inheritLabel: string
  thinkingInheritLabel: string
  pin: SubagentModelPin
  onChange: (next: SubagentModelPin) => void
  ollamaTags: string[]
  providers: readonly string[]
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={cn(select, 'min-w-[160px] flex-none')}
        value={pin.provider}
        // Model ids do not carry across providers, so switching clears the pair.
        onChange={(e) => onChange({ ...pin, provider: e.target.value, modelId: '' })}
        aria-label={`${label} provider`}
      >
        <option value="">{inheritLabel}</option>
        {providers.map((p) => (
          <option key={p} value={p}>
            {SYLO_MODEL_PROVIDER_LABELS[p as keyof typeof SYLO_MODEL_PROVIDER_LABELS] ?? p}
          </option>
        ))}
      </select>

      {pin.provider === '' ?
        null
      : pin.provider === 'ollama' ?
        <OllamaModelSelect
          id={`${idPrefix}-ollama-model`}
          className="min-w-[180px] flex-1"
          modelId={pin.modelId}
          setModelId={(v) => onChange({ ...pin, modelId: v })}
          ollamaTags={ollamaTags}
          emptyOptionLabel="Select a model…"
        />
      : pin.provider === CHATGPT_CODEX_PROVIDER ?
        <select
          id={`${idPrefix}-chatgpt-model`}
          className={cn(select, 'min-w-[180px] flex-1')}
          value={pin.modelId}
          onChange={(e) => onChange({ ...pin, modelId: e.target.value })}
          aria-label={`${label} model`}
        >
          <option value="">Select a model…</option>
          {CHATGPT_CODEX_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      : <input
          id={`${idPrefix}-model-id`}
          className={cn(input, 'min-w-[180px] flex-1')}
          value={pin.modelId}
          onChange={(e) => onChange({ ...pin, modelId: e.target.value })}
          placeholder="Model id"
          aria-label={`${label} model`}
        />
      }

      <select
        id={`${idPrefix}-thinking`}
        className={cn(select, 'w-auto min-w-[140px] flex-none')}
        value={pin.thinkingLevel ?? ''}
        onChange={(e) => {
          const thinkingLevel = e.target.value
          onChange(thinkingLevel ? { ...pin, thinkingLevel } : { provider: pin.provider, modelId: pin.modelId })
        }}
        aria-label={`${label} thinking`}
      >
        <option value="">{thinkingInheritLabel}</option>
        {SUBAGENT_THINKING_LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            think: {lvl}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Subagents settings — the global persona pin list (per-persona model pickers), the
 * custom-persona create/edit form, and diagnostics. Fully self-contained state;
 * only the Ollama tag list (shared, owned by the settings shell) comes in as a prop.
 */
export function SubagentsCard({
  onChanged,
  diagnostics,
  ollamaTags,
  providerListVersion,
}: {
  onChanged: () => void | Promise<void>
  diagnostics: {
    resolvedPiAgentDir: string
  }
  /** Shared Ollama tag list — owned by the settings shell (other cards need it too). */
  ollamaTags: string[]
  /** Bumped by the shell when provider lists may have changed; refetches configured providers. */
  providerListVersion: number
}): React.ReactElement {
  const [subagentModelSaving, setSubagentModelSaving] = useState(false)
  const [subagentAgents, setSubagentAgents] = useState<SubagentAgentInfo[]>([])
  const [agentPins, setAgentPins] = useState<Record<string, SubagentModelPin>>({})
  const [subagentDiag, setSubagentDiag] = useState<{
    runningCount: number
    orphanedCount: number
    extensionEnabled: boolean
  } | null>(null)
  const [clearOrphanBusy, setClearOrphanBusy] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentDescription, setNewAgentDescription] = useState('')
  const [newAgentPrompt, setNewAgentPrompt] = useState('')
  const [newAgentPin, setNewAgentPin] = useState<SubagentModelPin>({ provider: '', modelId: '' })
  // Every tool on to start: that is what a persona with no `tools:` line gets today,
  // so the default stays the behaviour operators already know.
  const [newAgentTools, setNewAgentTools] = useState<readonly PiBuiltinToolId[]>(PI_BUILTIN_TOOL_IDS)
  const [newAgentTimeout, setNewAgentTimeout] = useState('')
  const [newAgentBusy, setNewAgentBusy] = useState(false)
  const [newAgentError, setNewAgentError] = useState('')
  /** Name of the persona being edited, or null while composing a new one. */
  const [editingAgent, setEditingAgent] = useState<string | null>(null)

  const toggleNewAgentTools = (tools: readonly PiBuiltinToolId[], on: boolean) => {
    setNewAgentTools((prev) => {
      const next = new Set(prev)
      for (const t of tools) {
        if (on) next.add(t)
        else next.delete(t)
      }
      return PI_BUILTIN_TOOL_IDS.filter((id) => next.has(id))
    })
  }

  const configuredProviders = useConfiguredProviders(
    [newAgentPin.provider, ...Object.values(agentPins).map((p) => p.provider)],
    providerListVersion,
  )

  useEffect(() => {
    // Settings card lists global personas only (bundled + operator-global). Project
    // personas are trusted + pinned per folder from the chat Subagents modal.
    void window.sylo.tasks
      .agentsGlobal()
      .then(setSubagentAgents)
      .catch(() => setSubagentAgents([]))
  }, [providerListVersion])

  useEffect(() => {
    void window.sylo.tasks.diagnostics().then(setSubagentDiag).catch(() => setSubagentDiag(null))
  }, [])

  useEffect(() => {
    void window.sylo.prefs
      .get('sylo.subagents.model_by_agent', '')
      .then((raw) => setAgentPins(parseSubagentPins(String(raw ?? ''))))
      .catch(() => {})
  }, [])

  const reloadSubagentAgents = async () => {
    // Keeps the transcript's mention chips in step with the persona list.
    invalidateSubagentNames()
    try {
      setSubagentAgents(await window.sylo.tasks.agentsGlobal())
    } catch {
      setSubagentAgents([])
    }
  }

  const resetAgentForm = () => {
    setEditingAgent(null)
    setNewAgentName('')
    setNewAgentDescription('')
    setNewAgentPrompt('')
    setNewAgentPin({ provider: '', modelId: '' })
    setNewAgentTools(PI_BUILTIN_TOOL_IDS)
    setNewAgentTimeout('')
    setNewAgentError('')
  }

  /** Load a persona into the form below so it can be edited in place. */
  const beginEditSubagent = async (name: string) => {
    setNewAgentError('')
    try {
      const res = await window.sylo.tasks.readAgent(name)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      const { agent } = res
      setEditingAgent(agent.name)
      setNewAgentName(agent.name)
      setNewAgentDescription(agent.description)
      setNewAgentPrompt(agent.prompt)
      // No `tools:` line means unrestricted, which is every box checked.
      setNewAgentTools(agent.tools ? (agent.tools.filter(isPiBuiltinToolId)) : PI_BUILTIN_TOOL_IDS)
      setNewAgentTimeout(agent.timeoutSeconds ? String(agent.timeoutSeconds) : '')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const saveSubagentModel = async () => {
    // A provider with no model would spawn the Pi CLI against a model id that provider does
    // not serve, so every model pin is all-or-nothing. Thinking can stand alone.
    const incomplete: string[] = []
    const pinned: Record<string, SubagentModelPin> = {}
    for (const agent of subagentAgents) {
      const pin = agentPins[agent.name]
      const provider = pin?.provider.trim() ?? ''
      const modelId = pin?.modelId.trim() ?? ''
      const thinkingLevel = pin?.thinkingLevel?.trim() ?? ''
      if (!provider && !thinkingLevel) continue
      if (provider && !modelId) {
        incomplete.push(agent.name)
        continue
      }
      pinned[agent.name] = thinkingLevel ? { provider, modelId, thinkingLevel } : { provider, modelId }
    }
    if (incomplete.length > 0) {
      toast(
        `Pick a model for: ${incomplete.join(', ')} — or set the provider back to the inherit option.`,
        'error',
      )
      return
    }

    if (Object.values(pinned).some((p) => p.provider === CHATGPT_CODEX_PROVIDER)) {
      const st = await window.sylo.chatgpt.status()
      if (!st.connected) {
        toast('Sign in with ChatGPT under Model (Pi) first — subagents use the same login.', 'error')
        return
      }
    }

    setSubagentModelSaving(true)
    await window.sylo.prefs.set(
      'sylo.subagents.model_by_agent',
      Object.keys(pinned).length > 0 ? JSON.stringify(pinned) : '',
    )
    setAgentPins(pinned)
    // These pins ride in the broker env, which is frozen at fork.
    await window.sylo.broker.restart()
    setSubagentModelSaving(false)
    onChanged()
  }

  const saveCustomSubagent = async () => {
    setNewAgentError('')
    const editing = editingAgent
    const name = newAgentName.trim()
    const prompt = newAgentPrompt.trim()
    if (!name || !prompt) {
      setNewAgentError('Name and instructions are both required.')
      return
    }
    const provider = newAgentPin.provider.trim()
    const modelId = newAgentPin.modelId.trim()
    const thinkingLevel = newAgentPin.thinkingLevel?.trim() ?? ''
    if (provider && !modelId) {
      setNewAgentError('Pick a model for that provider, or set it back to the inherit option.')
      return
    }
    if (newAgentTools.length === 0) {
      setNewAgentError('Leave at least one tool enabled — an agent with no tools cannot do anything.')
      return
    }
    const timeoutRaw = newAgentTimeout.trim()
    const timeoutSeconds = timeoutRaw === '' ? undefined : Number(timeoutRaw)
    if (timeoutSeconds != null && !Number.isInteger(timeoutSeconds)) {
      setNewAgentError('Timeout must be a whole number of seconds, or blank for the default.')
      return
    }

    setNewAgentBusy(true)
    try {
      const payload = {
        name,
        // Discovery skips personas without a description, and it is what the
        // orchestrator reads when picking an agent on its own.
        description: newAgentDescription.trim() || prompt.split('\n')[0]!.slice(0, 160),
        prompt,
        tools: [...newAgentTools],
        ...(timeoutSeconds != null ? { timeoutSeconds } : {}),
      }
      const created =
        editing ?
          await window.sylo.tasks.updateAgent(payload)
        : await window.sylo.tasks.createAgent(payload)
      if (!created.ok) {
        setNewAgentError(created.error)
        return
      }
      // Editing leaves the pin alone: it is owned by this agent's row above, so
      // writing it from here would commit whatever that row happens to show.
      if (!editing && (provider || thinkingLevel)) {
        const pin: SubagentModelPin =
          thinkingLevel ? { provider, modelId, thinkingLevel } : { provider, modelId }
        // Merge onto what is persisted, not onto local state: writing the whole
        // local map would also commit unsaved pin edits for other agents.
        const stored = parseSubagentPins(
          (await window.sylo.prefs.get('sylo.subagents.model_by_agent', '')) as string,
        )
        await window.sylo.prefs.set(
          'sylo.subagents.model_by_agent',
          JSON.stringify({ ...stored, [created.name]: pin }),
        )
        setAgentPins((prev) => ({ ...prev, [created.name]: pin }))
        // Pins ride in the broker env, so they only take effect on the next fork.
        await window.sylo.broker.restart()
      }
      resetAgentForm()
      await reloadSubagentAgents()
      onChanged()
    } catch (e) {
      setNewAgentError(e instanceof Error ? e.message : String(e))
    } finally {
      setNewAgentBusy(false)
    }
  }

  const removeCustomSubagent = async (name: string) => {
    try {
      const res = await window.sylo.tasks.deleteAgent(name)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      return
    }
    // The form would otherwise keep offering to save edits to a file that is gone.
    if (editingAgent === name) resetAgentForm()
    setAgentPins((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
    await reloadSubagentAgents()
    onChanged()
  }

  return (
    <section className={card}>
      <h2 className={cardTitle}>Subagents</h2>
      <p className={leadText}>
        Child sessions the agent can delegate to — scout, planner, worker, reviewer, plus any persona you add.
        Type <code className="font-mono text-[0.86em]">@name</code> in the composer to force one.
      </p>
      <details className="m-0 mb-1.5">
        <summary className={detailsSummary}>How delegation works</summary>
        <p className={detailsBody}>
          The built-in <strong>sylo-subagents</strong> extension lets the primary agent decide when to
          delegate. A forced persona runs on its pinned model before the chat model sees the turn; runs
          appear inline in chat under each{' '}
          <code className="font-mono text-[0.86em]">subagent</code> tool row. Custom agent personas live as
          markdown under <code className="break-all">{diagnostics.resolvedPiAgentDir}/agents</code>
          (global). Project personas in a workspace folder (<code className="break-all">.pi/agents</code>)
          are a per-folder trust decision, made from the chat model bar&apos;s{' '}
          <strong>Subagents</strong> button.
        </p>
      </details>
      <div className="mt-3 flex flex-col gap-2.5">
        <span className={fieldLabel}>Personas</span>
        <p className={caption}>
          One pin per persona, saved globally — every workspace starts here. A persona left on
          inherit follows the chat&apos;s model and thinking; override per workspace folder from
          the chat model bar&apos;s <strong>Subagents</strong> button.
        </p>

        {subagentAgents.length > 0 ?
          <div className="flex flex-col gap-2 border-t border-border pt-2.5">
            {subagentAgents.map((agent) => (
              <div key={agent.name} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[0.82rem] text-text-primary">
                  <code className="font-mono text-[0.86em]">{agent.name}</code>
                  {agent.source !== 'builtin' ?
                    <span className={cn(mutedText, ' text-[0.74rem]')}>· {agent.source}</span>
                  : null}
                  {agent.source === 'user' ?
                    <>
                      <button
                        type="button"
                        className={cn(mutedText, 'border-0 bg-transparent p-0 text-[0.74rem] hover:text-text-primary hover:underline')}
                        onClick={() => void beginEditSubagent(agent.name)}
                      >
                        {editingAgent === agent.name ? 'Editing below' : 'Edit'}
                      </button>
                      <ConfirmButton
                        confirmLabel="Confirm delete?"
                        className={cn(mutedText, 'border-0 bg-transparent p-0 text-[0.74rem] hover:text-danger hover:underline')}
                        onConfirm={() => void removeCustomSubagent(agent.name)}
                      >
                        Delete
                      </ConfirmButton>
                    </>
                  : null}
                </span>
                {agent.tools || agent.timeoutSeconds ?
                  <span className={caption}>
                    {agent.tools ? `Tools: ${agent.tools.join(', ')}` : 'Tools: all'}
                    {agent.timeoutSeconds ? ` · ceiling ${agent.timeoutSeconds}s` : ''}
                  </span>
                : null}
                <SubagentModelFields
                  idPrefix={`sylo-subagent-${agent.name}`}
                  label={agent.name}
                  inheritLabel="Follow the chat model"
                  thinkingInheritLabel="Follow the chat thinking"
                  pin={agentPins[agent.name] ?? { provider: '', modelId: '' }}
                  onChange={(next) =>
                    setAgentPins((prev) => ({ ...prev, [agent.name]: next }))
                  }
                  ollamaTags={ollamaTags}
                  providers={configuredProviders}
                />
              </div>
            ))}
          </div>
        : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btnGhostSm}
            onClick={() => void saveSubagentModel()}
            disabled={subagentModelSaving}
          >
            {subagentModelSaving ? 'Restarting broker…' : 'Save subagent models'}
          </button>
          <span className={caption}>Applies to the next run.</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
        <span className={fieldLabel}>
          {editingAgent ? `Edit "${editingAgent}"` : 'Add a custom subagent'}
        </span>
        <p className={caption}>
          {editingAgent ?
            "Applies on this agent's next run — no restart needed."
          : <>
              Available immediately; type <code>@{newAgentName.trim() || 'name'}</code> in the composer to force it.
            </>
          }
        </p>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Name</span>
          <input
            className={input}
            value={newAgentName}
            placeholder="researcher"
            spellCheck={false}
            // The name keys this agent's model pin and is what @mention types,
            // so renaming is a delete plus a create rather than an edit.
            disabled={editingAgent !== null}
            onChange={(e) => setNewAgentName(e.target.value)}
          />
          <span className={caption}>
            {editingAgent ?
              'Names cannot be changed here — delete and recreate to rename.'
            : 'Letters, numbers, dot, dash, underscore — what you type after @.'}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>What it does</span>
          <input
            className={input}
            value={newAgentDescription}
            placeholder="Deep research across docs and the web, read-only"
            onChange={(e) => setNewAgentDescription(e.target.value)}
          />
          <span className={caption}>
            What the agent reads when deciding to delegate here on its own. Blank = first line of the instructions.
          </span>
        </label>
        <label className={cn('flex flex-col gap-1', editingAgent ? 'hidden' : '')}>
          <span className={fieldLabel}>Model</span>
          <SubagentModelFields
            idPrefix="sylo-subagent-new"
            label="new subagent"
            inheritLabel="Follow the chat model"
            thinkingInheritLabel="Follow the chat thinking"
            pin={newAgentPin}
            onChange={setNewAgentPin}
            ollamaTags={ollamaTags}
            providers={configuredProviders}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className={fieldLabel}>Tool access</span>
          <span className={caption}>
            Enforced by the child process itself, regardless of what its instructions say. The
            Capability manager applies on top.
          </span>
          <div className="mt-1 flex flex-col gap-2 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2">
            {PI_TOOL_ACCESS_GROUPS.map((group) => {
              const all = group.tools.every((t) => newAgentTools.includes(t))
              const some = group.tools.some((t) => newAgentTools.includes(t))
              return (
                <div key={group.id} className="flex flex-col gap-1">
                  <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={all}
                      ref={(el) => {
                        // Partial selection is a real state here; without this the box
                        // would read as "off" while some of its tools are on.
                        if (el) el.indeterminate = some && !all
                      }}
                      onChange={(e) => toggleNewAgentTools(group.tools, e.target.checked)}
                    />
                    <span className="flex flex-col">
                      <span>{group.label}</span>
                      <span className={caption}>{group.hint}</span>
                    </span>
                  </label>
                  {group.tools.length > 1 ?
                    <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
                      {group.tools.map((tool) => (
                        <label
                          key={tool}
                          className="flex cursor-pointer items-center gap-1.5 text-[0.8rem]"
                        >
                          <input
                            type="checkbox"
                            checked={newAgentTools.includes(tool)}
                            onChange={(e) => toggleNewAgentTools([tool], e.target.checked)}
                          />
                          <span>{PI_BUILTIN_TOOL_LABELS[tool]}</span>
                        </label>
                      ))}
                    </div>
                  : null}
                </div>
              )
            })}
          </div>
          <span className={caption}>
            {newAgentTools.length === 0 ?
              'Nothing enabled — pick at least one tool.'
            : newAgentTools.length === PI_BUILTIN_TOOL_IDS.length ?
              'Everything enabled — no restriction is written.'
            : `Written as tools: ${newAgentTools.join(', ')} — the agent is handed only these.`}
          </span>
        </div>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Timeout (seconds)</span>
          <input
            className={cn(input, 'max-w-[10rem]')}
            type="number"
            min={60}
            max={7200}
            step={30}
            value={newAgentTimeout}
            placeholder="default"
            onChange={(e) => setNewAgentTimeout(e.target.value)}
          />
          <span className={caption}>
            Hard ceiling for one run (60–7200 seconds). Blank = 2 hours.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Instructions (system prompt)</span>
          <textarea
            className={cn(textarea, 'min-h-[8rem] w-full')}
            value={newAgentPrompt}
            placeholder={
              'You are a research specialist.\n\nGather evidence, cite file paths and URLs, and do not edit files.\n\nReport:\n- Findings\n- Open questions'
            }
            onChange={(e) => setNewAgentPrompt(e.target.value)}
          />
          <span className={caption}>
            The agent&apos;s system prompt — what it does, what it must not touch, and the report shape.
          </span>
        </label>
        {newAgentError ? <p className={errorText}>{newAgentError}</p> : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btnGhostSm}
            onClick={() => void saveCustomSubagent()}
            disabled={newAgentBusy || !newAgentName.trim() || !newAgentPrompt.trim()}
          >
            {newAgentBusy ?
              editingAgent ? 'Saving…'
              : 'Creating…'
            : editingAgent ? 'Save changes'
            : 'Create subagent'}
          </button>
          {editingAgent ?
            <button type="button" className={btnGhostSm} onClick={resetAgentForm}>
              Cancel
            </button>
          : null}
          <span className={caption}>
            {editingAgent ?
              'No restart needed.'
            : 'Picking a model restarts the broker.'}
          </span>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
        <p className={cn(caption, 'mb-1.5 font-medium text-text-primary')}>Diagnostics</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={subagentDiag ? (subagentDiag.extensionEnabled ? 'ok' : 'warn') : 'neutral'}>
            {subagentDiag ?
              subagentDiag.extensionEnabled ? 'Extension loaded' : 'Extension disabled'
            : 'Checking…'}
          </Badge>
          <Badge title="Active runs across all conversations">
            {subagentDiag === null ? 'Checking…' : `${subagentDiag.runningCount} active run${subagentDiag.runningCount === 1 ? '' : 's'}`}
          </Badge>
          {subagentDiag !== null && subagentDiag.orphanedCount > 0 ?
            <Badge tone="warn" title="Rows left after a prior broker crash">
              {subagentDiag.orphanedCount} orphaned
            </Badge>
          : null}
        </div>
        {subagentDiag !== null && subagentDiag.orphanedCount > 0 ?
          <button
            type="button"
            className={cn(btnGhostSm, 'mt-2')}
            disabled={clearOrphanBusy}
            onClick={() => {
              setClearOrphanBusy(true)
              void window.sylo.tasks
                .clearOrphaned()
                .then(() => window.sylo.tasks.diagnostics())
                .then(setSubagentDiag)
                .finally(() => setClearOrphanBusy(false))
            }}
          >
            Clear orphaned ({subagentDiag.orphanedCount})
          </button>
        : null}
      </div>
    </section>
  )
}