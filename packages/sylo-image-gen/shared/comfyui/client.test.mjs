// Unit tests for the ComfyUI HTTP client (plan §2.3, §8 step 2). The global
// `fetch` is stubbed — zero network, no running ComfyUI required. Covers the
// endpoint contract, request/response shapes, typed errors, and the generate
// composition. Run: npm run test:client (esbuild-bundles → node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMFYUI_CLIENT_ID,
  ComfyUIError,
  comfyDoctorProbe,
  comfyFetchImageBytes,
  comfyGenerate,
  comfyHealth,
  comfyModelsDetected,
  comfyPollResult,
  comfySubmitWorkflow,
  comfySystemStats,
  comfyValidateWorkflowNodes,
  comfyInterrupt,
  pngDimensions,
  __setPollIntervalForTests,
  resolveComfyEndpoint,
} from './client.ts'
import { resolveGenRequest } from '../models.ts'

/** Minimal PNG whose IHDR carries w/h (dims are all the client reads). */
function pngBytes(width, height) {
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return new Uint8Array([
    ...sig, //            bytes 0–7: signature
    ...u32(13), //        bytes 8–11: first-chunk length (IHDR)
    0x49, 0x48, 0x44, 0x52, // bytes 12–15: 'IHDR'
    ...u32(width), //     bytes 16–19: width BE
    ...u32(height), //    bytes 20–23: height BE
    8, 2, 0, 0, 0, //     bytes 24–28: bit depth 8, color type 2, rest ignored
  ])
}

/** Deterministic fetch stub: routes GET/POST by URL pattern; returns a restore fn. */
function stubFetch(handler) {
  const fake = async (url, init = {}) => handler(String(url), init)
  const real = globalThis.fetch
  globalThis.fetch = fake
  return () => {
    globalThis.fetch = real
  }
}

const BASE = 'http://127.0.0.1:8188'

function jsonResponse(url, body, status = 200) {
  return { ok: status < 400, status, statusText: status === 200 ? 'OK' : 'Bad Request', url, json: async () => body }
}

function bytesResponse(url, bytes) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url,
    arrayBuffer: async () => bytes.slice().buffer,
    json: async () => {
      throw new Error('not json')
    },
  }
}

test('COMFYUI_CLIENT_ID: stable-per-process uuid (cancel/progress attribution)', () => {
  assert.match(COMFYUI_CLIENT_ID, /^[0-9a-f-]{36}$/i)
})

