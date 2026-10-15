/**
 * §5.2 Library — responsive lazy grid (full-file `sylo-file://` src with
 * object-fit cover — Speech route serves local files the same way), search-as-
 * you-type over prompt/tags/caption, favorites filter, model chips (from real
 * record counts), delete with confirm, and the footer ledger
 * "N images · M favorites · X GB · total gen H:MM" from the libraryList stats
 * (loadLibrary records — host-side, §3 note 3, no file scans).
 *
 * Shoulds not folded (disclosed): multi-select bulk ops, date filter, sort
 * options, albums (v3). Shoulds kept cheap: none needed — grid/search/favorite
 * chips/footer are all first-class above. Data comes from queryLibrary paging
 * (limit ≤ 100 per §4 store contract) — "Load more" paginates.
 */
import { useCallback, useEffect, useState } from 'react'

import {
  bridge,
  fmtBytes,
  fmtHMM,
  localFileUrl,
  type ImagegenCatalogEntry,
  type ImagegenLibraryItem,
  type ImagegenLibraryStats,
} from '../bridge'

const PAGE_SIZE = 60
const FILTERS_KEY = 'route-filters'
const SEARCH_DEBOUNCE_MS = 250

export interface LibraryFilters {
  query: string
  favorite: boolean
  model: string
}

export function LibraryScreen({
  refreshKey,
  stats,
  catalog,
  onOpenDetail,
  onChanged,
}: {
  refreshKey: number
  stats: ImagegenLibraryStats | null
  catalog: ImagegenCatalogEntry[]
  onOpenDetail: (imageId: string) => void
  onChanged: () => void
}): React.ReactElement {
  const [items, setItems] = useState<ImagegenLibraryItem[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [model, setModel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Hydration completion is RENDER state (not a ref): post-hydration the (re)load
  // effect must re-run even when saved filters equal the useState defaults —
  // otherwise the first "All" load never fires and the grid stays empty.
  const [hydrated, setHydrated] = useState(false)

  const load = useCallback(
    async (offset: number, append: boolean, q: string, fav: boolean, m: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await bridge.libraryList({
          query: q || undefined,
          favorite: fav || undefined,
          model: m || undefined,
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
    const t = setTimeout(() => {
      void load(0, false, query, favoriteOnly, model)
      void bridge.writeSkillData(FILTERS_KEY, { query, favorite: favoriteOnly, model }).catch(() => {})
    }, hydrated && refreshKey === 0 ? SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, favoriteOnly, model, refreshKey, hydrated])

  const loadMore = () => void load(items.length, true, query, favoriteOnly, model)

  const toggleItemFavorite = async (item: ImagegenLibraryItem) => {
    try {
      await bridge.imageUpdate({ image_id: item.id, favorite: !item.favorite })
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, favorite: !item.favorite } : it)))
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteItem = async (item: ImagegenLibraryItem) => {
    if (!window.confirm(`Delete "${item.prompt.slice(0, 60) || item.id}" from the library (file + record)?`)) return
    try {
      await bridge.imageDelete(item.id)
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
    <section className="ig-panel">
      <div className="ig-lib-toolbar">
        <input
          className="ig-input ig-grow"
          type="search"
          placeholder="Search prompt / tags / caption…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="ig-check ig-check-card" title="Favorites only">
          <input type="checkbox" checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} />★
        </label>
      </div>

      {modelChips.length > 0 ? (
        <div className="ig-chips ig-chips-wrap">
          <button
            type="button"
            className={!model ? 'ig-chip ig-chip-active' : 'ig-chip'}
            onClick={() => setModel('')}
          >
            all ({stats?.count ?? 0})
          </button>
          {modelChips.map(([id, n]) => (
            <button
              key={id}
              type="button"
              className={model === id ? 'ig-chip ig-chip-active' : 'ig-chip'}
              onClick={() => setModel(model === id ? '' : id)}
            >
              {labelForModel(id)} ({n})
            </button>
          ))}
        </div>
      ) : null}

      {warning ? <p className="ig-warn">{warning}</p> : null}
      {error ? <p className="ig-error">{error}</p> : null}

      {!loading && items.length === 0 && !error && !warning ? (
        <p className="ig-empty">
          No images here yet — generate something (and save) via Generate or ask the agent in chat.
        </p>
      ) : null}

      <div className="ig-grid">
        {items.map((it) =>
          confirmDeleteId === it.id ? (
            <div key={it.id} className="ig-card ig-card-confirm">
              <p className="ig-confirm-text">Delete file + record?</p>
              <div className="ig-confirm-row">
                <button type="button" className="ig-btn-danger" onClick={() => void deleteItem(it)}>
                  Delete
                </button>
                <button type="button" className="ig-btn-secondary" onClick={() => setConfirmDeleteId(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <figure key={it.id} className="ig-card" onClick={() => onOpenDetail(it.id)}>
              <img src={localFileUrl(it.path)} alt={it.prompt.slice(0, 60)} loading="lazy" />
              <figcaption className="ig-card-cap">
                <span className="ig-card-meta">
                  {it.model} {it.preset === 'draft' ? '· draft' : ''} {it.favorite ? '★' : ''}
                </span>
                <div className="ig-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="ig-iconbtn"
                    title={it.favorite ? 'Unfavorite' : 'Favorite'}
                    onClick={() => void toggleItemFavorite(it)}
                  >
                    {it.favorite ? '★' : '☆'}
                  </button>
                  <button type="button" className="ig-iconbtn" title="Delete" onClick={() => setConfirmDeleteId(it.id)}>
                    ✕
                  </button>
                </div>
              </figcaption>
              <div className="ig-card-prompt" title={it.prompt}>
                {it.prompt || '(no prompt recorded)'}
              </div>
            </figure>
          ),
        )}
      </div>

      {items.length < total ? (
        <div className="ig-loadmore">
          <button type="button" className="ig-btn-secondary" disabled={loading} onClick={loadMore}>
            {loading ? 'Loading…' : `Load more (${items.length} of ${total})`}
          </button>
        </div>
      ) : null}

      <footer className="ig-ledger">
        {stats
          ? `${stats.count} image${stats.count === 1 ? '' : 's'} · ${stats.favorites} favorite${
              stats.favorites === 1 ? '' : 's'
            } · ${fmtBytes(stats.bytes)} · total gen ${fmtHMM(stats.gen_ms)}`
          : 'library ledger unavailable (no workspace selected)'}
      </footer>
    </section>
  )
}