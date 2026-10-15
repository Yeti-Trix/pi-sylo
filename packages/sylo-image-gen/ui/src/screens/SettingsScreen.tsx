/**
 * §5.5 Settings — the ONE-SOURCE doctor parity surface (§3.3 note 1): health
 * and model data come from the SAME shared/client modules the
 * sylo_image_gen_doctor tool composes (comfyHealth /system_stats+/queue and
 * comfyDoctorProbe one-pull /object_info — host main's imagegen-host calls
 * them; this screen only renders). Sections:
 *  - ComfyUI URL + Connect/health (GPU name, VRAM free/total, version, queue
 *    depth) with a Refresh/Connect test button;
 *  - guided-install card (§2.5, expandable): ComfyUI Desktop guidance, model
 *    table with detected/missing + size + license badge + HF links + expected
 *    folders, disk + license notes;
 *  - preset defaults (draft model / final model / default aspect) → configSave;
 *  - storage card (library root path display — should, folded).
 */
import { useState } from 'react'

import { bridge, fmtBytes, type ImagegenCatalogEntry, type ImagegenStatus } from '../bridge'

const ASPECTS = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'] as const

export function SettingsScreen({
  status,
  statusError,
  onRefresh,
  onConfigSaved,
}: {
  status: ImagegenStatus | null
  statusError: string | null
  onRefresh: () => void
  onConfigSaved: () => void
}): React.ReactElement {
  const [showInstall, setShowInstall] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [urlDraft, setUrlDraft] = useState<string | null>(null)

  const config = status?.config ?? null
  const health = status?.health ?? null
  const catalog = status?.catalog ?? []
  const probe = status?.models ?? null

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

  const modelLabel = (id: string): string => catalog.find((c) => c.id === id)?.label ?? id
  const detectedFor = (entry: ImagegenCatalogEntry): boolean | null =>
    probe?.models?.find((m) => m.id === entry.id)?.detected ?? null

  const hfLink = (url: string) => {
    void bridge.openExternalUrl(url).catch(() => {})
  }

  return (
    <section className="ig-panel">
      <h2 className="ig-panel-title">ComfyUI</h2>

      <div className="ig-field">
        <label className="ig-label" htmlFor="ig-url">
          API URL
        </label>
        <div className="ig-url-row">
          <input
            id="ig-url"
            className="ig-input ig-grow"
            type="text"
            value={urlDraft ?? config?.comfyui_url ?? ''}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="http://127.0.0.1:8188"
          />
          <button type="button" className="ig-btn-secondary" disabled={saving || urlDraft === null} onClick={() => void saveUrl()}>
            Save
          </button>
          <button type="button" className="ig-btn" onClick={onRefresh} title="Connect test — re-probe /system_stats">
            {status ? 'Re-check' : 'Connect'}
          </button>
        </div>
        {statusError ? <p className="ig-error">{statusError}</p> : null}
      </div>

      <div className="ig-healthcard" data-ok={health?.ok === true}>
        {health?.ok ? (
          <dl className="ig-kv ig-kv-inline">
            <dt status-ok="true">Reachable</dt>
            <dd>
              {health.device_name ?? 'GPU reported'} · {fmtBytes(health.vram_free_bytes)} free /{' '}
              {fmtBytes(health.vram_total_bytes)} · ComfyUI {health.version ?? '?'} · queue {health.queue_depth ?? 0}
            </dd>
          </dl>
        ) : (
          <p className="ig-warn ig-nowrap-off">
            Not reachable at {health?.url ?? config?.comfyui_url ?? 'http://127.0.0.1:8188'} —{' '}
            {health?.error ?? 'no details'}
          </p>
        )}
      </div>

      <h2 className="ig-panel-title">
        Guided install{' '}
        <button type="button" className="ig-btn-ghost" onClick={() => setShowInstall((s) => !s)}>
          {showInstall ? 'hide' : 'show'}
        </button>
      </h2>
      {showInstall ? (
        <div className="ig-install">
          <ol className="ig-install-steps">
            <li>
              Install <strong>ComfyUI Desktop</strong> for Windows — current installers ship PyTorch CUDA ≥ 12.8 with
              Blackwell (RTX 5090) support. If an older install fails on the 5090, update torch to a cu128 build.
            </li>
            <li>
              Start ComfyUI and leave its default API <code>http://127.0.0.1:8188</code> running; the Re-check button
              above shows GPU name, free VRAM and version when it works.
            </li>
            <li>
              Download model files via the table below (models are 13–32 GB each — mind disk space). Files go into the
              ComfyUI <code>models/</code> subfolders printed per model.
            </li>
            <li>
              License note: FLUX dev models produce <strong>non-commercial</strong> output — check your use before
              committing finals. The defaults (Z-Image Turbo + Qwen-Image 2) are Apache-2.0.
            </li>
          </ol>

          <table className="ig-models">
            <thead>
              <tr>
                <th>Model</th>
                <th>Role</th>
                <th>~Size</th>
                <th>License</th>
                <th>Status</th>
                <th>Files → folder</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((m) => {
                const det = detectedFor(m)
                const missing = probe?.models?.find((x) => x.id === m.id)?.missing_nodes ?? []
                return (
                  <tr key={m.id}>
                    <td>{m.label}</td>
                    <td>{m.role}</td>
                    <td>{m.approx_size_gb ? `~${m.approx_size_gb} GB` : '?'}</td>
                    <td>
                      <span className={m.commercial_ok ? 'ig-badge ig-badge-ok' : 'ig-badge ig-badge-nc'}>
                        {m.license}
                      </span>
                    </td>
                    <td>
                      {det === null ? (
                        <span className="ig-badge">off/server down</span>
                      ) : det ? (
                        <span className="ig-badge ig-badge-ok">detected</span>
                      ) : (
                        <span className="ig-badge ig-badge-nc">missing</span>
                      )}
                      {missing.length > 0 ? <div className="ig-hint">missing nodes: {missing.join(', ')}</div> : null}
                    </td>
                    <td className="ig-models-files">
                      {m.download?.comfyui_subfolders.map((f) => (
                        <code key={f}>{f}</code>
                      ))}
                    </td>
                    <td>
                      {m.download ? (
                        <button type="button" className="ig-btn-ghost" onClick={() => hfLink(m.download!.huggingface_url)}>
                          HF card →
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="ig-hint">
            Detection is live via ComfyUI /object_info (same probe as sylo_image_gen_doctor); sizes/step counts are
            approximations.
          </p>
          <p className="ig-hint">
            VRAM: model rows carry a minimum-VRAM label in the catalog data, but v1 shows no live headroom meter —
            sizing guidance is sylo_image_gen_doctor's free-VRAM heuristic (warn before big finals) until a headroom
            meter lands (v2 could-tier).
          </p>
          <p className="ig-hint">
            v1 never manages the ComfyUI process or its model memory; if VRAM is tight (e.g. ComfyUI + sylo-tts share
            one GPU), unload models via ComfyUI's <code>/free</code> endpoint or restart it — the package only detects.
          </p>
        </div>
      ) : null}

      <h2 className="ig-panel-title">Preset defaults</h2>
      <div className="ig-row ig-row-wrap">
        <div className="ig-field">
          <label className="ig-label" htmlFor="ig-draft-model">
            Draft model
          </label>
          <select
            id="ig-draft-model"
            className="ig-select"
            value={config?.draft_model ?? ''}
            onChange={(e) => void saveConfig({ draft_model: e.target.value }, 'draft model')}
          >
            {catalog.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.commercial_ok ? '' : '(non-commercial)'}
              </option>
            ))}
          </select>
        </div>
        <div className="ig-field">
          <label className="ig-label" htmlFor="ig-final-model">
            Final model
          </label>
          <select
            id="ig-final-model"
            className="ig-select"
            value={config?.final_model ?? ''}
            onChange={(e) => void saveConfig({ final_model: e.target.value }, 'final model')}
          >
            {catalog.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.commercial_ok ? '' : '(non-commercial)'}
              </option>
            ))}
          </select>
        </div>
        <div className="ig-field">
          <label className="ig-label" htmlFor="ig-aspect">
            Default aspect
          </label>
          <select
            id="ig-aspect"
            className="ig-select"
            value={config?.default_aspect ?? '1:1'}
            onChange={(e) => void saveConfig({ default_aspect: e.target.value }, 'default aspect')}
          >
            {ASPECTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="ig-field">
          <label className="ig-label" htmlFor="ig-autotag">
            Auto-tag preset
          </label>
          <label className="ig-check" htmlFor="ig-autotag">
            <input
              id="ig-autotag"
              type="checkbox"
              checked={config?.auto_tag_preset ?? true}
              onChange={(e) => void saveConfig({ auto_tag_preset: e.target.checked }, 'auto-tag preset')}
            />
            tag drafts/finals automatically
          </label>
        </div>
      </div>
      {saving ? <p className="ig-hint">Saving…</p> : null}
      {note ? <p className="ig-toast">{note}</p> : null}
      {error ? <p className="ig-error">{error}</p> : null}

      <h2 className="ig-panel-title">Storage</h2>
      <p className="ig-hint">
        Library root{status?.workspace_root ? ` (workspace ${status.workspace_root})` : ''}:{' '}
        <code>{status?.library_root ?? 'no workspace selected — the library is per-workspace'}</code>
      </p>
      <p className="ig-hint">
        Index <code>library.json</code> + <code>files/&lt;yyyy&gt;/&lt;mm&gt;/&lt;id&gt;.png</code>. Recommend adding{' '}
        <code>.sylo/images/files/</code> to the workspace .gitignore (the agent can do it on request).
      </p>
    </section>
  )
}