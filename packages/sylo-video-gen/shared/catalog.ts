/**
 * Video model catalog + draft/final/restyle presets + request/frame resolution
 * (plan §2.2/§2.4/§2.5, §8 step 2 = plan §2 + §8.2 pairing).
 *
 * Sizes/VRAM are honest byte-level figures from the live HF listings
 * (re-anchored 2026-10-12 vs Comfy-Org API; per-entry comments cite the paths).
 * `doctor` detects actual installs via ComfyUI /object_info instead of trusting
 * these. `comfy` loader wiring names the EXACT basenames the official ComfyUI
 * workflow templates ship (comfyui_workflow_templates 0.11.78 — the version the
 * operator's ComfyUI 0.39.2 reports), and the builders in comfyui/workflows.ts
 * compose graphs from this wiring only — no paths hardcoded there.
 *
 * ALL-LOCAL ONLY (§2.6): every download target is a HuggingFace repack the
 * operator pulls into their own ComfyUI model dirs; nothing is fetched at
 * generation time and nothing runs remotely.
 *
 * Excluded from the catalog entirely (see EXCLUDED_VIDEO_MODELS): MiniMax-H3
 * (license excludes US/EU), CogVideoX (commercial use needs permission),
 * anything proprietary/cloud (Sora).
 */
import type { VideoGenRequest, VideoMode, VideoOrientation, VideoPreset, VideoResolution } from './types.ts'

/** V1 modes (§1) — the composer's segmented control is this exact union. */
export const VIDEO_MODES = ['clip', 'loop', 'restyle'] as const
export const VIDEO_PRESETS = ['draft', 'final'] as const
export const VIDEO_RESOLUTIONS = ['480p', '720p'] as const
export const VIDEO_ORIENTATIONS = ['landscape', 'portrait'] as const
/** Composer durations (§2.1); every one × accepted fps lands on a 4n+1 frame count. */
export const VIDEO_DURATIONS_SECONDS = [4, 5, 8] as const
/** Clips cost minutes, not seconds (plan §2.1) — image-gen caps 4. */
export const MAX_VIDEOS_PER_CALL = 2

/** Which underlying conditioning graph a mode needs (§2.4 builders). */
export type WorkflowVariant = 't2v' | 'i2v' | 'flf2v' | 'v2v'
export type VideoRole = 'draft' | 'final' | 'restyle'

export interface VideoResolutionFrame {
  width: number
  height: number
}

/** One DiT file with its load-time cast (UNETLoader.weight_dtype). */
export interface VideoComfyFile {
  /** ComfyUI-model-dir-relative basename (diffusion_models/). */
  file: string
  /** UNETLoader weight_dtype — 'default' keeps the file's own precision. */
  weight_dtype?: string
  /** 'high' | 'low' noise stage for A14B two-stage graphs (§2.4 order high→low). */
  stage?: 'high' | 'low'
}

/** Loader wiring for ONE workflow variant (§2.4) — builders read only this. */
export interface VideoComfyVariant {
  /** Latent node that builds the (empty or image-conditioned) video latent. */
  latent_node: string
  diffusion_models: VideoComfyFile[]
  /** VAE basename (vae/). */
  vae: string
  /** lightx2v 4-step LoRAs in stage order high→low (strength 1.0, §2.4). */
  loras?: string[]
  /** ModelSamplingSD3 shift (templates: 5B fp16 → 8, A14B+lightx2v → 5, VACE fp8-load → 8). */
  sampling_shift: number
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  /** How the source still rides the conditioning node. */
  image_input?: 'start_image' | 'start_end_image'
  /** The source clip rides LoadVideo → GetVideoComponents → control_video. */
  video_input?: boolean
}

export interface VideoComfyWiring {
  /** CLIPLoader type for the umt5 text encoder — 'wan' (live /object_info enum 0.39.2). */
  clip_type: 'wan'
  /** Text-encoder basenames (text_encoders/). */
  text_encoders: string[]
  /**
   * Wiring per workflow variant. A model that has no wiring for a variant the
   * request needs is REJECTED BEFORE SUBMIT with a plain-language error
   * (opt-in models ship empty variants by design — they are not wired in v1).
   */
  variants: Partial<Record<WorkflowVariant, VideoComfyVariant>>
}

