/**
 * Model catalog + draft/final presets (plan §2.2).
 * Sizes / VRAM / step numbers are approximations from research — `doctor`
 * detects actual installs via ComfyUI /object_info instead of trusting these.
 * `comfy` loader wiring + `download` targets: community-packaging basenames,
 * re-anchored to verified HuggingFace hostings 2026-10-11 (per-entry comments
 * cite the API listings; node wiring stays VERIFY live at §6 manual QA — node
 * classes are also validated against /object_info at runtime when ComfyUI is
 * reachable, plan §2.4/§3.3).
 * Resolution helpers turn a tool/route request + config into a filled GenRequest.
 */
import { randomInt } from 'node:crypto'
import type { AspectRatio, GenRequest, ImagePreset, ModelCatalogEntry } from './types.ts'

export const IMAGE_MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'z-image-turbo',
    label: 'Z-Image Turbo',
    family: 'z-image',
    license: 'Apache-2.0',
    commercial_ok: true,
    backend: 'comfyui',
    role: 'draft',
    approx_size_gb: 15,
    min_vram_gb: 16,
    steps: 8,
    guidance: 0,
    default_size: { width: 768, height: 768 },
    strengths: 'Fast draft — ~5–10 s @ 768px on RTX 5090; text-in-image fair.',
    // Filenames + loader wiring VERIFIED 2026-10-11 round-2 against LIVE evidence (round-1's
    // clip_type 'z_image' + "shared Qwen VAE" claims are refuted): (1) the operator's live ComfyUI
    // Desktop /object_info/CLIPLoader type enum (2026-10-11, port 8188) has NO 'z_image' option —
    // it has 'lumina2' (Z-Image's Qwen3-4B TE rides the Lumina-2 path), matching the official
    // Desktop Z-Image-Turbo template which uses CLIPLoader type 'lumina2'; (2) the VAE is NOT the
    // shared Qwen one — HF blob sha256 of Comfy-Org/z_image_turbo split_files/vae/ae.safetensors
    // (335,304,388 B, afc8e28272cd15db…) differs from Comfy-Org/Qwen-Image_ComfyUI
    // qwen_image_vae.safetensors (253,806,246 B, a70580f0213e6796…) → per-family VAEs; z-image
    // ships its own ae.safetensors (byte-identical to the FLUX.1 AE — see flux1-dev note: one file
    // serves flux1 + z-image, no vae/ collision). Official template widgets live-checked:
    // UNet z_image_turbo_bf16, ModelSamplingAuraFlow shift 3.0 sampling 'flow',
    // EmptySD3LatentImage 1024×1024, KSampler 8 steps / cfg 1.0 / res_multistep / simple /
    // denoise 1. VERIFY §6 live QA still owns anything the builder does not encode (distilled
    // CFG-1 turbo — no guidance node).
    comfy: {
      diffusion_model: 'z_image_turbo_bf16.safetensors',
      text_encoders: ['qwen_3_4b_fp8_mixed.safetensors'],
      clip_type: 'lumina2',
      vae: 'ae.safetensors',
    },
    download: {
      // Comfy-Org/z_image_turbo serves this exact single-file packaging open (HTTP 200
      // unauthenticated, verified 2026-10-11). Upstream Tongyi-MAI/Z-Image-Turbo is NOT gated
      // (checked 2026-10-11) but ships the diffusers layout (transformer/, vae/…), not these
      // ComfyUI loader basenames — the repack is the download-relevant host.
      huggingface_url: 'https://huggingface.co/Comfy-Org/z_image_turbo',
      targets: ['diffusion_models', 'text_encoders', 'vae'],
      comfyui_subfolders: [
        'diffusion_models/z_image_turbo_bf16.safetensors',
        'text_encoders/qwen_3_4b_fp8_mixed.safetensors',
        'vae/ae.safetensors',
      ],
    },
  },
  {
    id: 'flux2-klein',
    label: 'FLUX.2 Klein',
    family: 'flux',
    license: 'Apache-2.0',
    commercial_ok: true,
    backend: 'comfyui',
    role: 'draft',
    approx_size_gb: 13,
    min_vram_gb: 16,
    steps: 4,
    guidance: 0,
    default_size: { width: 768, height: 768 },
    strengths: 'Alternative draft — 4 steps.',
    // VERIFY §6 (upgraded, checked 2026-10-11): official black-forest-labs/FLUX.2-klein is gated (HTTP
    // 401 unauthenticated) and NO open Comfy-Org klein repack matches this template (HF searches for
    // flux2_klein_bf16 / mistral_3_small_fp8_scaled: zero hits). The open Comfy-Org klein support repos
    // (vae-text-encorder-for-flux-klein-4b/-9b) package klein differently — flux-2-klein-4b.safetensors
    // with qwen_3_4b/qwen_3_8b text encoders (NOT mistral_3_small) + flux2-vae.safetensors; the VAE name
    // is verified there and adopted below. UNet/TE re-anchoring = different TE family ⇒ template-shape
    // change (CLIPLoader type + tests) needing its own verified design — DOWNLOAD-LATER: verify-first.
    comfy: {
      diffusion_model: 'flux2_klein_bf16.safetensors',
      text_encoders: ['mistral_3_small_fp8_scaled.safetensors'],
      clip_type: 'flux2',
      vae: 'flux2-vae.safetensors',
    },
    download: {
      huggingface_url: 'https://huggingface.co/black-forest-labs/FLUX.2-klein',
      targets: ['diffusion_models', 'text_encoders', 'vae'],
      comfyui_subfolders: [
        'diffusion_models/flux2_klein_bf16.safetensors',
        'text_encoders/mistral_3_small_fp8_scaled.safetensors',
        'vae/flux2-vae.safetensors',
      ],
    },
  },
  {
    id: 'qwen-image-2',
    label: 'Qwen-Image 2',
    family: 'qwen-image',
    license: 'Apache-2.0',
    commercial_ok: true,
    backend: 'comfyui',
    role: 'final',
    approx_size_gb: 18,
    min_vram_gb: 24,
    steps: 20,
    guidance: 4,
    default_size: { width: 1024, height: 1024 },
    strengths: 'Best text-in-image; native 2K finals.',
    // Filenames VERIFIED 2026-10-11 vs Comfy-Org/Qwen-Image_ComfyUI (HF API listing): the Dec-2025
    // Qwen-Image 2.0-era single-file packaging is qwen_image_2512_{bf16,fp8_e4m3fn}; originals are gated
    // at Qwen/Qwen-Image-2 (HTTP 401 unauthenticated) — download URL points at the open Comfy-Org repack.
    // VERIFY §6 live QA still owns the CLIPLoader-type question (may gain a qwen_image_2 variant).
    // clip_type 'qwen_image' CONFIRMED LIVE 2026-10-11: present verbatim in the operator's ComfyUI
    // Desktop /object_info/CLIPLoader type enum. Deferred: Qwen-Image-2.1 (Comfy-Org/Qwen-Image-2.1 — new qwen3vl_8b/qwen3.5 TE family and its own
    // qwen_image_2.1_vae_bf16) is a template-shape change — follow-up design round, not migrated tonight.
    comfy: {
      diffusion_model: 'qwen_image_2512_fp8_e4m3fn.safetensors',
      text_encoders: ['qwen_2.5_vl_7b_fp8_scaled.safetensors'],
      clip_type: 'qwen_image',
      vae: 'qwen_image_vae.safetensors',
    },
    download: {
      huggingface_url: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI',
      targets: ['diffusion_models', 'text_encoders', 'vae'],
      comfyui_subfolders: [
        'diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors',
        'text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors',
        'vae/qwen_image_vae.safetensors',
      ],
    },
  },
  {
    // Non-commercial output license — UI surfaces must badge it.
    id: 'flux1-dev',
    label: 'FLUX.1 dev',
    family: 'flux',
    license: 'FLUX dev (non-commercial)',
    commercial_ok: false,
    backend: 'comfyui',
    role: 'final',
    approx_size_gb: 12,
    min_vram_gb: 24,
    steps: 20,
    guidance: 3.5,
    default_size: { width: 1024, height: 1024 },
    strengths: '12B quality sweet spot; huge LoRA ecosystem.',
    // Filenames VERIFIED 2026-10-11 (HF API listings, all open): flux1-dev-fp8.safetensors (ComfyUI
    // checkpoint packaging incl. the two TEs) at Comfy-Org/flux1-dev; clip_l + t5xxl_fp16 at
    // comfyanonymous/flux_text_encoders; ae.safetensors round-2 (2026-10-11): the round-1 citation
    // (black-forest-labs/FLUX.1-schnell) is NOT actually open — schnell is gated:auto and its tree
    // ships diffusers vae/… (no root ae.safetensors). FLUX.1 AE bytes (335,304,388 B, sha256
    // afc8e28272cd15db…) verified hosted open at realung/flux1-dev.safetensors; that sha is
    // BYTE-IDENTICAL to z-image-turbo's ae.safetensors (Comfy-Org/z_image_turbo) → models/vae/
    // ae.safetensors serves flux1-dev + z-image-turbo — one shared file, NO content collision
    // (basename kept: ComfyUI templates reference the loader basename). DualCLIPLoader type 'flux'
    // also present in the live ComfyUI Desktop enum 2026-10-11. Original
    // black-forest-labs/FLUX.1-dev is license-gated ("gated":"auto") — download URL points at the repack.
    comfy: {
      diffusion_model: 'flux1-dev-fp8.safetensors',
      text_encoders: ['clip_l.safetensors', 't5xxl_fp16.safetensors'],
      clip_type: 'flux',
      vae: 'ae.safetensors',
    },
    download: {
      huggingface_url: 'https://huggingface.co/Comfy-Org/flux1-dev',
      targets: ['diffusion_models', 'text_encoders', 'vae'],
      comfyui_subfolders: [
        'diffusion_models/flux1-dev-fp8.safetensors',
        'text_encoders/clip_l.safetensors',
        'text_encoders/t5xxl_fp16.safetensors',
        'vae/ae.safetensors',
      ],
    },
  },
  {
    // Non-commercial output license — UI surfaces must badge it.
    id: 'flux2-dev',
    label: 'FLUX.2 dev',
    family: 'flux',
    license: 'FLUX dev (non-commercial)',
    commercial_ok: false,
    backend: 'comfyui',
    role: 'final',
    approx_size_gb: 32,
    min_vram_gb: 32,
    steps: 24,
    guidance: 4,
    default_size: { width: 1536, height: 1536 },
    strengths: 'Max quality (32B) — tight on a 32 GB card.',
    // Filenames VERIFIED 2026-10-11 vs Comfy-Org/flux2-dev (HF API listing): UNet is flux2_dev_fp8mixed;
    // text encoders are the mistral_3_small_flux2 family (bf16 / fp4_mixed / fp8 — the earlier
    // "Mistral-3 24B _fp8_scaled" claim has no hosted counterpart and is retired); VAE is flux2-vae
    // (hyphen). Original black-forest-labs/FLUX.2-dev is license-gated — download URL points at the repack.
    // clip_type 'flux2' CONFIRMED LIVE 2026-10-11: present verbatim in the operator's ComfyUI
    // Desktop /object_info/CLIPLoader type enum. VERIFY §6 live QA still owns node wiring (single CLIPLoader entry for the TE).
    comfy: {
      diffusion_model: 'flux2_dev_fp8mixed.safetensors',
      text_encoders: ['mistral_3_small_flux2_fp8.safetensors'],
      clip_type: 'flux2',
      vae: 'flux2-vae.safetensors',
    },
    download: {
      huggingface_url: 'https://huggingface.co/Comfy-Org/flux2-dev',
      targets: ['diffusion_models', 'text_encoders', 'vae'],
      comfyui_subfolders: [
        'diffusion_models/flux2_dev_fp8mixed.safetensors',
        'text_encoders/mistral_3_small_flux2_fp8.safetensors',
        'vae/flux2-vae.safetensors',
      ],
    },
  },
  // sdxl is a §2.2 "(v3)" candidate — not in the v1 catalog (plan §6 v1 scope:
  // klein/flux dev entries present and flagged optional; sdxl joins with v3).
]

