/**
 * Preset → ComfyUI API-format workflow builders (plan §2.4). Builders are per
 * model family (z-image / flux / qwen-image), core nodes only, with
 * SaveImage `filename_prefix: 'sylo/<preset>'` kept so ComfyUI embeds the full
 * prompt/workflow into the PNG (free provenance; our library index is separate).
 * No Python — pure TS maps; client.ts submits them via POST /prompt.
 *
 * Required core node set (all ship with stock ComfyUI; ModelSamplingAuraFlow live-verified in the
 * operator's ComfyUI Desktop /object_info 2026-10-11; client.comfyValidateWorkflowNodes checks
 * these against GET /object_info at runtime when ComfyUI is reachable — doctor
 * validates before the first submit, guards against version drift):
 *   UNETLoader, ModelSamplingAuraFlow (z-image), CLIPLoader, DualCLIPLoader, VAELoader,
 *   CLIPTextEncode, FluxGuidance, EmptySD3LatentImage,
 *   KSampler, VAEDecode, SaveImage.
 *
 * Graph shape per family (API-format = node-id map; ids grouped loader=1–3 (+ z-image
 * model-sampling at 4), conditioning=10–12, per-image branch i = 20+i latent / 30+i sampler /
 * 40+i decode / 50+i save; execution order follows ascending ids so output files are
 * saved in seed order — client maps seeds to fetched files on that):
 *   z-image:    UNETLoader → ModelSamplingAuraFlow(shift 3.0, sampling 'flow') →
 *               CLIPLoader(type lumina2 — live ComfyUI Desktop enum 2026-10-11 has NO 'z_image'
 *               type; matches the official Desktop Z-Image-Turbo template) → CLIPTextEncode ×2 →
 *               EmptySD3LatentImage → KSampler(cfg 1, turbo distilled → no
 *               FluxGuidance, negative text unused but encoded harmlessly) →
 *               VAEDecode → SaveImage
 *   flux:       UNETLoader → CLIPLoader/DualCLIPLoader(type per entry) →
 *               CLIPTextEncode ×2 → [FluxGuidance on positive when guidance>0;
 *               KSampler cfg 1 (flow-matching, no negative guidance)] →
 *               EmptySD3LatentImage → KSampler → VAEDecode → SaveImage
 *   qwen-image: CLIPLoader(type qwen_image) → CLIPTextEncode ×2 (real negative
 *               prompt honored) → EmptySD3LatentImage → KSampler(cfg = guidance)
 *               → VAEDecode → SaveImage
 * count > 1 = N KSampler seeds in one submit (plan §2.4): branch i samples
 * seed = req.seed + i; N SaveImage nodes batch the run into a single prompt_id.
 */
import type { GenRequest, ModelCatalogEntry } from '../types.ts'
import { findModelEntry, MAX_IMAGES_PER_CALL, IMAGE_MODEL_IDS } from '../models.ts'

/** One API-format node. */
export interface ComfyApiNode {
  class_type: string
  inputs: Record<string, unknown>
}

/** API-format prompt graph: node-id (string) → node — the POST /prompt `prompt` body. */
export type ComfyApiGraph = Record<string, ComfyApiNode>

/** Per-family sampler/scheduler defaults (core templates; VERIFY §6 lives on).
 *  z-image constants match the official Desktop Z-Image-Turbo template round-2 checked
 *  2026-10-11 (screenshot evidence): KSampler res_multistep + simple scheduler, and the
 *  flow is re-timed by ModelSamplingAuraFlow shift 3.0 sampling 'flow' (node wired below).
 *  Round-1's euler choice predated that template evidence and is corrected here. */
const FAMILY_SAMPLING: Record<string, { sampler: string; scheduler: string }> = {
  'z-image': { sampler: 'res_multistep', scheduler: 'simple' },
  flux: { sampler: 'euler', scheduler: 'simple' },
  'qwen-image': { sampler: 'euler', scheduler: 'simple' },
}

export interface WorkflowSampling {
  steps: number
  cfg: number
  /** Effective guidance as configured (0 for distilled/graphs without guidance). */
  guidance: number
  sampler: string
  scheduler: string
  /** Present ⇒ a FluxGuidance node carries this value (flux family with guidance > 0). */
  fluxGuidance?: number
}

