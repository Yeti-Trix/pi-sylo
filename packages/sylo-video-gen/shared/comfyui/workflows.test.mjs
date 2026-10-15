// Unit tests for the sylo-video-gen workflow builders (plan §2.4–§2.5, §8 step
// 4 = plan §2.5/§2.6 + §8.4 pairing). Pure offline — no ComfyUI server involved.
// Asserts the template-verified node chains, the 4n+1 latent rule, the loop's
// image-level duplicate-frame trim, the locked flat dynamic-combo SaveVideo
// shape (live-probe record), and catalog↔builder cross-consistency.
// Run: npm run test:workflows (esbuild-bundles → node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WAN_NEGATIVE_PROMPT,
  SAVE_VIDEO_CODEC,
  SAVE_VIDEO_FORMAT,
  buildClipWorkflow,
  buildDynamicComboProbeWorkflow,
  buildLoopWorkflow,
  buildRestyleWorkflow,
  buildWorkflowForRequest,
  loopShiftForMotionStrength,
  vaceStrengthForMotionStrength,
  videoSamplingFor,
} from './workflows.ts'
import { findVideoModelEntry, resolveVideoGenRequest, VIDEO_MODEL_CATALOG } from '../catalog.ts'

const IMG_REF = 'sylo-uploads/probe-still.png'
const VID_REF = 'sylo-uploads/probe-clip.mp4'

function nodesWithClass(graph, klass) {
  return Object.values(graph).filter((n) => n.class_type === klass)
}
function nodeByClass(graph, klass) {
  return nodesWithClass(graph, klass)[0]
}
function nodeIdByClass(graph, klass) {
  return Object.keys(graph).find((id) => graph[id].class_type === klass)
}
function classesOf(graph) {
  return Object.values(graph).map((n) => n.class_type)
}
function nodesOf(graph, klass) {
  return nodesWithClass(graph, klass)
}

function clipReq(overrides = {}) {
  return resolveVideoGenRequest({ prompt: 'slow dolly through a neon-lit rainy street', seed: 7, ...overrides })
}
function loopReq(overrides = {}) {
  return resolveVideoGenRequest(
    { prompt: 'subtle hair sway, one movement at a time', mode: 'loop', source_image_path: 'a.png', seed: 9, resolution: '480p', loop_motion_strength: 0.5, ...overrides },
    { loop_motion_strength: 0.5 },
  )
}
function restyleReq(overrides = {}) {
  return resolveVideoGenRequest(
    { prompt: 'oil-paint the whole clip', mode: 'restyle', source_video_path: 'in.mp4', seed: 13, resolution: '480p', restyle_strength: 0.5, ...overrides },
  )
}

// ── Draft (wan22-ti2v-5b) ──

