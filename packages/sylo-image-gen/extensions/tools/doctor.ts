/**
 * sylo_image_gen_doctor (plan §3.3) — setup copilot. One text report:
 *   config echo (load chain + coercion notes) · ComfyUI reachability + system
 *   stats (GPU/VRAM/torch/ComUDA — field names verified at §6) · queue depth ·
 *   model catalog table with detected/missing + download links + license notes ·
 *   library stats (count + disk size from loadLibrary records) · next steps.
 *
 * The catalog data itself comes from shared/models.ts + shared/comfyui/client.ts
 * (one source of truth — the §5.5 Settings card composes the same modules), so
 * doctor and Settings can't drift. Every failure mode renders as text; nothing
 * is rethrown raw. Workspace resolution is SYLO_PI_CWD-only (§4 binding #2).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
  comfyDoctorProbe,
  comfyHealth,
  resolveComfyEndpoint,
} from '../../shared/comfyui/client.ts'
import { IMAGE_MODEL_CATALOG } from '../../shared/models.ts'
import {
  libraryRootForWorkspace,
  loadLibrary,
  resolveWorkspaceRoot,
} from '../../shared/library-store.ts'
import { loadImagegenConfig } from '../config.ts'
import { toolError, toolResult, type ToolContentBlock } from './blocks.ts'

const Params = Type.Object({})

const GIB = 1024 ** 3
function fmtBytes(n: number | undefined): string {
  if (n === undefined || n < 0) return '?'
  if (n >= GIB) return `${(n / GIB).toFixed(1)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${n} B`
}

function fmtNumber(n: number | string | undefined, fallback = '(not reported)'): string {
  if (n === undefined || n === null || n === '') return fallback
  return String(n)
}

function line(out: string[], text = ''): void {
  out.push(text)
}

/** Compose the doctor report; isolated so failures inside land in the tool catch. */
export async function buildDoctorReport(): Promise<string> {
  const out: string[] = []
  const config = loadImagegenConfig()

  line(out, 'sylo-image-gen setup report')
  line(out, '═'.repeat(60))

  // ── Workspace (§4: SYLO_PI_CWD only) ─────────────────────────────────────
  const workspaceRoot = resolveWorkspaceRoot()
  line(
    out,
    workspaceRoot
      ? `Workspace: ${workspaceRoot}`
      : 'Workspace: not set (SYLO_PI_CWD missing) — the per-workspace image library is disabled outside a Sylo chat.',
  )
  line(out)

  // ── Config echo (§3.3) ───────────────────────────────────────────────────
  line(out, `Config (source: ${config.source}):`)
  line(out, `  comfyui_url: ${config.config.comfyui_url}`)
  line(
    out,
    `  draft preset model: ${config.config.draft_model} · final preset model: ${config.config.final_model}`,
  )
  line(
    out,
    `  default_aspect: ${config.config.default_aspect} · auto_tag_preset: ${config.config.auto_tag_preset ? 'on' : 'off'} · image_format: ${config.config.image_format}`,
  )
  line(
    out,
    `  comfyui_exe_path: ${config.config.comfyui_exe_path || '(unset — v1 detects ComfyUI, never launches it)'} · upscale_model: ${config.config.upscale_model} (v2) · caption_backend: ${config.config.caption_backend} (v2)`,
  )
  for (const note of config.notes) line(out, `  note: ${note}`)
  line(out)

  // ── ComfyUI reachability + system stats (engine-resolved: the loopback port
  // sibling is probed when the configured port refuses — found live 2026-10) ─
  const endpoint = await resolveComfyEndpoint(config.config.comfyui_url)
  const health = endpoint.health
  if (!health.ok) {
    line(out, `ComfyUI at ${config.config.comfyui_url}: NOT REACHABLE`)
    line(out, `  ${health.error ?? 'no details'}`)
    line(out)
    line(out, '  Start ComfyUI (ComfyUI Desktop, default API 127.0.0.1:8188) or fix comfyui_url')
    line(out, '  in sylo-image-gen Settings; then run sylo_image_gen_doctor again.')
  } else {
    line(out, `ComfyUI at ${health.url}: REACHABLE`)
    if (health.url !== config.config.comfyui_url.replace(/\/+$/, '')) {
      line(out, `  note: engine answered on a FALLBACK probe (${health.url}, config pins ${config.config.comfyui_url}) — update comfyui_url in Settings when convenient.`)
    }
    line(out, `  ComfyUI version: ${fmtNumber(health.version)}`)
    line(out, `  GPU: ${fmtNumber(health.device_name)}${health.vram_total_bytes ? ` · VRAM free ${fmtBytes(health.vram_free_bytes)} / total ${fmtBytes(health.vram_total_bytes)}` : ''}`)
    if (health.vram_free_bytes !== undefined && (health.vram_total_bytes ?? 0) > 0 && health.vram_free_bytes < 16 * GIB)
      line(out, '  note: free VRAM is under 16 GiB — the bigger finals (flux1-dev/flux2-dev) may fail or swap; drafts are safe.')
    // Raw system_stats echo for torch/ComUDA — field names defensively read.
    // §3 note 5 dedupe: comfyHealth already fetched /system_stats; doctor must
    // not probe it a second time — the raw echo rides along on health.stats.
    const stats = health.stats
    if (stats) {
      const torch = stats.system?.pytorch_version ?? stats.system?.torch_version
      const os = fmtNumber(stats.system?.os)
      const python = fmtNumber(stats.system?.python_version)
      line(out, `  PyTorch: ${fmtNumber(torch)} (from /system_stats — VERIFY §6 exact field naming)`)
      line(out, `  OS: ${os} · Python: ${python} · RAM free ${fmtBytes(stats.system?.ram_free)} / total ${fmtBytes(stats.system?.ram_total)}`)
      const device = stats.devices?.[0]
      if (device?.type && device.type.toLowerCase() !== 'cuda') line(out, `  Device type: ${device.type} (non-CUDA — CUDA models will not run)`)
      else if (device?.type) line(out, `  Device type: cuda (ComUDA path)`)
    }
    line(out, `  Queue: ${health.queue_depth ?? 0} job(s) running/pending`)
  }
  line(out)

  // ── Model catalog table (detected / missing + download links + licenses) ─
  line(out, 'Models — detect-not-trust via GET /object_info; sizes and step counts are approximations:')
  if (!health.ok) {
    line(out, '  (model detection skipped — ComfyUI is not reachable)')
    for (const entry of IMAGE_MODEL_CATALOG) line(out, `  ${entry.id.padEnd(14)} ${entry.role.padEnd(6)} ${entry.license}${entry.approx_size_gb ? ` · ~${entry.approx_size_gb} GB` : ''}`)
  } else {
    try {
      const probe = await comfyDoctorProbe(endpoint.url)
      line(out, `  ComfyUI exposes ${probe.known_node_count} node classes.`)
      line(
        out,
        `  ${'model'.padEnd(14)} ${'role'.padEnd(6)} ${'size'.padEnd(8)} ${'status'.padEnd(10)} workflow nodes`,
      )
      for (const entry of IMAGE_MODEL_CATALOG) {
        const probeEntry = probe.models.find((m) => m.id === entry.id)
        const detected = probeEntry?.detected === true
        const nodes = probeEntry && probeEntry.missing_nodes.length === 0 ? 'OK' : `missing: ${probeEntry?.missing_nodes.join(', ') ?? '?'}`
        line(
          out,
          `  ${entry.id.padEnd(14)} ${entry.role.padEnd(6)} ${(entry.approx_size_gb ? `~${entry.approx_size_gb} GB` : '?').padEnd(8)} ${(detected ? 'DETECTED' : 'MISSING').padEnd(10)} ${nodes}`,
        )
        if (entry.download) {
          line(out, `      files: ${entry.download.comfyui_subfolders.join(' · ')}`)
          line(out, `      download: ${entry.download.huggingface_url}`)
        }
        if (!entry.commercial_ok)
          line(out, '      license note: FLUX dev — outputs are NON-COMMERCIAL; check the use before committing renders.')
      }
    } catch (err) {
      line(out, `  (model detection failed: ${err instanceof Error ? err.message : String(err)})`)
    }
  }
  line(out)

  // ── Library stats (index records — files are truth for pixels) ───────────
  if (workspaceRoot) {
    const root = libraryRootForWorkspace(workspaceRoot)
    const store = loadLibrary(root)
    const images = store.images
    const totalBytes = images.reduce((sum, im) => sum + im.bytes, 0)
    const favorites = images.filter((im) => im.favorite).length
    line(out, `Library (${root}):`)
    line(
      out,
      `  ${images.length} image${images.length === 1 ? '' : 's'} · ${favorites} favorit${favorites === 1 ? 'e' : 'es'} · ${fmtBytes(totalBytes)} on disk (per index records)`,
    )
    const recovered = images.filter((im) => im.tags.includes('recovered')).length
    if (recovered > 0) {
      line(
        out,
        `  note: ${recovered} record(s) were rebuilt after a corrupt index — metadata was lost; regenerate or re-tag them.` +
          ` The PNG's embedded ComfyUI workflow is the future backfill path (v2 re-import).`,
      )
    }
  } else {
    line(out, 'Library: unavailable outside a Sylo chat (no workspace).')
  }
  line(out)

  // ── Next steps ───────────────────────────────────────────────────────────
  line(out, 'Next steps:')
  if (!health.ok) {
    line(out, '  1. Start ComfyUI (ComfyUI Desktop on Windows; default API http://127.0.0.1:8188).')
    line(out, '  2. Re-run sylo_image_gen_doctor to see GPU/VRAM and model detection.')
    line(out, '  3. On a 5090, if torch reports an old CUDA build, update to torch cu128+ (Blackwell sm_120).')
  } else {
    line(out, DOCTOR_REACHABLE_HINT)
    line(out, '  - Generate a test image: "generate a logo draft of a red bicycle" (preset draft).')
    line(out, '  - If a generate call fails, re-run sylo_image_gen_doctor and read the workflow-nodes column.')
  }
  return out.join('\n')
}

const DOCTOR_REACHABLE_HINT =
  '- Download MISSING models via the links above; files go in the listed ComfyUI model subfolders, then re-run doctor.'

export function registerDoctorTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'sylo_image_gen_doctor',
    label: 'Image-gen setup doctor',
    description:
      'Diagnose sylo-image-gen setup: config echo, ComfyUI reachability + system stats (GPU/VRAM/version/queue), ' +
      'model catalog detected/missing with download links and license notes, and library stats. ' +
      'Run on any backend failure, or before the first generation when setup is unclear.',
    parameters: Params,
    async execute() {
      try {
        const report = await buildDoctorReport()
        const blocks: ToolContentBlock[] = [{ type: 'text', text: report }]
        return toolResult(blocks)
      } catch (err) {
        return toolError(
          `sylo_image_gen_doctor failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'Check that sylo-image-gen is enabled and the ComfyUI URL is reachable.',
        )
      }
    },
  })
}