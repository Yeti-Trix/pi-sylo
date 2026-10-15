/**
 * Videos route shell (plan §5.6/§6, §8 step 8 — the sylo-image-gen App.tsx
 * twin with video semantics). One Vite app, screens as tabs: Generate ·
 * Library · Settings + a detail drawer overlay. Queue stays v2 (§5.6) — the
 * generate composer carries the render-ledger card (§4.3 durable jobs) and
 * the composer job card instead.
 *
 * Bridge ops: videoGen* (§8.7 arm — the host resolves workspaceCwd + owns the
 * job/ledger), generic prefs via readSkillData/writeSkillData (per-skill
 * namespaced host-side). Change fan: `libraryChanged` bridge events (tagged
 * source 'videogen' by the videogen fan push, §5.5) bump the library refetch
 * key — imagegen shape parity, no filtering (a refetch is cheap).
 *
 * One deliberate difference vs the imagegen shell: the Generate screen stays
 * MOUNTED (hidden) across tab switches — video jobs run for minutes and the
 * running job card + its poll must survive moving to Library/Settings and
 * back (imagegen's seconds-long renders could afford the unmount).
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import {
  bridge,
  onLibraryChanged,
  type VideogenCatalogEntry,
  type VideogenLibraryStats,
  type VideogenStatus,
} from './bridge'
import { GenerateScreen } from './screens/GenerateScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { DetailDrawer } from './screens/DetailDrawer'

import type { RemixRequest } from './screens/GenerateScreen'

export type TabId = 'generate' | 'library' | 'settings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'generate', label: 'Generate' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' },
]

const TAB_PREF_KEY = 'route-tab'

export function App(): ReactElement {
  const [tab, setTab] = useState<TabId>('generate')
  const [status, setStatus] = useState<VideogenStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  /** Bump to refresh library + ledger data after mutations/generations/fans. */
  const [libraryKey, setLibraryKey] = useState(0)
  /** Open detail-drawer clip (library tab + composer result strip + ledger rows). */
  const [detailVideoId, setDetailVideoId] = useState<string | null>(null)
  const [remix, setRemix] = useState<RemixRequest | null>(null)
  const [libraryStats, setLibraryStats] = useState<VideogenLibraryStats | null>(null)
  const [healthOk, setHealthOk] = useState(false)

  const detected = useCallback((): Record<string, boolean> | null => {
    const models = status?.models?.models
    if (!models || models.length === 0) return null
    return Object.fromEntries(models.map((m) => [m.id, m.detected]))
  }, [status])

  const refreshStatus = useCallback(async (withModels: boolean) => {
    setStatusError(null)
    try {
      const s = await bridge.status({ with_models: withModels })
      setStatus(s)
      if (s.library_stats) setLibraryStats(s.library_stats)
      setHealthOk(s.health.ok)
      return s
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [])

  const refreshLibrary = useCallback(() => {
    setLibraryKey((k) => k + 1)
  }, [])

  // Mount: last tab + status (+ heavy probe once — Settings dogfoods it).
  useEffect(() => {
    void (async () => {
      try {
        const saved = (await bridge.readSkillData(TAB_PREF_KEY)) as unknown
        if (saved === 'library' || saved === 'generate' || saved === 'settings') setTab(saved)
      } catch {
        /* prefs are polish — defaults are fine */
      }
      void refreshStatus(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onTab = (next: TabId) => {
    setTab(next)
    void bridge.writeSkillData(TAB_PREF_KEY, next).catch(() => {})
  }

  const openDetail = (videoId: string) => setDetailVideoId(videoId)

  /** Detail drawer "Remix"/"Restyle this" → load params into the composer (§5.6). */
  const onRemix = (remixReq: RemixRequest) => {
    setDetailVideoId(null)
    setRemix(remixReq)
    onTab('generate')
  }

  /** Composer/library mutations re-fetch the cheap status (ledger + stats). */
  const onChanged = useCallback(() => {
    refreshLibrary()
    void refreshStatus(false)
  }, [refreshLibrary, refreshStatus])

  // §5.5 change fan (wired §8.7): agent-side (broker child) library mutations
  // arrive main → renderer → `libraryChanged` skill-bridge event → same
  // refetch path the route's own ops use (the generate composer stays mounted
  // and re-queries its render-ledger card too). Unsubscribes on unmount.
  useEffect(() => onLibraryChanged(() => onChanged()), [onChanged])

  const catalog: VideogenCatalogEntry[] = status?.catalog ?? []
  const detectedMap = detected()

  return (
    <div className="vg-app">
      <header className="vg-head">
        <h1 className="vg-title">Videos</h1>
        <p className="vg-sub">
          Local ComfyUI generation · per-workspace video library
          {libraryStats ? ` · ${libraryStats.count} clip(s)` : ''}
        </p>
        <nav className="vg-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'vg-tab vg-tab-active' : 'vg-tab'}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {statusError ? <p className="vg-error">Route host error: {statusError}</p> : null}
      {status && !healthOk ? (
        <p className="vg-warn">
          ComfyUI not reachable at {status.health.url} — {status.health.error ?? 'no details'} (Settings → Connect gives
          the recovery path.)
        </p>
      ) : null}

      {/* Generate stays mounted (hidden) — minutes-long jobs keep their card +
          poll across tab switches (§4.3; see module doc). */}
      <div hidden={tab !== 'generate'}>
        <GenerateScreen
          catalog={catalog}
          detected={detectedMap}
          config={status?.config ?? null}
          health={status?.health ?? null}
          refreshKey={libraryKey}
          remix={remix}
          onOpenDetail={openDetail}
          onChanged={onChanged}
        />
      </div>
      {tab === 'library' ? (
        <LibraryScreen
          refreshKey={libraryKey}
          stats={libraryStats}
          catalog={catalog}
          onOpenDetail={openDetail}
          onChanged={onChanged}
        />
      ) : null}
      {tab === 'settings' ? (
        <SettingsScreen
          status={status}
          statusError={statusError}
          onRefresh={() => void refreshStatus(true)}
          onConfigSaved={onChanged}
        />
      ) : null}

      {detailVideoId ? (
        <DetailDrawer
          videoId={detailVideoId}
          onClose={() => setDetailVideoId(null)}
          onChanged={onChanged}
          onRemix={onRemix}
          onOpenVideo={(id: string) => setDetailVideoId(id)}
        />
      ) : null}
    </div>
  )
}