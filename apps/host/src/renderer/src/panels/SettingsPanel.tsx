import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react'

// Personal-bundle Settings card — declarative config from the installed
// personal plugin; renders nothing when the bundle is absent.
const PersonalSettingsCard = lazy(() => import('./PersonalSettingsCard'))

import { clampMaxConcurrentTurns } from '../../../shared/concurrent-turns'
import {
  DEFAULT_MAX_CONCURRENT_TURNS,
  MAX_CONCURRENT_TURNS_LIMIT,
  MIN_CONCURRENT_TURNS,
  SYLO_MAX_CONCURRENT_TURNS_PREF,
} from '../../../shared/concurrent-turns'
import { normalizeOllamaOriginUi } from './ollama-ui'
import { PathRow } from './PathRow'
import { Badge } from './Badge'
import { ToastHost, toast } from './toast'
import { ModelCard } from './ModelCard'
import { SubagentsCard } from './SubagentsCard'
import { CompanionCard } from './CompanionCard'
import { WeeklySweepCard } from './WeeklySweepCard'
import { cn } from '../lib/cn'
import {
  btnGhost,
  btnGhostSm,
  btnPrimary,
  card,
  cardTitle,
  detailsBody,
  detailsSummary,
  fieldLabel,
  input,
  leadText,
  mutedText,
  settingsRail,
  settingsRailBtn,
  settingsRailBtnActive,
  settingsRailLabel,
  textarea,
} from './ui-classes'

const caption = cn(mutedText, 'm-0 text-[0.78rem] leading-[1.4]')

/** Reveal a filesystem path in the OS file manager, with toast feedback. */
export async function revealDirectory(
  dir: string,
  label: string,
): Promise<void> {
  const openDir = window.sylo.shell?.openDirectory
  if (typeof openDir !== 'function') {
    toast(`${label} needs a full Sylo restart (shell bridge not loaded).`, 'error')
    return
  }
  try {
    const r = await openDir(dir)
    if (!r.ok) toast(`Could not open ${label}:\n${r.error}`, 'error')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    toast(
      msg.includes('No handler registered') ?
        `${label} needs a full Sylo restart (main process still on an old build).`
      : `Could not open ${label}:\n${msg}`,
      'error',
    )
  }
}

type SettingsCategory = 'general' | 'model' | 'subagents' | 'companion' | 'extensions'

const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'model', label: 'Model' },
  { id: 'subagents', label: 'Subagents' },
  { id: 'companion', label: 'Companion' },
  { id: 'extensions', label: 'Extensions' },
]