test('comfyHealth: /system_stats + /queue → ok snapshot with device/VRAM/queue depth', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/system_stats`)
      return jsonResponse(url, {
        system: { comfyui_version: '1.x.y' },
        devices: [{ name: 'NVIDIA GeForce RTX 5090', vram_total: 34225520640, vram_free: 29127106560 }],
      })
    if (url === `${BASE}/queue`) return jsonResponse(url, { queue_running: ['a'], queue_pending: ['b', 'c'] })
    throw new Error(`unexpected ${url}`)
  })
  try {
    const health = await comfyHealth(`${BASE}/`)
    assert.equal(health.ok, true)
    assert.equal(health.url, BASE) // trailing slash normalized
    assert.equal(health.version, '1.x.y')
    assert.equal(health.device_name, 'NVIDIA GeForce RTX 5090')
    assert.equal(health.vram_total_bytes, 34225520640)
    assert.equal(health.vram_free_bytes, 29127106560)
    assert.equal(health.queue_depth, 3)
  } finally {
    restore()
  }
})

test('comfyHealth: dead ComfyUI → ok:false with actionable text (doctor path), never throws', async () => {
  const restore = stubFetch(async () => {
    throw new TypeError('fetch failed')
  })
  try {
    const health = await comfyHealth('http://127.0.0.1:9999')
    assert.equal(health.ok, false)
    assert.match(health.error, /ComfyUI not reachable at http:\/\/127\.0\.0\.1:9999/)
    assert.match(health.error, /sylo_image_gen_doctor/)
  } finally {
    restore()
  }
})

test('comfyModelsDetected: exact-file detection per catalog comfy wiring', async () => {
  const objectInfo = {
    UNETLoader: { inputs: { unet_name: ['z_image_turbo_bf16.safetensors', 'flux1-dev-fp8.safetensors', 'flux2_klein_bf16.safetensors', 'flux2_dev_fp8mixed.safetensors', 'qwen_image_2512_fp8_e4m3fn.safetensors'] } },
    CheckpointLoaderSimple: { inputs: { ckpt_name: [] } },
    CLIPLoader: { inputs: { clip_name: ['qwen_3_4b_fp8_mixed.safetensors', 'qwen_2.5_vl_7b_fp8_scaled.safetensors', 'mistral_3_small_fp8_scaled.safetensors', 'mistral_3_small_flux2_fp8.safetensors'] } },
    DualCLIPLoader: { inputs: { clip_name1: ['clip_l.safetensors'], clip_name2: ['t5xxl_fp16.safetensors'] } },
    VAELoader: { inputs: { vae_name: ['qwen_image_vae.safetensors', 'ae.safetensors', 'flux2-vae.safetensors'] } },
  }
  const restore = stubFetch((url) => {
    if (url === `${BASE}/object_info`) return jsonResponse(url, objectInfo)
    throw new Error(`unexpected ${url}`)
  })
  try {
    const detected = await comfyModelsDetected(BASE)
    for (const id of ['z-image-turbo', 'flux2-klein', 'qwen-image-2', 'flux1-dev', 'flux2-dev'])
      assert.equal(detected[id], true, `${id} should be detected when all its files are present`)

    // One missing leg (the shared ae.safetensors VAE) ⇒ not detected — detect, never trust.
    // Since round-2 (2026-10-11) flux1-dev and z-image-turbo legitimately SHARE ae.safetensors
    // (byte-identical FLUX.1 AE, sha afc8e282…): dropping it undetects BOTH models, while
    // qwen-image-2 stays detected on its own qwen_image_vae (different file — per-family VAEs).
    const missingVae = { ...objectInfo, VAELoader: { inputs: { vae_name: ['qwen_image_vae.safetensors'] } } }
    const restore2 = stubFetch((url) => (url === `${BASE}/object_info` ? jsonResponse(url, missingVae) : undefined))
    try {
      const d2 = await comfyModelsDetected(BASE)
      assert.equal(d2['flux1-dev'], false)
      assert.equal(d2['z-image-turbo'], false)
      assert.equal(d2['qwen-image-2'], true)
    } finally {
      restore2()
    }
  } finally {
    restore()
  }
})

test('comfyModelsDetected: unreachable server → typed not_reachable pointing at doctor', async () => {
  const restore = stubFetch(async (url) => {
    const err = new TypeError('fetch failed')
    err.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8188'), { code: 'ECONNREFUSED' })
    throw err
  })
  try {
    await assert.rejects(
      () => comfyModelsDetected(BASE),
      (err) => err instanceof ComfyUIError && err.code === 'not_reachable' && /sylo_image_gen_doctor/.test(err.message),
    )
  } finally {
    restore()
  }
})

test('comfySubmitWorkflow: POST /prompt body is {prompt, client_id}; returns prompt_id', async () => {
  let seen
  const restore = stubFetch(async (url, init) => {
    if (url === `${BASE}/prompt`) {
      seen = JSON.parse(init.body)
      return jsonResponse(url, { prompt_id: 'p-123', number: 1, node_errors: {} })
    }
    throw new Error(`unexpected ${url}`)
  })
  try {
    const graph = { 1: { class_type: 'SaveImage', inputs: {} } }
    const id = await comfySubmitWorkflow(BASE, graph)
    assert.equal(id, 'p-123')
    assert.deepEqual(seen, { prompt: graph, client_id: COMFYUI_CLIENT_ID })
  } finally {
    restore()
  }
})

test('comfySubmitWorkflow: HTTP 400 + node_errors → typed submit_rejected naming the node/class', async () => {
  const restore = stubFetch(async (url) => {
    if (url === `${BASE}/prompt`)
      return jsonResponse(
        url,
        {
          error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
          node_errors: { '30': { class_type: 'KSampler', errors: [{ message: 'Value not in list', details: 'sampler_name: not in list' }] } },
        },
        400,
      )
    throw new Error(`unexpected ${url}`)
  })
  try {
    await assert.rejects(
      () => comfySubmitWorkflow(BASE, {}),
      (err) => {
        assert.ok(err instanceof ComfyUIError)
        assert.equal(err.code, 'submit_rejected')
        assert.equal(err.httpStatus, 400)
        assert.match(err.message, /rejected the workflow.*prompt_outputs_failed_validation/)
        assert.match(err.message, /node 30 \(KSampler\).*not in list/)
        assert.match(err.message, /sylo_image_gen_doctor/)
        return true
      },
    )
  } finally {
    restore()
  }
})

const historyEntry = (refs, status) => (url) =>
  url.startsWith(`${BASE}/history/`)
    ? jsonResponse(url, { 'p-x': { outputs: refs, ...(status ? { status } : {}) } })
    : Promise.reject(new Error(`unexpected ${url}`))

test('comfyPollResult: collects only type:output refs (temp/preview excluded)', async () => {
  __setPollIntervalForTests(1)
  const restore = stubFetch(
    historyEntry(
      {
        '400': { images: [{ filename: 'draft_00001_.png', subfolder: 'sylo', type: 'output' }] },
        '201': { images: [{ filename: 'preview-abc', subfolder: '', type: 'temp' }] },
        '500': { images: [{ filename: 'draft_00002_.png', subfolder: 'sylo', type: 'output' }] },
      },
      { status_str: 'success', completed: true, messages: [] },
    ),
  )
  try {
    const r = await comfyPollResult(BASE, 'p-x', 5_000)
    assert.equal(r.done, true)
    // Sorted by save order (zero-padded counters) — branch seeds map in ascending order.
    assert.deepEqual(r.viewUrls, [
      { filename: 'draft_00001_.png', subfolder: 'sylo', type: 'output' },
      { filename: 'draft_00002_.png', subfolder: 'sylo', type: 'output' },
    ])
  } finally {
    restore()
  }
})

test('comfyPollResult: execution_error → typed execution_failed naming node + exception', async () => {
  __setPollIntervalForTests(1)
  const restore = stubFetch(
    historyEntry(
      {},
      {
        status_str: 'error',
        completed: false,
        messages: [['execution_error', { prompt_id: 'p-x', node_id: '300', node_type: 'KSampler', exception_message: 'Out of memory' }]],
      },
    ),
  )
  try {
    await assert.rejects(
      () => comfyPollResult(BASE, 'p-x', 5_000),
      (err) => {
        assert.ok(err instanceof ComfyUIError)
        assert.equal(err.code, 'execution_failed')
        assert.match(err.message, /node 300 \(KSampler\): Out of memory/)
        return true
      },
    )
  } finally {
    restore()
  }
})

test('comfyPollResult: completed with zero outputs → typed no_outputs', async () => {
  __setPollIntervalForTests(1)
  const restore = stubFetch(
    historyEntry({}, { status_str: 'success', completed: true, messages: [] }),
  )
  try {
    await assert.rejects(
      () => comfyPollResult(BASE, 'p-x', 5_000),
      (err) => err instanceof ComfyUIError && err.code === 'no_outputs',
    )
  } finally {
    restore()
  }
})

test('comfyPollResult: exceeds per-job cap → typed timeout with the job id', async () => {
  __setPollIntervalForTests(10)
  const restore = stubFetch(historyEntry({})) // always empty history
  try {
    await assert.rejects(
      () => comfyPollResult(BASE, 'p-x', 30),
      (err) => {
        assert.ok(err instanceof ComfyUIError)
        assert.equal(err.code, 'timeout')
        assert.match(err.message, /ComfyUI job p-x did not finish/)
        return true
      },
    )
  } finally {
    restore()
  }
})

test('comfyFetchImageBytes: GET /view with encoded params → bytes; 404 → typed bad_status', async () => {
  const bytes = pngBytes(8, 8)
  let sawUrl
  const restore = stubFetch(async (url) => {
    sawUrl = url
    if (url.startsWith(`${BASE}/view`)) return bytesResponse(url, bytes)
    throw new Error(`unexpected ${url}`)
  })
  try {
    const out = await comfyFetchImageBytes(BASE, 'draft 00001_.png', 'sylo/', 'output')
    assert.deepEqual(Array.from(out), Array.from(bytes))
    assert.equal(sawUrl, `${BASE}/view?filename=draft%2000001_.png&subfolder=sylo%2F&type=output`)
  } finally {
    restore()
  }

  const restore404 = stubFetch(async (url) => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    url,
    json: async () => ({ error: {} }),
  }))
  try {
    await assert.rejects(
      () => comfyFetchImageBytes(BASE, 'gone.png', 'sylo', 'output'),
      (err) =>
        err instanceof ComfyUIError &&
        err.code === 'bad_status' &&
        err.httpStatus === 404 &&
        /fetching output\/sylo\/gone\.png/.test(err.message),
    )
  } finally {
    restore404()
  }
})

test('comfyValidateWorkflowNodes: missing node classes are named; complete graphs pass', async () => {
  const objectInfo = { UNETLoader: { inputs: {} }, KSampler: { inputs: {} } }
  const restore = stubFetch((url) => {
    if (url === `${BASE}/object_info`) return jsonResponse(url, objectInfo)
    throw new Error(`unexpected ${url}`)
  })
  try {
    await assert.rejects(
      () => comfyValidateWorkflowNodes(BASE, { a: { class_type: 'UNETLoader' }, b: { class_type: 'KSampler' }, c: { class_type: 'VAELoader' } }),
      (err) => {
        assert.ok(err instanceof ComfyUIError)
        assert.equal(err.code, 'validation_failed')
        assert.match(err.message, /required workflow nodes:/)
        return true
      },
    )
    await comfyValidateWorkflowNodes(BASE, { a: { class_type: 'UNETLoader' }, b: { class_type: 'KSampler' } })
  } finally {
    restore()
  }
})

test('comfyGenerate: end-to-end with stubbed HTTP — validation, submit, poll, fetch, meta (offline)', async () => {
  __setPollIntervalForTests(1)
  const png = pngBytes(768, 432)
  let historyCalls = 0
  const restore = stubFetch(async (url, init) => {
    if (url === `${BASE}/object_info`)
      return jsonResponse(url, {
        UNETLoader: { inputs: {} },
        CLIPLoader: { inputs: {} },
        VAELoader: { inputs: {} },
        CLIPTextEncode: { inputs: {} },
        ModelSamplingAuraFlow: { inputs: {} },
        EmptySD3LatentImage: { inputs: {} },
        KSampler: { inputs: {} },
        VAEDecode: { inputs: {} },
        SaveImage: { inputs: {} },
      })
    if (url === `${BASE}/prompt`) {
      const body = JSON.parse(init.body)
      assert.equal(body.client_id, COMFYUI_CLIENT_ID)
      // count 2 → two latent/sampler/decode/save branches in ONE submitted graph.
      for (const id of ['200', '201', '300', '301', '400', '401', '500', '501']) assert.ok(body.prompt[id], `missing branch node ${id}`)
      assert.equal(Object.values(body.prompt).filter((n) => n.class_type === 'SaveImage').length, 2)
      assert.equal(body.prompt['501'].inputs.filename_prefix, 'sylo/draft')
      return jsonResponse(url, { prompt_id: 'p-gen', number: 1, node_errors: {} })
    }
    if (url.startsWith(`${BASE}/history/`)) {
      historyCalls++
      // First poll: still running; second: both outputs ready (branch order asc).
      if (historyCalls === 1)
        return jsonResponse(url, { 'p-gen': { outputs: {}, status: { status_str: 'success', completed: false, messages: [] } } })
      return jsonResponse(url, {
        'p-gen': {
          outputs: {
            '500': { images: [{ filename: 'draft_00002_.png', subfolder: 'sylo', type: 'output' }] },
            '501': { images: [{ filename: 'draft_00001_.png', subfolder: 'sylo', type: 'output' }] },
          },
          status: { status_str: 'success', completed: true, messages: [] },
        },
      })
    }
    if (url.startsWith(`${BASE}/view`)) return bytesResponse(url, png)
    throw new Error(`unexpected ${url}`)
  })
  try {
    const req = resolveGenRequest({ prompt: 'a red bicycle', preset: 'draft', seed: 500, count: 2 })
    const progress = []
    const { outputs } = await comfyGenerate(BASE, req, { onProgress: (p) => progress.push(p) })
    assert.equal(outputs.length, 2)
    // Sorted by save order → branch seeds map to base+i.
    assert.deepEqual(
      outputs.map((o) => [o.meta.seed, o.width, o.height]),
      [
        [500, 768, 432],
        [501, 768, 432],
      ],
    )
    for (const o of outputs) {
      assert.equal(o.meta.model, 'z-image-turbo')
      assert.equal(o.meta.preset, 'draft')
      assert.equal(o.meta.steps, 8)
      assert.equal(o.meta.sampler, 'res_multistep')
      assert.equal(o.meta.comfy_prompt_id, 'p-gen')
      assert.ok(o.meta.gen_ms >= 0)
      assert.ok(o.buffer.byteLength > 0)
    }
    // Progress ticks come from submit + non-terminal polls.
    assert.deepEqual(progress.map((p) => p.comfy_prompt_id), ['p-gen', 'p-gen'])
    assert.ok(progress[0].elapsed_ms >= 0)
  } finally {
    __setPollIntervalForTests(1000)
    restore()
  }
})

test('comfyGenerate: unknown model → typed unknown_model before any fetch', async () => {
  const restore = stubFetch(async (url) => {
    throw new Error(`no fetch allowed — ${url}`)
  })
  try {
    const base = resolveGenRequest({ prompt: 'x' })
    await assert.rejects(
      () => comfyGenerate(BASE, { ...base, model: 'does-not-exist' }),
      (err) => err instanceof ComfyUIError && err.code === 'unknown_model' && /z-image-turbo/.test(err.message),
    )
  } finally {
    restore()
  }
})

test('comfyInterrupt: POST /interrupt; network failures stay typed', async () => {
  const restore = stubFetch(async (url, init) => {
    assert.equal(url, `${BASE}/interrupt`)
    assert.equal(init.method, 'POST')
    return { ok: true, status: 200, statusText: 'OK', url, json: async () => ({}), text: async () => '{}' }
  })
  try {
    await comfyInterrupt(BASE)
  } finally {
    restore()
  }
})

test('pngDimensions: reads IHDR of a real header; non-PNG → undefined', () => {
  assert.deepEqual(pngDimensions(pngBytes(123, 456)), { width: 123, height: 456 })
  assert.equal(pngDimensions(new Uint8Array([1, 2, 3, 4])), undefined)
  const jpegish = new Uint8Array(32)
  jpegish[0] = 0xff
  assert.equal(pngDimensions(jpegish), undefined)
})

// ── §3 note 1 coverage gap (folded at §5): doctor probes get the same stubbed- ─
// ── fetch treatment as the rest of the client — Settings composes these.      ──

const PROBE_OBJECT_INFO = {
  UNETLoader: { inputs: { unet_name: ['z_image_turbo_bf16.safetensors', 'qwen_image_2512_fp8_e4m3fn.safetensors'] } },
  CheckpointLoaderSimple: { inputs: { ckpt_name: [] } },
  CLIPLoader: { inputs: { clip_name: ['qwen_3_4b_fp8_mixed.safetensors', 'qwen_2.5_vl_7b_fp8_scaled.safetensors'] } },
  DualCLIPLoader: { inputs: { clip_name1: [] } },
  VAELoader: { inputs: { vae_name: ['qwen_image_vae.safetensors', 'ae.safetensors'] } },
  // Core node classes the real graphs need — present ⇒ no missing_nodes. ModelSamplingAuraFlow
  // included since round-2 (z-image official template has it — live-verified 2026-10-11).
  ModelSamplingAuraFlow: { inputs: {} },
  CLIPTextEncode: { inputs: {} },
  CLIPVisionEncode: { inputs: {} },
  EmptySD3LatentImage: { inputs: {} },
  KSampler: { inputs: {} },
  FluxGuidance: { inputs: {} },
  VAEDecode: { inputs: {} },
  SaveImage: { inputs: {} },
}

test('comfySystemStats: raw /system_stats echo, defensive reads; non-object → typed bad_status', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/system_stats`)
      return jsonResponse(url, {
        system: { comfyui_version: '0.3.29', python_version: '3.13.2', pytorch_version: '2.7.1+cu128', ram_total: 64e9, ram_free: 31e9 },
        devices: [{ name: 'NVIDIA GeForce RTX 5090', type: 'cuda', index: 0, vram_total: 34225520640, vram_free: 29127106560 }],
      })
    throw new Error(`unexpected ${url}`)
  })
  try {
    const stats = await comfySystemStats(BASE)
    assert.equal(stats.system?.comfyui_version, '0.3.29')
    assert.equal(stats.devices?.[0]?.name, 'NVIDIA GeForce RTX 5090')
    assert.equal(stats.devices?.[0]?.type, 'cuda')
    // Doctor reads torch defensively: pytorch_version is the modern name.
    assert.equal(stats.system?.pytorch_version ?? stats.system?.torch_version, '2.7.1+cu128')
  } finally {
    restore()
  }

  const restoreBad = stubFetch((url) => (url === `${BASE}/system_stats` ? jsonResponse(url, 'nonsense-body') : undefined))
  try {
    await assert.rejects(
      () => comfySystemStats(BASE),
      (err) => err instanceof ComfyUIError && err.code === 'bad_status' && /unexpected \/system_stats body/.test(err.message),
    )
  } finally {
    restoreBad()
  }
})

