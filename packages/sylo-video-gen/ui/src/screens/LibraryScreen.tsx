/**
 * §5.6 Library — the imagegen LibraryScreen twin with video semantics: lazy
 * grid of native <video preload="metadata"> cards whose poster is the free
 * in-graph first frame (no ffmpeg in v1); hover flips preload to auto and
 * plays muted (no autoplay on scroll); duration + mode badges; search-as-you-
 * type over prompt/tags; filters (mode chips — the video addition — plus
 * favorite + model chips from real record counts); a since/until date filter
 * (§3.2's video query additions); delete-with-confirm cards; and the footer
 * ledger "N clips · M favorites · X GB · total render H:MM" from the
 * libraryList stats (loadLibrary records — host-side, no file scans).
 *
 * Shoulds not folded (disclosed): multi-select bulk ops, sort options, albums
 * (v3). PAGE_SIZE is 24 (clips are MBs — 60 images would prefetch a lot of
 * sylo-file bytes; "Load more" paginates the rest).
 *
 * The sandboxed route iframe blocks window.confirm — deletes use the inline
 * confirm-card pattern (imagegen parity at the card level; no dialogs).
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import {
  bridge,
  fmtBytes,
  fmtHMM,
  hoverPreviewStart,
  hoverPreviewStop,
  MODE_LABELS,
  localFileUrl,
  type VideoMode,
  type VideogenCatalogEntry,
  type VideogenLibraryItem,
  type VideogenLibraryStats,
} from '../bridge'
import { JobProgressStrip } from './JobProgress'

const PAGE_SIZE = 24
const FILTERS_KEY = 'route-filters'
const SEARCH_DEBOUNCE_MS = 250

export interface LibraryFilters {
  query: string
  favorite: boolean
  model: string
  mode: string
  since: string
  until: string
}

export function LibraryScreen({
  refreshKey,
  stats,
  catalog,
  onOpenDetail,
  onChanged,
}: {
  refreshKey: number
  stats: VideogenLibraryStats | null
  catalog: VideogenCatalogEntry[]
  onOpenDetail: (videoId: string) => void
  onChanged: () => void
}): ReactElement {
  const [items, setItems] = useState<VideogenLibraryItem[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [model, setModel] = useState('')
  const [mode, setMode] = useState('') // '' = all modes
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Hydration completion is RENDER state (not a ref) — post-hydration the
  // (re)load effect must re-run even when saved filters equal the defaults
  // (otherwise the first "All" load never fires and the grid stays empty).
  const [hydrated, setHydrated] = useState(false)

  const load = useCallback(
    async (offset: number, append: boolean, q: string, fav: boolean, m: string, md: string, from: string, to: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await bridge.libraryList({
          query: q || undefined,
          favorite: fav || undefined,
          model: m || undefined,
          mode: (['clip', 'loop', 'restyle'] as const).find((x) => x === md),
          since: from ? `${from}T00:00:00` : undefined,
          until: to ? `${to}T23:59:59.999` : undefined,
          limit: PAGE_SIZE,
          offset,
        })
        if (res.warning) setWarning(res.warning)
        else setWarning(null)
        setTotal(res.total)
        setItems((prev) => (append ? [...prev, ...res.items] : res.items))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  // Hydrate saved filters once.
  useEffect(() => {
    void (async () => {
      try {
        const saved = await bridge.readSkillData(FILTERS_KEY)
        if (saved && typeof saved === 'object') {
          const f = saved as Partial<LibraryFilters>
          if (typeof f.query === 'string') setQuery(f.query)
          if (f.favorite === true) setFavoriteOnly(true)
          if (typeof f.model === 'string') setModel(f.model)
          if (f.mode === 'clip' || f.mode === 'loop' || f.mode === 'restyle') setMode(f.mode)
          if (typeof f.since === 'string') setSince(f.since)
          if (typeof f.until === 'string') setUntil(f.until)
        }
      } catch {
        /* prefs are polish */
      } finally {
        setHydrated(true)
      }
    })()
  }, [])

  // (Re)load page 0 when filters change (search-as-you-type, debounced) or refreshKey bumps.
  useEffect(() => {
    if (!hydrated) return
    const t = setTimeout(
      () => {
        void load(0, false, query, favoriteOnly, model, mode, since, until)
        void bridge
          .writeSkillData(FILTERS_KEY, { query, favorite: favoriteOnly, model, mode, since, until })
          .catch(() => {})
      },
      hydrated && refreshKey === 0 ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, favoriteOnly, model, mode, since, until, refreshKey, hydrated])

  const loadMore = () => void load(items.length, true, query, favoriteOnly, model, mode, since, until)

  const toggleItemFavorite = async (item: VideogenLibraryItem) => {
    try {
      await bridge.videoUpdate({ video_id: item.id, favorite: !item.favorite })
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, favorite: !it.favorite } : it)))
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteItem = async (item: VideogenLibraryItem) => {
    try {
      await bridge.videoDelete(item.id)
      setConfirmDeleteId(null)
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      setTotal((t) => Math.max(0, t - 1))
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const modelChips = Object.entries(stats?.models ?? {}).sort((a, b) => b[1] - a[1])
  const labelForModel = (id: string): string => catalog.find((c) => c.id === id)?.label ?? id

  return (
    <section className="vg-panel">
      <div className="vg-lib-toolbar">
        <input
          className="vg-input vg-grow"
          type="search"
          placeholder="Search prompt / tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="vg-check vg-check-card" title="Favorites only">
          <input type="checkbox" checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} />★
        </label>
      </div>

      <JobProgressStrip catalog={catalog} onChanged={onChanged} />

      <div className="vg-chips vg-chips-wrap">
        <button
          type="button"
          className={mode === '' ? 'vg-chip vg-chip-active' : 'vg-chip'}
          onClick={() => setMode('')}
        >
          all modes
        </button>
        {(['clip', 'loop', 'restyle'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? 'vg-chip vg-chip-active' : 'vg-chip'}
            onClick={() => setMode(mode === m ? '' : m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
        <span className="vg-filter-dates" title="Created-between filter (created_at ≥ since, ≤ until)">
          <input
            className="vg-input vg-input-date"
            type="date"
            aria-label="Created from"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
          <span className="vg-hint-inline">→</span>
          <input
            className="vg-input vg-input-date"
            type="date"
            aria-label="Created until"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
          {since || until ? (
            <button
              type="button"
              className="vg-btn-ghost"
              title="Clear the date filter"
              onClick={() => {
                setSince('')
                setUntil('')
              }}
            >
              clear dates
            </button>
          ) : null}
        </span>
      </div>

      {modelChips.length > 0 ? (
        <div className="vg-chips vg-chips-wrap">
          <button
            type="button"
            className={!model ? 'vg-chip vg-chip-active' : 'vg-chip'}
            onClick={() => setModel('')}
          >
            all models ({stats?.count ?? 0})
          </button>
          {modelChips.map(([id, n]) => (
            <button
              key={id}
              type="button"
              className={model === id ? 'vg-chip vg-chip-active' : 'vg-chip'}
              onClick={() => setModel(model === id ? '' : id)}
            >
              {labelForModel(id)} ({n})
            </button>
          ))}
        </div>
      ) : null}

      {warning ? <p className="vg-warn">{warning}</p> : null}
      {error ? <p className="vg-error">{error}</p> : null}

      {!loading && items.length === 0 && !error && !warning ? (
        <p className="vg-empty">
          No clips here yet — make one from Generate, or ask the agent in chat ("generate a 5-second clip of …" — loop
          mode also wants a still: *"turn this image into a living photo"*).
        </p>
      ) : null}

      <div className="vg-grid vg-grid-video">
        {items.map((it) =>
          confirmDeleteId === it.id ? (
            <div key={it.id} className="vg-card vg-card-confirm">
              <p className="vg-confirm-text">Delete clip + poster + record?</p>
              <div className="vg-confirm-row">
                <button type="button" className="vg-btn-danger" onClick={() => void deleteItem(it)}>
                  Delete
                </button>
                <button type="button" className="vg-btn-secondary" onClick={() => setConfirmDeleteId(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <figure key={it.id} className="vg-card" onClick={() => onOpenDetail(it.id)}>
              <div className="vg-card-media" title={it.poster_path ? undefined : 'no poster — still recovered? click to play'}>
                <video
                  src={localFileUrl(it.path)}
                  poster={it.poster_path ? localFileUrl(it.poster_path) : undefined}
                  preload="metadata"
                  muted
                  playsInline
                  onMouseEnter={(e) => hoverPreviewStart(e.currentTarget)}
                  onMouseLeave={(e) => hoverPreviewStop(e.currentTarget)}
                />
                <span className="vg-duration">
                  {MODE_LABELS[it.mode]} · {it.duration_seconds}s
                </span>
                {it.favorite ? <span className="vg-card-fav" title="Favorited">★</span> : null}
              </div>
              <figcaption className="vg-card-cap">
                <span className="vg-card-meta">
                  {labelForModel(it.model)} {it.preset === 'draft' ? '· draft' : ''} · {it.frame_count} frames
                </span>
                <div className="vg-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="vg-iconbtn"
                    title={it.favorite ? 'Unfavorite' : 'Favorite'}
                    onClick={() => void toggleItemFavorite(it)}
                  >
                    {it.favorite ? '★' : '☆'}
                  </button>
                  <button type="button" className="vg-iconbtn" title="Delete" onClick={() => setConfirmDeleteId(it.id)}>
                    ✕
                  </button>
                </div>
              </figcaption>
              <div className="vg-card-prompt" title={it.prompt}>
                {it.prompt || '(no prompt recorded)'}
              </div>
            </figure>
          ),
        )}
      </div>

      {items.length < total ? (
        <div className="vg-loadmore">
          <button type="button" className="vg-btn-secondary" disabled={loading} onClick={loadMore}>
            {loading ? 'Loading…' : `Load more (${items.length} of ${total})`}
          </button>
        </div>
      ) : null}

      <footer className="vg-ledger">
        {stats
          ? `${stats.count} clip${stats.count === 1 ? '' : 's'} · ${stats.favorites} favorite${
              stats.favorites === 1 ? '' : 's'
            } · ${fmtBytes(stats.bytes)} · total render ${fmtHMM(stats.render_ms)}`
          : 'library ledger unavailable (no workspace selected)'}
      </footer>
    </section>
  )
}