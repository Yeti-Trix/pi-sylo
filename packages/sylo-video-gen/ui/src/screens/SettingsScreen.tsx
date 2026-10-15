/**
 * §5.6 Settings — the ONE-SOURCE doctor parity surface (§3.3): health and
 * model data come from the SAME shared/client modules the sylo_video_gen_doctor
 * tool composes (comfyHealth /system_stats+/queue and the single-pull
 * comfyDoctorProbe /object_info — host main's videogen-host calls them via
 * videoGenStatus/videoGenDoctor; this screen only renders). Sections:
 *  - ComfyUI URL + Connect/health (GPU, VRAM free/total in GiB + decimal GB,
 *    version, queue) with Save/Re-check;
 *  - guided-install card (expandable): the video model table (detected/
 *    missing + per-variant node checks + sizes + min-VRAM + license badges +
 *    HF links + model dirs + the repo file list), the frame_interpolation
 *    pack state, and the VRAM notes (§7: preflight refusals + shared-GPU guidance);
 *  - preset defaults (§2.7): draft/final/restyle models, resolution/
 *    orientation, duration, framerate default (0 = model default), loop
 *    motion strength, auto-tag → configSave;
 *  - storage card (library root + bytes + gitignore guidance + the §4.3
 *    render-ledger counts + replay hint).
 */
import { useState } from 'react'
import type { ReactElement } from 'react'

import { bridge, fmtBytes, MODE_LABELS, type VideogenCatalogEntry, type VideogenStatus } from '../bridge'

const DURATIONS = [4, 5, 8] as const
const RESOLUTIONS = ['480p', '720p'] as const
const ORIENTATIONS = ['landscape', 'portrait'] as const
const FRAMERATES = [0, 16, 24] as const

