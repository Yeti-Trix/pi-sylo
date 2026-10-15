// Unit tests for the video model catalog + request/frame resolution (plan §2.2/
// §2.5, §8 step 2 = plan §2 + §8.2 pairing). Pure offline — no ComfyUI involved.
// Run: npm run test:catalog (esbuild-bundles → node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DRAFT_VIDEO_MODEL,
  DEFAULT_FINAL_VIDEO_MODEL,
  DEFAULT_RESTYLE_VIDEO_MODEL,
  EXCLUDED_VIDEO_MODELS,
  MAX_VIDEOS_PER_CALL,
  VIDEO_DURATIONS_SECONDS,
  VIDEO_MODEL_CATALOG,
  VIDEO_MODEL_IDS,
  VIDEO_MODES,
  VIDEO_ORIENTATIONS,
  VIDEO_PRESETS,
  VIDEO_RESOLUTIONS,
  assertFramesAre4n1,
  findVideoModelEntry,
  framesForDuration,
  loopOutputFramesForDuration,
  resolutionPxFor,
  resolveModelForRequest,
  resolveVideoGenRequest,
  workflowVariantFor,
} from './catalog.ts'
import { coerceVideoGenRequest, coerceVideogenConfig } from './types.ts'

const wiredEntries = VIDEO_MODEL_CATALOG.filter((m) => Object.keys(m.comfy.variants ?? {}).length > 0)

test('catalog: exactly the three wired v1 models + two opt-ins, all ids stable + role-correct', () => {
  assert.deepEqual(VIDEO_MODEL_IDS, ['wan22-ti2v-5b', 'wan22-a14b', 'wan21-vace-14b', 'ltx-2.5', 'hunyuanvideo-1.5'])
  assert.equal(wiredEntries.length, 3)
  for (const m of wiredEntries) {
    assert.equal(m.backend, 'comfyui')
    assert.equal(m.license, 'Apache-2.0')
    assert.equal(m.commercial_ok, true, `${m.id} must be commercial-ok (§2.2)`)
    assert.ok(m.license_badge.includes('Apache-2.0'))
    assert.ok(m.approx_size_gb > 0)
    assert.ok(m.min_vram_gb > 0)
    assert.ok(Array.isArray(m.mode_roles) && m.mode_roles.length > 0, `${m.id} needs mode_roles`)
    assert.ok(Array.isArray(m.resolutions) && m.resolutions.length > 0)
    assert.ok(Array.isArray(m.durations_seconds) && m.durations_seconds.length > 0)
    assert.equal(m.max_duration_seconds, 8)
    assert.ok(m.comfy.clip_type === 'wan', `${m.id} uses CLIPLoader type wan (live enum verified)`)
    assert.ok(m.comfy.text_encoders.length > 0, `${m.id} needs a text encoder (umt5)`)
  }
  // Role/mode matrix matches §2.2: draft clips for the 5B, finals + loops for A14B, restyle for VACE.
  assert.deepEqual(findVideoModelEntry('wan22-ti2v-5b').mode_roles, ['clip'])
  assert.ok(findVideoModelEntry('wan22-ti2v-5b').role === 'draft')
  assert.deepEqual(findVideoModelEntry('wan22-a14b').mode_roles, ['clip', 'loop'])
  assert.ok(findVideoModelEntry('wan22-a14b').role === 'final')
  assert.deepEqual(findVideoModelEntry('wan21-vace-14b').mode_roles, ['restyle'])
  assert.ok(findVideoModelEntry('wan21-vace-14b').role === 'restyle')
})

test('opt-in entries are catalog-present but empty-wired + badged (FLUX-dev badge stance)', () => {
  for (const id of ['ltx-2.5', 'hunyuanvideo-1.5']) {
    const m = findVideoModelEntry(id)
    assert.ok(m)
    assert.deepEqual(Object.keys(m.comfy.variants), [], `${id} ships NO wiring in v1 (opt-in)`)
    assert.equal(m.commercial_ok, false)
    assert.ok(m.license_badge, `${id} needs a license badge`)
    assert.match(m.license_badge, /not wired in v1/)
    assert.ok(m.download?.huggingface_url.startsWith('https://huggingface.co/'))
  }
})

