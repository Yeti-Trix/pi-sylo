// Unit tests for the sylo-image-gen workflow builders + request resolution
// (plan §2.2/§2.4, §8 step 2). Pure offline — no ComfyUI server involved.
// Run: npm run test:workflows (esbuild-bundles this file, then node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildZImageWorkflow,
  buildFluxWorkflow,
  buildQwenImageWorkflow,
  buildWorkflowForModel,
  samplingFor,
} from './workflows.ts'
import {
  resolveGenRequest,
  sizeForAspect,
  roundToMultiple8,
  findModelEntry,
  DEFAULT_DRAFT_MODEL,
  DEFAULT_FINAL_MODEL,
} from '../models.ts'

const draftReq = resolveGenRequest({
  prompt: 'a red bicycle leaning on a wet brick wall at dusk',
  preset: 'draft',
  aspect: '1:1',
  seed: 7,
  count: 1,
  save: true,
})

function nodesWithClass(graph, klass) {
  return Object.values(graph).filter((n) => n.class_type === klass)
}

function nodeByClass(graph, klass) {
  const [first] = nodesWithClass(graph, klass)
  return first
}

test('z-image draft: core node set, cfg-1 turbo sampling, sylo/draft SaveImage prefix', () => {
  const g = buildZImageWorkflow(draftReq)
  const classes = Object.values(g).map((n) => n.class_type)
  for (const expected of ['UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'ModelSamplingAuraFlow', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage']) {
    assert.ok(classes.includes(expected), `missing core node ${expected}`)
  }
  // Official-template model-sampling stage (round-2, live evidence 2026-10-11): shift 3.0,
  // sampling 'flow', fed by the UNet and feeding the sampler.
  const auraFlow = nodeByClass(g, 'ModelSamplingAuraFlow')
  assert.deepEqual(auraFlow.inputs, { model: ['1', 0], shift: 3.0, sampling: 'flow' })
  // Draft long side capped at 768; latent takes the resolved dims; batch_size 1 (per-branch batching).
  const latent = nodeByClass(g, 'EmptySD3LatentImage')
  assert.deepEqual({ width: latent.inputs.width, height: latent.inputs.height }, { width: 768, height: 768 })
  assert.equal(latent.inputs.batch_size, 1)
  const sampler = nodeByClass(g, 'KSampler')
  assert.deepEqual(sampler.inputs, {
    seed: 7,
    steps: 8,
    cfg: 1,
    sampler_name: 'res_multistep',
    scheduler: 'simple',
    denoise: 1,
    model: ['4', 0],
    positive: ['10', 0],
    negative: ['11', 0],
    latent_image: [Object.keys(g).find((id) => g[id].class_type === 'EmptySD3LatentImage'), 0],
  })
  // Turbo is distilled: no FluxGuidance anywhere in the z-image graph.
  assert.equal(nodesWithClass(g, 'FluxGuidance').length, 0)
  const save = nodeByClass(g, 'SaveImage')
  assert.equal(save.inputs.filename_prefix, 'sylo/draft')
  assert.equal(save.inputs.images[1], 0)
})

test('z-image loaders are wired from the catalog comfy spec and clip encodes both prompts', () => {
  const g = buildZImageWorkflow(draftReq)
  const unet = nodeByClass(g, 'UNETLoader')
  const clip = nodeByClass(g, 'CLIPLoader')
  const vae = nodeByClass(g, 'VAELoader')
  const wiring = findModelEntry(DEFAULT_DRAFT_MODEL).comfy
  assert.equal(unet.inputs.unet_name, wiring.diffusion_model)
  assert.equal(clip.inputs.clip_name, wiring.text_encoders[0])
  assert.equal(clip.inputs.type, wiring.clip_type)
  assert.equal(vae.inputs.vae_name, wiring.vae)
  const encodes = nodesWithClass(g, 'CLIPTextEncode')
  assert.equal(encodes.length, 2)
  assert.equal(encodes[0].inputs.text, draftReq.prompt)
  // No negative passed → empty string encoded (inert at cfg 1, but KSampler needs the input).
  const neg = encodes.find((n) => n.inputs.text === '')
  assert.ok(neg, 'negative CLIPTextEncode with empty text must exist')
})