test('comfyDoctorProbe: one /object_info pull covers detection AND missing-node validation', async () => {
  let objectInfoCalls = 0
  const restore = stubFetch(async (url) => {
    if (url === `${BASE}/object_info`) {
      objectInfoCalls++
      return jsonResponse(url, PROBE_OBJECT_INFO)
    }
    throw new Error(`unexpected ${url}`)
  })
  try {
    const probe = await comfyDoctorProbe(BASE)
    assert.ok(objectInfoCalls <= 1, `probe must pull object_info once (got ${objectInfoCalls})`)
    assert.ok(probe.known_node_count > 0)
    assert.ok(Array.isArray(probe.models) && probe.models.length === 5)
    const z = probe.models.find((m) => m.id === 'z-image-turbo')
    assert.equal(z?.detected, true)
    assert.deepEqual(z?.missing_nodes, [])
    // flux1-dev TE files live under DualCLIPLoader lists in the stub but its
    // diffusion model / vae are missing ⇒ detection false, yet its graph nodes
    // all exist ⇒ missing_nodes empty.
    const flux1 = probe.models.find((m) => m.id === 'flux1-dev')
    assert.equal(flux1?.detected, false)
    assert.deepEqual(flux1?.missing_nodes, [])
  } finally {
    restore()
  }
})