test('excluded entries carry plain reasons and are never catalog ids (§1 absolute exclusions)', () => {
  const ids = EXCLUDED_VIDEO_MODELS.map((e) => e.id)
  assert.deepEqual(ids, ['minimax-h3', 'cogvideox', 'sora'])
  for (const e of EXCLUDED_VIDEO_MODELS) {
    assert.ok(e.reason.length > 20, `${e.id} needs a plain-language reason`)
    assert.equal(findVideoModelEntry(e.id), undefined, `${e.id} must NOT be in the catalog`)
  }
})

test('download info: HF URL shape + every wired variant file is listed on the entry (repo_files)', () => {
  for (const m of wiredEntries) {
    const d = m.download
    assert.ok(d, `${m.id} needs download targets (doctor-guided, §2.2)`)
    assert.ok(d.huggingface_url.startsWith('https://huggingface.co/Comfy-Org/'), `${m.id} downloads from the Comfy-Org repack`)
    assert.ok(d.targets.length > 0)
    for (const f of d.repo_files) assert.match(f, /^split_files\//, 'repo paths anchor the split_files layout (HF-listing discipline)')
    // Cross-consistency: every variant file the builders emit is catalog-listed below.
    const listed = new Set(d.repo_files.map((p) => p.split('/').pop()))
    for (const variant of Object.values(m.comfy.variants)) {
      assert.ok(listed.has(variant.vae), `${m.id} vae ${variant.vae} listed`)
      for (const dit of variant.diffusion_models) assert.ok(listed.has(dit.file), `${m.id} DiT ${dit.file} listed`)
      for (const lora of variant.loras ?? []) assert.ok(listed.has(lora), `${m.id} lora ${lora} listed`)
    }
    for (const te of m.comfy.text_encoders) assert.ok(listed.has(te), `${m.id} TE ${te} listed`)
  }
})

test('comfy wiring matches the official 0.11.78 templates verbatim (file basenames)', () => {
  // Draft: wan2.2_ti2v_5B_fp16 + wan2.2_vae (Wan22ImageToVideoLatent covers t2v AND i2v).
  const draft = findVideoModelEntry('wan22-ti2v-5b')
  assert.deepEqual(draft.comfy.variants.t2v.diffusion_models.map((f) => f.file), ['wan2.2_ti2v_5B_fp16.safetensors'])
  assert.equal(draft.comfy.variants.t2v.vae, 'wan2.2_vae.safetensors')
  assert.equal(draft.comfy.variants.t2v.latent_node, 'Wan22ImageToVideoLatent')
  assert.equal(draft.comfy.variants.t2v.sampling_shift, 8)
  assert.equal(draft.comfy.variants.i2v.image_input, 'start_image')
  // Sampling knobs live at the ENTRY level (variants carry optional overrides only — v1 has none).
  assert.equal(draft.steps, 20)
  assert.equal(draft.cfg, 5)
  assert.equal(draft.sampler, 'uni_pc')
  assert.equal(findVideoModelEntry('wan22-a14b').steps, 4)
  assert.equal(findVideoModelEntry('wan22-a14b').cfg, 1)
  const vaceStepsCfg = [findVideoModelEntry('wan21-vace-14b').steps, findVideoModelEntry('wan21-vace-14b').cfg]
  assert.deepEqual(vaceStepsCfg, [20, 6])

  // Final: A14B fp8 pair + lightx2v LoRAs; t2v latent = EmptyHunyuanLatentVideo, i2v = WanImageToVideo.
  const final = findVideoModelEntry('wan22-a14b')
  assert.deepEqual(
    final.comfy.variants.t2v.diffusion_models.map((f) => f.file),
    ['wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors', 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors'],
  )
  assert.deepEqual(final.comfy.variants.t2v.loras, [
    'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
    'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
  ])
  assert.equal(final.comfy.variants.t2v.latent_node, 'EmptyHunyuanLatentVideo')
  assert.equal(final.comfy.variants.i2v.latent_node, 'WanImageToVideo')
  assert.deepEqual(
    final.comfy.variants.i2v.loras,
    [
      'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
      'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    ],
  )
  assert.equal(final.comfy.variants.flf2v.latent_node, 'WanFirstLastFrameToVideo')
  // Loop reuses the i2v DiTs + LoRAs (template parity).
  assert.deepEqual(final.comfy.variants.flf2v.diffusion_models, final.comfy.variants.i2v.diffusion_models)
  assert.equal(final.comfy.variants.flf2v.image_input, 'start_end_image')

  // Restyle: single VACE DiT (fp16 file loaded WITH fp8 cast — no official fp8 repack exists),
  // wan_2.1_vae, video input, no LoRAs in v1 (CausVid = v2).
  const vace = findVideoModelEntry('wan21-vace-14b')
  const v2v = vace.comfy.variants.v2v
  assert.deepEqual(v2v.diffusion_models, [{ file: 'wan2.1_vace_14B_fp16.safetensors', weight_dtype: 'fp8_e4m3fn' }])
  assert.equal(v2v.vae, 'wan_2.1_vae.safetensors')
  assert.equal(v2v.latent_node, 'WanVaceToVideo')
  assert.equal(v2v.video_input, true)
  assert.ok(!v2v.loras)
  assert.ok(Array.isArray(vace.download?.repo_files))
  assert.ok(vace.download.repo_files.length > 0)
  assert.ok(vace.notes?.includes('strength'), 'VACE entry documents the strength mapping')
  // umt5 encoder shared by every wired model.
  const te = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'
  for (const m of wiredEntries) assert.deepEqual(m.comfy.text_encoders, [te])
})

test('frame tables (§2.5): duration×fps+1, exactly the verified 65/81/129/97/121/193 values', () => {
  // 16 fps community-verified row.
  assert.equal(framesForDuration(4, 16), 65)
  assert.equal(framesForDuration(5, 16), 81)
  assert.equal(framesForDuration(8, 16), 129)
  // 24 fps derived row (ti2v 5B native fps).
  assert.equal(framesForDuration(4, 24), 97)
  assert.equal(framesForDuration(5, 24), 121)
  assert.equal(framesForDuration(8, 24), 193)
  // 4n+1 for every catalog (duration, model-default-fps) pair.
  for (const m of wiredEntries) {
    for (const d of m.durations_seconds) {
      const f = framesForDuration(d, m.default_framerate)
      assertFramesAre4n1(f, `${m.id} ${d} s @ ${m.default_framerate} fps`)
    }
  }
  // Loop output = −1 (duplicated final frame trimmed post-decode).
  assert.equal(loopOutputFramesForDuration(5, 16), 80)
  assert.equal(loopOutputFramesForDuration(4, 24), 96)
  assert.equal(loopOutputFramesForDuration(8, 16), 128)
  // Rejections stay plain-language.
  assert.throws(() => framesForDuration(5, 0), /duration_seconds\/framerate/)
  assert.throws(() => framesForDuration(3.7, 16), /4n\+1/)
  assert.throws(() => assertFramesAre4n1(80, 'nonconforming'), /4n\+1/)
})

test('resolutionPxFor: §2.1 px pairs per model; unsupported combos error plainly', () => {
  const fiveB = findVideoModelEntry('wan22-ti2v-5b')
  // 5B native pair from the official template (1280×704) — 16-px generic table overridden per catalog.
  assert.deepEqual(resolutionPxFor(fiveB, '720p', 'landscape'), { width: 1280, height: 704 })
  assert.deepEqual(resolutionPxFor(fiveB, '720p', 'portrait'), { width: 704, height: 1280 })
  assert.equal(fiveB.resolutions.length, 1, '5B is 720p-native — no 480p offer')
  assert.throws(() => resolutionPxFor(fiveB, '480p', 'landscape'), /does not support 480p/)

  const a14b = findVideoModelEntry('wan22-a14b')
  assert.deepEqual(resolutionPxFor(a14b, '480p', 'landscape'), { width: 832, height: 480 })
  assert.deepEqual(resolutionPxFor(a14b, '720p', 'portrait'), { width: 720, height: 1280 })
  const vace = findVideoModelEntry('wan21-vace-14b')
  assert.deepEqual(resolutionPxFor(vace, '480p', 'portrait'), { width: 480, height: 832 })
  // All px pairs are step-16 multiples (latent nodes require it; 5B pairs step-32).
  for (const m of wiredEntries) {
    const firstVariant = Object.values(m.comfy.variants)[0]
    for (const [res, byOrient] of Object.entries(m.resolution_px)) {
      for (const [, px] of Object.entries(byOrient)) {
        const step = firstVariant.latent_node === 'Wan22ImageToVideoLatent' ? 32 : 16
        assert.equal(px.width % step, 0, `${m.id} ${res} width multiple of ${step}`)
        assert.equal(px.height % step, 0, `${m.id} ${res} height multiple of ${step}`)
      }
    }
  }
})

test('workflowVariantFor: clip→t2v/i2v by still presence, loop→flf2v, restyle→v2v', () => {
  assert.equal(workflowVariantFor({ mode: 'clip' }), 't2v')
  assert.equal(workflowVariantFor({ mode: 'clip', source_image: 'x.png' }), 'i2v')
  assert.equal(workflowVariantFor({ mode: 'loop', source_image: 'x.png' }), 'flf2v')
  assert.equal(workflowVariantFor({ mode: 'restyle' }), 'v2v')
})

test('resolveModelForRequest: mode-aware pairing + config overrides + mode_roles rejections', () => {
  assert.equal(resolveModelForRequest('clip', 'draft', undefined, {}).id, DEFAULT_DRAFT_VIDEO_MODEL)
  assert.equal(resolveModelForRequest('clip', 'final', undefined, {}).id, DEFAULT_FINAL_VIDEO_MODEL)
  assert.equal(resolveModelForRequest('loop', 'final', undefined, {}).id, 'wan22-a14b')
  assert.equal(resolveModelForRequest('restyle', 'final', undefined, {}).id, DEFAULT_RESTYLE_VIDEO_MODEL)
  // Config pairing ( VideogenConfig keys win over catalog defaults).
  assert.equal(resolveModelForRequest('clip', 'draft', undefined, { draft_model: 'wan22-a14b' }).id, 'wan22-a14b')
  // Explicit model wins but must serve the mode.
  assert.equal(resolveModelForRequest('clip', 'draft', 'wan22-a14b', {}).id, 'wan22-a14b')
  assert.throws(() => resolveModelForRequest('loop', 'final', 'wan22-ti2v-5b', {}), /does not serve the loop mode/)
  assert.throws(() => resolveModelForRequest('clip', 'draft', 'wan21-vace-14b', {}), /does not serve/)
  assert.throws(() => resolveModelForRequest('clip', 'draft', 'ltx-2.5', {}), /opt-in entry, not wired/)
})

test('resolveVideoGenRequest: end-to-end defaults, seeds, frames, lineage + actionable errors', () => {
  const req = resolveVideoGenRequest({ prompt: 'slow dolly through neon rain' }, { loop_motion_strength: 0.5 })
  assert.equal(req.mode, 'clip')
  assert.equal(req.preset, 'draft')
  assert.equal(req.model, 'wan22-ti2v-5b')
  assert.equal(req.resolution, '720p')
  assert.equal(req.orientation, 'landscape')
  assert.equal(req.duration_seconds, 5)
  assert.equal(req.framerate, 24)
  assert.equal(req.frame_count, 121)
  assert.ok(Number.isInteger(req.seed) && req.seed >= 0)
  assert.equal(req.count, 1)
  assert.equal(req.save, true)

  const determin = resolveVideoGenRequest({ prompt: 'x', seed: 42 })
  assert.equal(determin.seed, 42)

  // i2v: source still presence flips the variant; from_image_id alias flows to source_image_id.
  const i2v = resolveVideoGenRequest({ prompt: 'bring it alive', mode: 'clip', source_image_path: 'C:/stills/a.png', preset: 'final' })
  assert.equal(i2v.model, 'wan22-a14b')
  assert.equal(i2v.source_image_path, 'C:/stills/a.png')
  const fromImage = resolveVideoGenRequest({ prompt: 'x', mode: 'clip', from_image_id: 'img-9' })
  assert.equal(fromImage.source_image_id, 'img-9')
  assert.ok(fromImage.from_image_id === 'img-9')

  // Loop: default strength from config, loop model forced to the A14B.
  const loop = resolveVideoGenRequest({ prompt: 'subtle hair sway', mode: 'loop', source_image_path: 's.png', loop_motion_strength: 0.3 }, { loop_motion_strength: 0.3 })
  assert.equal(loop.mode, 'loop')
  assert.equal(loop.model, 'wan22-a14b')
  assert.equal(loop.preset, 'final')
  assert.equal(loop.loop_motion_strength, 0.3)
  assert.equal(loop.framerate, 16)
  assert.equal(loop.frame_count, 81)

  // Restyle: source clip required, restyle model by config key, strength default 0.5.
  const restyle = resolveVideoGenRequest({ prompt: 'paint it', mode: 'restyle', source_video_path: 'C:/clips/in.mp4' })
  assert.equal(restyle.model, 'wan21-vace-14b')
  assert.equal(restyle.restyle_strength, 0.5)
  assert.equal(restyle.frame_count, 81)

  // Actionable errors — regex as assert.throws' SECOND arg (the §2 review round:
  // these were landing in the resolver's opts/seedFn slots and were decorative).
  assert.throws(() => resolveVideoGenRequest({}), /prompt is required/)
  assert.throws(() => resolveVideoGenRequest({ prompt: 'x', duration_seconds: 6 }), /must be one of/)
  assert.throws(() => resolveVideoGenRequest({ prompt: 'x', resolution: '1080p' }), /not one of/)
  assert.throws(() => resolveVideoGenRequest({ prompt: 'x', orientation: 'square' }), /not one of/)
  assert.throws(() => resolveVideoGenRequest({ prompt: 'x', mode: 'loop' }), /source still/)
  assert.throws(() => resolveVideoGenRequest({ prompt: 'x', mode: 'restyle' }), /source clip/)
  assert.throws(() => resolveVideoGenRequest({ prompt: 'x', count: 3 }), /count must be between/)
  // §8.6 seed-sentinel fix: -1 is coerceVideoGenRequest's ABSENT-seed sentinel
  // (§2.1 seed?) — the resolver rolls it a fresh random like an omitted seed;
  // other out-of-range explicit seeds still fail with the actionable message.
  const unseeded = resolveVideoGenRequest({ prompt: 'x', seed: -1 })
  assert.ok(Number.isInteger(unseeded.seed) && unseeded.seed >= 0 && unseeded.seed !== -1)
  assert.throws(() => resolveVideoGenRequest({ prompt: 'x', seed: -2 }), /between/)
  // MAX_VIDEOS_PER_CALL = 2 (clips cost minutes).
  const two = resolveVideoGenRequest({ prompt: 'x', count: 2 })
  assert.equal(two.count, 2)
  assert.equal(MAX_VIDEOS_PER_CALL, 2)
})

test('coerceVideoGenRequest: out-of-range count clamps 1–2 with a plain-language note (§2 review round — was silent)', () => {
  const hi = coerceVideoGenRequest({ prompt: 'x', count: 5 })
  assert.equal(hi.request.count, 2)
  assert.match(hi.notes[0], /count 5 is outside 1–2 .MAX_VIDEOS_PER_CALL. — clamped to 2\./)
  const lo = coerceVideoGenRequest({ prompt: 'x', count: 0 })
  assert.equal(lo.request.count, 1)
  assert.match(lo.notes[0], /count 0 is outside 1–2 .* clamped to 1\./)
  const normal = coerceVideoGenRequest({ prompt: 'x', count: 2 })
  assert.equal(normal.request.count, 2)
  assert.equal(normal.notes.length, 0, 'in-range count coerces silently')
})

test('enumeration unions match the plan §2.1 contract exactly', () => {
  assert.deepEqual([...VIDEO_MODES], ['clip', 'loop', 'restyle'])
  assert.deepEqual([...VIDEO_PRESETS], ['draft', 'final'])
  assert.deepEqual([...VIDEO_RESOLUTIONS], ['480p', '720p'])
  assert.deepEqual([...VIDEO_ORIENTATIONS], ['landscape', 'portrait'])
  assert.deepEqual([...VIDEO_DURATIONS_SECONDS], [4, 5, 8])
})

test('coerceVideogenConfig accepts the catalog ids (config coerce reads VIDEO_MODEL_IDS, not the §8.1 inline list)', () => {
  const bad = coerceVideogenConfig({ draft_model: 'nope', final_model: 'wan22-a14b', restyle_model: 'wan21-vace-14b', loop_motion_strength: 2.5 })
  assert.match(bad.notes[0], /is not in the video-model catalog/)
  assert.equal(bad.config.draft_model, 'wan22-ti2v-5b')
  assert.equal(bad.config.loop_motion_strength, 1)
  const optIn = coerceVideogenConfig({ draft_model: 'wan22-a14b', final_model: 'ltx-2.5' })
  assert.equal(optIn.config.final_model, 'ltx-2.5', 'opt-in ids stay accepted (§8.1 config contract)')
  assert.ok(optIn.notes.length === 0)
})