test('qwen-image final: honored negative prompt, cfg from guidance, sylo/final prefix', () => {
  const req = resolveGenRequest({
    prompt: 'a shop sign reading "OPEN" in gold letters',
    negative_prompt: 'blurry, watermark, text artefacts',
    seed: 1000,
  })
  assert.equal(req.model, DEFAULT_FINAL_MODEL)
  assert.equal(req.preset, 'final')
  const g = buildQwenImageWorkflow(req)
  const encodes = nodesWithClass(g, 'CLIPTextEncode')
  assert.deepEqual(
    encodes.map((n) => n.inputs.text).sort(),
    ['a shop sign reading "OPEN" in gold letters', 'blurry, watermark, text artefacts'].sort(),
  )
  const sampler = nodeByClass(g, 'KSampler')
  const sampling = samplingFor(findModelEntry(req.model), req)
  assert.equal(sampling.cfg, 4)
  assert.equal(sampler.inputs.cfg, 4)
  assert.equal(sampler.inputs.steps, 20)
  assert.equal(nodeByClass(g, 'SaveImage').inputs.filename_prefix, 'sylo/final')
  assert.equal(nodesWithClass(g, 'FluxGuidance').length, 0)
})

test('count>1 → N KSampler branches in ONE submit with ascending seeds', () => {
  const req = resolveGenRequest({ prompt: 'x', preset: 'draft', count: 3, seed: 41 })
  const g = buildZImageWorkflow(req)
  const samplers = nodesWithClass(g, 'KSampler')
  assert.equal(samplers.length, 3)
  assert.deepEqual(samplers.map((n) => n.inputs.seed), [41, 42, 43])
  assert.equal(nodesWithClass(g, 'SaveImage').length, 3)
  // All branches share the same encodes (ids '10'/'11') and the same model-sampling node —
  // one conditioning/sampler chain, N seeds.
  assert.ok(Object.keys(g).every((id) => ['1', '2', '3', '4', '10', '11'].includes(id) || Number(id) >= 20))
  assert.equal(nodeByClass(g, 'CLIPTextEncode').inputs.clip[0], '2')
})

test('flux: DualCLIPLoader + FluxGuidance for flux1-dev; plain CLIPLoader without guidance for klein', () => {
  const req = resolveGenRequest({ prompt: 'y', model: 'flux1-dev', seed: 5 })
  assert.equal(req.preset, 'final')
  const g = buildFluxWorkflow(req)
  const dual = nodeByClass(g, 'DualCLIPLoader')
  assert.equal(dual.inputs.clip_name1, 'clip_l.safetensors')
  assert.equal(dual.inputs.clip_name2, 't5xxl_fp16.safetensors')
  assert.equal(dual.inputs.type, 'flux')
  // FLUX dev: guidance rides FluxGuidance (3.5), KSampler stays cfg 1.
  const guidance = nodeByClass(g, 'FluxGuidance')
  assert.equal(guidance.inputs.guidance, 3.5)
  assert.deepEqual([
    ...Object.values(g).filter((n) => n.class_type === 'KSampler').map((n) => n.inputs.positive),
  ], [['12', 0]])
  assert.equal(nodesWithClass(g, 'KSampler')[0].inputs.cfg, 1)
  assert.equal(nodesWithClass(g, 'KSampler')[0].inputs.steps, 20)
  assert.equal(nodesWithClass(g, 'KSampler')[0].inputs.sampler_name, 'euler')

  const klein = resolveGenRequest({ prompt: 'y', model: 'flux2-klein', seed: 6 })
  assert.equal(klein.preset, 'draft') // draft-role model resolves to draft preset
  const kg = buildFluxWorkflow(klein)
  const kSampler = nodeByClass(kg, 'KSampler')
  assert.deepEqual(kSampler.inputs.positive, ['10', 0]) // no FluxGuidance node
  assert.equal(nodesWithClass(kg, 'FluxGuidance').length, 0)
  assert.equal(kSampler.inputs.steps, 4)
  const kSave = nodeByClass(kg, 'SaveImage')
  assert.equal(kSave.inputs.filename_prefix, 'sylo/draft')
})

test('overrides: steps/guidance/sampler/size reach the graph; samplingFor mirrors both', () => {
  const req = resolveGenRequest({
    prompt: 'z',
    preset: 'final',
    steps: 30,
    guidance: 4.5,
    sampler: 'res_multistep',
    width: 1024,
    height: 1024,
    seed: 9,
  })
  assert.equal(req.steps, 30)
  assert.equal(req.guidance, 4.5)
  const g = buildQwenImageWorkflow(req)
  const sampler = nodesWithClass(g, 'KSampler')[0]
  assert.equal(sampler.inputs.sampler_name, 'res_multistep')
  assert.equal(sampler.inputs.steps, 30)
  assert.equal(sampler.inputs.cfg, 4.5)
  // meta helper matches the graph knobs (generate must keep GenOutput.meta truthful).
  const sampling = samplingFor(findModelEntry(req.model), req)
  assert.deepEqual(
    { steps: sampling.steps, cfg: sampling.cfg, sampler: sampling.sampler },
    { steps: sampler.inputs.steps, cfg: sampler.inputs.cfg, sampler: sampler.inputs.sampler_name },
  )
})

