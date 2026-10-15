/**
 * sylo_video_gen_doctor (plan §3.3) — setup copilot, sylo_image_gen_doctor twin
 * with the video specifics. One text report:
 *   config echo (load chain + coercion notes) · ComfyUI reachability + system
 *   stats (GPU/VRAM/torch/ComUDA — field names defensively read) · queue depth ·
 *   MODEL CATALOG table with detected/missing (per-FILE wiring detection) +
 *   per-variant node-class check (all four graphs — missing native nodes reported;
 *   missing `frame_interpolation` pack = downgrade-not-blocker) + download links +
 *   license badges · VRAM PREFLIGHT TABLE vs currently free VRAM (explicit units:
 *   the catalog GB figures are decimal; ComfyUI reports bytes) · JOB-RECORD health
 *   (§4.3 — durable ledger counts by status, stale pending rows flagged for the
 *   §8.7 host replay) · library + disk stats · excluded-models section · next steps.
 *
 * The catalog data itself comes from shared/catalog.ts + shared/comfyui/client.ts
 * + the job ledger module (one source of truth — the §5.6 Settings card composes
 * the same modules), so doctor and Settings can't drift. Every failure mode
 * renders as text; nothing is rethrown raw. Workspace resolution is SYLO_PI_CWD-
 * only (§4 binding #2). Read-only GETs only — no submissions, no /free, no kills.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { comfyDoctorProbe, comfyHealth, resolveComfyEndpoint } from '../../shared/comfyui/client.ts'
import { EXCLUDED_VIDEO_MODELS, VIDEO_MODEL_CATALOG } from '../../shared/catalog.ts'
import {
  libraryRootForWorkspace,
  loadLibrary,
  resolveWorkspaceRoot,
} from '../../shared/video-library-store.ts'
import { effectiveJobTimeoutMs, JOB_TIMEOUT_MS } from '../../shared/comfyui/client.ts'
import { loadJobsWithRecovery, type VideoJobsStore } from '../../shared/video-jobs-store.ts'
import { loadVideogenConfig } from '../config.ts'
import { toolError, toolResult, type ToolContentBlock } from './blocks.ts'

const Params = Type.Object({})

const GIB = 1024 ** 3
function fmtBytes(n: number | undefined): string {
  if (n === undefined || n < 0) return '?'
  if (n >= GIB) return `${(n / GIB).toFixed(2)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${n} B`
}

/** Decimal-GB rendering for catalog figures (the catalog ships decimal GB; ComfyUI VRAM is bytes). */
function fmtDecimalGb(n: number): string {
  return `${n} GB (decimal)`
}

function fmtNumber(n: number | string | undefined, fallback = '(not reported)'): string {
  if (n === undefined || n === null || n === '') return fallback
  return String(n)
}

function line(out: string[], text = ''): void {
  out.push(text)
}

/** §4.3 job-record health — exported for test jobs coverage of the STALE threshold. */
export const JOB_STALE_AFTER_MS = JOB_TIMEOUT_MS + 5 * 60 * 1000

/** Stale = a queued/running row older than the job timeout + slack: the render may
 *  have been interrupted by a host restart; the §8.7 host replays pending records
 *  and re-polls /history/{prompt_id} (§2.3), and the output may exist in ComfyUI
 *  already. Counted in the doctor; never auto-deleted (ledger is history, §4.3). */
export function jobHealthRows(store: VideoJobsStore): { counts: Record<string, number>; stale: { id: string; status: string; created_at: string; age_min: number }[] } {
  const counts: Record<string, number> = { queued: 0, running: 0, done: 0, error: 0 }
  const stale: { id: string; status: string; created_at: string; age_min: number }[] = []
  const now = Date.now()
  for (const job of store.jobs) counts[job.status] = (counts[job.status] ?? 0) + 1
  for (const job of store.jobs) {
    if (job.status !== 'queued' && job.status !== 'running') continue
    const t = Date.parse(job.started_at ?? job.created_at)
    if (!Number.isNaN(t) && now - t > JOB_STALE_AFTER_MS)
      stale.push({ id: job.id, status: job.status, created_at: job.created_at, age_min: Math.round((now - t) / 60000) })
  }
  return { counts, stale }
}