test('comfyDoctorProbe: version drift — absent node classes are named per model', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/object_info`) {
      const { KSampler, ...noSampler } = PROBE_OBJECT_INFO
      return jsonResponse(url, noSampler)
    }
    throw new Error(`unexpected ${url}`)
  })
  try {
    const probe = await comfyDoctorProbe(BASE)
    for (const entry of probe.models) {
      // Detection reads file lists (still present in the stub); node validation
      // is what catches version drift — every model's graph names KSampler.
      assert.ok(entry.missing_nodes.includes('KSampler'), `${entry.id} must name KSampler`)
    }
    const z = probe.models.find((m) => m.id === 'z-image-turbo')
    assert.equal(z?.detected, true, 'file detection is unaffected by missing sampler node')
  } finally {
    restore()
  }
})

test('comfyDoctorProbe: unreachable server → typed not_reachable (doctor catches and renders)', async () => {
  const restore = stubFetch(async () => {
    throw new TypeError('fetch failed')
  })
  try {
    await assert.rejects(
      () => comfyDoctorProbe(BASE),
      (err) => err instanceof ComfyUIError && err.code === 'not_reachable' && /not reachable/.test(err.message),
    )
  } finally {
    restore()
  }
})

test('comfyHealth: raw /system_stats echo rides along on health.stats (doctor dedupe, §3 note 5)', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/system_stats`)
      return jsonResponse(url, { system: { comfyui_version: '0.3.29' }, devices: [{ name: 'RTX 5090', vram_total: 1, vram_free: 1 }] })
    if (url === `${BASE}/queue`) return jsonResponse(url, { queue_running: [], queue_pending: [] })
    throw new Error(`unexpected ${url}`)
  })
  try {
    const health = await comfyHealth(BASE)
    assert.equal(health.ok, true)
    assert.equal(health.stats?.system?.comfyui_version, '0.3.29')
    // Doctor parity: the torch read comes from health.stats — no second fetch.
    assert.equal(health.stats?.system?.pytorch_version ?? health.stats?.system?.torch_version, undefined)
  } finally {
    restore()
  }
})