test('buildWorkflowForModel dispatch + actionable unknown/mismatch errors', () => {
  const req = resolveGenRequest({ prompt: 'x', preset: 'final', seed: 1 })
  assert.ok(buildWorkflowForModel('flux1-dev', { ...req, model: 'flux1-dev' }))
  assert.throws(() => buildWorkflowForModel('nope', req), /Unknown image model "nope".*z-image-turbo/)
  assert.throws(() => buildZImageWorkflow({ ...req, model: 'flux1-dev' }), /this builder expects the z-image family/)
  assert.throws(() => buildQwenImageWorkflow({ ...req, model: 'z-image-turbo' }), /this builder expects the qwen-image family/)
})

test('resolveGenRequest: defaults, preset-as-model-id, config pairing override, count clamps', () => {
  // Default: final preset → configured final model, catalog steps/size, random numeric seed.
  const def = resolveGenRequest({ prompt: 'hi' })
  assert.equal(def.model, DEFAULT_FINAL_MODEL)
  assert.equal(def.preset, 'final')
  assert.equal(def.steps, 20)
  assert.equal(def.count, 1)
  assert.equal(def.save, true)
  assert.ok(Number.isInteger(def.seed) && def.seed >= 0)

  // preset doubles as model picker (§3.1); draft long side = 768.
  const viaPreset = resolveGenRequest({ prompt: 'hi', preset: 'z-image-turbo', aspect: '16:9' })
  assert.equal(viaPreset.model, 'z-image-turbo')
  assert.equal(viaPreset.preset, 'draft')
  assert.deepEqual({ width: viaPreset.width, height: viaPreset.height }, { width: 768, height: 432 })

  // Config pairing: draft_model/final_model override the catalog defaults.
  const paired = resolveGenRequest({ prompt: 'hi', preset: 'draft' }, { draft_model: 'flux2-klein' })
  assert.equal(paired.model, 'flux2-klein')
  assert.equal(resolveGenRequest({ prompt: 'hi' }, { final_model: 'flux1-dev' }).model, 'flux1-dev')

  // Explicit model + preset word: both honored; explicit model alone → role preset.
  assert.equal(resolveGenRequest({ prompt: 'h', model: 'flux2-klein', preset: 'final' }).preset, 'final')

  // count out of range → actionable error (honest, not silent clamping).
  assert.throws(() => resolveGenRequest({ prompt: 'h', count: 9 }), /count must be between 1 and 4/)
  assert.throws(() => resolveGenRequest({ prompt: 'h', count: 0 }), /count must be between 1 and 4/)
  const one = resolveGenRequest({ prompt: 'h', width: 517 }) // 517 → 520 (nearest multiple of 8)
  assert.equal(one.width, 520)

  // Actionable errors.
  assert.throws(() => resolveGenRequest({ prompt: '   ' }), /prompt is required/)
  assert.throws(() => resolveGenRequest({ prompt: 'h', preset: 'mega' }), /preset must be 'draft', 'final', or a catalog model id/)
  assert.throws(() => resolveGenRequest({ prompt: 'h', steps: 500 }), /steps must be between/)
})

test('sizeForAspect + rounding: 16:9 @1024 → 1024×576, 9:16 portrait, multiples of 8 everywhere', () => {
  const qwen = findModelEntry(DEFAULT_FINAL_MODEL)
  assert.deepEqual(sizeForAspect(qwen, '16:9', 'final'), { width: 1024, height: 576 })
  assert.deepEqual(sizeForAspect(qwen, '9:16', 'final'), { width: 576, height: 1024 })
  // Finals keep the model long side; drafts cap at 768 even for a 1024-final model.
  assert.deepEqual(sizeForAspect(qwen, '1:1', 'draft'), { width: 768, height: 768 })
  const flux2dev = findModelEntry('flux2-dev')
  assert.deepEqual(sizeForAspect(flux2dev, '3:2', 'final'), { width: 1536, height: roundToMultiple8(1024) })
  for (const a of ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4']) {
    const s = sizeForAspect(qwen, a, 'final')
    assert.equal(s.width % 8, 0)
    assert.equal(s.height % 8, 0)
    assert.ok(s.width >= 64 && s.height >= 64)
  }
})