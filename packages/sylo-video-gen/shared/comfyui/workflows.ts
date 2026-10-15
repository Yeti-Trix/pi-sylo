/**
 * Preset → ComfyUI API-format workflow builders for video (plan §2.4–§2.6).
 * Builders are per MODE-VARIANT (t2v / i2v / flf2v / v2v), compose ONLY from
 * the catalog's `comfy` wiring (paths live there, verified against the official
 * ComfyUI workflow templates 0.11.78 shipped inside ComfyUI 0.39.2 + the live
 * /object_info), take explicit params, validate the 4n+1 latent rule, and
 * return the graph plus the expected output shape — no hidden mutation, no
 * workflow JSON snapshots hardcoded (imagegen precedent).
 *
 * Verified node set (all native in ComfyUI 0.39.2 — /object_info 976-class sweep
 * + the operator's template files, 2026-10-12): UNETLoader, LoraLoaderModelOnly,
 * ModelSamplingSD3, CLIPLoader (type 'wan'), CLIPTextEncode, VAELoader,
 * Wan22ImageToVideoLatent (5B ti2v — start_image OPTIONAL ⇒ t2v passes none),
 * EmptyHunyuanLatentVideo (A14B t2v), WanImageToVideo (A14B i2v — conditioning
 * rides its OUTPUTS), WanFirstLastFrameToVideo (loop — conditioning rides its
 * outputs), WanVaceToVideo (restyle; strength knob; conditioning rides its
 * outputs), KSampler, KSamplerAdvanced, VAEDecode, ImageFromBatch, CreateVideo,
 * SaveVideo (COMFY_DYNAMICCOMBO_V3 format/codec), SaveImage, LoadImage,
 * LoadVideo, GetVideoComponents, FrameInterpolate + FrameInterpolationModelLoader
 * (optional, OFF by default — the loader's model_name COMBO ships EMPTY;
 * RIFE/FILM is download-or-downgrade, tracker VERIFY). NOT present and NOT
 * used: ImageSelector (§0 sweep — confirmed absent at build time).
 *
 * Loop trim level (reviewer §8.4 note, source-verified): TrimVideoLatent trims
 * FROM THE START (comfy_extras/nodes_wan.py: `s1[:, :, trim_amount:]`) and any
 * latent trim quantizes in 4-pixel-frame decode steps (21 latent → 81 pixels,
 * 20 → 77) — it cannot yield the §2.5-table exact 80-frame output for a 5 s @16
 * loop. The duplicated-final-frame cut therefore happens POST-DECODE at image
 * level: ImageFromBatch(batch_index 0, length frames−1) — pixel-exact, keeps
 * the poster (f0) and the conditioned start frame. The reviewer's latent-level
 * alternative saves ~1% sampler work at the cost of duration exactness —
 * deviation recorded in the tracker.
 *
 * Graph node ids allocate sequentially per build; tests assert by node CLASS +
 * wiring, not literal ids.
 */
import type { VideoGenRequest } from '../types.ts'
import {
  DEFAULT_VIDEO_FORMAT,
  findVideoModelEntry,
  resolutionPxFor,
  VIDEO_MODEL_IDS,
  workflowVariantFor,
  type VideoModelCatalogEntry,
  type VideoComfyVariant,
  type WorkflowVariant,
} from '../catalog.ts'

/** One API-format node. */
export interface ComfyApiNode {
  class_type: string
  inputs: Record<string, unknown>
}

/** API-format prompt graph: node-id (string) → node — the POST /prompt `prompt` body. */
export type ComfyApiGraph = Record<string, ComfyApiNode>

/**
 * SaveVideo dynamic-combo inputs (§0 reviewer protocol): the /prompt API format
 * takes FLAT string keys for the COMFY_DYNAMICCOMBO_V3 options — confirmed by
 * (a) the executor's dynamic-path re-nesting (comfy_api/latest/_io.py
 * build_nested_inputs + execution.py "restructure inputs to expected nested
 * dict"), (b) the official templates' widget tuples (["video/…", "auto", "auto"]),
 * and (c) the LIVE shape-probe run with the queue EMPTY at build time (result
 * recorded in workflows.test.mjs + the tracker VERIFY row). format 'mp4' +
 * codec 'h264' is the locked v1 pair.
 */
export const SAVE_VIDEO_FORMAT = DEFAULT_VIDEO_FORMAT
export const SAVE_VIDEO_CODEC = 'h264'

/**
 * The official Wan shipped-default negative prompt — the COMMON string, byte-identical
 * across the official ComfyUI workflow templates (`comfyui_workflow_templates_json` package
 * shipped inside ComfyUI): video_wan2_2_5B_ti2v.json, video_wan2_2_14B_i2v.json and
 * video_wan2_2_14B_flf2v.json all contain exactly this. Known template variants: the t2v
 * template (video_wan2_2_14B_t2v.json) adds the extra tail "，裸露，NSFW"; the VACE v2v
 * template drops the leading 色调艳丽， and Wan2.1's flf2v carries a trailing ",过曝，".
 * § 2 review round (2026-10-12): the previous short "…整体低画质，闪烁，糟糕的画质" string
 * matched NO shipped template — replaced byte-verbatim from the flf2v/i2v variant.
 */
