/**
 * §5.6 Detail drawer (overlay over the grid/composer strip) — the imagegen
 * DetailDrawer twin with video semantics: native <video controls> player
 * previewing the clip via the bridged `sylo-file://` path (click-through
 * opens it in the OS player via a file:// href), full params (W×H@fps,
 * duration/frames, render time, format, seed, ledger id), the §3.5 lineage
 * block (source Image-library still id / local paths / the remix parent — open
 * via another get when it's a library clip), Remix (loads params into the
 * composer), "Restyle this clip" (mode:restyle prefill), Send-to-agent,
 * Copy path, Reveal in Explorer (clip or poster — §5.1's kind knob), favorite,
 * and a two-step delete confirm. Note: sandboxed route iframes block
 * window.confirm — the delete is inline two-step.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import {
  bridge,
  fmtBytes,
  fmtDateTime,
  fmtElapsed,
  localFileUrl,
  MODE_LABELS,
  pathToFileHref,
  type VideoRecord,
} from '../bridge'
import type { RemixRequest } from './GenerateScreen'

export function DetailDrawer({
  videoId,
  onClose,
  onChanged,
  onRemix,
  onOpenVideo,
}: {
  videoId: string
  onClose: () => void
  onChanged: () => void
  onRemix: (req: RemixRequest) => void
  onOpenVideo: (id: string) => void
}): ReactElement {
  const [record, setRecord] = useState<VideoRecord | null>(null)
  const [path, setPath] = useState('')
  const [posterPath, setPosterPath] = useState('')
  const [parent, setParent] = useState<VideoRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setRecord(null)
    setParent(null)
    setConfirmDelete(false)
    void (async () => {
      try {
        const res = await bridge.videoGet(videoId)
        setRecord(res.record)
        setPath(res.path)
        setPosterPath(res.poster_path ?? '')
        const parentId = res.record.lineage.parent_video_id
        if (parentId) {
          const p = await bridge.videoGet(parentId).catch(() => null)
          if (p) setParent(p.record)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [videoId])

  const toggleFavorite = useCallback(async () => {
    if (!record) return
    try {
      const res = await bridge.videoUpdate({ video_id: record.id, favorite: !record.favorite })
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
        note: 'Operator opened a library clip and sent it to the agent for a remix.',
        video_id: record.id,
        video_path: path,
        model: record.model,
        mode: record.mode,
        preset: record.preset,
        seed: record.seed,
        request:
          `Remix library clip ${record.id} with sylo_video_gen_generate (from_video_id=${record.id}). ` +
          'Ask the operator what to change if their message is not clear.',
      })
      setToast('Sent to agent — check the chat.')
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteRecord = async () => {
    if (!record) return
    setConfirmDelete(false)
    try {
      await bridge.videoDelete(record.id)
      onChanged()
      onClose()
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const reveal = async (kind: 'clip' | 'poster' = 'clip') => {
    try {
      await bridge.revealFile(videoId, kind)
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

  const restyleThis = () => {
    if (!record) return
    onRemix({ record, asRestyle: true })
  }

  const lin = record?.lineage
  return (
    <div className="vg-drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="vg-drawer" role="dialog" aria-modal="true" aria-label="Video detail" onClick={(e) => e.stopPropagation()}>
        <header className="vg-drawer-head">
          <strong>
            {record
              ? `${record.model} · ${MODE_LABELS[record.mode]}${record.mode === 'clip' ? ` · ${record.preset}` : ''}`
              : 'Video'}
          </strong>
          <button type="button" className="vg-iconbtn" title="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {error ? <p className="vg-error">{error}</p> : null}

        {record ? (
          <div className="vg-drawer-body">
            {/* §5.6 scope disclosure (thin-slice honesty, imagegen parity). */}
            <p className="vg-hint">
              v1 scope — absent here: tag editor, arbitrary-timestamp poster, A/B compare (v2 candidates). Tags/
              favorites/deletes also work in chat via sylo_video_gen_organize; the render ledger (jobs.json) keeps the
              run's history.
            </p>
            {/* Native player — click-through opens the OS default player. */}
            <div className="vg-detail-videowrap" title="Click to open externally" onClick={() => void openExternal()} role="presentation">
              <video
                src={localFileUrl(path)}
                poster={posterPath ? localFileUrl(posterPath) : undefined}
                controls
                preload="metadata"
                muted
                playsInline
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            <div className="vg-drawer-actions">
              <button type="button" className={record.favorite ? 'vg-btn-secondary vg-fav-on' : 'vg-btn-secondary'} onClick={() => void toggleFavorite()}>
                {record.favorite ? '★ Favorited' : '☆ Favorite'}
              </button>
              <button type="button" className="vg-btn-secondary" onClick={remix} title="Load these params into the composer">
                ✎ Remix
              </button>
              <button type="button" className="vg-btn-secondary" onClick={restyleThis} title="Restyle this clip (mode: restyle)">
                ✦ Restyle this clip
              </button>
              <button type="button" className="vg-btn-secondary" onClick={() => void sendToAgent()}>
                ✈ Send to agent
              </button>
              <button type="button" className="vg-btn-secondary" onClick={() => void copy(path, 'Path')}>
                ⧉ Copy path
              </button>
              <button type="button" className="vg-btn-secondary" onClick={() => void reveal('clip')}>
                ➘ Reveal clip
              </button>
              {posterPath ? (
                <button type="button" className="vg-btn-secondary" onClick={() => void reveal('poster')} title="Reveal the in-graph poster PNG">
                  ➘ Reveal poster
                </button>
              ) : null}
              {confirmDelete ? (
                <>
                  <button type="button" className="vg-btn-danger" onClick={() => void deleteRecord()}>
                    Confirm delete
                  </button>
                  <button type="button" className="vg-btn-secondary" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="vg-btn-danger-ghost" onClick={() => setConfirmDelete(true)}>
                  ✕ Delete
                </button>
              )}
            </div>

            <dl className="vg-kv">
              <dt>Created</dt>
              <dd>{fmtDateTime(record.created_at)}</dd>
              <dt>Format</dt>
              <dd>
                {record.resolution.width}×{record.resolution.height} · {record.framerate} fps · {record.duration_seconds}s ·{' '}
                {record.frame_count} frames · {fmtBytes(record.bytes)} · {record.video_format}
              </dd>
              <dt>Render time</dt>
              <dd>{record.render_ms > 0 ? fmtElapsed(record.render_ms) : '—'}</dd>
              <dt>Seed</dt>
              <dd>{record.seed}</dd>
              <dt>Backend</dt>
              <dd>
                ComfyUI <code>{record.comfy_prompt_id ? record.comfy_prompt_id.slice(0, 8) + '…' : ''}</code>
              </dd>
              {record.motion_strength !== undefined ? (
                <>
                  <dt>{MODE_LABELS[record.mode] === 'Restyle' ? 'Restyle strength' : 'Motion strength'}</dt>
                  <dd>{record.motion_strength.toFixed(2)}</dd>
                </>
              ) : null}
              {record.tags.length ? (
                <>
                  <dt>Tags</dt>
                  <dd>{record.tags.join(', ')}</dd>
                </>
              ) : null}
            </dl>

            {/* §3.5 lineage — one-way; source stills/clips read-only, no back-writes. */}
            {lin && (lin.source_image_id || lin.source_image_path || lin.source_video_path || lin.parent_video_id) ? (
              <div className="vg-lineage">
                <span className="vg-label">Lineage</span>
                {lin.source_image_id ? (
                  <p className="vg-lineageline">
                    Source still <code>{lin.source_image_id.slice(0, 12)}…</code> (IMAGES library — the keyframe born in
                    Images).
                  </p>
                ) : null}
                {lin.source_image_path ? (
                  <p className="vg-lineageline">
                    Source still path <code title={lin.source_image_path}>{lin.source_image_path.split(/[\\/]/).pop()}</code>{' '}
                    <button type="button" className="vg-btn-ghost" onClick={() => void copy(lin.source_image_path!, 'Source path')}>
                      copy
                    </button>
                  </p>
                ) : null}
                {lin.source_video_path ? (
                  <p className="vg-lineageline">
                    Source clip path <code title={lin.source_video_path}>{lin.source_video_path.split(/[\\/]/).pop()}</code>{' '}
                    <button type="button" className="vg-btn-ghost" onClick={() => void copy(lin.source_video_path!, 'Source path')}>
                      copy
                    </button>
                  </p>
                ) : null}
                {lin.parent_video_id ? (
                  parent ? (
                    <p className="vg-lineageline">
                      Remix of:{' '}
                      <button type="button" className="vg-btn-ghost" title="Open the parent clip" onClick={() => onOpenVideo(parent.id)}>
                        {(parent.prompt || parent.id).slice(0, 52)}…
                      </button>
                    </p>
                  ) : (
                    <p className="vg-lineageline">Parent clip {lin.parent_video_id} is no longer in the library (deleted).</p>
                  )
                ) : null}
              </div>
            ) : null}

            <div className="vg-field">
              <span className="vg-label">Prompt</span>
              <p className="vg-prompttext">{record.prompt}</p>
              <button type="button" className="vg-btn-ghost" onClick={() => void copy(record.prompt, 'Prompt')}>
                Copy prompt
              </button>
            </div>
            {record.negative_prompt ? (
              <div className="vg-field">
                <span className="vg-label">Negative prompt</span>
                <p className="vg-prompttext">{record.negative_prompt}</p>
                <button type="button" className="vg-btn-ghost" onClick={() => void copy(record.negative_prompt ?? '', 'Negative prompt')}>
                  Copy negative
                </button>
              </div>
            ) : null}
          </div>
        ) : !error ? (
          <p className="vg-empty">Loading…</p>
        ) : null}

        {toast ? <p className="vg-toast vg-toast-drawer">{toast}</p> : null}
      </aside>
    </div>
  )
}