/** Guided-install data (Settings model table + doctor): HF card + expected paths. */
export interface VideoDownloadInfo {
  huggingface_url: string
  /** ComfyUI model dirs that must contain this entry's files. */
  targets: string[]
  /** Repo-tree paths as <repo dir>/<file> — doctor renders + detection hints. */
  repo_files: string[]
}

export interface VideoModelCatalogEntry {
  id: string
  label: string
  family: 'wan22' | 'wan21' | 'opt-in'
  license: string
  /** One-line badge every selectable surface must render (composer, Settings, doctor — §7). */
  license_badge: string
  commercial_ok: boolean
  backend: 'comfyui'
  role: VideoRole
  /** Which modes the model serves (§2.2 mode_roles) — composer's model dropdown is mode-aware. */
  mode_roles: VideoMode[]
  /** Decimal-GB disk total from the HF listing (GiB vs GB distinction lives in the doctor table). */
  approx_size_gb: number
  min_vram_gb: number
  default_framerate: number
  /** Accepted fps values; the composer offers these + the model default. */
  framerates: number[]
  resolutions: VideoResolution[]
  /** Concrete px per resolution/orientation — step-16-multiples the latent nodes require.
   *  Partial: models that don't support a resolution simply omit it (resolutionPxFor checks
   *  `resolutions` FIRST and errors plainly on unsupported pairs). */
  resolution_px: Partial<Record<VideoResolution, Record<VideoOrientation, VideoResolutionFrame>>>
  durations_seconds: number[]
  max_duration_seconds: number
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  strengths?: string
  comfy: VideoComfyWiring
  download?: VideoDownloadInfo
  notes?: string
  /** VERIFY comment carried into the type contract (first real render re-anchors). */
  verify?: string
}

// ── The three v1 models (§2.2) — Comfy-Org repacks, Apache-2.0, native nodes ──