/** All-Apache default pairing — commercial-safe out of the box (plan §2.2). */
export const DEFAULT_DRAFT_MODEL = 'z-image-turbo'
export const DEFAULT_FINAL_MODEL = 'qwen-image-2'

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'] as const
export const MAX_IMAGES_PER_CALL = 4
/** Catalog ids in order — actionable-error text and dropdowns derive from this. */
export const IMAGE_MODEL_IDS = IMAGE_MODEL_CATALOG.map((m) => m.id) as string[]

export function findModelEntry(modelId: string): ModelCatalogEntry | undefined {
  const id = modelId.trim().toLowerCase()
  if (!id) return undefined
  return IMAGE_MODEL_CATALOG.find((m) => m.id === id)
}

export function resolveModelForPreset(
  preset: ImagePreset,
  draftModel?: string,
  finalModel?: string,
): string {
  const fallback = preset === 'draft' ? DEFAULT_DRAFT_MODEL : DEFAULT_FINAL_MODEL
  const configured = preset === 'draft' ? draftModel : finalModel
  return findModelEntry(configured ?? fallback)?.id ?? fallback
}

// --- §2 request resolution (used by the §3 tools and the §5 route; builders stay defensive) ---

/** Latents require dimensions divisible by 8; snap to the nearest multiple (min 64px). */
export function roundToMultiple8(n: number): number {
  return Math.max(64, Math.round(n / 8) * 8)
}

