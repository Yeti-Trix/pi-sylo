/**
 * Images route shell (plan §5 header: one Vite app, screens as tabs). Tabs:
 * Generate (composer + job card + result strip) · Library (grid) · Settings.
 * Queue is v2 (§5.4) — progress stays inline in the composer. Dark theme
 * matches the host's route styling (Speech-route look).
 */
import { useCallback, useEffect, useState } from 'react'

import {
  bridge,
  onLibraryChanged,
  type ImagegenCatalogEntry,
  type ImagegenLibraryStats,
  type ImagegenRecord,
  type ImagegenStatus,
} from './bridge'
import { GenerateScreen } from './screens/GenerateScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { DetailDrawer } from './screens/DetailDrawer'

export type TabId = 'generate' | 'library' | 'settings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'generate', label: 'Generate' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' },
]

const TAB_PREF_KEY = 'route-tab'

/** Remix payload the Detail drawer hands back to the composer (§5.3 Remix). */
export interface RemixRequest {
  record: ImagegenRecord
  /** Rerun as final: force preset 'final' onto the parent's composition. */
  presetOverride?: 'draft' | 'final'
}

export function App(): React.ReactElement {
  const [tab, setTab] = useState<TabId>('generate')
  const [status, setStatus] = useState<ImagegenStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  /** Bump to refresh library data after mutations/generations elsewhere. */
  const [libraryKey, setLibraryKey] = useState(0)
  /** Open detail-drawer image (library tab + composer result strip). */
  const [detailImageId, setDetailImageId] = useState<string | null>(null)
  const [remix, setRemix] = useState<RemixRequest | null>(null)
  const [libraryStats, setLibraryStats] = useState<ImagegenLibraryStats | null>(null)

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
      return s
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [])

  const refreshLibrary = useCallback(() => {
    setLibraryKey((k) => k + 1)
  }, [])

  // Mount: last tab + status (+ heavy model probe once).
  useEffect(() => {
    void (async () => {
      try {
        const saved = await bridge.readSkillData(TAB_PREF_KEY)
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

  const openDetail = (imageId: string) => setDetailImageId(imageId)

  /** Detail drawer "Remix" → load params into the composer (§5.3). */
  const onRemix = (remixReq: RemixRequest) => {
    setDetailImageId(null)
    setRemix(remixReq)
    onTab('generate')
  }

  /** Composer/library mutations re-fetch the cheap status (ledger + chip counts). */
  const onChanged = useCallback(() => {
    refreshLibrary()
    void refreshStatus(false)
  }, [refreshLibrary, refreshStatus])

  // §8 step 7 change fan: agent-side (broker child) library mutations arrive
  // main → renderer → `libraryChanged` skill-bridge event → same refetch path
  // the route's own ops use. Unsubscribes when this effect re-runs/unmounts.
  useEffect(() => onLibraryChanged(() => onChanged()), [onChanged])

  const catalog: ImagegenCatalogEntry[] = status?.catalog ?? []
  const detectedMap = detected()

  return (
    <div className="ig-app">
      <header className="ig-head">
        <h1 className="ig-title">Images</h1>
        <p className="ig-sub">
          Local ComfyUI generation · per-workspace image library{libraryStats ? ` · ${libraryStats.count} image(s)` : ''}
        </p>
        <nav className="ig-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'ig-tab ig-tab-active' : 'ig-tab'}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {statusError ? <p className="ig-error">Route host error: {statusError}</p> : null}
      {status && !status.health.ok ? (
        <p className="ig-warn">
          ComfyUI not reachable at {status.health.url} — {status.health.error ?? 'no details'} (Settings → Connect gives
          the recovery path.)
        </p>
      ) : null}

      {tab === 'generate' ? (
        <GenerateScreen
          catalog={catalog}
          detected={detectedMap}
          config={status?.config ?? null}
          health={status?.health ?? null}
          remix={remix}
          onOpenDetail={openDetail}
          onChanged={onChanged}
        />
      ) : null}
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

      {detailImageId ? (
        <DetailDrawer
          imageId={detailImageId}
          onClose={() => setDetailImageId(null)}
          onChanged={onChanged}
          onRemix={onRemix}
          onOpenImage={(id) => setDetailImageId(id)}
        />
      ) : null}
    </div>
  )
}