/** Explicit GiB + decimal-GB pairing (§8.6 doctor discipline — the card echoes both). */
function fmtGibPlusGb(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '?'
  return `${fmtBytes(bytes)} · ${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

export function SettingsScreen({
  status,
  statusError,
  onRefresh,
  onConfigSaved,
}: {
  status: VideogenStatus | null
  statusError: string | null
  onRefresh: () => void
  onConfigSaved: () => void
}): ReactElement {
  const [showInstall, setShowInstall] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  const [loopDraft, setLoopDraft] = useState<string | null>(null)

  const config = status?.config ?? null
  const health = status?.health ?? null
  const catalog = status?.catalog ?? []
  const probe = status?.models ?? null
  const jobsHealth = status?.jobs ?? null

  const saveConfig = async (values: Record<string, unknown>, what: string) => {
    setSaving(true)
    setError(null)
    try {
      const r = await bridge.configSave(values)
      if (!r.ok) throw new Error(r.error)
      setNote(`Saved ${what}.${r.restartNote ? ` ${r.restartNote}` : ''}`)
      onRefresh()
      onConfigSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const saveUrl = async () => {
    if (urlDraft === null) return
    await saveConfig({ comfyui_url: urlDraft.trim() }, 'ComfyUI URL')
    setUrlDraft(null)
  }

  const detectedFor = (entry: VideogenCatalogEntry): boolean | null =>
    probe?.models?.find((m) => m.id === entry.id)?.detected ?? null

  const hfLink = (url: string) => {
    void bridge.openExternalUrl(url).catch(() => {})
  }

  return (
    <section className="vg-panel">
      <h2 className="vg-panel-title">ComfyUI</h2>

      <div className="vg-field">
        <label className="vg-label" htmlFor="vg-url">
          API URL
        </label>
        <div className="vg-url-row">
          <input
            id="vg-url"
            className="vg-input vg-grow"
            type="text"
            value={urlDraft ?? config?.comfyui_url ?? ''}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="http://127.0.0.1:8188"
          />
          <button type="button" className="vg-btn-secondary" disabled={saving || urlDraft === null} onClick={() => void saveUrl()}>
            Save
          </button>
          <button type="button" className="vg-btn" onClick={onRefresh} title="Connect test — re-probe /system_stats">
            {status ? 'Re-check' : 'Connect'}
          </button>
        </div>
        {statusError ? <p className="vg-error">{statusError}</p> : null}
      </div>

      <div className="vg-healthcard" data-ok={health?.ok === true}>
        {health?.ok ? (
          <dl className="vg-kv vg-kv-inline">
            <dt data-ok="true">Reachable</dt>
            <dd>
              {health.device_name ?? 'GPU reported'} · {fmtGibPlusGb(health.vram_free_bytes)} free of{' '}
              {fmtGibPlusGb(health.vram_total_bytes)} · ComfyUI {health.version ?? '?'} · queue {health.queue_depth ?? 0}
            </dd>
          </dl>
        ) : (
          <p className="vg-warn vg-nowrap-off">
            Not reachable at {health?.url ?? config?.comfyui_url ?? 'http://127.0.0.1:8188'} — {health?.error ?? 'no details'}
          </p>
        )}
      </div>

      <h2 className="vg-panel-title">
        Guided install{' '}
        <button type="button" className="vg-btn-ghost" onClick={() => setShowInstall((s) => !s)}>
          {showInstall ? 'hide' : 'show'}
        </button>
      </h2>
      {showInstall ? (
        <div className="vg-install">
          <ol className="vg-install-steps">
            <li>
              Install <strong>ComfyUI Desktop</strong> for Windows — current installers ship PyTorch CUDA ≥ 12.8 with
              Blackwell (RTX 5090) support. Start it and leave the default API <code>http://127.0.0.1:8188</code> running.
            </li>
            <li>
              Download model files via the table below (Wan models are 18–43 GB each — mind disk space). Files go into the
              ComfyUI <code>models/</code> subfolders printed per model; the doctor re-checks detection after each download.
            </li>
            <li>
              No Wan weights are on-disk by default — Generate refuses plainly with download pointers until they are in
              place. Posters are saved in-graph next to every clip (no ffmpeg in v1); clips save as mp4/h264.
            </li>
            <li>
              License note: the v1 catalog is Apache-2.0 (commercial OK); the opt-in entries (LTX 2.5, HunyuanVideo 1.5)
              are community-gated, BADGED NON-COMMERCIAL, and not wired — picking them fails plainly. Restyles grant no
              rights to the source clip.
            </li>
          </ol>

          <table className="vg-models">
            <thead>
              <tr>
                <th>Model</th>
                <th>Role / modes</th>
                <th>~Size</th>
                <th>min VRAM</th>
                <th>License</th>
                <th>Status</th>
                <th>Model dirs</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((m) => {
                const det = detectedFor(m)
                const missing = probe?.models?.find((x) => x.id === m.id)?.missing_nodes ?? []
                return (
                  <tr key={m.id}>
                    <td>
                      {m.label}
                      {m.verify ? <div className="vg-hint">{m.verify}</div> : null}
                    </td>
                    <td>
                      {m.role}
                      {m.mode_roles.length > 0 ? (
                        <div className="vg-hint">{m.mode_roles.map((x) => MODE_LABELS[x]).join(', ')}</div>
                      ) : (
                        <div className="vg-hint">opt-in · not wired</div>
                      )}
                    </td>
                    <td>{m.approx_size_gb ? `~${m.approx_size_gb} GB` : '?'}</td>
                    <td>≈{m.min_vram_gb} GB</td>
                    <td>
                      <span className={m.commercial_ok ? 'vg-badge vg-badge-ok' : 'vg-badge vg-badge-nc'}>{m.license}</span>
                      {m.commercial_ok ? null : <div className="vg-hint">{m.license_badge}</div>}
                    </td>
                    <td>
                      {det === null ? (
                        <span className="vg-badge">off/server down</span>
                      ) : det ? (
                        <span className="vg-badge vg-badge-ok">detected</span>
                      ) : (
                        <span className="vg-badge vg-badge-nc">missing</span>
                      )}
                      {missing.length > 0 ? <div className="vg-hint">{missing.join(', ')}</div> : null}
                    </td>
                    <td className="vg-models-files">
                      {m.download?.targets.map((f) => (
                        <code key={f}>{f}</code>
                      ))}
                    </td>
                    <td>
                      {m.download ? (
                        <div className="vg-models-files">
                          <button type="button" className="vg-btn-ghost" onClick={() => hfLink(m.download!.huggingface_url)}>
                            HF card →
                          </button>
                          {m.download!.repo_files.length > 0 ? (
                            <details>
                              <summary className="vg-btn-ghost">{m.download!.repo_files.length} repo file(s)</summary>
                              <div className="vg-models-files">
                                {m.download!.repo_files.map((f) => (
                                  <code key={f}>{f}</code>
                                ))}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p className="vg-hint">
            Detection is live via ComfyUI /object_info (the same probe as sylo_video_gen_doctor); node-class checks run
            per workflow variant (t2v/i2v/flf2v/v2v). Frame interpolation pack:{' '}
            {probe?.frame_interpolation?.available ? 'DETECTED' : 'not installed'} — optional; loops render at native fps
            without it (upgrade-not-blocker; the doctor prints the download-or-downgrade guidance).
          </p>
          <p className="vg-hint">
            VRAM notes: per-model minimums are estimates until the first real render — preflight compares free VRAM
            against the table before every render and refuses plainly when it is short. ComfyUI + sylo-tts (and image
            finals) share this GPU: render video finals while TTS is idle. The package detects, never spawns — unload
            models via ComfyUI's own <code>/free</code> endpoint if VRAM is tight.
          </p>
        </div>
      ) : null}

      <h2 className="vg-panel-title">Preset defaults</h2>
      <div className="vg-row vg-row-wrap">
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-draft-model">
            Draft model (clip)
          </label>
          <select
            id="vg-draft-model"
            className="vg-select"
            value={config?.draft_model ?? ''}
            onChange={(e) => void saveConfig({ draft_model: e.target.value }, 'draft model')}
          >
            {catalog.filter((m) => m.mode_roles.includes('clip')).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.commercial_ok ? '' : '(non-commercial)'}
              </option>
            ))}
          </select>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-final-model">
            Final model (clip + loop)
          </label>
          <select
            id="vg-final-model"
            className="vg-select"
            value={config?.final_model ?? ''}
            onChange={(e) => void saveConfig({ final_model: e.target.value }, 'final model')}
          >
            {catalog
              .filter((m) => m.mode_roles.includes('clip') && m.mode_roles.includes('loop'))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} {m.commercial_ok ? '' : '(non-commercial)'}
                </option>
              ))}
          </select>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-restyle-model">
            Restyle model
          </label>
          <select
            id="vg-restyle-model"
            className="vg-select"
            value={config?.restyle_model ?? ''}
            onChange={(e) => void saveConfig({ restyle_model: e.target.value }, 'restyle model')}
          >
            {catalog.filter((m) => m.mode_roles.includes('restyle')).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.commercial_ok ? '' : '(non-commercial)'}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="vg-row vg-row-wrap">
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-res">
            Default resolution
          </label>
          <select
            id="vg-res"
            className="vg-select"
            value={config?.default_resolution ?? '720p'}
            onChange={(e) => void saveConfig({ default_resolution: e.target.value }, 'default resolution')}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-orient">
            Default orientation
          </label>
          <select
            id="vg-orient"
            className="vg-select"
            value={config?.default_orientation ?? 'landscape'}
            onChange={(e) => void saveConfig({ default_orientation: e.target.value }, 'default orientation')}
          >
            {ORIENTATIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-dur">
            Default duration
          </label>
          <select
            id="vg-dur"
            className="vg-select"
            value={String(config?.default_duration_seconds ?? 5)}
            onChange={(e) => void saveConfig({ default_duration_seconds: Number(e.target.value) }, 'default duration')}
          >
            {DURATIONS.map((d) => (
              <option key={String(d)} value={String(d)}>
                {String(d)} s
              </option>
            ))}
          </select>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-fpsdef">
            Default framerate
          </label>
          <select
            id="vg-fpsdef"
            className="vg-select"
            value={String(config?.default_framerate ?? 0)}
            onChange={(e) => void saveConfig({ default_framerate: Number(e.target.value) }, 'default framerate')}
          >
            {FRAMERATES.map((f) => (
              <option key={String(f)} value={String(f)}>
                {f === 0 ? 'model default (0)' : `${String(f)} fps`}
              </option>
            ))}
          </select>
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-loopmotion">
            Loop motion strength
          </label>
          <input
            id="vg-loopmotion"
            className="vg-input vg-input-num"
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={loopDraft ?? (config ? config.loop_motion_strength : 0.5)}
            onChange={(e) => setLoopDraft(e.target.value)}
            onBlur={() => {
              if (loopDraft === null) return
              const v = Number(loopDraft)
              setLoopDraft(null)
              if (Number.isFinite(v) && v >= 0 && v <= 1) void saveConfig({ loop_motion_strength: v }, 'loop motion strength')
            }}
          />
        </div>
        <div className="vg-field">
          <label className="vg-label" htmlFor="vg-autotag">
            Auto-tag preset
          </label>
          <label className="vg-check" htmlFor="vg-autotag">
            <input
              id="vg-autotag"
              type="checkbox"
              checked={config?.auto_tag_preset ?? true}
              onChange={(e) => void saveConfig({ auto_tag_preset: e.target.checked }, 'auto-tag preset')}
            />
            tag drafts/finals automatically
          </label>
        </div>
      </div>
      {saving ? <p className="vg-hint">Saving…</p> : null}
      {note ? <p className="vg-toast">{note}</p> : null}
      {error ? <p className="vg-error">{error}</p> : null}

      <h2 className="vg-panel-title">Storage</h2>
      <p className="vg-hint">
        Library root{status?.workspace_root ? ` (workspace ${status.workspace_root})` : ''}:{' '}
        <code>{status?.library_root ?? 'no workspace selected — the library is per-workspace'}</code>
        {status?.library_stats ? ` · ${status.library_stats.count} clip(s) · ${fmtBytes(status.library_stats.bytes)}` : ''}
      </p>
      <p className="vg-hint">
        Index <code>library.json</code> + <code>files/&lt;yyyy&gt;/&lt;mm&gt;/&lt;id&gt;.mp4</code> +{' '}
        <code>&lt;id&gt;.poster.png</code> (the in-graph first frame). Recommend adding{' '}
        <code>.sylo/videos/files/</code> to the workspace .gitignore (the index + the render ledger stay in).
      </p>
      <p className="vg-hint">
        Render ledger <code>jobs.json</code>
        {jobsHealth
          ? ` · ${jobsHealth.total} row(s): ${jobsHealth.done} done · ${jobsHealth.error} error · ${jobsHealth.running} running · ${jobsHealth.queued} queued`
          : ' unavailable (no workspace)'}{' '}
        — pending rows replay read-only from ComfyUI history after a restart (Generate tab → Replay pending).
      </p>
    </section>
  )
}