/**
 * Applied sampling knobs for a model + request — shared by the builders (KSampler
 * inputs) and client.comfyGenerate (GenOutput.meta must mirror what was built).
 */
export function samplingFor(entry: ModelCatalogEntry, req: GenRequest): WorkflowSampling {
  const steps = requireInt(req.steps ?? entry.steps, 'steps')
  const sampler = (req.sampler ?? '').trim() || FAMILY_SAMPLING[entry.family]?.sampler || 'euler'
  const scheduler = FAMILY_SAMPLING[entry.family]?.scheduler ?? 'simple'
  const guidance = (req.guidance ?? entry.guidance) as number

  if (entry.family === 'flux') {
    // Flow-matching + distilled dev graphs run cfg 1; guidance rides FluxGuidance.
    const out: WorkflowSampling = { steps, cfg: 1, guidance: entry.guidance, sampler, scheduler }
    if (entry.guidance > 0) out.fluxGuidance = guidance
    return out
  }
  if (entry.family === 'qwen-image') {
    // Qwen honors a real negative prompt: KSampler cfg = guidance.
    return { steps, cfg: guidance > 0 ? guidance : 1, guidance, sampler, scheduler }
  }
  // z-image turbo is distilled: cfg pinned to 1; negative is inert by design.
  return { steps, cfg: 1, guidance: guidance > 0 ? 1 : 0, sampler, scheduler }
}

function requireInt(value: unknown, name: string): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(
      `${name} must be a positive integer (got "${String(value)}") — resolve the request through models.resolveGenRequest first.`,
    )
  return n
}

function requireSeed(value: unknown): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 32 - 1)
    throw new Error(`seed must be a non-negative integer below 2^32 (got "${String(value)}").`)
  return n
}

function requireDims(req: GenRequest): { width: number; height: number } {
  const width = Math.round(req.width)
  const height = Math.round(req.height)
  if (!(width >= 64 && height >= 64) || !(Number.isInteger(width) && Number.isInteger(height)) || width % 8 !== 0 || height % 8 !== 0)
    throw new Error(
      `width/height must be integers ≥ 64 and multiples of 8 (got ${req.width}×${req.height}) — resolve through models.resolveGenRequest.`,
    )
  return { width, height }
}

/** Catalog entry for a family-scoped builder; throws actionable when req.model is out of family. */
function entryForFamily(req: GenRequest, family: string): ModelCatalogEntry {
  const entry = findModelEntry(req.model)
  if (!entry)
    throw new Error(`Unknown image model "${req.model}" — sylo-image-gen catalog: ${IMAGE_MODEL_IDS.join(', ')}.`)
  if (entry.family !== family)
    throw new Error(
      `Model "${entry.id}" is a ${entry.family} model — this builder expects the ${family} family.`,
    )
  return entry
}