export const DEFAULT_WAN_NEGATIVE_PROMPT =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走'

/**
 * Loop motion_strength → ModelSamplingSD3 shift (§2.5 mapping, semantics VERIFY):
 * linear between the official templates' two verified anchors — fp16 base 8,
 * lightx2v 4-step 5 — so strength 1 → 5, strength 0 → 8, 0.5 → 6.5. Which
 * direction reads as "subtler" gets its first-render VERIFY (one number flips:
 * the curve is the documented surface, not a magic constant).
 */
export function loopShiftForMotionStrength(motionStrength: number | undefined): number {
  const s = Math.min(1, Math.max(0, motionStrength ?? 0.5))
  return Math.round((8 - 3 * s) * 100) / 100
}

/**
 * Restyle motion_strength → WanVaceToVideo.strength (§2.4(3) mapping, VERIFY
 * calibration): linear from a 0.2 floor — 0 → 0.2, 0.5 → 0.6, 1 → 1.0. The
 * floor keeps the source structure from fully dissolving; documented in the
 * catalog entry's notes.
 */
export function vaceStrengthForMotionStrength(motionStrength: number | undefined): number {
  const s = Math.min(1, Math.max(0, motionStrength ?? 0.5))
  return Math.round((0.2 + 0.8 * s) * 100) / 100
}

export interface WorkflowSampling {
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  /** ModelSamplingSD3 shift as wired (loop: motion-strength curve; else the variant's). */
  shift: number
  /** true ⇒ A14B-style two-stage high/low-noise KSamplerAdvanced pair. */
  two_stage: boolean
}

/**
 * Applied sampling knobs for a model + variant — shared by the builders (KSampler
 * inputs) and client.comfyGenerateVideo (ComfyVideoMeta must mirror what was built).
 */
export function videoSamplingFor(
  entry: VideoModelCatalogEntry,
  variant: WorkflowVariant,
  overrides: { loop_motion_strength?: number } = {},
): WorkflowSampling {
  const wired = entry.comfy?.variants?.[variant]
  if (!wired)
    throw new Error(
      `Model "${entry.id}" has no ${variant} wiring — cannot derive sampling knobs (catalog §2.2; run sylo_video_gen_doctor).`,
    )
  return {
    steps: wired.steps ?? entry.steps,
    cfg: wired.cfg ?? entry.cfg,
    sampler: wired.sampler ?? entry.sampler,
    scheduler: wired.scheduler ?? entry.scheduler,
    shift: variant === 'flf2v' ? loopShiftForMotionStrength(overrides.loop_motion_strength) : wired.sampling_shift,
    two_stage: wired.diffusion_models.length === 2,
  }
}

/** Expected output shape of a built graph — the store/route derive records from it (§2.4). */
export interface WorkflowExpected {
  variant: WorkflowVariant
  /** SaveVideo container as wired (locked mp4 — the VERIFY row re-anchors on first render). */
  video_format: typeof SAVE_VIDEO_FORMAT
  codec: string
  fps: number
  /** Conditioning length (4n+1: 65/81/129/97/121/193). */
  latent_length: number
  /** Frames CreateVideo receives — loop trims the duplicated final frame (−1). */
  final_frame_count: number
  /** Effective output length in seconds (final_frame_count / fps). */
  final_duration_seconds: number
  width: number
  height: number
  poster_ext: 'png'
}

export interface BuiltWorkflow {
  workflow: ComfyApiGraph
  expected: WorkflowExpected
  /** Builder notes (downgrades, mapping documentation). */
  notes: string[]
}

export interface VideoWorkflowContext {
  /** ComfyUI input-dir ref for the source still (comfyUploadFile result) — required for i2v/flf2v. */
  sourceImageRef?: string
  /** ComfyUI input-dir ref for the restyle control clip — required for v2v. */
  sourceVideoRef?: string
  /**
   * Optional frame interpolation for loops (§2.4) — OFF by default: the
   * FrameInterpolationModelLoader COMBO ships EMPTY on 0.39.2 (no models in
   * `frame_interpolation/`); the doctor reports the pack (download-or-downgrade).
   * When passed although the pack is empty, the submit 400s at the loader —
   * gate call sites on comfyDoctorProbe(...).frame_interpolation.available.
   */
  interpolation?: { model_name: string; multiplier?: number }
}

type NodeMaker = (classType: string, inputs: Record<string, unknown>) => string

interface GraphBuilder {
  graph: ComfyApiGraph
  node: NodeMaker
}

/** Sequential id allocator — read by tests via the returned node handles only. */
function makeGraph(): GraphBuilder {
  const graph: ComfyApiGraph = {}
  let nextId = 1
  const node: NodeMaker = (classType, inputs) => {
    const id = String(nextId++)
    if (graph[id]) throw new Error(`workflow node id ${id} already taken — builder bug`)
    graph[id] = { class_type: classType, inputs }
    return id
  }
  return { graph, node }
}