export const VIDEO_MODEL_CATALOG: VideoModelCatalogEntry[] = [
  {
    id: 'wan22-ti2v-5b',
    label: 'Wan 2.2 ti2v 5B (draft)',
    family: 'wan22',
    license: 'Apache-2.0',
    license_badge: 'Apache-2.0 · commercial OK',
    commercial_ok: true,
    backend: 'comfyui',
    role: 'draft',
    mode_roles: ['clip'],
    // Disk total from HF listing (decimal GB): DiT fp16 10.00 + umt5 fp8 6.74 + wan2.2 VAE 1.41.
    approx_size_gb: 18.2,
    // Approximate (§2.2 VERIFY): 5B fp16 at 704p/121 frames on the 5090 — first render re-anchors.
    min_vram_gb: 16,
    default_framerate: 24,
    framerates: [24],
    resolutions: ['720p'],
    // The model's native pair comes from the official 5B ti2v template (1280×704) — NOT the
    // generic 720p table (§2.1). 704 is the Wan22-5B VAE's trained height for 16:9-class clips
    // and both dims are step-32 multiples (the latent node requires step 32).
    resolution_px: {
      '720p': { landscape: { width: 1280, height: 704 }, portrait: { width: 704, height: 1280 } },
    },
    durations_seconds: [4, 5, 8],
    max_duration_seconds: 8,
    steps: 20,
    cfg: 5,
    sampler: 'uni_pc',
    scheduler: 'simple',
    strengths: 'Draft clip (t2v + i2v) — tens of seconds on the 5090; 720p@24fps native.',
    // Template-verified (video_wan2_2_5B_ti2v, comfyui_workflow_templates 0.11.78): single fp16
    // DiT + ModelSamplingSD3 shift 8 + KSampler 20 steps / cfg 5 / uni_pc / simple, latent via
    // Wan22ImageToVideoLatent (start_image OPTIONAL → t2v passes none), VAE wan2.2 (16×16 spatial
    // — the 48-channel latent), CreateVideo fps 24 → SaveVideo.
    comfy: {
      clip_type: 'wan',
      text_encoders: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
      variants: {
        t2v: {
          latent_node: 'Wan22ImageToVideoLatent',
          diffusion_models: [{ file: 'wan2.2_ti2v_5B_fp16.safetensors' }],
          vae: 'wan2.2_vae.safetensors',
          sampling_shift: 8,
        },
        i2v: {
          latent_node: 'Wan22ImageToVideoLatent',
          diffusion_models: [{ file: 'wan2.2_ti2v_5B_fp16.safetensors' }],
          vae: 'wan2.2_vae.safetensors',
          sampling_shift: 8,
          image_input: 'start_image',
        },
      },
    },
    download: {
      // Repo verified open (HTTP 200 unauthenticated) 2026-10-12 — split_files tree exact:
      huggingface_url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
      targets: ['diffusion_models', 'text_encoders', 'vae'],
      repo_files: [
        'split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors',
        'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
        'split_files/vae/wan2.2_vae.safetensors',
      ],
    },
    verify:
      'min_vram 16 GB is an estimate until the first real draft render; 480p is NOT offered (model is 720p-native).',
  },
  {
    id: 'wan22-a14b',
    label: 'Wan 2.2 A14B (final)',
    family: 'wan22',
    license: 'Apache-2.0',
    license_badge: 'Apache-2.0 · commercial OK',
    commercial_ok: true,
    backend: 'comfyui',
    role: 'final',
    mode_roles: ['clip', 'loop'],
    // Disk (decimal GB, byte-verified per direction, fp8-TE math): DiT pair 2×14.29 +
    // lightx2v LoRAs 2×1.23 + umt5-xxl fp8 TE 6.74 (shared) + wan_2.1_vae 0.25 — ONE clip
    // direction ≈ 38.1 GB; BOTH clip directions on disk ≈ 69 GB. The plan's "~42 GB" figure
    // carried the umt5-fp16 TE math; the wiring ships the fp8 TE — doctor shows per-file truth.
    approx_size_gb: 38.1,
    // fp8_scaled DiTs + 4-step lightx2v LoRAs at 480p/720p (§2.2: fits 24 GB class; VERIFY).
    min_vram_gb: 24,
    default_framerate: 16,
    framerates: [16, 24],
    resolutions: ['480p', '720p'],
    resolution_px: {
      '480p': { landscape: { width: 832, height: 480 }, portrait: { width: 480, height: 832 } },
      '720p': { landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } },
    },
    durations_seconds: [4, 5, 8],
    max_duration_seconds: 8,
    steps: 4,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    strengths:
      'Final clip + living-photo loop — fp8 high/low-noise pair + lightx2v 4-step LoRA ≈ 1–2 min/clip on the 5090 (est., VERIFY).',
    // Template-verified (video_wan2_2_14B_t2v / _i2v / _flf2v, templates 0.11.78): TWO fp8_scaled
    // DiTs (high_noise → steps 0–2, low_noise → 2–4 of 4; KSamplerAdvanced ×2, euler/simple,
    // cfg 1) each behind LoraLoaderModelOnly (lightx2v, strength 1) + ModelSamplingSD3 shift 5;
    // VAE wan_2.1_vae (8×8 — the 16-channel latent). t2v latent = EmptyHunyuanLatentVideo;
    // i2v latent = WanImageToVideo (start_image); loop = WanFirstLastFrameToVideo (i2v DiTs).
    comfy: {
      clip_type: 'wan',
      text_encoders: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
      variants: {
        t2v: {
          latent_node: 'EmptyHunyuanLatentVideo',
          diffusion_models: [
            { file: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors', stage: 'high' },
            { file: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors', stage: 'low' },
          ],
          vae: 'wan_2.1_vae.safetensors',
          loras: [
            'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
            'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
          ],
          sampling_shift: 5,
        },
        i2v: {
          latent_node: 'WanImageToVideo',
          diffusion_models: [
            { file: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', stage: 'high' },
            { file: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', stage: 'low' },
          ],
          vae: 'wan_2.1_vae.safetensors',
          loras: [
            'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
            'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
          ],
          sampling_shift: 5,
          image_input: 'start_image',
        },
        // Loop = i2v DiTs/LoRAs + WanFirstLastFrameToVideo conditioning (same still first+last).
        flf2v: {
          latent_node: 'WanFirstLastFrameToVideo',
          diffusion_models: [
            { file: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', stage: 'high' },
            { file: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', stage: 'low' },
          ],
          vae: 'wan_2.1_vae.safetensors',
          loras: [
            'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
            'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
          ],
          sampling_shift: 5,
          image_input: 'start_end_image',
        },
      },
    },
    download: {
      huggingface_url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
      targets: ['diffusion_models', 'loras', 'text_encoders', 'vae'],
      repo_files: [
        'split_files/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
        'split_files/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
        'split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
        'split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
        'split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
        'split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
        'split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
        'split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
        'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
        'split_files/vae/wan_2.1_vae.safetensors',
      ],
    },
    verify:
      'approx_size_gb 38.1 = ONE clip direction (byte-verified: DiT pair 2×14.29 + LoRA pair 2×1.23 + umt5-fp8 TE 6.74 + VAE 0.25); downloading BOTH directions ≈ 69 GB. min_vram 24 vs the real render is a first-render VERIFY (§2.2).',
  },
  {
    id: 'wan21-vace-14b',
    label: 'Wan 2.1 VACE 14B (restyle)',
    family: 'wan21',
    license: 'Apache-2.0',
    license_badge: 'Apache-2.0 · commercial OK',
    commercial_ok: true,
    backend: 'comfyui',
    role: 'restyle',
    mode_roles: ['restyle'],
    // Disk (decimal GB, HF listing): VACE DiT ONLY ships fp16 (34.68) — the plan's "~20 GB fp8"
    // figure assumed an fp8 repack that does NOT exist in the official repo (deviation recorded);
    // we keep the official file and cast to fp8 at LOAD TIME (UNETLoader weight_dtype) for VRAM.
    // + umt5 fp8 6.74 + wan_2.1_vae 0.25 → ≈ 41.7 GB disk.
    approx_size_gb: 41.7,
    // fp8-load 14B at 480p ≈ 15–18 GB VRAM; 720p wants 24 GB class (template GPU table; VERIFY).
    min_vram_gb: 24,
    default_framerate: 16,
    framerates: [16],
    resolutions: ['480p', '720p'],
    resolution_px: {
      '480p': { landscape: { width: 832, height: 480 }, portrait: { width: 480, height: 832 } },
      '720p': { landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } },
    },
    durations_seconds: [4, 5, 8],
    max_duration_seconds: 8,
    steps: 20,
    cfg: 6,
    sampler: 'uni_pc',
    scheduler: 'simple',
    strengths: 'Whole-clip style transfer (VACE v2v, no mask in v1). The v2v template accelerates with CausVid — NOT bundled in v1 (steps stay 20/cfg 6; CausVid is a v2 candidate).',
    // Template-verified (video_wan_vace_14B_v2v, templates 0.11.78): single fp16 DiT loaded with
    // weight_dtype fp8_e4m3fn (VRAM cast) + ModelSamplingSD3 shift 8 + KSampler 20 steps / cfg 6 /
    // uni_pc / simple; source clip → LoadVideo → GetVideoComponents → WanVaceToVideo control_video
    // (strength knob + width/height/length). The template's TrimVideoLatent+reference_image path is
    // ref2v (v2) — the plain v2v chain needs no trim node. VAE wan_2.1_vae.
    comfy: {
      clip_type: 'wan',
      text_encoders: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
      variants: {
        v2v: {
          latent_node: 'WanVaceToVideo',
          diffusion_models: [{ file: 'wan2.1_vace_14B_fp16.safetensors', weight_dtype: 'fp8_e4m3fn' }],
          vae: 'wan_2.1_vae.safetensors',
          sampling_shift: 8,
          video_input: true,
        },
      },
    },
    download: {
      huggingface_url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
      targets: ['diffusion_models', 'text_encoders', 'vae'],
      repo_files: [
        'split_files/diffusion_models/wan2.1_vace_14B_fp16.safetensors',
        'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
        'split_files/vae/wan_2.1_vae.safetensors',
      ],
    },
    notes:
      'VACE strength semantics (motion_strength ↔ WanVaceToVideo.strength, node native 0.39.2 — mapping VERIFY at first real render): the catalog ships the LINEAR curve strength = 0.2 + 0.8 × strength_input, so 0 → 0.2 (loose interpretation), 0.5 → 0.6, 1 → 1.0 (exact motion preservation). One documented curve, chosen for honesty over magic: linear from a 0.2 floor so the source structure never fully disappears.',
    verify:
      'Restyle duration ignores the source clip frame count in v1 (counting frames needs an ffmpeg detect — the §2.4 "defaults to the source frame count" line is DEFERRED to v2 with the poster tool); the composer picks 4/5/8 s and VACE pads/truncates control frames.',
  },
  // ── Opt-in extras (§2.2): catalog-present, NOT wired in v1, badged, never default ──
  {
    id: 'ltx-2.5',
    label: 'LTX 2.5 (opt-in, not wired)',
    family: 'opt-in',
    license: 'LTX Open Weights (community, click-agree)',
    license_badge: 'community license · NON-COMMERCIAL · opt-in · not wired in v1',
    commercial_ok: false,
    backend: 'comfyui',
    role: 'draft',
    mode_roles: [],
    approx_size_gb: 0, // unknown until wired — honest 0 + notes (doctor shows "opt-in")
    min_vram_gb: 24,
    default_framerate: 25,
    framerates: [25, 50],
    resolutions: ['480p', '720p'],
    resolution_px: {
      '480p': { landscape: { width: 832, height: 480 }, portrait: { width: 480, height: 832 } },
      '720p': { landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } },
    },
    durations_seconds: [4, 5, 8],
    max_duration_seconds: 8,
    steps: 20,
    cfg: 3,
    sampler: 'euler',
    scheduler: 'simple',
    strengths: 'Long-clip experiments; FLUX-dev stance (models.ts:161+ twin): listed so the operator can see WHY it is not offered and what terms apply.',
    comfy: {
      clip_type: 'wan',
      text_encoders: [],
      variants: {}, // not wired in v1 (§2.2 opt-in) — builders reject with a plain-language error.
    },
    download: {
      // Verified 2026-10-12: open repo, 'license:other' — the LTX community license is click-agree.
      huggingface_url: 'https://huggingface.co/Lightricks/LTX-2',
      targets: [],
      repo_files: [],
    },
    notes: 'Opt-in only: requires the operator to explicitly accept the LTX community license AND a v2 wiring round (template + node classes + download targets). Accepting the id in config does NOT wire it.',
  },
  {
    id: 'hunyuanvideo-1.5',
    label: 'HunyuanVideo 1.5 (opt-in, not wired)',
    family: 'opt-in',
    license: 'Tencent Hunyuan community license',
    license_badge: 'community-gated · NON-COMMERCIAL · opt-in · not wired in v1',
    commercial_ok: false,
    backend: 'comfyui',
    role: 'draft',
    mode_roles: [],
    approx_size_gb: 0,
    min_vram_gb: 24,
    default_framerate: 24,
    framerates: [24],
    resolutions: ['480p', '720p'],
    resolution_px: {
      '480p': { landscape: { width: 832, height: 480 }, portrait: { width: 480, height: 832 } },
      '720p': { landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } },
    },
    durations_seconds: [4, 5, 8],
    max_duration_seconds: 8,
    steps: 30,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    strengths: 'Same opt-in-only + badge stance as LTX (§2.2).',
    comfy: {
      clip_type: 'wan',
      text_encoders: [],
      variants: {},
    },
    download: {
      // Verified 2026-10-12: tencent/HunyuanVideo-1.5 open listing, 'license:other' (Tencent terms).
      huggingface_url: 'https://huggingface.co/tencent/HunyuanVideo-1.5',
      targets: [],
      repo_files: [],
    },
    notes: 'Opt-in only: requires explicit operator acceptance of the Tencent community terms AND a v2 wiring round.',
  },
]

/**
 * License-absolute exclusions (§1/§2.2) — never in VIDEO_MODEL_CATALOG; the
 * doctor + README render these so an operator who heard of them elsewhere
 * understands why sylo-video-gen will not offer them.
 */
export interface ExcludedVideoModel {
  id: string
  label: string
  reason: string
}

export const EXCLUDED_VIDEO_MODELS: ExcludedVideoModel[] = [
  {
    id: 'minimax-h3',
    label: 'MiniMax H3',
    reason: 'Upstream license excludes the US and EU — a non-starter (§1 operator decision).',
  },
  {
    id: 'cogvideox',
    label: 'CogVideoX',
    reason: 'Commercial use requires prior written permission (§1) — incompatible with the all-models-commercial-safe catalog.',
  },
  {
    id: 'sora',
    label: 'Sora / closed cloud video models',
    reason: 'Anything proprietary or cloud-hosted is out of scope — all-local discipline (§2.6).',
  },
]

/** Catalog ids in order — actionable-error text and dropdowns derive from this. */
export const VIDEO_MODEL_IDS = VIDEO_MODEL_CATALOG.map((m) => m.id)

export function findVideoModelEntry(modelId: string | undefined | null): VideoModelCatalogEntry | undefined {
  const id = (modelId ?? '').trim().toLowerCase()
  if (!id) return undefined
  return VIDEO_MODEL_CATALOG.find((m) => m.id === id)
}

/** Default pairing — all-Apache, commercial-safe out of the box (§2.2). */
export const DEFAULT_DRAFT_VIDEO_MODEL = 'wan22-ti2v-5b'
export const DEFAULT_FINAL_VIDEO_MODEL = 'wan22-a14b'
export const DEFAULT_RESTYLE_VIDEO_MODEL = 'wan21-vace-14b'

/** SaveVideo container locked at §2 (mp4 + h264; webm stays a catalog-legal value). */
export const DEFAULT_VIDEO_FORMAT = 'mp4' as const

// ── §2.5 frame tables — duration × fps → the 4n+1 inclusive-frame counts ──
// Verified table (§0): 16 fps → 4 s 65, 5 s 81, 8 s 129; 24 fps → 97 / 121 / 193.
// d×fps is a multiple of 4 for every accepted (duration, fps) pair, so the
// nearest 4n+1 is always exact (+1 = the inclusive loop length).

/** Nearest frame count of form 4n+1 for a duration at fps (throws when not near-integral). */
export function framesForDuration(durationSeconds: number, framerate: number): number {
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(framerate) || framerate <= 0)
    throw new Error(`duration_seconds/framerate must be finite numbers (fps > 0) — got ${durationSeconds} s @ ${framerate} fps.`)
  const raw = durationSeconds * framerate
  const base = Math.round(raw / 4)
  const nearest = base * 4
  // More than a quarter frame off means the operator asked for something the 4n+1
  // latent rule cannot honor near-exactly — surface it instead of silently snapping.
  if (Math.abs(nearest - raw) > 0.25)
    throw new Error(
      `duration_seconds × framerate (${durationSeconds} × ${framerate} = ${raw} frames) is not near a 4n+1 — ` +
        `pass duration_seconds ${VIDEO_DURATIONS_SECONDS.join(' | ')}.`,
    )
  return nearest + 1
}

/** Loop semantics: the duplicated FINAL frame is cut post-decode → fps-divisible remainder. */
export function loopOutputFramesForDuration(durationSeconds: number, framerate: number): number {
  return framesForDuration(durationSeconds, framerate) - 1
}

export function assertFramesAre4n1(frames: number, what: string): void {
  if (!Number.isInteger(frames) || frames < 1 || (frames - 1) % 4 !== 0)
    throw new Error(`${what} frame count must be 4n+1 (65/81/129/97/121/193… for the §2.5 table) — got ${frames}.`)
}

/** Concrete px: resolution + orientation → the catalog pair for this model (checks `resolutions` first). */
export function resolutionPxFor(
  entry: VideoModelCatalogEntry,
  resolution: VideoResolution,
  orientation: VideoOrientation,
): VideoResolutionFrame {
  if (!entry.resolutions.includes(resolution))
    throw new Error(
      `${entry.id} does not support ${resolution} — supported: ${entry.resolutions.join(' | ')}.`,
    )
  const pair = entry.resolution_px[resolution]?.[orientation]
  if (!pair)
    throw new Error(
      `${entry.id} has no ${resolution} ${orientation} pixel pair in the catalog (§2.2) — resolution_px misses the supported combination; fix the catalog.`,
    )
  return { ...pair }
}

/** Variant a model + mode + request resolves to (i2v when a source still is present). */
export function workflowVariantFor(req: { mode: VideoMode; source_image?: string }): WorkflowVariant {
  if (req.mode === 'restyle') return 'v2v'
  if (req.mode === 'loop') return 'flf2v'
  return req.source_image ? 'i2v' : 't2v'
}

export interface VideoGenResolutionOpts {
  /** From VideogenConfig — preset pairing + composer defaults (§2.7). */
  draft_model?: string
  final_model?: string
  restyle_model?: string
  default_resolution?: VideoResolution
  default_orientation?: VideoOrientation
  default_duration_seconds?: number
  default_framerate?: number
  loop_motion_strength?: number
}

/** What tools/route accept before resolution — strings stay raw, resolved + validated here. */
export interface VideoGenRequestInput {
  prompt: string
  negative_prompt?: string
  mode?: string
  preset?: string
  model?: string
  resolution?: string
  orientation?: string
  duration_seconds?: number
  framerate?: number
  seed?: number
  loop_motion_strength?: number
  restyle_strength?: number
  count?: number
  save?: boolean
  tags?: string[]
  source_image_id?: string
  source_image_path?: string
  source_video_id?: string
  source_video_path?: string
  /** Tool-boundary cross-package alias (§3.5) — resolved into source_image_id. */
  from_image_id?: string
  from_video_id?: string
}

function num(value: unknown, name: string, min: number, max: number, fallback: number | undefined, integer = false): number | undefined {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${String(value)}").`)
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max} (got ${n}).`)
  return integer ? Math.round(n) : n
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, name: string): T {
  if (value === undefined || value === null || value === '') return fallback
  const v = value.trim().toLowerCase() as T
  if (!(allowed as readonly string[]).includes(v))
    throw new Error(`${name} "${value}" is not one of ${allowed.join(' | ')}.`)
  return v
}

/** Model for a mode + preset, honoring explicit ids and the config pairing (§2.2 mode-aware). */
export function resolveModelForRequest(
  mode: VideoMode,
  preset: VideoPreset,
  explicitModel: string | undefined,
  opts: VideoGenResolutionOpts,
): VideoModelCatalogEntry {
  const modeDefaultId =
    mode === 'restyle' ? opts.restyle_model : mode === 'loop' ? opts.final_model : preset === 'final' ? opts.final_model : opts.draft_model
  const entry = (explicitModel ? findVideoModelEntry(explicitModel) : undefined) ?? findVideoModelEntry(modeDefaultId)
  const fallbackId =
    mode === 'restyle' ? DEFAULT_RESTYLE_VIDEO_MODEL : mode === 'loop' || (mode === 'clip' && preset === 'final') ? DEFAULT_FINAL_VIDEO_MODEL : DEFAULT_DRAFT_VIDEO_MODEL
  const chosen = entry ?? findVideoModelEntry(fallbackId)!
  if (!chosen.mode_roles.includes(mode))
    throw new Error(
      `Model "${chosen.id}" does not serve the ${mode} mode (serves: ${chosen.mode_roles.join(' | ') || 'none — opt-in entry, not wired'}). ` +
        `Mode-appropriate models: ${VIDEO_MODEL_CATALOG.filter((m) => m.mode_roles.includes(mode)).map((m) => m.id).join(', ') || '(none in catalog)'}.`,
    )
  return chosen
}

/**
 * Fill a VideoGenRequest from raw tool/route input + config: mode → variant →
 * preset/model pairing → resolution px + duration → frames + seed + count.
 * Errors are plain actionable Errors (no network involved).
 */
export function resolveVideoGenRequest(
  input: VideoGenRequestInput,
  opts: VideoGenResolutionOpts = {},
  seedFn: () => number = () => Math.floor(Math.random() * 2 ** 31),
): VideoGenRequest {
  const prompt = (input.prompt ?? '').trim()
  if (!prompt && !input.source_image_path && !input.source_image_id)
    throw new Error(
      'prompt is required — describe the shot, e.g. "slow dolly through a neon-lit rainy street at night".',
    )
  const mode = oneOf(input.mode ?? 'clip', VIDEO_MODES, 'clip', 'mode')
  // Loop/restyle presets are 'final' (the loop graph runs on the A14B final model).
  const preset = mode === 'clip' ? oneOf(input.preset ?? 'draft', VIDEO_PRESETS, 'draft', 'preset') : 'final'
  const entry = resolveModelForRequest(mode, preset, input.model, opts)
  const variant = workflowVariantFor({ mode, source_image: input.source_image_path ?? input.from_image_id ?? input.source_image_id })
  if (mode === 'clip' && !entry.comfy.variants[variant])
    throw new Error(
      `Model "${entry.id}" has no ${variant} wiring (catalog §2.2) — this is a builder/catalog inconsistency, run sylo_video_gen_doctor.`,
    )

  const resolution = oneOf(
    input.resolution ?? opts.default_resolution ?? '720p',
    VIDEO_RESOLUTIONS,
    '720p',
    'resolution',
  )
  const orientation = oneOf(input.orientation ?? opts.default_orientation ?? 'landscape', VIDEO_ORIENTATIONS, 'landscape', 'orientation')
  const px = resolutionPxFor(entry, resolution, orientation)

  const duration = num(input.duration_seconds, 'duration_seconds', 1, entry.max_duration_seconds, opts.default_duration_seconds ?? 5, true)!
  if (!(VIDEO_DURATIONS_SECONDS as readonly number[]).includes(duration))
    throw new Error(`duration_seconds must be one of ${VIDEO_DURATIONS_SECONDS.join(' | ')} (got ${duration}).`)
  // 0 is the §2.7 "model default" sentinel — the request coerce (shared/types.ts)
  // emits it when the config default_framerate is 0 or the raw value is junk; map
  // it to the model default here. Other out-of-range explicit framerates stay errors.
  const framerateNum = num(
    input.framerate === 0 ? undefined : input.framerate,
    'framerate',
    1,
    60,
    (opts.default_framerate ?? 0) > 0 && entry.framerates.includes(opts.default_framerate ?? 0) ? opts.default_framerate : entry.default_framerate,
    true,
  )!
  if (!entry.framerates.includes(framerateNum))
    throw new Error(`framerate ${framerateNum} fps is not supported by ${entry.id} (accepted: ${entry.framerates.join(' | ')}).`)
  const frame_count = framesForDuration(duration, framerateNum)
  assertFramesAre4n1(frame_count, `${entry.id} ${duration} s @ ${framerateNum} fps`)

  // -1 is the shared-types coerceVideoGenRequest sentinel for an ABSENT seed (§2.1
  // seed? — route/UI raws may omit it) — map it to a fresh random like any absent
  // seed. Anything else outside 0..2³²−1 stays an actionable error (explicit -1
  // from a non-coerce caller is still invalid: use undefined/omission instead).
  const seed = num(input.seed === -1 ? undefined : input.seed, 'seed', 0, 2 ** 32 - 1, undefined, true) ?? seedFn()
  const count = num(input.count, 'count', 1, MAX_VIDEOS_PER_CALL, 1, true)!
  const loopStrengthInput = mode === 'loop' ? (num(input.loop_motion_strength, 'loop_motion_strength', 0, 1, opts.loop_motion_strength ?? 0.5) as number) : undefined
  const restyleStrength = mode === 'restyle' ? (num(input.restyle_strength, 'restyle_strength', 0, 1, 0.5) as number) : undefined

  const source_image_id = (input.source_image_id ?? input.from_image_id ?? '').trim() || undefined
  const source_image_path = (input.source_image_path ?? '').trim() || undefined
  if (mode === 'loop' && !source_image_id && !source_image_path)
    throw new Error('loop mode requires a source still — pass source_image_id (an image from the Images library) or source_image_path (a local file).')
  if (mode === 'restyle' && !input.source_video_path && !input.source_video_id)
    throw new Error('restyle mode requires a source clip — pass source_video_path (a local video file).')

  return {
    mode,
    prompt,
    negative_prompt: (input.negative_prompt ?? '').trim() || undefined,
    model: entry.id,
    preset,
    resolution,
    orientation,
    duration_seconds: duration,
    framerate: framerateNum,
    frame_count,
    seed,
    loop_motion_strength: loopStrengthInput,
    restyle_strength: restyleStrength,
    count,
    save: input.save ?? true,
    tags: input.tags?.map((t) => t.trim()).filter(Boolean),
    source_image_id,
    source_image_path,
    source_video_id: (input.source_video_id ?? '').trim() || undefined,
    source_video_path: (input.source_video_path ?? '').trim() || undefined,
    from_image_id: (input.from_image_id ?? '').trim() || undefined,
    from_video_id: (input.from_video_id ?? '').trim() || undefined,
  }
}