/** Compose the doctor report; isolated so failures inside land in the tool catch. */
export async function buildDoctorReport(): Promise<string> {
  const out: string[] = []
  const config = loadVideogenConfig()

  line(out, 'sylo-video-gen setup report')
  line(out, '═'.repeat(60))

  // ── Workspace (§4: SYLO_PI_CWD only) ─────────────────────────────────────
  const workspaceRoot = resolveWorkspaceRoot()
  line(
    out,
    workspaceRoot
      ? `Workspace: ${workspaceRoot}`
      : 'Workspace: not set (SYLO_PI_CWD missing) — the per-workspace video library + render ledger are disabled outside a Sylo chat.',
  )
  line(out)

  // ── Config echo (§3.3) ───────────────────────────────────────────────────
  const cfg = config.config
  line(out, `Config (source: ${config.source}):`)
  line(out, `  comfyui_url: ${cfg.comfyui_url}`)
  line(
    out,
    `  draft preset model: ${cfg.draft_model} · final preset model: ${cfg.final_model} · restyle model: ${cfg.restyle_model}`,
  )
  line(
    out,
    `  default_resolution: ${cfg.default_resolution} · default_orientation: ${cfg.default_orientation} · default_duration_seconds: ${cfg.default_duration_seconds} · default_framerate: ${cfg.default_framerate} (0 = model default)`,
  )
  line(
    out,
    `  loop_motion_strength: ${cfg.loop_motion_strength} · auto_tag_preset: ${cfg.auto_tag_preset ? 'on' : 'off'} · comfyui_exe_path: ${cfg.comfyui_exe_path || '(unset — v1 detects ComfyUI, never launches it)'}`,
  )
  for (const note of config.notes) line(out, `  note: ${note}`)
  line(out)

  // ── ComfyUI reachability + system stats (engine-resolved: the loopback port
  // sibling is probed when the configured port refuses — found live 2026-10) ─
  const endpoint = await resolveComfyEndpoint(cfg.comfyui_url)
  const health = endpoint.health
  if (!health.ok) {
    line(out, `ComfyUI at ${cfg.comfyui_url}: NOT REACHABLE`)
    line(out, `  ${health.error ?? 'no details'}`)
    line(out)
    line(out, '  Start ComfyUI (ComfyUI Desktop, default API 127.0.0.1:8188) or fix comfyui_url')
    line(out, '  in sylo-video-gen Settings; then run sylo_video_gen_doctor again.')
  } else {
    line(out, `ComfyUI at ${health.url}: REACHABLE`)
    if (health.url !== cfg.comfyui_url.replace(/\/+$/, '')) {
      line(out, `  note: engine answered on a FALLBACK probe (${health.url}, config pins ${cfg.comfyui_url}) — update comfyui_url in Settings when convenient.`)
    }
    line(out, `  ComfyUI version: ${fmtNumber(health.version)}`)
    line(out, `  GPU: ${fmtNumber(health.device_name)}`)
    const vramTotal = health.vram_total_bytes ?? 0
    const vramFree = health.vram_free_bytes
    if (vramTotal > 0) {
      const freeText = vramFree !== undefined ? `${fmtBytes(vramFree)} (≈ ${(vramFree / GIB).toFixed(1)} GiB / ${(vramFree / 1e9).toFixed(1)} GB)` : '?'
      line(out, `  VRAM free ${freeText} of total ${fmtBytes(vramTotal)} (total ≈ ${(vramTotal / GIB).toFixed(1)} GiB / ${(vramTotal / 1e9).toFixed(1)} GB)`)
    }
    // Raw system_stats echo for torch/ComUDA — field names defensively read; the
    // §3.3 dedupe stands: ONE /system_stats fetch (comfyHealth carries the raw echo).
    const stats = health.stats
    if (stats) {
      const torch = stats.system?.pytorch_version ?? stats.system?.torch_version
      const os = fmtNumber(stats.system?.os)
      const python = fmtNumber(stats.system?.python_version)
      line(out, `  PyTorch: ${fmtNumber(torch)} (from /system_stats — field names verified at §0/probe)`)
      line(out, `  OS: ${os} · Python: ${python} · RAM free ${fmtBytes(stats.system?.ram_free)} / total ${fmtBytes(stats.system?.ram_total)}`)
      const device = stats.devices?.[0]
      if (device?.type && device.type.toLowerCase() !== 'cuda')
        line(out, `  Device type: ${device.type} (non-CUDA — CUDA video models will not run)`)
      else if (device?.type) line(out, '  Device type: cuda')
    }
    line(out, `  Queue: ${health.queue_running ?? 0} running · ${health.queue_pending ?? 0} pending`)
  }
  line(out)

  // ── Model catalog table (per-FILE detection + per-variant node classes) ──
  line(out, 'Models — detect-not-trust via GET /object_info; sizes are decimal GB from the HF listings:')
  if (!health.ok) {
    line(out, '  (model detection skipped — ComfyUI is not reachable)')
    for (const entry of VIDEO_MODEL_CATALOG)
      line(
        out,
        `  ${entry.id.padEnd(16)} ${(entry.mode_roles.join('/') || 'opt-in').padEnd(14)} ${fmtDecimalGb(entry.approx_size_gb)} · min VRAM ${entry.min_vram_gb} GB${entry.commercial_ok ? '' : ` · ${entry.license_badge}`}`,
      )
  } else {
    try {
      const probe = await comfyDoctorProbe(cfg.comfyui_url)
      line(out, `  ComfyUI exposes ${probe.known_node_count} node classes.`)
      line(
        out,
        `  ${'model'.padEnd(16)} ${( 'role/modes').padEnd(14)} ${'size'.padEnd(10)} ${'status'.padEnd(10)} workflow node check`,
      )
      for (const entry of VIDEO_MODEL_CATALOG) {
        const probeEntry = probe.models.find((m) => m.id === entry.id)
        const detected = probeEntry?.detected === true
        const wired = Object.values(entry.comfy.variants ?? {}).some(Boolean)
        const nodes =
          !wired
            ? '(opt-in — not wired in v1)'
            : (probeEntry?.missing_nodes.length ?? 1) === 0 && !probeEntry?.missing_nodes.some((n) => n.startsWith('('))
              ? 'OK (wired graphs validate)'
              : `issues: ${probeEntry?.missing_nodes.join(', ') ?? '?'}`
        line(
          out,
          `  ${entry.id.padEnd(16)} ${(entry.mode_roles.join('/') || 'opt-in').padEnd(14)} ${(entry.approx_size_gb ? `~${entry.approx_size_gb} GB` : '?').padEnd(10)} ${(detected ? 'DETECTED' : 'MISSING').padEnd(10)} ${nodes}`,
        )
        if (entry.download) {
          line(out, `      model dirs: ${entry.download.targets.join(' · ')}`)
          line(out, `      download: ${entry.download.huggingface_url}`)
        }
        if (!entry.commercial_ok) line(out, `      license badge: ${entry.license_badge}`)
      }
      // frame_interpolation pack state (loop upgrade/downgrade note — §2.4/§3.3).
      if (probe.frame_interpolation.available) {
        line(out, `  frame_interpolation pack: PRESENT (${probe.frame_interpolation.models.join(' · ')}) — loop graphs can opt into native interpolation.`)
      } else {
        line(
          out,
          '  frame_interpolation pack: NOT INSTALLED — loop graphs render at native fps (downgrade, not a blocker); ' +
            'install the Comfy-Org frame_interpolation pack to enable RIFE/FILM interpolation.',
        )
      }
    } catch (err) {
      line(out, `  (model detection failed: ${err instanceof Error ? err.message : String(err)})`)
    }
  }
  line(out)

  // ── VRAM preflight table (§3.3) vs currently free VRAM — explicit units ──
  if (health.ok) {
    const free = health.vram_free_bytes
    if (free === undefined) {
      line(out, 'VRAM preflight: (this ComfyUI build does not report free VRAM — checks skipped)')
    } else {
      line(
        out,
        `VRAM preflight (free ${fmtBytes(free)} = ${(free / GIB).toFixed(1)} GiB = ${(free / 1e9).toFixed(1)} GB; catalog minimums are DECIMAL GB):`,
      )
      for (const entry of VIDEO_MODEL_CATALOG) {
        if (!Object.values(entry.comfy.variants ?? {}).some(Boolean)) {
          line(out, `  ${entry.id.padEnd(16)} min ~${entry.min_vram_gb} GB — (opt-in, not wired)`)
          continue
        }
        const need = entry.min_vram_gb * 1e9
        const verdict = free >= need ? 'OK' : 'TIGHT — finals may fail or swap'
        line(out, `  ${entry.id.padEnd(16)} min ~${entry.min_vram_gb} GB (decimal) — ${verdict}`)
      }
      line(out, '  note: render finals while sylo-tts is idle — TTS + a 14B DiT share the GPU (§7).')
    }
    line(out)
  }

  // ── Job-record health (§4.3 durable ledger) ─────────────────────────────
  if (workspaceRoot) {
    const root = libraryRootForWorkspace(workspaceRoot)
    const { store, recovery_note } = loadJobsWithRecovery(root)
    const { counts, stale } = jobHealthRows(store)
    line(out, `Render ledger (${'jobs.json'}):`)
    if (recovery_note) line(out, `  note: ${recovery_note}`)
    line(
      out,
      `  ${store.jobs.length} job row(s) — ${counts.queued} queued · ${counts.running} running · ${counts.done} done · ${counts.error} error`,
    )
    if (stale.length) {
      line(
        out,
        `  note: ${stale.length} queued/running row(s) older than the ${Math.round(effectiveJobTimeoutMs() / 60000)}-min job cap + slack — ` +
          'these renders may have been interrupted by a restart; the host replays pending records (§8.7) and ' +
          're-polls /history/{prompt_id}; or just re-run the request.',
      )
    }
    // Library + disk stats (§3.3) — index records (files are truth for bytes).
    const lib = loadLibrary(root)
    const clips = lib.videos
    const totalBytes = clips.reduce((sum, v) => sum + v.bytes, 0)
    const favorites = clips.filter((v) => v.favorite).length
    line(out, `Library (${root}):`)
    line(
      out,
      `  ${clips.length} clip${clips.length === 1 ? '' : 's'} · ${fmtBytes(totalBytes)} (per index records) · ${favorites} favorit${favorites === 1 ? 'e' : 'es'}`,
    )
    const byMode = { clip: 0, loop: 0, restyle: 0 } as Record<string, number>
    for (const clip of clips) byMode[clip.mode] = (byMode[clip.mode] ?? 0) + 1
    line(out, `  by mode: ${Object.entries(byMode).map(([m, n]) => `${n} ${m}`).join(' · ')}`)
    const recovered = clips.filter((clip) => clip.tags.includes('recovered')).length
    if (recovered > 0) {
      line(
        out,
        `  note: ${recovered} record(s) were rebuilt after a corrupt index — metadata was lost (placeholders + 'recovered' tag); ` +
          'regenerate or re-tag them.',
      )
    }
  } else {
    line(out, 'Render ledger + library: unavailable outside a Sylo chat (no workspace).')
  }
  line(out)

  // ── Excluded models (§2.2 — license exclusions are absolute) ────────────
  line(out, 'Excluded from the catalog (license/proprietary — absolute):')
  for (const excluded of EXCLUDED_VIDEO_MODELS) line(out, `  ${excluded.label}: ${excluded.reason}`)
  line(out)

  // ── Next steps ───────────────────────────────────────────────────────────
  line(out, 'Next steps:')
  if (!health.ok) {
    line(out, '  1. Start ComfyUI (ComfyUI Desktop on Windows; default API http://127.0.0.1:8188).')
    line(out, '  2. Re-run sylo_video_gen_doctor to see GPU/VRAM and model detection.')
  } else {
    line(out, '  - Download MISSING models via the links above; files go in the listed ComfyUI model subfolders, then re-run doctor.')
    line(out, '  - Generate a test clip: e.g. "5s draft clip: slow dolly through a neon-lit rainy street" (preset draft).')
    line(out, '  - If a generate call fails, re-run sylo_video_gen_doctor and read the workflow-nodes column.')
  }
  return out.join('\n')
}

export function registerDoctorTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'sylo_video_gen_doctor',
    label: 'Video-gen setup doctor',
    description:
      'Diagnose sylo-video-gen setup: config echo, ComfyUI reachability + system stats (GPU/VRAM/version/queue), model ' +
      'catalog detected/missing with per-variant workflow-node checks, download links and license badges, VRAM preflight ' +
      'table, durable render-ledger health, and library stats. Run on any backend failure, or before the first ' +
      'generation when setup is unclear.',
    parameters: Params,
    async execute() {
      try {
        const report = await buildDoctorReport()
        const blocks: ToolContentBlock[] = [{ type: 'text', text: report }]
        return toolResult(blocks)
      } catch (err) {
        return toolError(
          `sylo_video_gen_doctor failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'Check that sylo-video-gen is enabled and the ComfyUI URL is reachable.',
        )
      }
    },
  })
}