const ASPECT_RATIOS_LIST = ASPECT_RATIOS as readonly string[]

function ratioParts(aspect: AspectRatio): { rw: number; rh: number } {
  const [rw, rh] = aspect.split(':').map(Number)
  if (!rw || !rh) throw new Error(`bad aspect "${aspect}"`)
  return { rw, rh }
}

/**
 * Concrete px for a model + preset + aspect: long side = 768 for drafts (plan §2.2),
 * the model's default_size long side for finals; short side keeps the aspect and
 * snaps to a multiple of 8. Returns rounded ints — never wider than the long side.
 */
export function sizeForAspect(
  entry: ModelCatalogEntry,
  aspect: AspectRatio,
  preset: ImagePreset,
): { width: number; height: number } {
  const { rw, rh } = ratioParts(aspect)
  const longSide =
    preset === 'draft' ? Math.min(768, Math.max(entry.default_size.width, entry.default_size.height)) : Math.max(entry.default_size.width, entry.default_size.height)
  return rw >= rh
    ? { width: longSide, height: roundToMultiple8((longSide * rh) / rw) }
    : { width: roundToMultiple8((longSide * rw) / rh), height: longSide }
}

/** Nearest known aspect label for given dims (record params display; defaults to '1:1'). */
export function nearestAspectLabel(width: number, height: number): AspectRatio {
  const r = width / Math.max(1, height)
  let best: AspectRatio = '1:1'
  let bestErr = Number.POSITIVE_INFINITY
  for (const a of ASPECT_RATIOS_LIST) {
    const { rw, rh } = ratioParts(a as AspectRatio)
    const err = Math.abs(r - rw / rh)
    if (err < bestErr) {
      bestErr = err
      best = a as AspectRatio
    }
  }
  return best
}