/** Deterministic node order in the emitted graph (readable diffs + stable save order). */
function sortGraph(graph: ComfyApiGraph): ComfyApiGraph {
  const out: ComfyApiGraph = {}
  for (const id of Object.keys(graph).sort((a, b) => Number(a) - Number(b))) out[id] = graph[id]
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function positiveInt(value: unknown, name: string): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${name} must be a positive integer (got "${String(value)}") — resolve the request through catalog.resolveVideoGenRequest first.`)
  return n
}

function seedFor(value: number | undefined): number {
  const n = Math.floor(Number(value))
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 32 - 1)
    throw new Error(`seed must be a non-negative integer below 2^32 (got "${String(value)}") — resolve the request first.`)
  return n
}

/** Dims quantization the variant's latent node requires (5B ti2v latent = 32-step; 8×8-VAE nodes = 16). */
function latentStepFor(latentNode: string): number {
  return latentNode === 'Wan22ImageToVideoLatent' ? 32 : 16
}

/**
 * Where each latent-conditioning node exposes its LATENT output (and whether
 * the sampler's pos/neg must come from the node's outputs instead of the raw
 * encodes) — node output layouts, /object_info + template verified 2026-10-12:
 *   Wan22ImageToVideoLatent → (latent) — latent output slot 0;
 *   EmptyHunyuanLatentVideo → (latent) — slot 0;
 *   WanImageToVideo → (pos, neg, latent) — latent slot 2, sampling POS/NEG from node;
 *   WanFirstLastFrameToVideo → (pos, neg, latent) — latent slot 2, POS/NEG from node;
 *   WanVaceToVideo → (pos, neg, latent, trim_latent INT) — latent slot 2, POS/NEG from node.
 * Getting the slot wrong silent-400s at /prompt validation (slot types mismatch) —
 * this map is the single place the layouts are encoded.
 */
export const LATENT_OUTPUT_SLOTS: Record<string, { latent: number; carries_conditioning: boolean }> = {
  Wan22ImageToVideoLatent: { latent: 0, carries_conditioning: false },
  EmptyHunyuanLatentVideo: { latent: 0, carries_conditioning: false },
  WanImageToVideo: { latent: 2, carries_conditioning: true },
  WanFirstLastFrameToVideo: { latent: 2, carries_conditioning: true },
  WanVaceToVideo: { latent: 2, carries_conditioning: true },
}

function validateDims(latentNode: string, width: number, height: number): void {
  const step = latentStepFor(latentNode)
  if (width % step !== 0 || height % step !== 0)
    throw new Error(
      `${latentNode} requires width/height as multiples of ${step} (got ${width}×${height}) — resolve through catalog.resolutionPxFor (the catalog pairs already comply).`,
    )
}

/** Every builder asserts the 4n+1 rule before emitting a single node (§2.5). */
function validate4n1(req: Pick<VideoGenRequest, 'frame_count' | 'framerate'>, variant: WorkflowVariant): void {
  if (!Number.isInteger(req.frame_count) || req.frame_count < 1 || (req.frame_count - 1) % 4 !== 0)
    throw new Error(
      `frame_count ${req.frame_count} is not 4n+1 (§2.5 table: ${req.framerate} fps → ${[4, 5, 8].map((d) => `${d} s ${d * req.framerate + 1}`).join(' / ')}) — resolve through the catalog.`,
    )
  if (variant === 'flf2v' && req.frame_count < 17)
    throw new Error(`loop latent length ${req.frame_count} is too short to loop meaningfully (minimum 17 frames ≈ 1 s @16 fps).`)
}

/** Wiring for the request's variant; rejects opt-in/unwired models with a plain-language error. */
export function wiredVariantFor(req: VideoGenRequest, entry: VideoModelCatalogEntry): VideoComfyVariant {
  const variant = workflowVariantFor({ mode: req.mode, source_image: req.source_image_id ?? req.source_image_path ?? '' })
  const wired = entry.comfy?.variants?.[variant]
  if (!wired)
    throw new Error(
      entry.mode_roles.length === 0
        ? `Model "${entry.id}" is opt-in-only (${entry.license_badge}) and has NO ${variant} wiring in v1 (§2.2) — keep the Apache default pairing (wan22-ti2v-5b / wan22-a14b / wan21-vace-14b), or wire it in a follow-up.`
        : `Model "${entry.id}" has no ${variant} wiring for the ${req.mode} mode (catalog mode_roles: ${entry.mode_roles.join(' | ') || 'none'}) — pick a mode-appropriate model; run sylo_video_gen_doctor.`,
    )
  if (variant === 'v2v' && entry.role !== 'restyle')
    throw new Error(`Model "${entry.id}" cannot serve restyle (VACE-only) — catalog mode_roles: ${entry.mode_roles.join(' | ')}.`)
  return wired
}

/**
 * Minimal 1-source SaveVideo probe — the §0 reviewer protocol's live shape
 * probe: EmptyImage 16×16 → CreateVideo(fps 16) → SaveVideo. Runs in
 * milliseconds GPU-free, so a queue-empty probe costs the operator nothing
 * (NEVER interrupt/kill; never touch /free). `nested` true emits the dict-form
 * alternative shape so the probe can A/B the two serializations on live
 * ComfyUI; the accepted one is the LOCKED shape.
 */
export function buildDynamicComboProbeWorkflow(options: { nested?: boolean; format?: string; codec?: string } = {}): ComfyApiGraph {
  const formatValue = options.format ?? SAVE_VIDEO_FORMAT
  const codecValue = options.codec ?? SAVE_VIDEO_CODEC
  const graph: ComfyApiGraph = {}
  graph['1'] = { class_type: 'EmptyImage', inputs: { width: 16, height: 16, batch_size: 1, color: 0 } }
  graph['2'] = { class_type: 'CreateVideo', inputs: { images: ['1', 0], fps: 16 } }
  // Flat shape (default): format + codec as plain string inputs. Nested shape: the dict-form
  // alternative the executor's build_nested_inputs also understands.
  graph['3'] = {
    class_type: 'SaveVideo',
    inputs: options.nested
      ? {
          video: ['2', 0],
          filename_prefix: 'sylo-video/probe',
          format: { format: formatValue, codec: { codec: codecValue } },
        }
      : {
          video: ['2', 0],
          filename_prefix: 'sylo-video/probe',
          format: formatValue,
          codec: codecValue,
        },
  }
  return graph
}

/** Conditioning chain shared by every graph: CLIPLoader(wan) → encode(prompt) + encode(negative). */
function buildConditioning(
  node: NodeMaker,
  entry: VideoModelCatalogEntry,
  req: Pick<VideoGenRequest, 'prompt' | 'negative_prompt'>,
): { clipRef: string; posRef: string; negRef: string } {
  if (typeof req.prompt !== 'string' || !req.prompt.trim())
    throw new Error('prompt is required — describe the shot, e.g. "slow dolly through a neon-lit rainy street at night".')
  const clipRef = node('CLIPLoader', { clip_name: entry.comfy.text_encoders[0], type: entry.comfy.clip_type })
  const posRef = node('CLIPTextEncode', { text: req.prompt, clip: [clipRef, 0] })
  const negRef = node('CLIPTextEncode', { text: req.negative_prompt?.trim() || DEFAULT_WAN_NEGATIVE_PROMPT, clip: [clipRef, 0] })
  return { clipRef, posRef, negRef }
}

/** DiT loader chain: DiT(s) → (lightx2v LoRA ×N on two-stage) → ModelSamplingSD3 (one end per stage). */
function buildModelChain(node: NodeMaker, entry: VideoModelCatalogEntry, wired: VideoComfyVariant, shift: number): string[] {
  const modelRefs = wired.diffusion_models.map((f) => node('UNETLoader', { unet_name: f.file, weight_dtype: f.weight_dtype ?? 'default' }))
  if (wired.loras) {
    if (wired.loras.length !== wired.diffusion_models.length)
      throw new Error(
        `Catalog wiring error: ${entry.id} / ${wired.latent_node} carries ${wired.diffusion_models.length} DiT(s) but ${wired.loras.length} LoRA(s) — counts must match (high/low pairs). Fix the catalog (§2.2).`,
      )
    const withLora = modelRefs.map((m, i) => node('LoraLoaderModelOnly', { lora_name: wired.loras![i], strength_model: 1.0, model: [m, 0] }))
    // Two-stage graphs keep ONE shift (the templates wire identical shifts per stage).
    return withLora.map((m) => node('ModelSamplingSD3', { shift, model: [m, 0] }))
  }
  return [node('ModelSamplingSD3', { shift, model: [modelRefs[0]!, 0] })]
}

/** Single-stage KSampler branch (5B draft / VACE restyle) — decoded frames out. */
function sampleSingleStage(
  node: NodeMaker,
  chainEnd: string,
  posTarget: [string, number],
  negTarget: [string, number],
  latentTarget: [string, number],
  wired: VideoComfyVariant,
  seed: number,
  vaeRef: string,
): string {
  const samp = node('KSampler', {
    seed,
    steps: wired.steps ?? 20,
    cfg: wired.cfg ?? 5,
    sampler_name: wired.sampler ?? 'uni_pc',
    scheduler: wired.scheduler ?? 'simple',
    denoise: 1,
    model: [chainEnd, 0],
    positive: posTarget,
    negative: negTarget,
    latent_image: latentTarget,
  })
  return node('VAEDecode', { samples: [samp, 0], vae: [vaeRef, 0] })
}

/**
 * Two-stage high/low-noise pair (A14B, template-verified): high stage denoises
 * steps 0–split with add_noise 'enable' + leftover ON (hands the partial latent
 * to stage 2), low stage split–steps with add_noise 'disable'. Split = ceil/2
 * (4 steps → 2/2).
 */
function sampleTwoStage(
  node: NodeMaker,
  chainEnds: string[],
  posTarget: [string, number],
  negTarget: [string, number],
  latentTarget: [string, number],
  wired: VideoComfyVariant,
  seed: number,
  vaeRef: string,
): string {
  const steps = wired.steps ?? 4
  const split = Math.ceil(steps / 2)
  const sampHigh = node('KSamplerAdvanced', {
    model: [chainEnds[0]!, 0],
    positive: posTarget,
    negative: negTarget,
    latent_image: latentTarget,
    add_noise: 'enable',
    noise_seed: seed,
    steps,
    cfg: wired.cfg ?? 1,
    sampler_name: wired.sampler ?? 'euler',
    scheduler: wired.scheduler ?? 'simple',
    start_at_step: 0,
    end_at_step: split,
    return_with_leftover_noise: 'enable',
  })
  const sampLow = node('KSamplerAdvanced', {
    model: [chainEnds[1]!, 0],
    positive: posTarget,
    negative: negTarget,
    latent_image: [sampHigh, 0],
    add_noise: 'disable',
    noise_seed: 0,
    steps,
    cfg: wired.cfg ?? 1,
    sampler_name: wired.sampler ?? 'euler',
    scheduler: wired.scheduler ?? 'simple',
    start_at_step: split,
    end_at_step: steps,
    return_with_leftover_noise: 'disable',
  })
  return node('VAEDecode', { samples: [sampLow, 0], vae: [vaeRef, 0] })
}

/** Output tail: first-frame poster PNG (in-graph, §2.4(4)) + CreateVideo + SaveVideo. */
function buildOutputTail(
  node: NodeMaker,
  frameSourceRef: string,
  opts: { fps: number; prefix: string; finalFrames?: number; videoFramesRef?: [string, number] },
): { videoSaveId: string; posterSaveId: string } {
  // Poster = decoded frame 0 (pre-trim — the still as rendered), §2.4(4): no ffmpeg in v1.
  const posterFrameRef = node('ImageFromBatch', { image: [frameSourceRef, 0], batch_index: 0, length: 1 })
  const posterSaveId = node('SaveImage', { images: [posterFrameRef, 0], filename_prefix: 'sylo-video/poster' })
  // videoFramesRef = an already-built frames source (loop: post-trim + post-interpolation);
  // finalFrames = the tail itself cuts the last frame (loop duplicate) in one place.
  const clipFrameRef: [string, number] = opts.videoFramesRef
    ? opts.videoFramesRef
    : opts.finalFrames !== undefined
      ? [node('ImageFromBatch', { image: [frameSourceRef, 0], batch_index: 0, length: opts.finalFrames }), 0]
      : [frameSourceRef, 0]
  const videoRef = node('CreateVideo', { images: clipFrameRef, fps: opts.fps })
  const videoSaveId = node('SaveVideo', {
    video: [videoRef, 0],
    filename_prefix: opts.prefix,
    // Dynamic-combo shape LOCKED flat (see SAVE_VIDEO_FORMAT note + the live probe record).
    format: SAVE_VIDEO_FORMAT,
    codec: SAVE_VIDEO_CODEC,
  })
  return { videoSaveId, posterSaveId }
}

/**
 * Draft/final clip t2v + i2v — Wan 2.2 (§2.4(1)): 5B single-stage fp16 for drafts,
 * A14B two-stage fp8+lightx2v for finals; i2v when a source still is present,
 * t2v otherwise (the 5B's ti2v conditioning node takes start_image OPTIONAL —
 * the same graph shape serves both, matching the official ti2v template).
 * count 1–2 = per-branch latent/sampler/decode/tail in ONE submit; seeds ascend.
 */
export function buildClipWorkflow(req: VideoGenRequest, entryInput?: VideoModelCatalogEntry, context: VideoWorkflowContext = {}): BuiltWorkflow {
  const entry = entryInput ?? findVideoModelEntry(req.model)
  if (!entry) throw new Error(`Unknown video model "${req.model}" — sylo-video-gen catalog: ${VIDEO_MODEL_IDS.join(', ')}.`)
  const variant = workflowVariantFor({ mode: req.mode, source_image: req.source_image_id ?? req.source_image_path ?? '' })
  if (variant === 'flf2v') return buildLoopWorkflow(req, entry, context)
  if (variant === 'v2v') return buildRestyleWorkflow(req, entry, context)
  if (variant !== 't2v' && variant !== 'i2v')
    throw new Error(`clip builder: resolved variant "${variant}" is not a clip variant — builder/catalog drift.`)
  const wired = wiredVariantFor({ ...req, mode: 'clip' }, entry)

  const count = Math.min(2, Math.max(1, Math.round(Number(req.count) || 1)))
  const baseSeed = seedFor(req.seed)
  const px = resolutionPxFor(entry, req.resolution, req.orientation)
  validateDims(wired.latent_node, px.width, px.height)
  validate4n1(req, variant)
  const notes: string[] = []
  const stillRef = (context.sourceImageRef ?? '').trim()
  if (variant === 'i2v' && !stillRef)
    throw new Error('i2v needs the source still inside ComfyUI first — the tool uploads it (comfyUploadFile) and passes sourceImageRef; a missing ref is a build-order bug.')
  if (variant === 't2v' && stillRef)
    notes.push('sourceImageRef provided but NOT wired — the request resolved to t2v (no source still on the request).')

  const { graph, node } = makeGraph()
  const shift = wired.sampling_shift
  const chainEnds = buildModelChain(node, entry, wired, shift)
  const { posRef, negRef } = buildConditioning(node, entry, req)
  const vaeRef = node('VAELoader', { vae_name: wired.vae })

  // The shared LoadImage (i2v) is created before the branches so both reference one upload.
  const stillNode = variant === 'i2v' ? node('LoadImage', { image: stillRef }) : undefined

  for (let i = 0; i < count; i++) {
    const latentInputs: Record<string, unknown> = { width: px.width, height: px.height, length: req.frame_count, batch_size: 1 }
    let posTarget: [string, number] = [posRef, 0]
    let negTarget: [string, number] = [negRef, 0]
    switch (wired.latent_node) {
      case 'Wan22ImageToVideoLatent':
        // t2v passes NO start_image (ti2v treats an empty start_image as pure t2v — template parity).
        latentInputs.vae = [vaeRef, 0]
        if (variant === 'i2v') latentInputs.start_image = [stillNode!, 0]
        break
      case 'EmptyHunyuanLatentVideo':
        // Unconditional empty latent (A14B t2v) — conditioning stays on the raw encodes.
        break
      case 'WanImageToVideo': {
        // Conditional node: pos/neg/latent all come FROM it (template-verified A14B i2v).
        if (variant !== 'i2v')
          throw new Error(`Builder/catalog drift: ${wired.latent_node} requested for a t2v clip (A14B t2v uses EmptyHunyuanLatentVideo).`)
        latentInputs.positive = [posRef, 0]
        latentInputs.negative = [negRef, 0]
        latentInputs.vae = [vaeRef, 0]
        latentInputs.start_image = [stillNode!, 0]
        break
      }
      default:
        throw new Error(`Unsupported clip latent node "${wired.latent_node}" — the builders cover Wan22ImageToVideoLatent / EmptyHunyuanLatentVideo / WanImageToVideo (§2.4).`)
    }
    const latentRef = node(wired.latent_node, latentInputs)
    const layout = LATENT_OUTPUT_SLOTS[wired.latent_node]
    if (!layout) throw new Error(`Builder drift: unknown latent node "${wired.latent_node}" output layout — extend LATENT_OUTPUT_SLOTS (§2.4).`)
    if (layout.carries_conditioning) {
      // The sampler's conditioning comes from the node's outputs (0/1 = pos/neg with image wiring).
      posTarget = [latentRef, 0]
      negTarget = [latentRef, 1]
    }
    const latentTarget: [string, number] = [latentRef, layout.latent]
    const frameRef =
      wired.diffusion_models.length === 2
        ? sampleTwoStage(node, chainEnds, posTarget, negTarget, latentTarget, wired, baseSeed + i, vaeRef)
        : sampleSingleStage(node, chainEnds[0]!, posTarget, negTarget, latentTarget, wired, baseSeed + i, vaeRef)
    buildOutputTail(node, frameRef, { fps: req.framerate, prefix: 'sylo-video/clip' })
  }

  return {
    workflow: sortGraph(graph),
    expected: {
      variant,
      video_format: SAVE_VIDEO_FORMAT,
      codec: SAVE_VIDEO_CODEC,
      fps: req.framerate,
      latent_length: req.frame_count,
      final_frame_count: req.frame_count,
      final_duration_seconds: round2(req.frame_count / req.framerate),
      width: px.width,
      height: px.height,
      poster_ext: 'png',
    },
    notes,
  }
}

/**
 * Living-photo loop (§2.4(2) + §2.5): Wan 2.2 A14B + WanFirstLastFrameToVideo
 * with the SAME still at start_image + end_image → seamless loop; the decoded
 * final frame (the re-encoded still — the duplicate at the wrap point) is cut
 * post-decode by ImageFromBatch(batch_index 0, length frames−1) → exactly
 * frames−1 @ fps (5 s → 80 @16 = 5.0 s). Optional FrameInterpolate rides BETWEEN
 * the trim and CreateVideo when explicitly enabled (OFF by default — the
 * loader's model_name combo is empty until an interpolation model is installed;
 * the doctor reports download-or-downgrade). Poster = decoded frame 0 (the
 * source still as rendered). NO ImageSelector — it does not exist in 0.39.2.
 */
export function buildLoopWorkflow(req: VideoGenRequest, entryInput?: VideoModelCatalogEntry, context: VideoWorkflowContext = {}): BuiltWorkflow {
  const entry = entryInput ?? findVideoModelEntry(req.model)
  if (!entry) throw new Error(`Unknown video model "${req.model}" — sylo-video-gen catalog: ${VIDEO_MODEL_IDS.join(', ')}.`)
  if (req.mode !== 'loop') throw new Error(`buildLoopWorkflow expects a loop-mode request (got "${req.mode}") — resolve through the catalog.`)
  const wired = wiredVariantFor(req, entry)
  if (wired.latent_node !== 'WanFirstLastFrameToVideo')
    throw new Error(`Builder drift: the loop graph requires WanFirstLastFrameToVideo wiring (catalog got "${wired.latent_node}").`)
  const baseSeed = seedFor(req.seed)
  const px = resolutionPxFor(entry, req.resolution, req.orientation)
  validateDims(wired.latent_node, px.width, px.height)
  validate4n1(req, 'flf2v')
  const stillRef = (context.sourceImageRef ?? '').trim()
  if (!stillRef)
    throw new Error('loop needs the source still inside ComfyUI first — the tool uploads it (comfyUploadFile) and passes sourceImageRef; a missing ref is a build-order bug.')

  const { graph, node } = makeGraph()
  // Loop motion curve drives the shift (§2.5 mapping — documented, VERIFY).
  const shift = loopShiftForMotionStrength(req.loop_motion_strength)
  const chainEnds = buildModelChain(node, entry, wired, shift)
  const { posRef, negRef } = buildConditioning(node, entry, req)
  const vaeRef = node('VAELoader', { vae_name: wired.vae })
  const imgRef = node('LoadImage', { image: stillRef })
  // SAME still at first AND last position — the loop's core mechanic (§1/§2.4).
  const latent = node(wired.latent_node, {
    positive: [posRef, 0],
    negative: [negRef, 0],
    vae: [vaeRef, 0],
    width: px.width,
    height: px.height,
    length: req.frame_count,
    batch_size: 1,
    start_image: [imgRef, 0],
    end_image: [imgRef, 0],
  })

  // Latent slot 2 + conditioning from the flf node's outputs (LATENT_OUTPUT_SLOTS).
  const layout = LATENT_OUTPUT_SLOTS[wired.latent_node]
  if (!layout) throw new Error(`Builder drift: unknown latent node "${wired.latent_node}" output layout — extend LATENT_OUTPUT_SLOTS (§2.4).`)
  const frames = sampleTwoStage(node, chainEnds, [latent, 0], [latent, 1], [latent, layout.latent], wired, baseSeed, vaeRef)
  // NOTE: decode → trim → (interp) → CreateVideo → SaveVideo; poster from the pre-trim decode.

  // Trim the duplicated FINAL frame (latent level cannot hit the exact count — see header);
  // the POSTER stays pre-trim (frame 0 = the source still as rendered).
  const framesTrim = node('ImageFromBatch', { image: [frames, 0], batch_index: 0, length: req.frame_count - 1 })

  const notes: string[] = []
  let videoFramesRef: [string, number] = [framesTrim, 0]
  if (context.interpolation?.model_name) {
    const loader = node('FrameInterpolationModelLoader', { model_name: context.interpolation.model_name })
    const interp = node('FrameInterpolate', { interp_model: [loader, 0], images: [framesTrim, 0], multiplier: context.interpolation.multiplier ?? 2 })
    const multiplier = context.interpolation.multiplier ?? 2
    videoFramesRef = [interp, 0]
    notes.push(`FrameInterpolate ×${multiplier} (${context.interpolation.model_name}) — output fps effectively ${req.framerate}×${multiplier}; the recorded fps stays ${req.framerate} (poster is pre-interpolation).`)
  }
  buildOutputTail(node, frames, { fps: req.framerate, prefix: 'sylo-video/loop', videoFramesRef })

  return {
    workflow: sortGraph(graph),
    expected: {
      variant: 'flf2v',
      video_format: SAVE_VIDEO_FORMAT,
      codec: SAVE_VIDEO_CODEC,
      fps: req.framerate,
      latent_length: req.frame_count,
      final_frame_count: req.frame_count - 1,
      final_duration_seconds: round2((req.frame_count - 1) / req.framerate),
      width: px.width,
      height: px.height,
      poster_ext: 'png',
    },
    notes,
  }
}

/**
 * Whole-clip restyle v2v (§2.4(3)) — Wan 2.1 VACE 14B: source clip →
 * LoadVideo → GetVideoComponents → WanVaceToVideo control_video (whole-clip,
 * no mask/reference in v1); strength rides the documented motion-strength
 * curve; single-stage KSampler steps 20 / cfg 6 / uni_pc (the template's
 * defaults — CausVid acceleration is a v2 candidate, not bundled). Duration:
 * v1 uses the composer's 4/5/8 s (VACE pads/truncates the control frames to
 * `length`); "duration defaults to the source frame count" (§2.4) needs frame
 * counting = v2 ffmpeg-detect territory, recorded in the catalog VERIFY.
 */
export function buildRestyleWorkflow(req: VideoGenRequest, entryInput?: VideoModelCatalogEntry, context: VideoWorkflowContext = {}): BuiltWorkflow {
  const entry = entryInput ?? findVideoModelEntry(req.model)
  if (!entry) throw new Error(`Unknown video model "${req.model}" — sylo-video-gen catalog: ${VIDEO_MODEL_IDS.join(', ')}.`)
  if (req.mode !== 'restyle') throw new Error(`buildRestyleWorkflow expects a restyle-mode request (got "${req.mode}") — resolve through the catalog.`)
  const wired = wiredVariantFor(req, entry)
  if (wired.latent_node !== 'WanVaceToVideo')
    throw new Error(`Builder drift: the restyle graph requires WanVaceToVideo wiring (catalog got "${wired.latent_node}").`)
  if (wired.diffusion_models.length !== 1)
    throw new Error(`Builder drift: the VACE restyle graph is single-stage (got ${wired.diffusion_models.length} DiTs).`)
  if (wired.loras?.length)
    throw new Error('Builder drift: v1 restyle wires no LoRAs (CausVid is a v2 candidate) — the catalog must not carry any here.')
  const baseSeed = seedFor(req.seed)
  const px = resolutionPxFor(entry, req.resolution, req.orientation)
  validateDims(wired.latent_node, px.width, px.height)
  validate4n1(req, 'v2v')
  const videoRefSrc = (context.sourceVideoRef ?? '').trim()
  if (!videoRefSrc)
    throw new Error('restyle needs the source clip inside ComfyUI first — the tool uploads it (comfyUploadFile) and passes sourceVideoRef; a missing ref is a build-order bug.')

  const { graph, node } = makeGraph()
  const [unet] = wired.diffusion_models
  const unetRef = node('UNETLoader', { unet_name: unet!.file, weight_dtype: unet!.weight_dtype ?? 'fp8_e4m3fn' })
  const modelRef = node('ModelSamplingSD3', { shift: wired.sampling_shift, model: [unetRef, 0] })
  const { posRef, negRef } = buildConditioning(node, entry, req)
  const vaeRef = node('VAELoader', { vae_name: wired.vae })
  const srcVideo = node('LoadVideo', { file: videoRefSrc })
  const srcFrames = node('GetVideoComponents', { video: [srcVideo, 0] })
  const strength = vaceStrengthForMotionStrength(req.restyle_strength)
  const latent = node(wired.latent_node, {
    positive: [posRef, 0],
    negative: [negRef, 0],
    vae: [vaeRef, 0],
    width: px.width,
    height: px.height,
    length: req.frame_count,
    batch_size: 1,
    strength,
    control_video: [srcFrames, 0],
  })
  const samp = node('KSampler', {
    seed: baseSeed,
    steps: wired.steps ?? entry.steps,
    cfg: wired.cfg ?? entry.cfg,
    sampler_name: wired.sampler ?? entry.sampler,
    scheduler: wired.scheduler ?? entry.scheduler,
    denoise: 1,
    model: [modelRef, 0],
    positive: [latent, 0],
    negative: [latent, 1],
    latent_image: [latent, 2],
  })
  const frames = node('VAEDecode', { samples: [samp, 0], vae: [vaeRef, 0] })
  // Poster + CreateVideo + SaveVideo in one tail call (no trim for v2v — decoded length = 4n+1).
  buildOutputTail(node, frames, { fps: req.framerate, prefix: 'sylo-video/restyle' })

  return {
    workflow: sortGraph(graph),
    expected: {
      variant: 'v2v',
      video_format: SAVE_VIDEO_FORMAT,
      codec: SAVE_VIDEO_CODEC,
      fps: req.framerate,
      latent_length: req.frame_count,
      final_frame_count: req.frame_count,
      final_duration_seconds: round2(req.frame_count / req.framerate),
      width: px.width,
      height: px.height,
      poster_ext: 'png',
    },
    notes: [`VACE strength ${strength} = 0.2 + 0.8 × restyle_strength ${req.restyle_strength ?? 0.5} (documented curve, VERIFY at first render).`],
  }
}

/**
 * Dispatch on the request's mode → variant → catalog wiring. The single entry
 * point the client (comfyGenerateVideo) and the tools use; every variant
 * composition stays inside the builders above.
 */
export function buildWorkflowForRequest(
  req: VideoGenRequest,
  context: VideoWorkflowContext = {},
  entryInput?: VideoModelCatalogEntry,
): ComfyApiGraph {
  const entry = entryInput ?? findVideoModelEntry(req.model)
  if (!entry) throw new Error(`Unknown video model "${req.model}" — sylo-video-gen catalog: ${VIDEO_MODEL_IDS.join(', ')}.`)
  switch (req.mode) {
    case 'clip':
      return buildClipWorkflow(req, entry, context).workflow
    case 'loop':
      return buildLoopWorkflow(req, entry, context).workflow
    case 'restyle':
      return buildRestyleWorkflow(req, entry, context).workflow
    default: {
      const never: never = req.mode
      throw new Error(`No workflow builder for mode "${String(never)}" (catalog modes: clip | loop | restyle).`)
    }
  }
}