test('resolveComfyEndpoint: configured port down + sibling up → sibling url with ITS health', async () => {
  const restore = stubFetch((url) => {
    if (String(url).startsWith('http://127.0.0.1:8188/')) throw new TypeError('fetch failed')
    if (url === 'http://127.0.0.1:8189/system_stats')
      return jsonResponse(url, { system: { comfyui_version: '0.39.2' }, devices: [{ name: 'RTX 5090', vram_total: 2, vram_free: 1 }] })
    if (url === 'http://127.0.0.1:8189/queue') return jsonResponse(url, { queue_running: [], queue_pending: [] })
    throw new Error(`unexpected ${url}`)
  })
  try {
    const endpoint = await resolveComfyEndpoint('http://127.0.0.1:8188')
    assert.equal(endpoint.url, 'http://127.0.0.1:8189')
    assert.equal(endpoint.health.ok, true)
    assert.equal(endpoint.health.version, '0.39.2') // carries the engine's own stats — no re-fetch
  } finally {
    restore()
  }
})

test('resolveComfyEndpoint: configured UP wins on the first probe; nothing answers → ORIGINAL url + its health', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/system_stats`)
      return jsonResponse(url, { system: { comfyui_version: '0.3.30' }, devices: [{ name: 'RTX 5090', vram_total: 3, vram_free: 2 }] })
    if (url === `${BASE}/queue`) return jsonResponse(url, { queue_running: [], queue_pending: [] })
    throw new Error(`unexpected ${url}`)
  })
  try {
    const up = await resolveComfyEndpoint(BASE)
    assert.equal(up.url, BASE)
    assert.equal(up.health.version, '0.3.30')
  } finally {
    restore()
  }
  const dead = stubFetch(async () => {
    throw new TypeError('fetch failed')
  })
  try {
    const none = await resolveComfyEndpoint('http://127.0.0.1:8188')
    assert.equal(none.url, 'http://127.0.0.1:8188') // original, so error text still names it
    assert.equal(none.health.ok, false)
  } finally {
    dead()
  }
})

test('resolveComfyEndpoint: custom (non-loopback-default) URLs are never probed on other ports', async () => {
  const seen = []
  const restore = stubFetch((url) => {
    seen.push(String(url))
    throw new TypeError('fetch failed')
  })
  try {
    const custom = await resolveComfyEndpoint('http://192.168.1.10:7777')
    assert.equal(custom.url, 'http://192.168.1.10:7777')
    assert.ok(seen.every((u) => u.startsWith('http://192.168.1.10:7777/')), `no stray probes: ${JSON.stringify(seen)}`)
  } finally {
    restore()
  }
})