/** Single shared graph skeleton; knobs and guidance-node presence vary per entry/family. */
function buildFamilyGraph(entry: ModelCatalogEntry, req: GenRequest, family: string): ComfyApiGraph {
  if (typeof req.prompt !== 'string' || !req.prompt.trim())
    throw new Error(
      'prompt is required — describe what to depict, e.g. "a red bicycle leaning on a wet brick wall at dusk".',
    )
  const count = Math.round(Number(req.count))
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGES_PER_CALL)
    throw new Error(`count must be between 1 and ${MAX_IMAGES_PER_CALL} (got "${String(req.count)}").`)
  const baseSeed = requireSeed(req.seed)
  const { width, height } = requireDims(req)
  const sampling = samplingFor(entry, req)

  const graph: ComfyApiGraph = {}
  const node = (id: string, classType: string, inputs: Record<string, unknown>): void => {
    if (graph[id]) throw new Error(`workflow node id ${id} is already taken — builder bug`)
    graph[id] = { class_type: classType, inputs }
  }

  // Loaders (1–3) file names come from the catalog's comfy wiring (VERIFY §6).
  const comfy = entry.comfy
  node('1', 'UNETLoader', {
    unet_name: comfy.diffusion_model,
    weight_dtype: 'default',
  })
  if (comfy.text_encoders.length === 2) {
    node('2', 'DualCLIPLoader', {
      clip_name1: comfy.text_encoders[0],
      clip_name2: comfy.text_encoders[1],
      type: comfy.clip_type,
      device: 'default',
    })
  } else {
    node('2', 'CLIPLoader', {
      clip_name: comfy.text_encoders[0],
      type: comfy.clip_type,
      device: 'default',
    })
  }
  node('3', 'VAELoader', { vae_name: comfy.vae })

  // Model-sampling stage: z-image only (official Desktop template 2026-10-11 — ModelSamplingAuraFlow
  // shift 3.0, sampling 'flow'; flux/qwen templates carry no such node).
  let modelRef: [string, number] = ['1', 0]
  if (family === 'z-image') {
    node('4', 'ModelSamplingAuraFlow', { model: ['1', 0], shift: 3.0, sampling: 'flow' })
    modelRef = ['4', 0]
  }

  // Conditioning (10–12). Negative text is inert on cfg-1 graphs (z-image/flux),
  // honored on qwen-image; encoded always — harmless and keeps one graph shape.
  node('10', 'CLIPTextEncode', { text: req.prompt, clip: ['2', 0] })
  node('11', 'CLIPTextEncode', { text: req.negative_prompt ?? '', clip: ['2', 0] })
  let positiveRef: [string, number] = ['10', 0]
  if (sampling.fluxGuidance !== undefined) {
    node('12', 'FluxGuidance', { guidance: sampling.fluxGuidance, conditioning: ['10', 0] })
    positiveRef = ['12', 0]
  }

  // Per-image branch i: latent → KSampler(seed+i) → VAEDecode → SaveImage.
  for (let i = 0; i < count; i++) {
    const latentId = `20${i}`
    const samplerId = `30${i}`
    const decodeId = `40${i}`
    const saveId = `50${i}`
    node(latentId, 'EmptySD3LatentImage', { width, height, batch_size: 1 })
    node(samplerId, 'KSampler', {
      seed: baseSeed + i,
      steps: sampling.steps,
      cfg: sampling.cfg,
      sampler_name: sampling.sampler,
      scheduler: sampling.scheduler,
      denoise: 1,
      model: modelRef,
      positive: positiveRef,
      negative: ['11', 0],
      latent_image: [latentId, 0],
    })
    node(decodeId, 'VAEDecode', { samples: [samplerId, 0], vae: ['3', 0] })
    node(saveId, 'SaveImage', {
      images: [decodeId, 0],
      filename_prefix: `sylo/${req.preset}`,
    })
  }

  return graph
}

export function buildZImageWorkflow(req: GenRequest, entryRef?: ModelCatalogEntry): Record<string, unknown> {
  const entry = entryRef ?? entryForFamily(req, 'z-image')
  if (entry.family !== 'z-image') throw new Error(`Model "${entry.id}" is not a z-image model.`)
  return buildFamilyGraph(entry, req, entry.family)
}

/** FLUX.1 dev / FLUX.2 klein/dev share one graph shape; knobs differ by model entry. */
export function buildFluxWorkflow(req: GenRequest, entryRef?: ModelCatalogEntry): Record<string, unknown> {
  const entry = entryRef ?? entryForFamily(req, 'flux')
  if (entry.family !== 'flux') throw new Error(`Model "${entry.id}" is not a flux-family model.`)
  return buildFamilyGraph(entry, req, entry.family)
}

export function buildQwenImageWorkflow(req: GenRequest, entryRef?: ModelCatalogEntry): Record<string, unknown> {
  const entry = entryRef ?? entryForFamily(req, 'qwen-image')
  if (entry.family !== 'qwen-image') throw new Error(`Model "${entry.id}" is not a qwen-image model.`)
  return buildFamilyGraph(entry, req, entry.family)
}

/** Dispatch on the catalog model's family. count>1 = N seeds in one submit. */
export function buildWorkflowForModel(modelId: string, req: GenRequest): Record<string, unknown> {
  const entry = findModelEntry(modelId)
  if (!entry)
    throw new Error(
      `Unknown image model "${modelId}" — sylo-image-gen catalog: ${IMAGE_MODEL_IDS.join(', ')}.`,
    )
  switch (entry.family) {
    case 'flux':
      return buildFluxWorkflow(req, entry)
    case 'qwen-image':
      return buildQwenImageWorkflow(req, entry)
    case 'z-image':
      return buildZImageWorkflow(req, entry)
    default:
      // Unreachable while the catalog only ships the three families above.
      throw new Error(`Model "${entry.id}" has family "${entry.family}" — no workflow builder for it.`)
  }
}