/**
 * Settings shell — a left category rail plus one scrolled pane per category.
 * Every category stays mounted (hidden via CSS) so unsaved drafts survive
 * switching; the shared Ollama connection (URL + tag list) is owned here
 * because both the Model and Subagents cards need it.
 */
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
    maxConcurrentTurns: number
    chatOnly: boolean
  }
  activeWorkspace: {
    id: string
    name: string
    resolvedPiCwd: string
  }
}): React.ReactElement {
  const [activeCat, setActiveCat] = useState<SettingsCategory>('general')
  /** Bumped when provider lists may have changed (providers modal, sign-ins, key removal);
   *  refetches the configured-provider list used by the Subagents card. */
  const [providerListVersion, setProviderListVersion] = useState(0)

  // --- Shared Ollama connection (used by Model + Subagents cards) ------------
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://127.0.0.1:11434')
  const [ollamaTags, setOllamaTags] = useState<string[]>([])
  const [ollamaListError, setOllamaListError] = useState<string | null>(null)
  const [ollamaListLoading, setOllamaListLoading] = useState(false)

  const refreshOllamaTags = useCallback(async () => {
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
  }, [ollamaBaseUrl])

  useEffect(() => {
    void (async () => {
      const pref = (await window.sylo.prefs.get('sylo.ollama_base_url', '')) as string
      if (pref.trim()) {
        setOllamaBaseUrl(pref.trim())
      } else {
        setOllamaBaseUrl(await window.sylo.ollama.inferBaseUrl())
      }
    })()
  }, [])

  // Loaded for every provider, not just Ollama: the image fallback is always an
  // Ollama vision model, so its picker needs the tag list even when the main
  // model is ChatGPT OAuth or another remote provider.
  useEffect(() => {
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
  }, [ollamaBaseUrl])

  // --- General: global AI instructions --------------------------------------
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

  // --- General: clone folder -------------------------------------------------
  const [cloneDir, setCloneDir] = useState('')

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

  // --- General: chat concurrency ---------------------------------------------
  const [concurrentTurns, setConcurrentTurns] = useState(diagnostics.concurrentTurns)
  const [maxConcurrentTurns, setMaxConcurrentTurns] = useState(diagnostics.maxConcurrentTurns)
  /** Free-text draft for the number input — persisted only when it parses. */
  const [maxConcurrentDraft, setMaxConcurrentDraft] = useState(String(diagnostics.maxConcurrentTurns))

  useEffect(() => {
    setConcurrentTurns(diagnostics.concurrentTurns)
    setMaxConcurrentTurns(diagnostics.maxConcurrentTurns)
    setMaxConcurrentDraft(String(diagnostics.maxConcurrentTurns))
  }, [diagnostics.concurrentTurns, diagnostics.maxConcurrentTurns])

  return (
    <div className="flex min-h-0 flex-1 w-full">
      <ToastHost />

      {/* Category rail */}
      <nav className={settingsRail} aria-label="Settings categories">
        <span className={settingsRailLabel}>Settings</span>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            aria-current={activeCat === cat.id ? 'true' : undefined}
            className={cn(activeCat === cat.id ? settingsRailBtnActive : settingsRailBtn)}
            onClick={() => setActiveCat(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </nav>

      {/* Scrolled category pane — switching hides a category, never unmounts it,
          so partially entered drafts survive category switches. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain touch-pan-y p-4">
        {/* --- General ------------------------------------------------------- */}
        <div className={cn('flex flex-col gap-3.5', activeCat !== 'general' && 'hidden')}>
          <section className={card}>
            <h2 className={cardTitle}>Global Pi directory</h2>
            <p className={leadText}>
              Pi&apos;s machine-wide home for <code>settings.json</code>, <code>models.json</code>, skills, and transcripts.
            </p>
            <div className="mb-1.5 mt-3 flex flex-col gap-1.5">
              <PathRow label="Resolved" path={diagnostics.resolvedPiAgentDir} />
              {diagnostics.piAgentDir.trim() ?
                <PathRow label="Pref override" path={diagnostics.piAgentDir} />
              : (
                <span className={cn(mutedText, 'text-[0.75rem] leading-[1.4]')}>
                  No override set — defaults to <code>~/.pi/agent</code>.
                </span>
              )}
            </div>
            <details className="mb-1.5 mt-3">
              <summary className={detailsSummary}>What lives here</summary>
              <p className={detailsBody}>
                Default <code>~/.pi/agent</code> (Pi docs call it the agent directory): global
                extensions/skills and Sylo session transcripts (<code>sessions/sylo/…</code>). Workspace{' '}
                <strong>project folders</strong> are separate — set those per workspace under{' '}
                <strong>Edit workspaces</strong> in the sidebar.
              </p>
            </details>
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
            <div className="mt-2.5 flex flex-col gap-1.5">
              <PathRow
                label="Skills (global)"
                path={`${diagnostics.resolvedPiAgentDir}/skills`}
                onOpen={() =>
                  void revealDirectory(
                    `${diagnostics.resolvedPiAgentDir}/skills`,
                    'global skills folder',
                  )
                }
              />
              <PathRow
                label="Skills (project)"
                path={`${activeWorkspace.resolvedPiCwd}/.pi/skills`}
                onOpen={() =>
                  void revealDirectory(
                    `${activeWorkspace.resolvedPiCwd}/.pi/skills`,
                    'workspace project skills folder',
                  )
                }
              />
            </div>
            <p className={cn(caption, 'mb-0 mt-2.5')}>
              Changes apply after <strong>Developer → Restart broker</strong>.
            </p>
          </section>

          <section className={card}>
            <h2 className={cardTitle}>Global AI instructions</h2>
            <p className={leadText}>
              Standing instructions for the AI in <strong>every chat, every workspace</strong>.
            </p>
            <details className="m-0 mb-1.5">
              <summary className={detailsSummary}>Where this lives</summary>
              <p className={detailsBody}>
                The source of truth lives in your universal workspace (default <code>sylo-user</code>, renamed
                freely — e.g. <code>sylo-work</code>, <code>sylo-personal</code>) so it travels with your other
                user-data files. Sylo deploys it to the global Pi directory at startup and on save.
              </p>
            </details>
            {gaStatus && (
              <div className="mb-1.5 mt-3 flex flex-col gap-1.5">
                <PathRow
                  label="Source"
                  path={gaStatus.sourcePath}
                  trailing={!gaStatus.sourceExists ? <Badge tone="bad">Missing</Badge> : null}
                />
                <PathRow label="Deployed" path={gaStatus.targetPath} />
                {gaStatus.inSync ?
                  <Badge tone="ok">In sync</Badge>
                : <Badge tone="warn" title="Redeploys automatically on next start or save">Out of sync — auto-redeploys</Badge>}
              </div>
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
                    .catch((e) => toast(`Could not save: ${e instanceof Error ? e.message : String(e)}`, 'error'))
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
                    .catch((e) => toast(`Could not redeploy: ${e instanceof Error ? e.message : String(e)}`, 'error'))
                    .finally(() => setGaBusy(false))
                }}
              >
                Reload from source
              </button>
            </div>
            <details className="mt-2.5">
              <summary className={detailsSummary}>Syncing between computers</summary>
              <p className={detailsBody}>
                This one file syncs with the universal workspace (git) or copy it manually. The deployed copy
                also carries a machine-managed pointer block that Sylo rewrites on each deploy — edits made
                directly to the deployed file are overwritten on the next startup or save.
              </p>
            </details>
          </section>

          <section className={card}>
            <h2 className={cardTitle}>Clone folder</h2>
            <p className={leadText}>
              Default landing spot for repos cloned from GitHub: <code>&lt;folder&gt;/&lt;owner&gt;/&lt;repo&gt;</code>.
            </p>
            <details className="m-0 mb-1.5">
              <summary className={detailsSummary}>Details</summary>
              <p className={detailsBody}>
                Applies to <strong>Clone from GitHub</strong>. The folder is created on startup if missing;
                built-in default is <code>&lt;Documents&gt;/GitHub</code>.
              </p>
            </details>
            <div className="mb-1.5 mt-3">
              <PathRow
                label="Current"
                path={cloneDir || '(unknown)'}
                pickAction={
                  <button
                    type="button"
                    className={btnGhostSm}
                    onClick={() => {
                      void window.sylo.dialog.openDirectory().then(async (p) => {
                        if (!p) return
                        await window.sylo.workspaces.github.setDefaultCloneDir(p)
                        await refreshCloneDir()
                        await onChanged()
                      })
                    }}
                  >
                    Choose…
                  </button>
                }
                onOpen={() => void revealDirectory(cloneDir, 'clone folder')}
                onReset={async () => {
                  await window.sylo.workspaces.github.setDefaultCloneDir('')
                  await refreshCloneDir()
                  await onChanged()
                }}
              />
            </div>
          </section>

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
              <span>Allow concurrent agent turns across conversations</span>
            </label>
            <p className={leadText}>
              Send in another chat while one is still working. Each extra turn uses its own Pi broker process.
            </p>
            <details className="m-0">
              <summary className={detailsSummary}>Queueing in the same chat</summary>
              <p className={detailsBody}>
                One chat still runs one turn at a time — Enter queues the next, Ctrl+Enter steers a running turn.
              </p>
            </details>
            {concurrentTurns ?
              <>
                <label className="mt-3 flex flex-col gap-1">
                  <span className={fieldLabel}>Max concurrent turns</span>
                  <input
                    className={cn(input, 'max-w-[10rem]')}
                    type="number"
                    min={MIN_CONCURRENT_TURNS}
                    max={MAX_CONCURRENT_TURNS_LIMIT}
                    step={1}
                    value={maxConcurrentDraft}
                    onChange={(e) => {
                      const draft = e.target.value
                      setMaxConcurrentDraft(draft)
                      const parsed = Number.parseInt(draft, 10)
                      if (Number.isFinite(parsed)) {
                        const clamped = clampMaxConcurrentTurns(parsed)
                        setMaxConcurrentTurns(clamped)
                        void window.sylo.prefs
                          .set(SYLO_MAX_CONCURRENT_TURNS_PREF, clamped)
                          .then(onChanged)
                      }
                    }}
                    onBlur={() => setMaxConcurrentDraft(String(maxConcurrentTurns))}
                  />
                  <span className={caption}>
                    Turns that may run at once across conversations (default {DEFAULT_MAX_CONCURRENT_TURNS}).
                  </span>
                </label>
                <details className="m-0">
                  <summary className={detailsSummary}>Limits</summary>
                  <p className={detailsBody}>
                    {MIN_CONCURRENT_TURNS}–{MAX_CONCURRENT_TURNS_LIMIT}. Each in-flight turn beyond the first
                    spawns its own Pi broker process, so very high numbers eat RAM. Out-of-range or blank input
                    snaps back to the last valid value.
                  </p>
                </details>
              </>
            : null}
          </section>
        </div>

        {/* --- Model --------------------------------------------------------- */}
        <div className={cn('flex flex-col gap-3.5', activeCat !== 'model' && 'hidden')}>
          <ModelCard
            onChanged={onChanged}
            diagnostics={{
              modelProvider: diagnostics.modelProvider,
              modelId: diagnostics.modelId,
              chatOnly: diagnostics.chatOnly,
            }}
            ollamaBaseUrl={ollamaBaseUrl}
            setOllamaBaseUrl={setOllamaBaseUrl}
            ollamaTags={ollamaTags}
            ollamaListLoading={ollamaListLoading}
            ollamaListError={ollamaListError}
            refreshOllamaTags={refreshOllamaTags}
            onProvidersChanged={() => setProviderListVersion((n) => n + 1)}
          />
        </div>

        {/* --- Subagents ----------------------------------------------------- */}
        <div className={cn('flex flex-col gap-3.5', activeCat !== 'subagents' && 'hidden')}>
          <SubagentsCard
            onChanged={onChanged}
            diagnostics={{ resolvedPiAgentDir: diagnostics.resolvedPiAgentDir }}
            ollamaTags={ollamaTags}
            providerListVersion={providerListVersion}
          />
        </div>

        {/* --- Companion ----------------------------------------------------- */}
        <div className={cn('flex flex-col gap-3.5', activeCat !== 'companion' && 'hidden')}>
          <CompanionCard onChanged={onChanged} />
        </div>

        {/* --- Extensions ---------------------------------------------------- */}
        <div className={cn('flex flex-col gap-3.5', activeCat !== 'extensions' && 'hidden')}>
          <WeeklySweepCard />
          <Suspense fallback={null}>
            <PersonalSettingsCard onChanged={onChanged} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}