test('draft t2v: official 5B ti2v chain — single-stage 20/cfg5/uni_pc + shift 8, no LoadImage, poster+video', () => {
  const req = clipReq({ preset: 'draft' })
  assert.equal(req.model, 'wan22-ti2v-5b')
  const { workflow: g, expected } = buildClipWorkflow(req)
  const classes = classesOf(g)
  for (const wanted of ['UNETLoader', 'ModelSamplingSD3', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'Wan22ImageToVideoLatent', 'KSampler', 'VAEDecode', 'ImageFromBatch', 'SaveImage', 'CreateVideo', 'SaveVideo'])
    assert.ok(classes.includes(wanted), `missing core node ${wanted}`)
  assert.ok(!classes.includes('LoraLoaderModelOnly'), 'draft 5B has NO lightx2v LoRA (template parity)')
  assert.ok(!classes.includes('LoadImage'), 't2v wires NO LoadImage')
  assert.ok(!classes.includes('KSamplerAdvanced'), 'single-stage KSampler, not KSamplerAdvanced')
  assert.ok(!classes.includes('FrameInterpolate'), 'interpolation OFF by default')

  // Loader + sampling wiring from the catalog (template-verified values).
  const unet = nodeByClass(g, 'UNETLoader')
  assert.equal(unet.inputs.unet_name, 'wan2.2_ti2v_5B_fp16.safetensors')
  assert.equal(unet.inputs.weight_dtype, 'default')
  const sampling = nodeByClass(g, 'ModelSamplingSD3')
  assert.equal(sampling.inputs.shift, 8)
  const clip = nodeByClass(g, 'CLIPLoader')
  assert.equal(clip.inputs.type, 'wan')
  assert.equal(clip.inputs.clip_name, 'umt5_xxl_fp8_e4m3fn_scaled.safetensors')
  const vae = nodeByClass(g, 'VAELoader')
  assert.equal(vae.inputs.vae_name, 'wan2.2_vae.safetensors')

  // Latent: Wan22ImageToVideoLatent with NO start_image (t2v) — 5 s @24 = 121, step-32 dims.
  const latent = nodeByClass(g, 'Wan22ImageToVideoLatent')
  assert.deepEqual({ width: latent.inputs.width, height: latent.inputs.height }, { width: 1280, height: 704 })
  assert.equal(latent.inputs.length, 121)
  assert.equal(latent.inputs.batch_size, 1)
  assert.equal('start_image' in latent.inputs, false)

  const samp = nodeByClass(g, 'KSampler')
  assert.deepEqual(
    { seed: samp.inputs.seed, steps: samp.inputs.steps, cfg: samp.inputs.cfg, sampler: samp.inputs.sampler_name, scheduler: samp.inputs.scheduler, denoise: samp.inputs.denoise },
    { seed: 7, steps: 20, cfg: 5, sampler: 'uni_pc', scheduler: 'simple', denoise: 1 },
  )
  const latentId = nodeIdByClass(g, 'Wan22ImageToVideoLatent')
  assert.deepEqual(samp.inputs.latent_image, [latentId, 0])
  assert.equal(samp.inputs.model[1], 0)
  assert.equal(samp.inputs.positive[1], 0)
  assert.equal(samp.inputs.negative[1], 0)
  // Conditioning feeds the sampler from the ENCODES (Wan22ImageToVideoLatent carries no cond).
  const encodes = nodesWithClass(g, 'CLIPTextEncode')
  assert.equal(encodes.length, 2)
  assert.equal(encodes[0].inputs.text, req.prompt)
  assert.equal(encodes[1].inputs.text, DEFAULT_WAN_NEGATIVE_PROMPT, 'official Wan negative default — byte-verbatim common string (2.2 5B-ti2v / 14B-i2v / 14B-flf2v templates; t2v adds the ，裸露，NSFW tail)')
  assert.ok(!DEFAULT_WAN_NEGATIVE_PROMPT.includes('裸露') && !DEFAULT_WAN_NEGATIVE_PROMPT.includes('整体低画质'), 'flf2v/i2v variant (no t2v tail; the old short string retired — §2 review round)')

  // Tail: poster = decoded frame 0; video = full frames @24; SaveVideo DYNAMIC-COMBO LOCKED FLAT.
  const posterFrame = nodesWithClass(g, 'ImageFromBatch')[0]
  assert.equal(posterFrame.inputs.length, 1)
  const poster = nodeByClass(g, 'SaveImage')
  assert.equal(poster.inputs.filename_prefix, 'sylo-video/poster')
  const create = nodeByClass(g, 'CreateVideo')
  assert.equal(create.inputs.fps, 24)
  assert.equal(create.inputs.images[0], posterFrame.inputs.image[0])
  const save = nodeByClass(g, 'SaveVideo')
  assert.equal(save.inputs.format, SAVE_VIDEO_FORMAT)
  assert.equal(save.inputs.codec, SAVE_VIDEO_CODEC)
  assert.equal(save.inputs.format, 'mp4')
  assert.equal(save.inputs.codec, 'h264')

  // Expected output shape mirrors the graph (§2.4 record derivation).
  assert.deepEqual(expected, {
    variant: 't2v',
    video_format: 'mp4',
    codec: 'h264',
    fps: 24,
    latent_length: 121,
    final_frame_count: 121,
    final_duration_seconds: 5.04,
    width: 1280,
    height: 704,
    poster_ext: 'png',
  })
})

test('draft i2v: ONE shared LoadImage feeds Wan22ImageToVideoLatent start_image', () => {
  const req = clipReq({ preset: 'draft', source_image_path: 'C:/stills/a.png' })
  const { workflow: g, expected } = buildClipWorkflow(req, undefined, { sourceImageRef: IMG_REF })
  assert.equal(expected.variant, 'i2v')
  const loads = nodesWithClass(g, 'LoadImage')
  assert.equal(loads.length, 1, 'ONE shared LoadImage per graph')
  assert.equal(loads[0].inputs.image, IMG_REF)
  const latent = nodeByClass(g, 'Wan22ImageToVideoLatent')
  assert.equal(latent.inputs.start_image[0], nodeIdByClass(g, 'LoadImage'))

  // Explicit negative prompt passes through the encode (default replaced).
  const custom = clipReq({ preset: 'draft', negative_prompt: 'blurry, watermark' })
  const gc = buildClipWorkflow(custom)
  const negEncode = nodesWithClass(gc.workflow, 'CLIPTextEncode').find((n) => n.inputs.text === 'blurry, watermark')
  assert.ok(negEncode, 'explicit negative passes through')
})

test('draft portrait: 704×1280 from the catalog (step-32 pair), latent dims exact', () => {
  const req = clipReq({ preset: 'draft', orientation: 'portrait', seed: 2 })
  const { workflow: g, expected } = buildClipWorkflow(req)
  const latent = nodeByClass(g, 'Wan22ImageToVideoLatent')
  assert.deepEqual({ width: latent.inputs.width, height: latent.inputs.height }, { width: 704, height: 1280 })
  assert.equal(expected.width, 704)
  assert.equal(expected.height, 1280)
})

