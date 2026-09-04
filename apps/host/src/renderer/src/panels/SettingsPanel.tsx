import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react'

// Personal-bundle Settings card — declarative config from the installed
// personal plugin; renders nothing when the bundle is absent.
const PersonalSettingsCard = lazy(() => import('./PersonalSettingsCard'))
import { SYLO_DEFAULT_MODEL_ID } from '../../../shared/sylo-model-defaults'
import { cn } from '../lib/cn'
import { normalizeOllamaOriginUi, OllamaModelSelect } from './ollama-ui'
import { WeeklySweepCard } from './WeeklySweepCard'
import {
  btnGhost,
  btnGhostSm,
  btnPrimary,
  card,
  cardTitle,
  errorText,
  fieldLabel,
  input,
  leadText,
  mutedText,
        panelShell,
  select,
  textarea,
} from './ui-classes'

const caption = cn(mutedText, 'm-0 text-[0.78rem] leading-[1.4]')

async function revealDirectory(
  dir: string,
  label: string,
): Promise<void> {
  const openDir = window.sylo.shell?.openDirectory
  if (typeof openDir !== 'function') {
    window.alert(`${label} needs a full Sylo restart (shell bridge not loaded).`)
    return
  }
  try {
    const r = await openDir(dir)
    if (!r.ok) window.alert(`Could not open ${label}:\n${r.error}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    window.alert(
      msg.includes('No handler registered') ?
        `${label} needs a full Sylo restart (main process still on an old build).`
      : `Could not open ${label}:\n${msg}`,
    )
  }
}

export function SettingsPanel({
  onChanged,
  diagnostics,
    activeWorkspace,
}: {
  onChanged: () => void | Promise<void>
  diagnostics: {
    modelProvider: string
    modelId: string
    resolvedHostPiCwd: string
    piAgentDir: string
    resolvedPiAgentDir: string
        canonicalWorkspaceProject: string
    concurrentTurns: boolean
    chatOnly: boolean
  }
  activeWorkspace: {
    id: string
    name: string
    resolvedPiCwd: string
  }
  }): React.ReactElement {
  const [modelId, setModelId] = useState(diagnostics.modelId)
    const [modelProvider, setModelProvider] = useState(diagnostics.modelProvider)
  const [concurrentTurns, setConcurrentTurns] = useState(diagnostics.concurrentTurns)
  const [chatOnly, setChatOnly] = useState(diagnostics.chatOnly)
  const [allowProjectAgents, setAllowProjectAgents] = useState(false)
  const [subagentDiag, setSubagentDiag] = useState<{
    runningCount: number
    orphanedCount: number
    extensionEnabled: boolean
  } | null>(null)
  const [clearOrphanBusy, setClearOrphanBusy] = useState(false)
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://127.0.0.1:11434')
  const [ollamaTags, setOllamaTags] = useState<string[]>([])
  const [ollamaListError, setOllamaListError] = useState<string | null>(null)
  const [ollamaListLoading, setOllamaListLoading] = useState(false)
  const [modelVisionCapable, setModelVisionCapable] = useState(false)
  const [modelVisionExplicit, setModelVisionExplicit] = useState(false)
  const [ollamaVisionDetected, setOllamaVisionDetected] = useState<boolean | null>(null)
  const [visionProbeLoading, setVisionProbeLoading] = useState(false)
  const [visionProbeError, setVisionProbeError] = useState<string | null>(null)
  const [imageModelId, setImageModelId] = useState('')
  // OpenRouter (free tier): API key (auth.json) + live free-model list.
  const [orKeyInput, setOrKeyInput] = useState('')
  const [orAuthHasKey, setOrAuthHasKey] = useState(false)
  const [orAuthPreview, setOrAuthPreview] = useState<string | null>(null)
  const [orAuthError, setOrAuthError] = useState<string | null>(null)
  const [orModels, setOrModels] = useState<{ id: string; name: string; contextLength: number | null }[]>([])
  const [orModelsSource, setOrModelsSource] = useState<'live' | 'fallback' | null>(null)
  const [orModelsLoading, setOrModelsLoading] = useState(false)
  const [orKeySaving, setOrKeySaving] = useState(false)
  const [companionEnabled, setCompanionEnabled] = useState(false)
  const [companionBind, setCompanionBind] = useState<'loopback' | 'lan'>('loopback')
  const [companionPort, setCompanionPort] = useState(9241)
  const [companionUrl, setCompanionUrl] = useState('')
  const [companionUrlsLan, setCompanionUrlsLan] = useState<string[]>([])
  const [companionFqdnUrl, setCompanionFqdnUrl] = useState<string | null>(null)
  const [companionStaticBuilt, setCompanionStaticBuilt] = useState(true)
  const [companionRunning, setCompanionRunning] = useState(false)
  const [companionUsername, setCompanionUsername] = useState('')
  const [companionPassword, setCompanionPassword] = useState('')
  const [companionHasCredentials, setCompanionHasCredentials] = useState(false)
  const [companionCredError, setCompanionCredError] = useState<string | null>(null)
  const [companionTlsMode, setCompanionTlsMode] = useState<'mkcert' | 'sylo-ca'>('sylo-ca')
  const [companionRootCaPath, setCompanionRootCaPath] = useState<string | null>(null)
    const [cloneDir, setCloneDir] = useState('')
  const [gaStatus, setGaStatus] = useState<
    Awaited<ReturnType<typeof window.sylo.globalAgents.status>> | null
  >(null)
  const [gaDraft, setGaDraft] = useState('')
  const [gaDirty, setGaDirty] = useState(false)
  const [gaBusy, setGaBusy] = useState(false)

  const loadGlobalAgents = useCallback(async () => {
    try {
      const s = await window.sylo.globalAgents.status()
      setGaStatus(s)
      setGaDraft(s.content)
      setGaDirty(false)
    } catch {
      /* main process may be on an older build */
    }
  }, [])

  useEffect(() => {
    void loadGlobalAgents()
  }, [loadGlobalAgents])

  const refreshCloneDir = useCallback(async () => {
    try {
      setCloneDir(await window.sylo.workspaces.github.defaultCloneDir())
    } catch {
      /* github bridge may be unavailable on older builds */
    }
  }, [])

  useEffect(() => {
    void refreshCloneDir()
  }, [refreshCloneDir])

  const refreshCompanionStatus = useCallback(async () => {
    const st = await window.sylo.companion.getStatus()
    setCompanionEnabled(st.enabled)
    setCompanionBind(st.bind)
    setCompanionPort(st.port)
        setCompanionUrl(st.urls.loopback)
    setCompanionUrlsLan(st.urls.lan)
    setCompanionFqdnUrl(st.urls.fqdn)
    setCompanionStaticBuilt(st.staticBuilt)
    setCompanionRunning(st.running)
    setCompanionUsername(st.username)
    setCompanionHasCredentials(st.hasCredentials)
    setCompanionTlsMode(st.tls.mode)
    setCompanionRootCaPath(st.tls.rootCaPath)
  }, [])

  useEffect(() => {
    void refreshCompanionStatus()
  }, [refreshCompanionStatus])

    useEffect(() => {
    void (async () => {
      const scope = (await window.sylo.prefs.get('sylo.subagents.agent_scope', 'user')) as string
      setAllowProjectAgents(scope.trim() === 'both')
    })()
  }, [])

  useEffect(() => {
    void window.sylo.tasks.diagnostics().then(setSubagentDiag).catch(() => setSubagentDiag(null))
  }, [allowProjectAgents])

  useEffect(() => {
        setModelId(diagnostics.modelId)
    setModelProvider(diagnostics.modelProvider)
    setConcurrentTurns(diagnostics.concurrentTurns)
    setChatOnly(diagnostics.chatOnly)
  }, [diagnostics.modelId, diagnostics.modelProvider, diagnostics.concurrentTurns, diagnostics.chatOnly])

  useEffect(() => {
    void (async () => {
      const pref = (await window.sylo.prefs.get('sylo.ollama_base_url', '')) as string
      if (pref.trim()) {
        setOllamaBaseUrl(pref.trim())
      } else {
        setOllamaBaseUrl(await window.sylo.ollama.inferBaseUrl())
      }
      setImageModelId((await window.sylo.prefs.get('sylo.image_model_id', '')) as string)
    })()
  }, [])

  useEffect(() => {
    if (modelProvider !== 'ollama') {
      setOllamaListError(null)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        setOllamaListLoading(true)
        setOllamaListError(null)
        const r = await window.sylo.ollama.listTags(normalizeOllamaOriginUi(ollamaBaseUrl))
        if (cancelled) return
        setOllamaListLoading(false)
        if (r.ok) {
          setOllamaTags(r.models)
        } else {
          setOllamaTags([])
          setOllamaListError(r.error)
        }
      })()
    }, 480)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [modelProvider, ollamaBaseUrl])

  useEffect(() => {
    const id = modelId.trim()
    if (modelProvider !== 'ollama' || !id) {
      setModelVisionCapable(false)
      setModelVisionExplicit(false)
      setOllamaVisionDetected(null)
      setVisionProbeError(null)
      return
    }
    let cancelled = false
    void (async () => {
      const cfg = await window.sylo.models.getInputConfig('ollama', id)
      if (cancelled) return
      if (cfg.ok) {
        setModelVisionCapable(cfg.visionCapable)
        setModelVisionExplicit(cfg.explicit)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modelProvider, modelId])

  useEffect(() => {
    const id = modelId.trim()
    if (modelProvider !== 'ollama' || !id) {
      setOllamaVisionDetected(null)
      setVisionProbeError(null)
      setVisionProbeLoading(false)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        setVisionProbeLoading(true)
        setVisionProbeError(null)
        const origin = normalizeOllamaOriginUi(ollamaBaseUrl)
        const probed = await window.sylo.ollama.probeVision(origin, id)
        if (cancelled) return
        setVisionProbeLoading(false)
        if (!probed.ok) {
          setOllamaVisionDetected(null)
          setVisionProbeError(probed.error)
          return
        }
        setOllamaVisionDetected(probed.vision)
        setVisionProbeError(null)
        setModelVisionCapable((prev) => {
          if (modelVisionExplicit) return prev
          return probed.vision
        })
      })()
    }, 320)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [modelProvider, modelId, ollamaBaseUrl, modelVisionExplicit])

    const refreshOllamaTags = useCallback(async () => {
    if (modelProvider !== 'ollama') return
    setOllamaListLoading(true)
    setOllamaListError(null)
    const r = await window.sylo.ollama.listTags(normalizeOllamaOriginUi(ollamaBaseUrl))
    setOllamaListLoading(false)
    if (r.ok) {
      setOllamaTags(r.models)
    } else {
      setOllamaTags([])
      setOllamaListError(r.error)
    }
  }, [modelProvider, ollamaBaseUrl])

  const refreshOrAuth = useCallback(async () => {
    const r = await window.sylo.piAuth.get('openrouter')
    if (r.ok) {
      setOrAuthHasKey(r.hasKey)
      setOrAuthPreview(r.keyPreview)
      setOrAuthError(null)
    } else {
      setOrAuthError(r.error)
    }
  }, [])

  const refreshOrModels = useCallback(async () => {
    setOrModelsLoading(true)
    const r = await window.sylo.openrouter.listModels()
    setOrModelsLoading(false)
    if (r.ok) {
      setOrModels(r.models)
      setOrModelsSource(r.source)
    } else {
      setOrModels([])
      setOrModelsSource(null)
    }
  }, [])

  useEffect(() => {
    if (modelProvider !== 'openrouter') return
    void refreshOrAuth()
    void refreshOrModels()
  }, [modelProvider, refreshOrAuth, refreshOrModels])

    const saveModelPrefs = async () => {
    const origin = normalizeOllamaOriginUi(ollamaBaseUrl)
    const trimmedId = modelId.trim()
    const trimmedImageId = imageModelId.trim()
    // OpenRouter: persist the key to Pi's auth.json BEFORE saving prefs, so the
    // broker restart that follows always has the credential to work with.
    if (modelProvider === 'openrouter' && orKeyInput.trim() !== '') {
      setOrKeySaving(true)
      const w = await window.sylo.piAuth.set('openrouter', orKeyInput.trim())
      setOrKeySaving(false)
      if (!w.ok) {
        window.alert(
          `Could not save the OpenRouter key to auth.json:\n${w.error}\n\nPi reads this file at session start, so the model would still be unreachable.`,
        )
        return
      }
      const k = orKeyInput.trim()
      setOrAuthHasKey(true)
      setOrAuthPreview('…' + (k.length > 12 ? k.slice(-8) : k.slice(-4)))
      setOrKeyInput('')
      setOrAuthError(null)
    }
    await window.sylo.prefs.set('sylo.model_provider', modelProvider)
    await window.sylo.prefs.set('sylo.model_id', modelId)
    await window.sylo.prefs.set('sylo.image_model_id', trimmedImageId)
    await window.sylo.prefs.set(
      'sylo.image_model_provider',
      trimmedImageId ? 'ollama' : '',
    )
    if (modelProvider === 'ollama') {
      await window.sylo.prefs.set('sylo.ollama_base_url', origin)
      const patch = await window.sylo.ollama.patchBaseUrl(
        origin,
        trimmedId || undefined,
        trimmedId ? modelVisionCapable : undefined,
      )
      if (!patch.ok) {
        window.alert(`Could not update ~/.pi/agent/models.json: ${patch.error}`)
        return
      }
      if (trimmedId) {
        setModelVisionExplicit(true)
      }
    }
    if (trimmedImageId) {
      const patchImage = await window.sylo.ollama.patchBaseUrl(origin, trimmedImageId, true)
      if (!patchImage.ok) {
        window.alert(`Could not register image fallback model in models.json: ${patchImage.error}`)
        return
      }
      const probed = await window.sylo.ollama.probeVision(origin, trimmedImageId)
      if (probed.ok) {
        await window.sylo.models.setVision('ollama', trimmedImageId, probed.vision)
      }
    }
    // Chat caption + AgentSession read the running broker; prefs alone do not hot-swap the model.
    await window.sylo.broker.restart()
    onChanged()
  }

  return (
    <div className={cn(panelShell, 'flex flex-col gap-3.5')}>
            <section className={card}>
        <h2 className={cardTitle}>Model (Pi)</h2>
        <p className={leadText}>
          Provider + model id are passed into Pi&apos;s <code>ModelRegistry</code>. Leave both empty to use whatever Pi
          already has in <code>settings.json</code> / session defaults (no Sylo override).
        </p>
        <div className="flex flex-col gap-2.5">
          <label className="flex min-w-[140px] flex-col gap-1">
            <span className={fieldLabel}>Provider</span>
            <select className={select} value={modelProvider} onChange={(e) => setModelProvider(e.target.value)}>
              <option value="">Pi default (no Sylo override)</option>
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>

          {modelProvider === 'ollama' ?
            <>
              <label className="flex min-w-[140px] flex-col gap-1">
                <span className={fieldLabel}>Ollama server URL</span>
                <p className={caption}>
                  Saved to <code>~/.pi/agent/models.json</code> as OpenAI-compatible{' '}
                  <code>{normalizeOllamaOriginUi(ollamaBaseUrl) || '…'}/v1</code> (used by Pi for requests).
                </p>
                <input
                  className={input}
                  value={ollamaBaseUrl}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:11434 or http://host:11434"
                  autoComplete="off"
                />
              </label>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => void refreshOllamaTags()}
                  disabled={ollamaListLoading}
                >
                  {ollamaListLoading ? 'Loading models…' : 'Refresh model list'}
                </button>
                {ollamaTags.length > 0 ?
                  <span className={caption}>
                    {ollamaTags.length} model(s) from <code>/api/tags</code>
                  </span>
                : null}
              </div>
              {ollamaListError ?
                <p className={errorText}>{ollamaListError}</p>
              : null}
            </>
          : null}

                    {modelProvider === 'openrouter' ?
            <div className="flex flex-col gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
              <label className="flex min-w-[140px] flex-col gap-1" htmlFor="sylo-or-key-input">
                <span className={fieldLabel}>OpenRouter API key</span>
                <input
                  id="sylo-or-key-input"
                  className={input}
                  type="password"
                  value={orKeyInput}
                  onChange={(e) => setOrKeyInput(e.target.value)}
                  placeholder="sk-or-... — create one at openrouter.ai/keys"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <p className={caption}>
                {orAuthHasKey ?
                  <>Saved key: <code>{orAuthPreview}</code>. Leave the box empty to keep it — the key is stored in Pi&apos;s <code>auth.json</code> (not Sylo prefs), so switching providers back and forth never loses it.</>
                  : <>No key saved yet. Sylo stores it in Pi&apos;s <code>~/.pi/agent/auth.json</code> — the same file Pi&apos;s <code>/login</code> uses — so it survives restarts and provider switches.</>
                }
                {orKeySaving ? ' Saving…' : null}
              </p>
              {orAuthError ? <p className={errorText}>{orAuthError}</p> : null}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => void refreshOrModels()}
                  disabled={orModelsLoading}
                >
                  {orModelsLoading ? 'Loading models…' : 'Refresh free model list'}
                </button>
                {orModels.length > 0 ?
                  <span className={caption}>
                    {orModels.length} free model(s)
                    {orModelsSource === 'fallback' ? ' (offline fallback list)' : ' from openrouter.ai'}
                  </span>
                : null}
                {orAuthHasKey ?
                  <button
                    type="button"
                    className={btnGhostSm}
                    onClick={() => {
                      if (!window.confirm('Remove the saved OpenRouter key from auth.json?')) return
                      void (async () => {
                        const w = await window.sylo.piAuth.set('openrouter', '')
                        if (!w.ok) {
                          window.alert(`Could not remove the key: ${w.error}`)
                          return
                        }
                        setOrAuthHasKey(false)
                        setOrAuthPreview(null)
                      })()
                    }}
                  >
                    Remove saved key
                  </button>
                : null}
              </div>
              {orModels.length > 0 ?
                <select
                  className={select}
                  value={modelId}
                  onChange={(e) => {
                    if (e.target.value !== '') setModelId(e.target.value)
                  }}
                  aria-label="OpenRouter free model"
                >
                  <option value="">Choose a free model… (or type any id below)</option>
                  {modelId.trim() !== '' && !orModels.some((m) => m.id === modelId) ?
                    <option value={modelId}>{modelId} (custom)</option>
                  : null}
                  {orModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.id}
                    </option>
                  ))}
                </select>
              : null}
            </div>
          : null}

          <label
            className="flex min-w-[140px] flex-col gap-1"
            htmlFor={modelProvider === 'ollama' ? 'sylo-ollama-model-select' : 'sylo-model-id-input'}
          >
            <span className={fieldLabel}>
              {modelProvider === 'ollama' ? 'Model' : 'Model id'} (must match Pi / ~/.pi/agent/models.json)
            </span>
            {modelProvider === 'ollama' ?
              <OllamaModelSelect modelId={modelId} setModelId={setModelId} ollamaTags={ollamaTags} />
            : <input
                id="sylo-model-id-input"
                className={input}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder={`e.g. ${SYLO_DEFAULT_MODEL_ID} — or leave empty for Pi default`}
              />
            }
          </label>

          {modelProvider === 'ollama' && modelId.trim() !== '' ?
            <div className="flex flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
              <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={modelVisionCapable}
                  onChange={(e) => {
                    setModelVisionCapable(e.target.checked)
                    setModelVisionExplicit(true)
                  }}
                />
                <span>Supports vision (image paste in chat)</span>
              </label>
              <p className={caption}>
                Pi only sends pasted screenshots when <code>models.json</code> lists{' '}
                <code>&quot;image&quot;</code> in <code>input</code>. Sylo probes Ollama{' '}
                <code>/api/show</code> and sets this automatically when you save — uncheck if you
                want text-only for a vision model.
              </p>
              {visionProbeLoading ?
                <p className={caption}>Detecting vision from Ollama…</p>
              : visionProbeError ?
                <p className={errorText}>Ollama vision probe failed: {visionProbeError}</p>
              : ollamaVisionDetected !== null ?
                <p className={caption}>
                  Ollama reports: <strong>{ollamaVisionDetected ? 'vision yes' : 'vision no'}</strong>
                  {modelVisionExplicit && modelVisionCapable !== ollamaVisionDetected ?
                    ' — your saved setting overrides detection.'
                  : !modelVisionExplicit && ollamaVisionDetected ?
                    ' — will be saved when you click Save model settings.'
                  : null}
                </p>
              : null}
            </div>
          : null}

          <div className="flex flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
            <span className={fieldLabel}>Image model (fallback, optional)</span>
            <p className={caption}>
              When your main model is <strong>text-only</strong>, Sylo can describe pasted images with a
              separate Ollama vision model and inject that text into the chat. Ignored when the main model
              already supports vision. Uses the same Ollama server URL as above.
            </p>
            {modelProvider === 'ollama' ?
              <OllamaModelSelect
                id="sylo-ollama-image-model-select"
                modelId={imageModelId}
                setModelId={setImageModelId}
                ollamaTags={ollamaTags}
                emptyOptionLabel="None — path only when main model lacks vision"
              />
            : <input
                id="sylo-image-model-id-input"
                className={input}
                value={imageModelId}
                onChange={(e) => setImageModelId(e.target.value)}
                placeholder="Ollama model id (e.g. qwen3-vl:8b) — empty to disable"
              />
            }
          </div>
        </div>

        <div className="mt-2.5 flex flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
          <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={chatOnly}
              onChange={(e) => {
                const next = e.target.checked
                setChatOnly(next)
                void window.sylo.prefs.set('sylo.chat_only', next).then(async () => {
                  await window.sylo.broker.restart()
                  onChanged()
                })
              }}
            />
            <span>Chat only (no tools)</span>
          </label>
          <p className={caption}>
            Plain conversation — Pi will not send read/bash/MCP tools to the model. Use this for
            local chat models (e.g. Dolphin Mixtral) that reject tool payloads. Restart applies
            immediately when toggled.
          </p>
        </div>

        <button type="button" className={cn(btnPrimary, 'mt-3')} onClick={() => void saveModelPrefs()}>
          Save model settings
        </button>
        <p className={cn(leadText, 'mb-0 mt-2.5')}>
          Saving restarts the broker automatically. If the agent is stuck, use <strong>Developer → Restart broker</strong> in the
          sidebar (Developer section).
        </p>
      </section>

      <section className={card}>
        <h2 className={cardTitle}>Global Pi directory</h2>
        <p className={leadText}>
          Pi&apos;s machine-wide home (default <code>~/.pi/agent</code>; Pi docs call this the{' '}
          <strong>agent directory</strong>) for <code>settings.json</code>, <code>models.json</code>, global
          extensions/skills, and Sylo session transcripts (<code>sessions/sylo/…</code>). Workspace{' '}
          <strong>project folders</strong> are separate — set those per workspace under{' '}
          <strong>Edit workspaces</strong> in the sidebar.
        </p>
        <p className={cn(caption, 'mb-1.5 mt-3')}>
          <strong>Resolved:</strong>{' '}
          <code className="break-all">{diagnostics.resolvedPiAgentDir}</code>
        </p>
        {diagnostics.piAgentDir.trim() ?
          <p className={cn(caption, 'mt-0')}>
            Pref override (<code>sylo.pi_agent_dir</code>): <code>{diagnostics.piAgentDir}</code>
          </p>
        : (
          <p className={cn(caption, 'mt-0')}>
            Pref empty — expands to the path above (typically <code>~/.pi/agent</code> on disk).
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              void window.sylo.dialog.openDirectory().then((p) => {
                if (p) void window.sylo.prefs.set('sylo.pi_agent_dir', p).then(onChanged)
              })
            }}
          >
            Choose global Pi directory…
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={() => void window.sylo.prefs.set('sylo.pi_agent_dir', '').then(onChanged)}
          >
            Reset to default ~/.pi/agent
          </button>
        </div>
        <p className={cn(caption, 'mb-1.5 mt-3')}>
          <strong>Skills folders</strong> — global skills live under{' '}
          <code className="break-all">{diagnostics.resolvedPiAgentDir}/skills</code>; project-scoped skills live under{' '}
          <code className="break-all">{activeWorkspace.resolvedPiCwd}/.pi/skills</code> for the sidebar workspace{' '}
          <strong>{activeWorkspace.name}</strong>.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className={btnGhost}
            title={`${diagnostics.resolvedPiAgentDir}/skills`}
            onClick={() => {
              void revealDirectory(
                `${diagnostics.resolvedPiAgentDir}/skills`,
                'global skills folder',
              )
            }}
          >
            Open global skills folder
          </button>
          <button
            type="button"
            className={btnGhost}
            title={`${activeWorkspace.resolvedPiCwd}/.pi/skills`}
            onClick={() => {
              void revealDirectory(
                `${activeWorkspace.resolvedPiCwd}/.pi/skills`,
                'workspace project skills folder',
              )
            }}
          >
            Open workspace project skills folder
          </button>
        </div>
        <p className={cn(caption, 'mb-0 mt-2.5')}>
          Saving does <strong>not</strong> restart the broker automatically; use <strong>Developer → Restart broker</strong>{' '}
                    after changing this unless you only need the prefs panel to refresh.
        </p>
      </section>

      <section className={card}>
        <h2 className={cardTitle}>Global AI instructions</h2>
        <p className={leadText}>
          Your standing instructions for the AI in <strong>every chat, every workspace</strong>. The source of truth
          lives in your universal workspace (the default <code>sylo-user</code> folder, renamed freely — e.g.
          <code>sylo-work</code> on work machines) so it travels with your other user-data files. Sylo deploys it to
          the global Pi directory at startup and on save.
        </p>
        {gaStatus && (
          <p className={cn(caption, 'mb-1.5 mt-3')}>
            <strong>Source:</strong>{' '}
            <code className="break-all">{gaStatus.sourcePath}</code>
            {!gaStatus.sourceExists && <span className={errorText}> (missing)</span>}
            <br />
            <strong>Deployed to:</strong>{' '}
            <code className="break-all">{gaStatus.targetPath}</code>{' '}
            {gaStatus.inSync ? (
              <span className={mutedText}>(in sync)</span>
            ) : (
              <span className={errorText}>(out of sync — will redeploy on next start or save)</span>
            )}
          </p>
        )}
        <textarea
          className={cn(textarea, 'mt-2 w-full')}
          spellCheck={false}
          value={gaDraft}
          onChange={(e) => {
            setGaDraft(e.target.value)
            setGaDirty(true)
          }}
          placeholder="Standing instructions, principles, tone…"
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className={gaDirty ? btnPrimary : btnGhost}
            disabled={gaBusy}
            onClick={() => {
              setGaBusy(true)
              void window.sylo.globalAgents
                .save(gaDraft)
                .then((s) => {
                  setGaStatus(s)
                  setGaDraft(s.content)
                  setGaDirty(false)
                })
                .catch((e) => window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`))
                .finally(() => setGaBusy(false))
            }}
          >
            {gaBusy ? 'Saving…' : 'Save & deploy'}
          </button>
          <button
            type="button"
            className={btnGhost}
            disabled={gaBusy}
            onClick={() => {
              setGaBusy(true)
              void window.sylo.globalAgents
                .deploy()
                .then((s) => {
                  setGaStatus(s)
                  setGaDraft(s.content)
                  setGaDirty(false)
                })
                .catch((e) => window.alert(`Could not redeploy: ${e instanceof Error ? e.message : String(e)}`))
                .finally(() => setGaBusy(false))
            }}
          >
            Reload from source
          </button>
        </div>
        <p className={cn(caption, 'mb-0 mt-2.5')}>
          Between computers: this file syncs with the universal workspace (git) or copy it manually — it is one file.
          The deployed copy also carries a machine-managed pointer block that Sylo rewrites on each deploy; edits made
          directly to the deployed file are overwritten on the next startup or save.
        </p>
      </section>

      <section className={card}>
        <h2 className={cardTitle}>Clone folder</h2>
        <p className={leadText}>
          Where repos cloned via <strong>Clone from GitHub</strong> land by default. New clones are
          created under <code>&lt;clone folder&gt;/&lt;owner&gt;/&lt;repo&gt;</code>. The folder is
          created on startup if it doesn&apos;t exist. The built-in default is{' '}
          <code>&lt;Documents&gt;/GitHub</code>.
        </p>
        <p className={cn(caption, 'mb-1.5 mt-3')}>
          <strong>Current:</strong> <code className="break-all">{cloneDir || '(unknown)'}</code>
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              void window.sylo.dialog.openDirectory().then(async (p) => {
                if (!p) return
                await window.sylo.workspaces.github.setDefaultCloneDir(p)
                await refreshCloneDir()
                await onChanged()
              })
            }}
          >
            Choose clone folder…
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={async () => {
              await window.sylo.workspaces.github.setDefaultCloneDir('')
              await refreshCloneDir()
              await onChanged()
            }}
          >
            Reset to default
          </button>
          <button
            type="button"
            className={btnGhost}
            title={cloneDir}
            onClick={() => void revealDirectory(cloneDir, 'clone folder')}
          >
            Open clone folder
          </button>
        </div>
      </section>

      <WeeklySweepCard />

      <section className={card}>
        <h2 className={cardTitle}>Chat concurrency</h2>
        <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={concurrentTurns}
            onChange={(e) => {
              setConcurrentTurns(e.target.checked)
              void window.sylo.prefs
                .set('sylo.chat.concurrent_turns', e.target.checked)
                .then(onChanged)
            }}
          />
          <span>Allow concurrent agent turns across conversations (up to 4 in flight)</span>
        </label>
        <p className={leadText}>
          When enabled, you can send in another chat while a cloud model is still working in the
                    current one. Each extra turn uses its own Pi broker process. Same chat still runs one turn
          at a time (use Enter to queue or Ctrl+Enter to steer).
        </p>
      </section>

      <Suspense fallback={null}>
        <PersonalSettingsCard onChanged={onChanged} />
      </Suspense>


      <section className={card}>
        <h2 className={cardTitle}>Companion (phone / LAN)</h2>
        <p className={leadText}>
          Optional mobile web UI against this desktop Sylo. Set a username and password here, then log in from your phone.
          Still worth having on a home LAN — guest Wi‑Fi and other devices can reach an open port.
        </p>
        {!companionStaticBuilt ?
          <p className={errorText}>
            Companion UI not built. Run <code className="text-[0.85em]">npm run build:companion</code> in{' '}
            <code className="text-[0.85em]">apps/host</code>, then restart Sylo.
          </p>
        : null}
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[140px] flex-1 flex-col gap-1">
            <span className={fieldLabel}>Username</span>
            <input
              className={input}
              value={companionUsername}
              onChange={(e) => setCompanionUsername(e.target.value)}
              autoComplete="off"
              placeholder="e.g. sylo"
            />
          </label>
          <label className="flex min-w-[140px] flex-1 flex-col gap-1">
            <span className={fieldLabel}>Password</span>
            <input
              className={input}
              type="password"
              value={companionPassword}
              onChange={(e) => setCompanionPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={companionHasCredentials ? 'Leave blank to keep current' : 'Required before enable'}
            />
          </label>
        </div>
        {companionCredError ?
          <p className={errorText}>{companionCredError}</p>
        : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={btnPrimary}
            onClick={() => {
              setCompanionCredError(null)
              const password = companionPassword.trim()
              if (!companionUsername.trim()) {
                setCompanionCredError('Username is required.')
                return
              }
              if (!password && !companionHasCredentials) {
                setCompanionCredError('Password is required the first time.')
                return
              }
              if (!password) {
                setCompanionCredError('Enter a new password to change it.')
                return
              }
              void window.sylo.companion
                .setCredentials({ username: companionUsername.trim(), password })
                .then((r) => {
                  if ('ok' in r && r.ok === false) {
                    setCompanionCredError(
                      r.error === 'username_required' ? 'Username is required.'
                      : r.error === 'password_required' ? 'Password is required.'
                      : r.error,
                    )
                    return
                  }
                  setCompanionPassword('')
                  void refreshCompanionStatus()
                })
            }}
          >
            Save login
          </button>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-[0.88rem]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={companionEnabled}
            disabled={!companionHasCredentials}
            onChange={(e) => {
              const enabled = e.target.checked
              setCompanionEnabled(enabled)
              void window.sylo.companion
                .setConfig({ enabled, bind: companionBind, port: companionPort })
                .then((st) => {
                  if ('ok' in st && st.ok === false) {
                    setCompanionEnabled(false)
                    setCompanionCredError('Save username and password before enabling.')
                    return
                  }
                                    if ('urls' in st) {
                    setCompanionUrl(st.urls.loopback)
                    setCompanionUrlsLan(st.urls.lan)
                    setCompanionFqdnUrl(st.urls.fqdn)
                    setCompanionRunning(st.running)
                    setCompanionStaticBuilt(st.staticBuilt)
                  }
                })
            }}
          />
          <span>Enable companion server{!companionHasCredentials ? ' (save login first)' : ''}</span>
        </label>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[120px] flex-col gap-1">
            <span className={fieldLabel}>HTTPS port</span>
            <input
              className={input}
              type="number"
              min={1024}
              max={65535}
              value={companionPort}
              onChange={(e) => setCompanionPort(Number(e.target.value) || 9241)}
              onBlur={() => {
                void window.sylo.companion
                  .setConfig({ enabled: companionEnabled, bind: companionBind, port: companionPort })
                  .then((st) => {
                    if ('ok' in st && st.ok === false) return
                    void refreshCompanionStatus()
                  })
              }}
            />
          </label>
          <label className="flex min-w-[160px] flex-col gap-1">
            <span className={fieldLabel}>Network bind</span>
            <select
              className={select}
              value={companionBind}
              onChange={(e) => {
                const bind = e.target.value === 'lan' ? 'lan' : 'loopback'
                setCompanionBind(bind)
                void window.sylo.companion
                  .setConfig({ enabled: companionEnabled, bind, port: companionPort })
                  .then((st) => {
                    if ('ok' in st && st.ok === false) return
                    void refreshCompanionStatus()
                  })
              }}
            >
              <option value="loopback">This PC only (127.0.0.1)</option>
              <option value="lan">Phone on same Wi‑Fi / Tailscale (0.0.0.0)</option>
            </select>
          </label>
        </div>
        {companionEnabled ?
          <>
            <p className={cn(caption, 'mt-3')}>
              Status: {companionRunning ? 'running' : 'not running'}
              {companionBind === 'lan' ?
                ` — allow Node on HTTPS port ${companionPort} through Windows Firewall.`
              : ' — phone on another device cannot reach loopback; switch bind to LAN.'}
            </p>
                        {companionUrl ?
              <div className="mt-2 flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className={fieldLabel}>URL (this PC)</span>
                  <input className={input} readOnly value={companionUrl} onFocus={(e) => e.target.select()} />
                </label>
                {companionFqdnUrl ?
                  <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>URL (Tailscale — use on phone)</span>
                    <input className={input} readOnly value={companionFqdnUrl} onFocus={(e) => e.target.select()} />
                  </label>
                : null}
                {companionUrlsLan.map((u) => (
                  <label key={u} className="flex flex-col gap-1">
                    <span className={fieldLabel}>URL (LAN — {companionFqdnUrl ? 'untrusted fallback' : 'use on phone'})</span>
                    <input className={input} readOnly value={u} onFocus={(e) => e.target.select()} />
                  </label>
                ))}
              </div>
            : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={btnGhostSm}
                                onClick={() => {
                  const copy = companionFqdnUrl ?? companionUrlsLan[0] ?? companionUrl
                  if (copy) void navigator.clipboard.writeText(copy)
                }}
              >
                Copy phone URL
              </button>
              <button
                type="button"
                className={btnGhostSm}
                onClick={() => {
                  void window.sylo.companion.openCertsFolder()
                }}
              >
                Open certs folder
              </button>
              {companionRootCaPath ?
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => {
                    void navigator.clipboard.writeText(companionRootCaPath)
                  }}
                >
                  Copy root CA path
                </button>
              : null}
            </div>
            <p className={cn(caption, 'mb-0 mt-2')}>
                            HTTPS:{' '}
              {companionTlsMode === 'mkcert' ?
                (companionFqdnUrl ?
                  <>trusted public cert — <code className="text-[0.85em]">{companionFqdnUrl}</code> (apps/host/certs/ override)</>
                : 'using mkcert files in apps/host/certs/ (developer override)')
              : 'Sylo creates a unique CA when companion starts. The phone downloads it from the companion site.'}
            </p>
                        {(companionFqdnUrl ?? companionUrlsLan[0] ?? companionUrl) ?
              <p className={cn(caption, 'mb-0 mt-2')}>
                {companionFqdnUrl ?
                  <>On the phone, open the <strong>Tailscale URL</strong> → log in → <strong>Install app</strong>. No root-cert install needed — trusted Let's Encrypt cert for your node's <code className="text-[0.85em]">*.ts.net</code> name. Full steps: <code className="text-[0.85em]">docs/COMPANION_PHONE_INSTALL.md</code>.</>
                : <>On the phone, open the LAN URL → tap <strong>Download root certificate</strong> → install as CA
                  → reload → log in → <strong>Install app</strong>. Full steps:{' '}
                  <code className="text-[0.85em]">docs/COMPANION_PHONE_INSTALL.md</code></>}
              </p>
            : null}
            <p className={cn(caption, 'mb-0 mt-2')}>
              Root CA download path on the server:{' '}
              <code className="text-[0.85em]">/api/companion/root-ca.pem</code>
            </p>
            <p className={cn(caption, 'mb-0 mt-2')}>
              Changing the password logs out phones until they sign in again.
            </p>
          </>
        : null}
      </section>

      <section className={card}>
        <h2 className={cardTitle}>Subagents</h2>
        <p className={leadText}>
          Sylo ships <strong>sylo-subagents</strong> (built-in extension) so the primary agent can delegate to
          scout, planner, worker, and reviewer child sessions. Runs appear inline in chat under each{' '}
          <code className="font-mono text-[0.86em]">subagent</code> tool row. Custom agent personas live as markdown under{' '}
          <code className="break-all">{diagnostics.resolvedPiAgentDir}/agents</code> (global) or{' '}
          <code className="break-all">{activeWorkspace.resolvedPiCwd}/.pi/agents</code> (project, optional).
        </p>
        <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[0.88rem]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={allowProjectAgents}
            onChange={(e) => {
              const next = e.target.checked
              setAllowProjectAgents(next)
              void window.sylo.prefs
                .set('sylo.subagents.agent_scope', next ? 'both' : 'user')
                .then(async () => {
                  await window.sylo.broker.restart()
                  onChanged()
                })
            }}
          />
          <span>Allow project agents (<code>.pi/agents/*.md</code> in the workspace folder)</span>
        </label>
        <p className={caption}>
          Off by default. When enabled, the agent may use repo-local personas after you confirm a prompt for
          untrusted projects. Restart broker applies immediately when toggled.
        </p>
        <div className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--sylo-border)_70%,transparent)] px-3 py-2.5">
          <p className={cn(caption, 'mb-1.5 font-medium text-text-primary')}>Diagnostics</p>
          <ul className={cn(caption, 'm-0 list-inside list-disc space-y-1')}>
            <li>
              Built-in extension:{' '}
              {subagentDiag ?
                subagentDiag.extensionEnabled ?
                  'loaded'
                : 'disabled in Capability manager'
              : '…'}
            </li>
            <li>
              Active runs (all conversations):{' '}
              {subagentDiag !== null ? String(subagentDiag.runningCount) : '…'}
            </li>
            <li>
              Orphaned rows (prior broker crash):{' '}
              {subagentDiag !== null ? String(subagentDiag.orphanedCount) : '…'}
            </li>
          </ul>
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
    </div>
  )
}