/** What tools/route accept before resolution — strings stay raw (resolved + validated here). */
export interface GenRequestInput {
  prompt: string
  /** 'draft' | 'final' | a catalog model id (§3.1: preset doubles as a model picker). */
  preset?: string
  /** Explicit catalog id — wins over a model id passed via preset. */
  model?: string
  negative_prompt?: string
  aspect?: string
  width?: number
  height?: number
  steps?: number
  guidance?: number
  seed?: number
  sampler?: string
  count?: number
  save?: boolean
  tags?: string[]
  from_record?: string
}

export interface GenResolutionOpts {
  /** From ImagegenConfig.draft_model / final_model (config lands at §2.7/§8 step 5). */
  draft_model?: string
  final_model?: string
}

/** Number from raw input with range check; integer=true rounds to an int (steps/count). */
function requireNumberInRange(
  value: number | undefined,
  name: string,
  min: number,
  max: number,
  fallback: number,
  integer = false,
): number {
  if (value === undefined || value === null) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${String(value)}").`)
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max} (got ${n}).`)
  return integer ? Math.round(n) : n
}

/**
 * Fill a GenRequest from raw input + config: preset → model → catalog entry →
 * steps/guidance/seed/size, count clamped to 1–4, save defaults true.
 * Errors are plain actionable Errors at this layer (no network involved).
 */
export function resolveGenRequest(input: GenRequestInput, opts: GenResolutionOpts = {}): GenRequest {
  const prompt = (input.prompt ?? '').trim()
  if (!prompt)
    throw new Error(
      'prompt is required — describe what to depict, e.g. "a red bicycle leaning on a wet brick wall at dusk".',
    )

  const presetRaw = (input.preset ?? '').trim().toLowerCase()
  const presetAsModel = presetRaw ? findModelEntry(presetRaw) : undefined
  const explicitModel = input.model ? findModelEntry(input.model) : undefined
  const model = explicitModel?.id ?? presetAsModel?.id

  let modelId: string
  let preset: ImagePreset
  if (model) {
    const chosen = explicitModel ?? presetAsModel!
    modelId = chosen.id
    // Explicit model + a real preset word → honor both; explicit model alone → its own role preset.
    const explicitPreset = presetRaw && !presetAsModel && (presetRaw === 'draft' || presetRaw === 'final')
    preset = explicitPreset ? (presetRaw as ImagePreset) : chosen.role === 'draft' ? 'draft' : 'final'
  } else {
    preset = presetRaw === 'draft' || presetRaw === 'final' ? (presetRaw as ImagePreset) : 'final'
    if (presetRaw && presetRaw !== 'draft' && presetRaw !== 'final')
      throw new Error(
        `preset must be 'draft', 'final', or a catalog model id (${IMAGE_MODEL_CATALOG.map((m) => m.id).join(', ')}) — got "${presetRaw}".`,
      )
    modelId = resolveModelForPreset(preset, opts.draft_model, opts.final_model)
  }

  const entry = findModelEntry(modelId)
  if (!entry)
    throw new Error(
      `Unknown image model "${modelId}" — sylo-image-gen catalog: ${IMAGE_MODEL_CATALOG.map((m) => m.id).join(', ')}.`,
    )

  // Size: explicit dims win (snapped to multiples of 8); a single missing side is
  // derived from the derived pair's ratio; otherwise aspect-derived defaults.
  const aspect: AspectRatio = ASPECT_RATIOS_LIST.includes(input.aspect ?? '')
    ? (input.aspect as AspectRatio)
    : '1:1'
  const derived = sizeForAspect(entry, aspect, preset)
  const r = derived.height / derived.width
  const width = input.width !== undefined
    ? roundToMultiple8(input.width)
    : input.height !== undefined
      ? roundToMultiple8(input.height / r)
      : derived.width
  const height = input.height !== undefined
    ? roundToMultiple8(input.height)
    : input.width !== undefined
      ? roundToMultiple8(input.width * r)
      : derived.height

  const steps = requireNumberInRange(input.steps, 'steps', 1, 100, entry.steps, true)
  const guidance = requireNumberInRange(input.guidance, 'guidance', 0, 30, entry.guidance)
  const count = requireNumberInRange(input.count, 'count', 1, MAX_IMAGES_PER_CALL, 1, true)
  const seed =
    input.seed !== undefined && Number.isFinite(Number(input.seed)) && Number(input.seed) >= 0
      ? Math.floor(Number(input.seed))
      : randomInt(0, 2 ** 31)

  const negative = (input.negative_prompt ?? '').trim() || undefined
  return {
    prompt,
    negative_prompt: negative,
    model: modelId,
    preset,
    width,
    height,
    steps,
    guidance,
    seed,
    sampler: (input.sampler ?? '').trim() || undefined,
    aspect: input.width !== undefined && input.height !== undefined && aspect === '1:1'
      ? nearestAspectLabel(width, height)
      : aspect,
    count,
    save: input.save ?? true,
    tags: input.tags?.map((t) => t.trim()).filter(Boolean),
    from_record: (input.from_record ?? '').trim() || undefined,
  }
}