test('draft count 2: two latent/sampler/decode/tail branches in ONE submit, seeds ascend', () => {
  const req = clipReq({ preset: 'draft', count: 2, seed: 41 })
  const { workflow: g } = buildClipWorkflow(req)
  const samplers = nodesWithClass(g, 'KSampler')
  assert.equal(samplers.length, 2)
  assert.deepEqual(samplers.map((s) => s.inputs.seed), [41, 42])
  assert.equal(nodesWithClass(g, 'SaveVideo').length, 2)
  assert.equal(nodesWithClass(g, 'SaveImage').length, 2, 'one poster per clip')
  assert.equal(nodesWithClass(g, 'CLIPTextEncode').length, 2, 'pos+neg encodes shared across branches')
  assert.equal(nodesWithClass(g, 'Wan22ImageToVideoLatent').length, 2, 'one latent node per branch')
})

// ── Final (wan22-a14b) ──

test('FINAL t2v (A14B): two fp8 DiTs + lightx2v LoRAs + two-stage KSamplerAdvanced split 2/4 + EmptyHunyuanLatentVideo', () => {
  const req = clipReq({ preset: 'final', resolution: '480p' })
  assert.equal(req.model, 'wan22-a14b')
  assert.equal(req.frame_count, 81)
  const { workflow: g, expected } = buildClipWorkflow(req)
  const classes = classesOf(g)
  for (const wanted of ['UNETLoader', 'LoraLoaderModelOnly', 'ModelSamplingSD3', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'EmptyHunyuanLatentVideo', 'KSamplerAdvanced', 'VAEDecode', 'ImageFromBatch', 'SaveImage', 'CreateVideo', 'SaveVideo'])
    assert.ok(classes.includes(wanted), `final t2v missing ${wanted}`)
  assert.ok(!classes.includes('KSampler'), 'A14B final uses the two-stage KSamplerAdvanced pair (template)')
  assert.ok(!classes.includes('LoadImage'), 't2v wires NO image input')

  const unets = nodesWithClass(g, 'UNETLoader')
  assert.deepEqual(unets.map((u) => u.inputs.unet_name), [
    'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
    'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
  ])
  const loras = nodesWithClass(g, 'LoraLoaderModelOnly')
  assert.deepEqual(
    loras.map((l) => l.inputs.lora_name),
    ['wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors', 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors'],
  )
  for (const l of loras) {
    assert.equal(l.inputs.strength_model, 1.0)
  }
  const samplings = nodesWithClass(g, 'ModelSamplingSD3')
  assert.equal(samplings.length, 2)
  for (const s of samplings) assert.equal(s.inputs.shift, 5, 'lightx2v branch shift (template anchor)')

  const latent = nodeByClass(g, 'EmptyHunyuanLatentVideo')
  assert.deepEqual({ width: latent.inputs.width, height: latent.inputs.height }, { width: 832, height: 480 })
  assert.equal(latent.inputs.length, 81, '5 s @16 = 81 (4n+1)')
  assert.equal(latent.inputs.batch_size, 1)

  const [high, low] = nodesWithClass(g, 'KSamplerAdvanced')
  assert.deepEqual(
    { add_noise: high.inputs.add_noise, steps: high.inputs.steps, cfg: high.inputs.cfg, sampler: high.inputs.sampler_name, scheduler: high.inputs.scheduler, start: high.inputs.start_at_step, end: high.inputs.end_at_step, leftover: high.inputs.return_with_leftover_noise, noise_seed: high.inputs.noise_seed },
    { add_noise: 'enable', steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', start: 0, end: 2, leftover: 'enable', noise_seed: 7 },
  )
  assert.equal(low.inputs.add_noise, 'disable')
  assert.equal(low.inputs.start_at_step, 2)
  assert.equal(low.inputs.end_at_step, 4)
  assert.equal(low.inputs.return_with_leftover_noise, 'disable')
  // Stage-2 latent continues stage-1's partial denoise left after step 2.
  const highId = nodeIdByClass(g, 'KSamplerAdvanced')
  assert.deepEqual(low.inputs.latent_image, [highId, 0])
  // Stage models: chainEnds[0] (high) feeds stage 1; chainEnds[1] (low) feeds stage 2.
  assertSameChain(g, high.inputs.model, 'high_noise')
  assertSameChain(g, low.inputs.model, 'low_noise')
  assert.equal(nodeByClass(g, 'VAELoader').inputs.vae_name, 'wan_2.1_vae.safetensors', 'A14B VAE = wan_2.1')
  assert.equal(expected.latent_length, 81)
  assert.equal(expected.final_duration_seconds, 5.06)
})

/** Walk UNETLoader → LoraLoaderModelOnly → ModelSamplingSD3 and assert the file carries `stageName`. */
function assertSameChain(graph, samplingRef, stageName) {
  const sampling = graph[samplingRef[0]]
  assert.equal(sampling.class_type, 'ModelSamplingSD3')
  const lora = graph[sampling.inputs.model[0]]
  assert.equal(lora.class_type, 'LoraLoaderModelOnly')
  assert.match(lora.inputs.lora_name, new RegExp(stageName))
  const unet = graph[lora.inputs.model[0]]
  assert.equal(unet.class_type, 'UNETLoader')
  assert.match(unet.inputs.unet_name, new RegExp(stageName))
}

test('FINAL i2v (A14B): WanImageToVideo CARRIES the conditioning; latent from ITS slot 2', () => {
  const req = resolveVideoGenRequest(
    { prompt: 'the still comes alive', mode: 'clip', preset: 'final', source_image_path: 'C:/stills/a.png', seed: 5 },
  )
  assert.equal(req.frame_count, 81)
  const { workflow: g, expected } = buildClipWorkflow(req, undefined, { sourceImageRef: IMG_REF })
  assert.equal(expected.variant, 'i2v')
  const latent = nodeByClass(g, 'WanImageToVideo')
  assert.equal(latent.inputs.start_image[0], nodeIdByClass(g, 'LoadImage'))
  assert.deepEqual({ width: latent.inputs.width, height: latent.inputs.height }, { width: 1280, height: 720 })
  assert.equal(latent.inputs.length, 81)
  assert.equal(latent.inputs.batch_size, 1)
  // Conditioning rides the node's OUTPUTS (template parity, LATENT_OUTPUT_SLOTS).
  const [high] = nodesWithClass(g, 'KSamplerAdvanced')
  const latentId = nodeIdByClass(g, 'WanImageToVideo')
  assert.deepEqual(high.inputs.positive, [latentId, 0], 'pos/neg come FROM WanImageToVideo')
  assert.deepEqual(high.inputs.negative, [latentId, 1])
  assert.deepEqual(high.inputs.latent_image, [latentId, 2], 'latent from the i2v node slot 2')
  // Encodes still exist (they FEED the i2v node).
  assert.equal(nodesWithClass(g, 'CLIPTextEncode').length, 2)
  // i2v variant carries the i2v LoRA set (distinct files from the t2v set).
  assert.deepEqual(
    nodesWithClass(g, 'LoraLoaderModelOnly').map((l) => l.inputs.lora_name),
    ['wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors', 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors'],
  )
})

test('FINAL 720p landscape: 1280×720 (step-16 pair) — not the 5B native 704', () => {
  const req = clipReq({ preset: 'final', resolution: '720p', seed: 3 })
  const { workflow: g, expected } = buildClipWorkflow(req)
  const latent = nodeByClass(g, 'EmptyHunyuanLatentVideo')
  assert.deepEqual({ width: latent.inputs.width, height: latent.inputs.height }, { width: 1280, height: 720 })
  assert.equal(expected.latent_length, 81, 'default duration 5 s @16 fps (the request did not pin 24 fps)')
  // Step-4 latent semantics: 81 = 4n+1.
  assertFramesAre4n1(expected.latent_length)
})

// ── Loop (living photo) ──

test('LOOP: WanFirstLastFrameToVideo same still BOTH ends; 81→80 post-decode trim; 16 fps; poster f0', () => {
  const req = loopReq()
  assert.equal(req.model, 'wan22-a14b')
  const { workflow: g, expected, notes } = buildLoopWorkflow(req, undefined, { sourceImageRef: IMG_REF })
  const classes = classesOf(g)
  for (const wanted of ['UNETLoader', 'LoraLoaderModelOnly', 'ModelSamplingSD3', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'WanFirstLastFrameToVideo', 'KSamplerAdvanced', 'VAEDecode', 'ImageFromBatch', 'SaveImage', 'CreateVideo', 'SaveVideo'])
    assert.ok(classes.includes(wanted), `loop missing ${wanted}`)
  // NO ImageSelector (absent in 0.39.2) and NO TrimVideoLatent (image-level cut instead — reviewer §8.4).
  assert.ok(!classes.includes('ImageSelector'), 'ImageSelector does not exist in native 0.39.2')
  assert.ok(!classes.includes('TrimVideoLatent'), 'trim happens post-decode at IMAGE level (duration-exact), documented')
  assert.ok(!classes.includes('LoadVideo'), 'loop feeds a STILL, not a video')
  assert.ok(!classes.includes('FrameInterpolate'), 'interpolation OFF by default (loader combo empty on 0.39.2)')

  const flf = nodeByClass(g, 'WanFirstLastFrameToVideo')
  const loadId = nodeIdByClass(g, 'LoadImage')
  assert.equal(flf.inputs.start_image[0], loadId)
  assert.equal(flf.inputs.end_image[0], loadId, 'the SAME still at first AND last position (the mode)')
  assert.equal(flf.inputs.length, 81)
  assert.equal(flf.inputs.width, 832)
  assert.equal(flf.inputs.height, 480)
  assert.equal(flf.inputs.vae[0], nodeIdByClass(g, 'VAELoader'))

  const [high, low] = nodesWithClass(g, 'KSamplerAdvanced')
  assert.equal(high.inputs.noise_seed, 9)
  assert.equal(high.inputs.end_at_step, 2)
  const flfId = nodeIdByClass(g, 'WanFirstLastFrameToVideo')
  assert.deepEqual(high.inputs.positive, [flfId, 0], 'conditioning from the flf node outputs')
  assert.deepEqual(high.inputs.negative, [flfId, 1])
  assert.deepEqual(high.inputs.latent_image, [flfId, 2])
  const highId = nodeIdByClass(g, 'KSamplerAdvanced')
  assert.deepEqual(low.inputs.latent_image, [highId, 0])

  // Trim: post-decode — ImageFromBatch length 80 (4n+1 minus the duplicated final frame).
  const trims = nodesWithClass(g, 'ImageFromBatch')
  assert.equal(trims.length, 2, 'poster frame AND loop trim ride ImageFromBatch')
  const loopTrim = trims.find((t) => t.inputs.length === 80)
  assert.ok(loopTrim, `loop trim = length 80 (got ${trims.map((t) => t.inputs.length).join(',')})`)
  assert.equal(loopTrim.inputs.batch_index, 0, 'trims the LAST (duplicated) frame, keeps the poster frame 0')
  const create = nodeByClass(g, 'CreateVideo')
  assert.equal(create.inputs.fps, 16)
  const save = nodeByClass(g, 'SaveVideo')
  assert.equal(save.inputs.filename_prefix, 'sylo-video/loop')
  assert.equal(save.inputs.format, 'mp4')
  assert.equal(save.inputs.codec, 'h264')

  assert.ok(notes.length >= 0)
  assert.deepEqual(expected, {
    variant: 'flf2v',
    video_format: 'mp4',
    codec: 'h264',
    fps: 16,
    latent_length: 81,
    final_frame_count: 80,
    final_duration_seconds: 5,
    width: 832,
    height: 480,
    poster_ext: 'png',
  })
})

test('LOOP frame table: every duration lands exact (16 fps 64/80/128 after trim; 24 fps 96/120/192)', () => {
  for (const [duration, fps] of [[4, 16], [5, 16], [8, 16], [4, 24], [5, 24], [8, 24]]) {
    const resolved = resolveVideoGenRequest(
      { prompt: 'x', mode: 'loop', source_image_path: 's.png', duration_seconds: duration, framerate: fps, seed: 1 },
    )
    const { workflow: g, expected } = buildLoopWorkflow(resolved, undefined, { sourceImageRef: IMG_REF })
    assert.equal(expected.latent_length, duration * fps + 1, `${duration} s @${fps} latent (4n+1 table)`)
    assertFramesAre4n1(expected.latent_length)
    assert.equal(expected.final_frame_count, duration * fps, 'post-trim frames exact')
    assert.equal(expected.final_duration_seconds, duration, 'loop length exactly the composed duration')
    for (const t of nodesWithClass(g, 'ImageFromBatch')) {
      if (t.inputs.length > 1) {
        assert.equal(t.inputs.length, duration * fps)
        // (trim length + 1) must satisfy the 4n+1 rule (inclusive frame count).
        assertFramesAre4n1(t.inputs.length + 1)
      }
    }
  }
})

test('LOOP with FrameInterpolate explicitly enabled: loader + interpolate wired between trim and CreateVideo', () => {
  const req = loopReq()
  const { workflow: g, expected, notes } = buildLoopWorkflow(req, undefined, { sourceImageRef: IMG_REF, interpolation: { model_name: 'rife_v4.26.pth', multiplier: 2 } })
  const loader = nodeByClass(g, 'FrameInterpolationModelLoader')
  assert.equal(loader.inputs.model_name, 'rife_v4.26.pth')
  const interp = nodeByClass(g, 'FrameInterpolate')
  assert.equal(interp.inputs.multiplier, 2)
  const trimId = Object.keys(g).find((id) => g[id].class_type === 'ImageFromBatch' && g[id].inputs.length === 80)
  assert.deepEqual(interp.inputs.images, [trimId, 0])
  const create = nodeByClass(g, 'CreateVideo')
  assert.equal(create.inputs.images[0], nodeIdByClass(g, 'FrameInterpolate'))
  assert.match(notes.join(' '), /FrameInterpolate ×2/)
  // Default (no option) has NO interpolation nodes.
  const plain = buildLoopWorkflow(loopReq(), undefined, { sourceImageRef: IMG_REF })
  assert.ok(!classesOf(plain.workflow).includes('FrameInterpolate'))
  void expected
})

test('LOOP motion_strength → shift curve: anchors 5 (strength 1) / 8 (strength 0) — documented mapping', () => {
  assert.equal(loopShiftForMotionStrength(1), 5)
  assert.equal(loopShiftForMotionStrength(0), 8)
  assert.equal(loopShiftForMotionStrength(0.5), 6.5)
  assert.equal(loopShiftForMotionStrength(undefined), 6.5, 'default 0.5')
  const calm = buildLoopWorkflow(loopReq({ loop_motion_strength: 0.2 }), undefined, { sourceImageRef: IMG_REF })
  for (const s of nodesWithClass(calm.workflow, 'ModelSamplingSD3'))
    assert.equal(s.inputs.shift, loopShiftForMotionStrength(0.2), 'both stages share the loop curve shift')
  const live = buildLoopWorkflow(loopReq({ loop_motion_strength: 1 }), undefined, { sourceImageRef: IMG_REF })
  for (const s of nodesWithClass(live.workflow, 'ModelSamplingSD3')) assert.equal(s.inputs.shift, 5)
})

test('videoSamplingFor: per-variant knobs truthful (final two-stage, loop curve, vace single)', () => {
  const a14b = findVideoModelEntry('wan22-a14b')
  const sT2v = videoSamplingFor(a14b, 't2v')
  assert.deepEqual({ steps: sT2v.steps, cfg: sT2v.cfg, sampler: sT2v.sampler, shift: sT2v.shift, two_stage: sT2v.two_stage }, { steps: 4, cfg: 1, sampler: 'euler', shift: 5, two_stage: true })
  const sLoop = videoSamplingFor(a14b, 'flf2v', { loop_motion_strength: 1 })
  assert.equal(sLoop.shift, 5)
  assert.equal(sLoop.two_stage, true)
  const draft = findVideoModelEntry('wan22-ti2v-5b')
  const sDraft = videoSamplingFor(draft, 't2v')
  assert.deepEqual({ steps: sDraft.steps, cfg: sDraft.cfg, sampler: sDraft.sampler, shift: sDraft.shift, two_stage: sDraft.two_stage }, { steps: 20, cfg: 5, sampler: 'uni_pc', shift: 8, two_stage: false })
  const vace = findVideoModelEntry('wan21-vace-14b')
  const sVace = videoSamplingFor(vace, 'v2v')
  assert.equal(sVace.steps, 20)
  assert.equal(sVace.cfg, 6)
  assert.equal(sVace.sampler, 'uni_pc')
  // Unwired (opt-in) → plain error, not nonsense knobs.
  const ltx = findVideoModelEntry('ltx-2.5')
  assert.throws(() => videoSamplingFor(ltx, 't2v'), /no t2v wiring/)
})

// ── Restyle (VACE) ──

test('RESTYLE: LoadVideo → GetVideoComponents → WanVaceToVideo control_video; strength curve; fp8 cast load', () => {
  const req = restyleReq()
  assert.equal(req.model, 'wan21-vace-14b')
  const { workflow: g, expected, notes } = buildRestyleWorkflow(req, undefined, { sourceVideoRef: VID_REF })
  const classes = classesOf(g)
  for (const wanted of ['UNETLoader', 'ModelSamplingSD3', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'LoadVideo', 'GetVideoComponents', 'WanVaceToVideo', 'KSampler', 'VAEDecode', 'ImageFromBatch', 'SaveImage', 'CreateVideo', 'SaveVideo'])
    assert.ok(classes.includes(wanted), `restyle missing ${wanted}`)
  assert.ok(!classes.includes('LoraLoaderModelOnly'), 'v1 restyle: no CausVid LoRA (v2 candidate)')
  assert.ok(!classes.includes('Canny'), 'v1 wires the source frames directly (no preprocessor)')

  const unet = nodeByClass(g, 'UNETLoader')
  assert.equal(unet.inputs.unet_name, 'wan2.1_vace_14B_fp16.safetensors')
  assert.equal(unet.inputs.weight_dtype, 'fp8_e4m3fn', 'fp16 file loaded with fp8 cast (no official fp8 repack exists)')
  const load = nodesWithClass(g, 'LoadVideo')[0]
  assert.equal(load.inputs.file, VID_REF)
  const vace = nodeByClass(g, 'WanVaceToVideo')
  assert.equal(vace.inputs.control_video[0], nodeIdByClass(g, 'GetVideoComponents'))
  assert.equal(vace.inputs.strength, 0.6, 'default restyle_strength 0.5 → 0.2 + 0.8×0.5 (documented curve)')
  assert.equal(vace.inputs.width, 832)
  assert.equal(vace.inputs.height, 480)
  assert.equal(vace.inputs.length, 81)
  assert.equal('control_masks' in vace.inputs, false, 'no mask in v1')
  assert.equal('reference_image' in vace.inputs, false, 'ref2v is v2')
  const samp = nodeByClass(g, 'KSampler')
  assert.deepEqual({ steps: samp.inputs.steps, cfg: samp.inputs.cfg, sampler: samp.inputs.sampler_name }, { steps: 20, cfg: 6, sampler: 'uni_pc' })
  const vaceId = nodeIdByClass(g, 'WanVaceToVideo')
  assert.deepEqual(samp.inputs.positive, [vaceId, 0])
  assert.deepEqual(samp.inputs.negative, [vaceId, 1])
  assert.deepEqual(samp.inputs.latent_image, [vaceId, 2])
  const create = nodeByClass(g, 'CreateVideo')
  assert.equal(create.inputs.fps, 16)
  const save = nodeByClass(g, 'SaveVideo')
  assert.equal(save.inputs.filename_prefix, 'sylo-video/restyle')
  assert.equal(save.inputs.format, 'mp4')
  assert.match(notes[0], /VACE strength 0\.6/)
  assert.equal(expected.variant, 'v2v')
})

test('RESTYLE strength curve: 0→0.2 (structure never fully dissolves), 1→1.0 exact; clamp on build', () => {
  assert.equal(vaceStrengthForMotionStrength(undefined), 0.6)
  assert.equal(vaceStrengthForMotionStrength(0), 0.2)
  assert.equal(vaceStrengthForMotionStrength(1), 1.0)
  const strong = buildRestyleWorkflow(restyleReq({ restyle_strength: 1 }), undefined, { sourceVideoRef: VID_REF })
  assert.equal(nodeByClass(strong.workflow, 'WanVaceToVideo').inputs.strength, 1.0)
  const soft = buildRestyleWorkflow(restyleReq({ restyle_strength: 0 }), undefined, { sourceVideoRef: VID_REF })
  assert.equal(nodeByClass(soft.workflow, 'WanVaceToVideo').inputs.strength, 0.2)
})

// ── Dynamic-combo probe builder + dispatch + validation ──

test('probe builder: flat SaveVideo shape default; nested shape available for A/B on live ComfyUI', () => {
  const flat = buildDynamicComboProbeWorkflow()
  assert.deepEqual(Object.values(flat).map((n) => n.class_type), ['EmptyImage', 'CreateVideo', 'SaveVideo'])
  const save = flat['3']
  assert.equal(save.inputs.format, 'mp4')
  assert.equal(save.inputs.codec, 'h264')
  assert.deepEqual(save.inputs.video, ['2', 0])
  // The nested alternative (the executor also understands dicts per _io.execute()) — for the live A/B, not the lock.
  const nested = buildDynamicComboProbeWorkflow({ nested: true })
  assert.deepEqual(nested['3'].inputs.format, { format: 'mp4', codec: { codec: 'h264' } })
  assert.equal(save.inputs.filename_prefix, 'sylo-video/probe')
  const custom = buildDynamicComboProbeWorkflow({ format: 'webm', codec: 'av1' })
  assert.equal(custom['3'].inputs.format, 'webm')
  assert.equal(custom['3'].inputs.codec, 'av1')
})

/**
 * LIVE PROBE RECORD (2026-10-12, ComfyUI 0.39.2 — the §0 dynamic-combo VERIFY guard, run with
 * the queue verified EMPTY): the FLAT /prompt shape was ACCEPTED —
 *   POST /prompt SaveVideo inputs: { video:['2',0], filename_prefix:'sylo-video/probe',
 *   format: 'mp4', codec: 'h264' }  →  prompt_id 7a413c77-3481-4869-a007-8467c13d0b51  →
 *   history output probe_00001_.mp4 (subfolder sylo-video, type output) — 1928 bytes via /view.
 * The video file + history entry were left untouched (protocol). The nested dict shape was NOT
 * needed (the flat probe accepted on the first try). Lock: builders emit ONLY the flat shape;
 * test:workflows asserts the flat shape on every graph; wrong shapes still surface their 400
 * body (client test: "400 bodies SURFACED"). mp4+h264 container confirmed at the file level.
 */
test('LOCKED dynamic-combo shape (live probe 2026-10-12): every builder emits flat format/codec mp4+h264', () => {
  const probeSave = Object.values(buildDynamicComboProbeWorkflow()).find((n) => n.class_type === 'SaveVideo')
  assert.equal(typeof probeSave.inputs.format, 'string', 'FLAT — a plain string, not a dict (live-locked)')
  assert.equal(typeof probeSave.inputs.codec, 'string')
  for (const [name, built] of [
    ['draft', buildClipWorkflow(clipReq({ preset: 'draft', seed: 1 }))],
    ['final', buildClipWorkflow(clipReq({ preset: 'final', resolution: '480p', seed: 1 }))],
    ['loop', buildLoopWorkflow(loopReq(), undefined, { sourceImageRef: IMG_REF })],
    ['restyle', buildRestyleWorkflow(restyleReq(), undefined, { sourceVideoRef: VID_REF })],
  ]) {
    const save = nodeByClass(built.workflow, 'SaveVideo')
    assert.equal(save.inputs.format, 'mp4', `${name}: locked container (flat string — the live-accepted shape)`)
    assert.equal(save.inputs.codec, 'h264', `${name}: locked codec (flat string)`)
    assert.equal(typeof save.inputs['format'], 'string')
    assert.ok(!('animated' in save.inputs))
    // mp4 ext must classify video in the client (the probe file was probe_00001_.mp4).
    assert.equal(SAVE_VIDEO_FORMAT, 'mp4')
  }
})

test('buildWorkflowForRequest: dispatch per mode + actionable unknown/unwired/missing-ref errors', () => {
  const clip = clipReq()
  assert.ok(buildWorkflowForRequest(clip, undefined, findVideoModelEntry('wan22-ti2v-5b')))
  const loopG = buildWorkflowForRequest(loopReq(), { sourceImageRef: IMG_REF })
  assert.deepEqual(Object.values(loopG).map((n) => n.class_type).includes('WanFirstLastFrameToVideo'), true)
  const restyleG = buildWorkflowForRequest(restyleReq(), { sourceVideoRef: VID_REF })
  assert.ok(Object.values(restyleG).map((n) => n.class_type).includes('WanVaceToVideo'))
  // Unknown model.
  assert.throws(() => buildWorkflowForRequest({ ...clip, model: 'nope' }), /Unknown video model "nope"/)
  // Opt-in accepted in config but NOT wired — plain-language rejection before submit.
  const optIn = { ...clipReq({ preset: 'draft' }), model: 'ltx-2.5', mode_roles: undefined }
  assert.throws(() => buildWorkflowForRequest(optIn, undefined), /opt-in-only.*not wired in v1/)
  // VACE cannot serve clip (no t2v wiring).
  assert.throws(() => buildWorkflowForRequest({ ...clip, model: 'wan21-vace-14b' }), /no t2v wiring for the clip mode/)
  // Missing source refs for i2v/loop/restyle are build-order bugs with actionable text.
  assert.throws(() => buildLoopWorkflow(loopReq()), /source still.*build-order bug/)
  assert.throws(() => buildRestyleWorkflow(restyleReq()), /source clip.*build-order bug/)
  // Loop request through the clip builder delegates to the loop builder (still needs the ref).
  assert.throws(() => buildClipWorkflow(loopReq()), /source still/)
})

function assertFramesAre4n1(n) {
  assert.equal((n - 1) % 4, 0, `${n} must be 4n+1`)
}

// ── Catalog ↔ builder cross-consistency (§2.4 discipline) ──

test('CROSS-CONSISTENCY: every builder-emitted model path is catalog-listed; builder accepts catalog ids only', () => {
  for (const m of VIDEO_MODEL_CATALOG) {
    if (Object.keys(m.comfy.variants).length === 0) continue
    const listed = new Set(m.download?.repo_files.map((p) => p.split('/').pop()))
    for (const [variantName, v] of Object.entries(m.comfy.variants)) {
      void variantName
      for (const f of v.diffusion_models) assert.ok(listed.has(f.file), `${f.file} catalog-listed (${m.id})`)
      assert.ok(listed.has(v.vae), `${v.vae} catalog-listed (${m.id})`)
      for (const l of v.loras ?? []) assert.ok(listed.has(l), `${l} catalog-listed (${m.id})`)
      const te = m.comfy.text_encoders[0]
      assert.ok(listed.has(te), `${te} catalog-listed (${m.id})`)
      // The builder accepts each wired variant id (throws only when refs missing at build order).
      try {
        const req =
          variantName === 't2v'
            ? clipReq({ model: m.id, preset: m.role === 'draft' ? 'draft' : 'final', resolution: m.resolutions[0], framerate: m.default_framerate })
            : variantName === 'i2v'
              ? clipReq({ model: m.id, preset: 'final', source_image_path: 's.png', resolution: m.resolutions[0] })
              : variantName === 'flf2v'
                ? loopReq({ model: m.id, resolution: m.resolutions[0] })
                : restyleReq({ model: m.id, resolution: m.resolutions[0] })
        const ctx = v.image_input ? { sourceImageRef: IMG_REF } : v.video_input ? { sourceVideoRef: VID_REF } : {}
        // buildWorkflowForRequest returns the GRAPH directly (imagegen parity — no wrapper).
        const wf = buildWorkflowForRequest(req, ctx, m)
        assert.ok(Object.keys(wf).length > 5, `${m.id}/${variantName} builds a real graph`)
        // Every graph's LATENT node is the wired one.
        assert.ok(nodesWithClass(wf, v.latent_node).length > 0, `${v.latent_node} present`)
      } catch (err) {
        // Only build-order ref errors allowed here (catalog/wiring errors are test failures).
        assert.match(err.message, /build-order bug|opt-in-only/, `${m.id}/${variantName}: unexpected build error ${err.message}`)
      }
    }
  }
})