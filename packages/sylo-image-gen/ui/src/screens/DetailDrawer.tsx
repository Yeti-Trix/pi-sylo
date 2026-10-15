/**
 * §5.3 Detail drawer (overlay over the grid/composer strip) — full image
 * (click → open externally), complete params, prompt/negative with copy
 * buttons, favorite, Remix (loads params into the composer), Rerun as final
 * (draft records), Send to agent, Delete (confirm), Copy path, Reveal in
 * Explorer, and the lineage-strip link to the parent record (should, folded —
 * one getRecord call).
 */
import { useCallback, useEffect, useState } from 'react'

import {
  bridge,
  fmtBytes,
  localFileUrl,
  pathToFileHref,
  type ImagegenRecord,
} from '../bridge'
import type { RemixRequest } from '../App'

function fmtCreated(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

export function DetailDrawer({
  imageId,
  onClose,
  onChanged,
  onRemix,
  onOpenImage,
}: {
  imageId: string
  onClose: () => void
  onChanged: () => void
  onRemix: (req: RemixRequest) => void
  onOpenImage: (id: string) => void
}): React.ReactElement {
  const [record, setRecord] = useState<ImagegenRecord | null>(null)
  const [path, setPath] = useState('')
  const [parent, setParent] = useState<ImagegenRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setRecord(null)
    setParent(null)
    setConfirmDelete(false)
    void (async () => {
      try {
        const res = await bridge.imageGet(imageId)
        if (!res || !res.ok) throw new Error('image_not_found')
        setRecord(res.record)
        setPath(res.path)
        if (res.record.parent_id) {
          const p = await bridge.imageGet(res.record.parent_id).catch(() => null)
          if (p && p.ok) setParent(p.record)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [imageId])

  const toggleFavorite = useCallback(async () => {
    if (!record) return
    try {
      const res = await bridge.imageUpdate({ image_id: record.id, favorite: !record.favorite })
      if (res.ok && res.record) setRecord(res.record)
      onChanged()
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }, [record, onChanged])

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setToast(`${what} copied.`)
    } catch {
      setToast(text)
    }
  }

  const sendToAgent = async () => {
    if (!record || !path) return
    try {
      await bridge.sendToAgent({
        note: 'Operator opened a library image and sent it to the agent for a remix.',
        image_id: record.id,
        image_path: path,
        model: record.model,
        preset: record.preset,
        seed: record.params.seed,
        request:
          `Remix library image ${record.id} with sylo_image_gen_generate (from_image_id=${record.id}). ` +
          'Ask the operator what to change if their message is not clear.',
      })
      setToast('Sent to agent — check the chat.')
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteRecord = async () => {
    if (!record) return
    if (!window.confirm('Delete this image from the library (file + record)?')) {
      setConfirmDelete(false)
      return
    }
    try {
      await bridge.imageDelete(record.id)
      onChanged()
      onClose()
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const reveal = async () => {
    try {
      await bridge.revealFile(imageId)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const openExternal = async () => {
    if (!path) return
    try {
      await bridge.openExternalUrl(pathToFileHref(path))
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const remix = () => {
    if (!record) return
    onRemix({ record })
  }

  const rerunAsFinal = () => {
    if (!record) return
    onRemix({ record, presetOverride: 'final' })
  }

  const p = record?.params
  return (
    <div className="ig-drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="ig-drawer" role="dialog" aria-modal="true" aria-label="Image detail" onClick={(e) => e.stopPropagation()}>
        <header className="ig-drawer-head">
          <strong>{record ? `${record.model} · ${record.preset} · ${record.origin === 'agent' ? 'agent job' : 'route job'}` : 'Image'}</strong>
          <button type="button" className="ig-iconbtn" title="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {error ? <p className="ig-error">{error}</p> : null}

        {record ? (
          <div className="ig-drawer-body">
            {/* §5.3 should-item disclosure (step 7): the drawer's should-tier
                UI is not built yet — say so like the plan rather than leaving
                the surface silently thinner than it looks. Tag/favorite/album
                edits still work through the agent in chat. */}
            <p className="ig-hint">
              v1 scope — absent here: tag editor, PNG-workflow/EXIF viewer, A/B compare (v2 candidates). The
              ComfyUI-embedded workflow still lives inside the PNG; tags/favorites/albums can be changed in chat via
              sylo_image_gen_organize.
            </p>
            {/* Full image — click opens the OS viewer */}
            <div
              className="ig-detail-imgwrap"
              title="Click to open externally"
              onClick={() => void openExternal()}
              role="presentation"
            >
              <img src={localFileUrl(path)} alt={record.prompt.slice(0, 80)} />
            </div>

            <div className="ig-drawer-actions">
              <button type="button" className={record.favorite ? 'ig-btn-secondary ig-fav-on' : 'ig-btn-secondary'} onClick={() => void toggleFavorite()}>
                {record.favorite ? '★ Favorited' : '☆ Favorite'}
              </button>
              {record.preset === 'draft' ? (
                <button type="button" className="ig-btn-secondary" onClick={rerunAsFinal} title="Rerun with the configured final model">
                  ↻ Rerun as final
                </button>
              ) : null}
              <button type="button" className="ig-btn-secondary" onClick={remix}>
                ✎ Remix
              </button>
              <button type="button" className="ig-btn-secondary" onClick={() => void sendToAgent()}>
                ✈ Send to agent
              </button>
              <button type="button" className="ig-btn-secondary" onClick={() => void copy(path, 'Path')}>
                ⧉ Copy path
              </button>
              <button type="button" className="ig-btn-secondary" onClick={() => void reveal()}>
                ➘ Reveal in Explorer
              </button>
              {confirmDelete ? (
                <>
                  <button type="button" className="ig-btn-danger" onClick={() => void deleteRecord()}>
                    Confirm delete
                  </button>
                  <button type="button" className="ig-btn-secondary" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="ig-btn-danger-ghost" onClick={() => setConfirmDelete(true)}>
                  ✕ Delete
                </button>
              )}
            </div>

            <dl className="ig-kv">
              <dt>Created</dt>
              <dd>{fmtCreated(record.created_at)}</dd>
              <dt>Size</dt>
              <dd>
                {record.width}×{record.height} · {fmtBytes(record.bytes)}
              </dd>
              <dt>Gen time</dt>
              <dd>{record.gen_ms > 0 ? `${(record.gen_ms / 1000).toFixed(1)} s` : '—'}</dd>
              <dt>Backend</dt>
              <dd>{record.backend}</dd>
              <dt>Steps</dt>
              <dd>{p?.steps ?? 0}</dd>
              <dt>Guidance</dt>
              <dd>{p?.guidance ?? 0}</dd>
              <dt>Seed</dt>
              <dd>{p?.seed ?? 0}</dd>
              {p?.sampler ? (
                <>
                  <dt>Sampler</dt>
                  <dd>{p.sampler}</dd>
                </>
              ) : null}
              {p?.aspect ? (
                <>
                  <dt>Aspect</dt>
                  <dd>{p.aspect}</dd>
                </>
              ) : null}
              <dt>Origin</dt>
              <dd>{record.origin}</dd>
              {record.tags.length ? (
                <>
                  <dt>Tags</dt>
                  <dd>{record.tags.join(', ')}</dd>
                </>
              ) : null}
            </dl>

            {parent ? (
              <p className="ig-lineage">
                Variant of:{' '}
                <button
                  type="button"
                  className="ig-btn-ghost"
                  title="Open the parent record"
                  onClick={() => onOpenImage(parent.id)}
                >
                  {(parent.prompt || parent.id).slice(0, 60)}…
                </button>
              </p>
            ) : record.parent_id ? (
              <p className="ig-lineage">Parent record {record.parent_id} is no longer in the library (deleted).</p>
            ) : null}

            <div className="ig-field">
              <span className="ig-label">Prompt</span>
              <p className="ig-prompttext">{record.prompt}</p>
              <button type="button" className="ig-btn-ghost" onClick={() => void copy(record.prompt, 'Prompt')}>
                Copy prompt
              </button>
            </div>
            {record.negative_prompt ? (
              <div className="ig-field">
                <span className="ig-label">Negative prompt</span>
                <p className="ig-prompttext">{record.negative_prompt}</p>
                <button type="button" className="ig-btn-ghost" onClick={() => void copy(record.negative_prompt ?? '', 'Negative prompt')}>
                  Copy negative
                </button>
              </div>
            ) : null}
          </div>
        ) : !error ? (
          <p className="ig-empty">Loading…</p>
        ) : null}

        {toast ? <p className="ig-toast ig-toast-drawer">{toast}</p> : null}
      </aside>
    </div>
  )
}