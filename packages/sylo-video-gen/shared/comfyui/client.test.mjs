// Unit tests for the ComfyUI video HTTP client (plan §2.3, §8 step 3 = plan
// §2.3 + §8.3 pairing). The global `fetch` is stubbed — zero network, no
// running ComfyUI required (mirrors client.test.mjs of sylo-image-gen). Covers
// the endpoint contract, request/response shapes, typed errors, 400-body
// propagation (the §0 silent-400 guard), upload refs, queue position/cancel,
// and the generate composition. Run: npm run test:client.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMFYUI_CLIENT_ID,
  ComfyUIError,
  comfyCancelJob,
  comfyDoctorProbe,
  comfyFetchOutputBytes,
  comfyGenerateVideo,
  comfyHealth,
  comfyModelsDetected,
  comfyPollResult,
  comfyQueuePosition,
  comfySubmitWorkflow,
  comfySystemStats,
  comfyUploadFile,
  comfyValidateWorkflowNodes,
  effectiveJobTimeoutMs,
  historyFor,
  missingNodeClasses,
  __setPollIntervalForTests,
  resolveComfyEndpoint,
} from './client.ts'
import { resolveVideoGenRequest } from '../catalog.ts'
import { coerceBackendHealth } from '../types.ts'

/** PNG bytes with an IHDR (poster stub). */
function pngBytes(width, height) {
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32(13), 0x49, 0x48, 0x44, 0x52,
    ...u32(width), ...u32(height),
    8, 2, 0, 0, 0,
  ])
}

/** Fake MP4 bytes (the client stays container-agnostic — bytes are opaque). */
const mp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])

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
  return { ok: status < 400, status, statusText: status === 200 ? 'OK' : 'Bad Request', url, json: async () => body, text: async () => JSON.stringify(body) }
}

function bytesResponse(url, bytes) {
  return { ok: true, status: 200, statusText: 'OK', url, arrayBuffer: async () => bytes.slice().buffer, json: async () => { throw new Error('not json') } }
}

test('COMFYUI_CLIENT_ID: stable-per-process uuid (cancel/progress attribution)', () => {
  assert.match(COMFYUI_CLIENT_ID, /^[0-9a-f-]{36}$/i)
})

test('effectiveJobTimeoutMs: 20-min default (§2.3 VERIFY), option wins, env wins in-between', () => {
  assert.equal(effectiveJobTimeoutMs(), 20 * 60 * 1000, 'default = 20 min (plan §2.3 calibration)')
  assert.equal(effectiveJobTimeoutMs(90_000), 90_000)
  const prev = process.env.SYLO_VIDEOGEN_JOB_TIMEOUT_MS
  try {
    process.env.SYLO_VIDEOGEN_JOB_TIMEOUT_MS = '25'
    assert.equal(effectiveJobTimeoutMs(), 25 * 60 * 1000)
    process.env.SYLO_VIDEOGEN_JOB_TIMEOUT_MS = '999'
    assert.equal(effectiveJobTimeoutMs(), 20 * 60 * 1000, 'env out of range (240-min cap) → default')
    process.env.SYLO_VIDEOGEN_JOB_TIMEOUT_MS = 'bogus'
    assert.equal(effectiveJobTimeoutMs(), 20 * 60 * 1000)
    process.env.SYLO_VIDEOGEN_JOB_TIMEOUT_MS = '1'
    assert.equal(effectiveJobTimeoutMs(500_000), 500_000, 'explicit option beats env')
  } finally {
    if (prev === undefined) delete process.env.SYLO_VIDEOGEN_JOB_TIMEOUT_MS
    else process.env.SYLO_VIDEOGEN_JOB_TIMEOUT_MS = prev
  }
})

test('comfyHealth: /system_stats + /queue → ok snapshot with device/VRAM/RAM/queue depth', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/system_stats`)
      return jsonResponse(url, {
        system: { comfyui_version: '0.39.2', ram_total: 61_600_000_000, ram_free: 32_000_000_000 },
        devices: [{ name: 'NVIDIA GeForce RTX 5090', vram_total: 34_225_520_640, vram_free: 30_000_000_000 }],
      })
    if (url === `${BASE}/queue`) return jsonResponse(url, { queue_running: ['a'], queue_pending: ['b', 'c'] })
    throw new Error(`unexpected ${url}`)
  })
  try {
    const health = await comfyHealth(`${BASE}/`)
    assert.equal(health.ok, true)
    assert.equal(health.url, BASE) // trailing slash normalized
    assert.equal(health.version, '0.39.2')
    assert.equal(health.device_name, 'NVIDIA GeForce RTX 5090')
    assert.equal(health.vram_total_bytes, 34_225_520_640)
    assert.equal(health.vram_free_bytes, 30_000_000_000)
    assert.equal(health.ram_total_bytes, 61_600_000_000)
    assert.equal(health.queue_running, 1)
    assert.equal(health.queue_pending, 2)
    assert.equal(health.queue_depth, 3)
    // §3.3 doctor dedupe: raw stats echo rides along.
    assert.equal(health.stats?.system?.comfyui_version, '0.39.2')
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
    assert.match(health.error, /sylo_video_gen_doctor/)
  } finally {
    restore()
  }
})

test('comfyModelsDetected: per-file wiring detection — DiTs, umt5, VAE, lightx2v LoRAs', async () => {
  // REAL ComfyUI /object_info shape (verified against a live 0.39.2 install):
  // each node is { input: { required: { key: [[...choices], {tooltip?}] } } }.
  const objectInfo = {
    UNETLoader: {
      input: {
        required: {
          unet_name: [
            [
              'wan2.2_ti2v_5B_fp16.safetensors',
              'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
              'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
              'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
              'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
              'wan2.1_vace_14B_fp16.safetensors',
            ],
            { tooltip: 'Select the diffusion model file' },
          ],
        },
      },
    },
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } },
    CLIPLoader: {
      input: {
        required: { clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], { tooltip: 'Select the text encoder' }], type: [['wan']] },
      },
    },
    VAELoader: { input: { required: { vae_name: [['wan2.2_vae.safetensors', 'wan_2.1_vae.safetensors']] } } },
    LoraLoaderModelOnly: {
      input: {
        required: {
          lora_name: [
            [
              'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
              'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
              'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
              'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
            ],
          ],
        },
      },
    },
    FrameInterpolationModelLoader: { input: { required: { model_name: [[]] } } },
  }
  // All three wired models detect when every file (incl. LoRAs) is present.
  {
    const restore = stubFetch((url) => (url === `${BASE}/object_info` ? jsonResponse(url, objectInfo) : Promise.reject(new Error(`unexpected ${url}`))))
    try {
      const detected = await comfyModelsDetected(BASE)
      assert.equal(detected['wan22-ti2v-5b'], true)
      assert.equal(detected['wan22-a14b'], true)
      assert.equal(detected['wan21-vace-14b'], true)
      assert.equal(detected['ltx-2.5'], false, 'opt-in without wiring is never detected')
    } finally {
      restore()
    }
  }
  // One missing leg (the shared t2v lightx2v LoRA) ⇒ A14B not detected — detect, never trust.
  const missingLora = {
    ...objectInfo,
    LoraLoaderModelOnly: {
      input: {
        required: {
          lora_name: [
            [
              'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
              'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
            ],
          ],
        },
      },
    },
  }
  const restore2 = stubFetch((url) => (url === `${BASE}/object_info` ? jsonResponse(url, missingLora) : undefined))
  try {
    const d2 = await comfyModelsDetected(BASE)
    assert.equal(d2['wan22-a14b'], false, 'missing t2v LoRA ⇒ A14B not fully detected')
    assert.equal(d2['wan22-ti2v-5b'], true)
    assert.equal(d2['wan21-vace-14b'], true)
  } finally {
    restore2()
  }
})

test('comfyModelsDetected: legacy object_info shape (node-level inputs) still detected', async () => {
  // Older ComfyUI builds / docs exposed { key: [...choices] } directly on the node —
  // fileNamesIn tolerates it so installs shaped that way keep detecting.
  const legacy = {
    UNETLoader: {
      inputs: {
        unet_name: [
          'wan2.2_ti2v_5B_fp16.safetensors',
          'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
          'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
          'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
          'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
          'wan2.1_vace_14B_fp16.safetensors',
        ],
      },
    },
    CheckpointLoaderSimple: { inputs: { ckpt_name: [] } },
    CLIPLoader: { inputs: { clip_name: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'] } },
    VAELoader: { inputs: { vae_name: ['wan2.2_vae.safetensors', 'wan_2.1_vae.safetensors'] } },
    LoraLoaderModelOnly: {
      inputs: {
        lora_name: [
          'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
          'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
          'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
          'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
        ],
      },
    },
    FrameInterpolationModelLoader: { inputs: { model_name: [] } },
  }
  const restore = stubFetch((url) => (url === `${BASE}/object_info` ? jsonResponse(url, legacy) : Promise.reject(new Error(`unexpected ${url}`))))
  try {
    const detected = await comfyModelsDetected(BASE)
    assert.equal(detected['wan22-ti2v-5b'], true)
    assert.equal(detected['wan22-a14b'], true)
    assert.equal(detected['wan21-vace-14b'], true)
  } finally {
    restore()
  }
})

test('comfyModelsDetected: unreachable server → typed not_reachable pointing at doctor', async () => {
  const restore = stubFetch(async () => {
    const err = new TypeError('fetch failed')
    err.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8188'), { code: 'ECONNREFUSED' })
    throw err
  })
  try {
    await assert.rejects(
      () => comfyModelsDetected(BASE),
      (err) => err instanceof ComfyUIError && err.code === 'not_reachable' && /sylo_video_gen_doctor/.test(err.message),
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
      return jsonResponse(url, { prompt_id: 'p-123', number: 7, node_errors: {} })
    }
    throw new Error(`unexpected ${url}`)
  })
  try {
    const graph = { 1: { class_type: 'SaveVideo', inputs: {} } }
    const id = await comfySubmitWorkflow(BASE, graph)
    assert.equal(id, 'p-123')
    assert.deepEqual(seen, { prompt: graph, client_id: COMFYUI_CLIENT_ID })
  } finally {
    restore()
  }
})

test('comfySubmitWorkflow: 400 bodies SURFACED (§0 silent-400 guard) — dynamic-combo shape errors name themselves', async () => {
  const restore = stubFetch(async (url) => {
    if (url === `${BASE}/prompt`)
      return jsonResponse(
        url,
        {
          error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
          node_errors: {
            '3': {
              class_type: 'SaveVideo',
              errors: [{ message: 'Invalid input', details: "format: 'not-a-format' is not a valid COMFY_DYNAMICCOMBO_V3 option" }],
            },
          },
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
        assert.match(err.message, /node 3 \(SaveVideo\).*COMFY_DYNAMICCOMBO_V3/)
        assert.match(err.detail, /node_errors/, 'the raw body rides the error (never swallowed)')
        return true
      },
    )
  } finally {
    restore()
  }

  // Non-JSON 400 body still surfaces its text.
  const restoreBad = stubFetch(async (url) => {
    if (url === `${BASE}/prompt`)
      return { ok: false, status: 400, statusText: 'Bad Request', url, text: async () => 'plain text error', json: async () => { throw new Error('nope') } }
    throw new Error(`unexpected ${url}`)
  })
  try {
    await assert.rejects(
      () => comfySubmitWorkflow(BASE, {}),
      (err) => err instanceof ComfyUIError && err.code === 'submit_rejected' && /Bad Request/.test(err.message),
    )
  } finally {
    restoreBad()
  }
})

/** SaveVideo history payload — PreviewVideo serializes to `images` (source of truth _ui.py). */
const historyEntry = (refs, status) => (url) =>
  url.startsWith(`${BASE}/history/`)
    ? jsonResponse(url, { 'p-x': { outputs: refs, ...(status ? { status } : {}) } })
    : Promise.reject(new Error(`unexpected ${url}`))

test('comfyPollResult: SaveVideo video + poster refs classified by extension, sorted (temp excluded)', async () => {
  __setPollIntervalForTests(1)
  const restore = stubFetch(
    historyEntry(
      {
        '50': { images: [{ filename: 'poster_00001_.png', subfolder: 'sylo-video', type: 'output' }] },
        '500': { images: [{ filename: 'clip_00001_.mp4', subfolder: 'sylo-video', type: 'output' }] },
        '1a': { images: [{ filename: 'preview.mp4', subfolder: '', type: 'temp' }] },
      },
      { status_str: 'success', completed: true, messages: [] },
    ),
  )
  try {
    const r = await comfyPollResult(BASE, 'p-x', 5_000)
    assert.equal(r.done, true)
    // Sorted (subfolder ties → filename): clip before poster; temp dropped.
    assert.deepEqual(r.outputs.map((o) => [o.kind, o.filename]), [
      ['video', 'clip_00001_.mp4'],
      ['poster', 'poster_00001_.png'],
    ])
    assert.equal(r.outputs[0].ext, 'mp4')
  } finally {
    restore()
  }
})

test('comfyPollResult: completed with NO video file → typed video_output_missing (§2.3 code)', async () => {
  __setPollIntervalForTests(1)
  const restore = stubFetch(
    historyEntry(
      { '51': { images: [{ filename: 'poster_00001_.png', subfolder: 'sylo-video', type: 'output' }] } },
      { status_str: 'success', completed: true, messages: [] },
    ),
  )
  try {
    await assert.rejects(
      () => comfyPollResult(BASE, 'p-x', 5_000),
      (err) => err instanceof ComfyUIError && err.code === 'video_output_missing' && /poster_00001_\.png/.test(err.message),
    )
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
        messages: [['execution_error', { prompt_id: 'p-x', node_id: '300', node_type: 'KSampler', exception_message: 'CUDA out of memory' }]],
      },
    ),
  )
  try {
    await assert.rejects(
      () => comfyPollResult(BASE, 'p-x', 5_000),
      (err) => {
        assert.ok(err instanceof ComfyUIError)
        assert.equal(err.code, 'execution_failed')
        assert.match(err.message, /node 300 \(KSampler\): CUDA out of memory/)
        return true
      },
    )
  } finally {
    restore()
  }
})

test('comfyPollResult: exceeds per-job cap → typed timeout naming the job + cap knob', async () => {
  __setPollIntervalForTests(10)
  const restore = stubFetch(historyEntry({})) // always empty history
  try {
    await assert.rejects(
      () => comfyPollResult(BASE, 'p-x', 30),
      (err) => {
        assert.ok(err instanceof ComfyUIError)
        assert.equal(err.code, 'timeout')
        assert.match(err.message, /did not finish within/)
        assert.match(err.message, /SYLO_VIDEOGEN_JOB_TIMEOUT_MS/)
        return true
      },
    )
  } finally {
    restore()
  }
})

test('historyFor: one-shot replay snapshot — done (refs) / error / not-found (§4.3 job replay)', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/history/p-done`)
      return jsonResponse(url, {
        'p-done': {
          outputs: { '50': { images: [{ filename: 'clip_00001_.mp4', subfolder: 'sylo-video', type: 'output' }] } },
          status: { status_str: 'success', completed: true, messages: [] },
        },
      })
    if (url === `${BASE}/history/p-err`)
      return jsonResponse(url, {
        'p-err': {
          outputs: {},
          status: {
            status_str: 'error',
            completed: false,
            messages: [['execution_error', { node_id: '30', node_type: 'KSampler', exception_message: 'no vae' }]],
          },
        },
      })
    if (url === `${BASE}/history/p-gone`) return jsonResponse(url, {})
    throw new Error(`unexpected ${url}`)
  })
  try {
    const done = await historyFor(BASE, 'p-done')
    assert.equal(done.completed, true)
    assert.equal(done.statusStr, 'success')
    assert.deepEqual(done.outputs.map((o) => o.kind), ['video'])
    const errored = await historyFor(BASE, 'p-err')
    assert.equal(errored.completed, false)
    assert.match(errored.error ?? '', /no vae/)
    const gone = await historyFor(BASE, 'p-gone')
    assert.deepEqual(gone.outputs, [])
  } finally {
    restore()
  }
})

test('comfyFetchOutputBytes: GET /view with encoded params → bytes for VIDEO and poster; 404 typed', async () => {
  let sawUrl
  const restore = stubFetch(async (url) => {
    sawUrl = url
    if (url.startsWith(`${BASE}/view`)) return bytesResponse(url, mp4Bytes)
    throw new Error(`unexpected ${url}`)
  })
  try {
    const out = await comfyFetchOutputBytes(BASE, { filename: 'clip 00001_.mp4', subfolder: 'sylo-video/', type: 'output' })
    assert.deepEqual(Array.from(out), Array.from(mp4Bytes))
    assert.equal(sawUrl, `${BASE}/view?filename=clip%2000001_.mp4&subfolder=sylo-video%2F&type=output`)
  } finally {
    restore()
  }

  const restore404 = stubFetch(async (url) => ({ ok: false, status: 404, statusText: 'Not Found', url, json: async () => ({ error: {} }), text: async () => '' }))
  try {
    await assert.rejects(
      () => comfyFetchOutputBytes(BASE, { filename: 'gone.mp4', subfolder: 'sylo-video' }),
      (err) =>
        err instanceof ComfyUIError &&
        err.code === 'bad_status' &&
        err.httpStatus === 404 &&
        /fetching output\/sylo-video\/gone\.mp4/.test(err.message),
    )
  } finally {
    restore404()
  }
})

test('comfyUploadFile: POST /upload/image multipart — overwrite, subfolder, ref built "<sub>/<name>"', async () => {
  let sawForm
  const restore = stubFetch(async (url, init) => {
    assert.equal(url, `${BASE}/upload/image`)
    assert.equal(init.method, 'POST')
    sawForm = init.body
    return jsonResponse(url, { name: 'still.png', subfolder: 'sylo-video', type: 'input' })
  })
  try {
    const up = await comfyUploadFile(BASE, pngBytes(8, 8), 'still.png', { subfolder: 'sylo-video' })
    assert.equal(up.name, 'still.png')
    assert.equal(up.subfolder, 'sylo-video')
    assert.equal(up.ref, 'sylo-video/still.png')
    assert.ok(sawForm?.get?.('image'), 'multipart carries the image field')
    assert.equal(sawForm.get('image').name, 'still.png')
    assert.equal(sawForm.get('overwrite'), '1')
    assert.equal(sawForm.get('subfolder'), 'sylo-video')
    assert.equal(sawForm.get('type'), 'input')
  } finally {
    restore()
  }
})

test('comfyUploadFile: missing name in response → typed bad_status', async () => {
  const restore = stubFetch(async (url) => (url === `${BASE}/upload/image` ? jsonResponse(url, {}) : Promise.reject(new Error(`unexpected ${url}`))))
  try {
    await assert.rejects(
      () => comfyUploadFile(BASE, new Uint8Array(4), 'x.png'),
      (err) => err instanceof ComfyUIError && err.code === 'bad_status',
    )
  } finally {
    restore()
  }
})

test('comfyQueuePosition: running → 0, pending → 1-based position, unknown → -1 (§2.3 queue handling)', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/queue`)
      return jsonResponse(url, {
        queue_running: [{ prompt_id: ['p-running'] }],
        queue_pending: [
          [1, 'p-next'],
          [2, 'p-mine'],
        ],
      })
    throw new Error(`unexpected ${url}`)
  })
  try {
    assert.equal(await comfyQueuePosition(BASE, 'p-running'), 0)
    assert.equal(await comfyQueuePosition(BASE, 'p-next'), 1)
    assert.equal(await comfyQueuePosition(BASE, 'p-mine'), 2)
    assert.equal(await comfyQueuePosition(BASE, 'p-nowhere'), -1)
  } finally {
    restore()
  }
})

test('comfyCancelJob: POST /queue {"delete":[id]} + interrupt; ComfyUI-side failures become notes', async () => {
  let deleteBody
  const restore = stubFetch(async (url, init) => {
    if (url === `${BASE}/queue`) {
      deleteBody = JSON.parse(init.body)
      return jsonResponse(url, {})
    }
    if (url === `${BASE}/interrupt`) return jsonResponse(url, {})
    throw new Error(`unexpected ${url}`)
  })
  try {
    const r = await comfyCancelJob(BASE, 'p-x')
    assert.deepEqual(deleteBody, { delete: ['p-x'] })
    assert.equal(r.deletedQueued, true)
    assert.equal(r.interrupted, true)
    assert.deepEqual(r.notes, [])
  } finally {
    restore()
  }

  // Pending delete rejected (job already running) — best-effort, notes not throws.
  const restore2 = stubFetch(async (url) => {
    if (url === `${BASE}/queue`) return { ok: false, status: 400, statusText: 'Bad Request', url, json: async () => ({}), text: async () => '' }
    if (url === `${BASE}/interrupt`) return jsonResponse(url, {})
    throw new Error(`unexpected ${url}`)
  })
  try {
    const r2 = await comfyCancelJob(BASE, 'p-run')
    assert.equal(r2.deletedQueued, false)
    assert.equal(r2.interrupted, true)
    assert.match(r2.notes[0] ?? '', /queue delete answered 400/)
  } finally {
    restore2()
  }
})

test('comfyValidateWorkflowNodes + missingNodeClasses: missing classes named; complete graphs pass', async () => {
  const objectInfo = { UNETLoader: { input: { required: {} } }, KSampler: { input: { required: {} } }, Wan22ImageToVideoLatent: { input: { required: {} } } }
  const restore = stubFetch((url) => {
    if (url === `${BASE}/object_info`) return jsonResponse(url, objectInfo)
    throw new Error(`unexpected ${url}`)
  })
  try {
    const missing = await comfyValidateWorkflowNodes(BASE, {
      a: { class_type: 'UNETLoader' },
      b: { class_type: 'KSampler' },
      c: { class_type: 'Wan22ImageToVideoLatent' },
      d: { class_type: 'VAELoader' },
    })
    assert.deepEqual(missing, ['VAELoader'])
    const ok = await comfyValidateWorkflowNodes(BASE, { a: { class_type: 'UNETLoader' }, b: { class_type: 'KSampler' } })
    assert.deepEqual(ok, [])
  } finally {
    restore()
  }
  // Offline helper parity.
  assert.deepEqual(missingNodeClasses({ a: { class_type: 'X' } }, new Set(['Y'])), ['X'])
})

// ── Doctor probe (single /object_info pull; video-catalog shapes) ──

const PROBE_OBJECT_INFO = {
  // Loader classes carry the REAL /object_info shape (input.required with
  // [choices, opts] entries) — doctor detection reads exactly these lists.
  UNETLoader: {
    input: {
      required: {
        unet_name: [
          [
            'wan2.2_ti2v_5B_fp16.safetensors',
            'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
            'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
            'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
            'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
            'wan2.1_vace_14B_fp16.safetensors',
          ],
          { tooltip: 'Select the diffusion model file' },
        ],
      },
    },
  },
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } },
  CLIPLoader: {
    input: {
      required: { clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], { tooltip: 'Select the text encoder' }], type: [['wan']] },
    },
  },
  VAELoader: { input: { required: { vae_name: [['wan2.2_vae.safetensors', 'wan_2.1_vae.safetensors']] } } },
  LoraLoaderModelOnly: {
    input: {
      required: {
        lora_name: [
          [
            'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
            'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
            'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
            'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
          ],
        ],
      },
    },
  },
  // Every class the four builders emit — present ⇒ no missing_nodes.
  ModelSamplingSD3: { input: { required: {} } },
  CLIPTextEncode: { input: { required: {} } },
  Wan22ImageToVideoLatent: { input: { required: {} } },
  EmptyHunyuanLatentVideo: { input: { required: {} } },
  WanImageToVideo: { input: { required: {} } },
  WanFirstLastFrameToVideo: { input: { required: {} } },
  WanVaceToVideo: { input: { required: {} } },
  KSampler: { input: { required: {} } },
  KSamplerAdvanced: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  ImageFromBatch: { input: { required: {} } },
  CreateVideo: { input: { required: {} } },
  SaveVideo: { input: { required: {} } },
  SaveImage: { input: { required: {} } },
  LoadImage: { input: { required: {} } },
  LoadVideo: { input: { required: {} } },
  GetVideoComponents: { input: { required: {} } },
  FrameInterpolate: { input: { required: {} } },
  FrameInterpolationModelLoader: { input: { required: { model_name: [[]] } } },
}

test('comfySystemStats: raw /system_stats echo, defensive reads; non-object → typed bad_status', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/system_stats`)
      return jsonResponse(url, {
        system: { comfyui_version: '0.39.2', python_version: '3.13.12', pytorch_version: '2.12.1+cu130', ram_total: 61.6e9, ram_free: 32.1e9 },
        devices: [{ name: 'NVIDIA GeForce RTX 5090', type: 'cuda', index: 0, vram_total: 34225520640, vram_free: 30146585600 }],
      })
    throw new Error(`unexpected ${url}`)
  })
  try {
    const stats = await comfySystemStats(BASE)
    assert.equal(stats.system?.comfyui_version, '0.39.2')
    assert.equal(stats.devices?.[0]?.name, 'NVIDIA GeForce RTX 5090')
    assert.equal(stats.system?.pytorch_version ?? stats.system?.torch_version, '2.12.1+cu130')
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

test('comfyDoctorProbe: one /object_info pull covers detection AND per-model missing-node validation', async () => {
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
    assert.ok(objectInfoCalls === 1, `probe must pull object_info exactly once (got ${objectInfoCalls})`)
    assert.ok(probe.known_node_count > 0)
    assert.equal(probe.models.length, 5)
    for (const id of ['wan22-ti2v-5b', 'wan22-a14b', 'wan21-vace-14b']) {
      const e = probe.models.find((m) => m.id === id)
      assert.equal(e?.detected, true)
      if (id !== 'wan21-vace-14b')
        assert.deepEqual(e?.missing_nodes, [], `${id}: all graph nodes present (wan_2.1_vae covers a14b; FrameInterpolate NOT in graph by default)`)
      else
        assert.deepEqual(e?.missing_nodes, [], 'VACE graph nodes all present')
    }
    assert.equal(probe.models.find((m) => m.id === 'ltx-2.5')?.missing_nodes[0], '(opt-in model — not wired in v1)')
    // frame_interpolation pack: loader combo EMPTY on this install ⇒ available false (downgrade, not blocker).
    assert.deepEqual(probe.frame_interpolation, { available: false, models: [] })
  } finally {
    restore()
  }
})

test('comfyDoctorProbe: version drift — absent node classes are named per model', async () => {
  const restore = stubFetch((url) => {
    if (url === `${BASE}/object_info`) {
      const { KSampler, KSamplerAdvanced, ...noSamplers } = PROBE_OBJECT_INFO
      return jsonResponse(url, noSamplers)
    }
    throw new Error(`unexpected ${url}`)
  })
  try {
    const probe = await comfyDoctorProbe(BASE)
    // Single-stage models name KSampler; the A14B two-stage names KSamplerAdvanced.
    assert.ok(probe.models.find((m) => m.id === 'wan22-ti2v-5b').missing_nodes.includes('KSampler'))
    assert.ok(probe.models.find((m) => m.id === 'wan22-a14b').missing_nodes.includes('KSamplerAdvanced'))
    assert.ok(probe.models.find((m) => m.id === 'wan21-vace-14b').missing_nodes.includes('KSampler'))
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

// ── The composition: build → validate → submit → poll → fetch (offline) ──

test('comfyGenerateVideo: end-to-end with stubbed HTTP — draft t2v meta truthful, poster fetched', async () => {
  __setPollIntervalForTests(1)
  let historyCalls = 0
  const restore = stubFetch(async (url, init) => {
    if (url === `${BASE}/object_info`) return jsonResponse(url, PROBE_OBJECT_INFO)
    if (url === `${BASE}/prompt`) {
      const body = JSON.parse(init.body)
      assert.equal(body.client_id, COMFYUI_CLIENT_ID)
      const classes = Object.values(body.prompt).map((n) => n.class_type)
      // Draft ti2v 5B single-stage chain (§2.4(1) template parity).
      for (const expected of ['UNETLoader', 'ModelSamplingSD3', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'Wan22ImageToVideoLatent', 'KSampler', 'VAEDecode', 'ImageFromBatch', 'SaveImage', 'CreateVideo', 'SaveVideo'])
        assert.ok(classes.includes(expected), `draft graph missing ${expected}`)
      assert.ok(!classes.includes('LoadImage'), 't2v wires NO LoadImage')
      const save = Object.values(body.prompt).find((n) => n.class_type === 'SaveVideo')
      // LOCKED dynamic-combo shape: flat 'mp4' + 'h264' (probe record §0).
      assert.equal(save.inputs.format, 'mp4')
      assert.equal(save.inputs.codec, 'h264')
      return jsonResponse(url, { prompt_id: 'p-gen', number: 1, node_errors: {} })
    }
    if (url.startsWith(`${BASE}/history/`)) {
      historyCalls++
      if (historyCalls === 1)
        return jsonResponse(url, { 'p-gen': { outputs: {}, status: { status_str: 'success', completed: false, messages: [] } } })
      return jsonResponse(url, {
        'p-gen': {
          outputs: {
            '50': { images: [{ filename: 'clip_00001_.mp4', subfolder: 'sylo-video', type: 'output' }] },
            '51': { images: [{ filename: 'poster_00001_.png', subfolder: 'sylo-video', type: 'output' }] },
          },
          status: { status_str: 'success', completed: true, messages: [] },
        },
      })
    }
    if (url.startsWith(`${BASE}/view`)) return bytesResponse(url, url.includes('.mp4') ? mp4Bytes : pngBytes(1280, 704))
    throw new Error(`unexpected ${url}`)
  })
  try {
    const req = resolveVideoGenRequest({ prompt: 'slow dolly through neon rain', seed: 11 })
    assert.equal(req.frame_count, 121)
    const progress = []
    const { promptId, outputs } = await comfyGenerateVideo(BASE, req, {}, { onProgress: (p) => progress.push(p) })
    assert.equal(promptId, 'p-gen')
    assert.equal(outputs.length, 1)
    const o = outputs[0]
    assert.equal(o.meta.model, 'wan22-ti2v-5b')
    assert.equal(o.meta.mode, 'clip')
    assert.equal(o.meta.preset, 'draft')
    assert.equal(o.meta.variant, 't2v')
    assert.equal(o.meta.seed, 11)
    assert.equal(o.meta.steps, 20)
    assert.equal(o.meta.cfg, 5)
    assert.equal(o.meta.sampler, 'uni_pc')
    assert.equal(o.meta.sampling_shift, 8)
    assert.equal(o.meta.framerate, 24)
    assert.equal(o.meta.width, 1280)
    assert.equal(o.meta.height, 704)
    assert.equal(o.meta.frame_count, 121)
    assert.equal(o.meta.video_format, 'mp4')
    assert.equal(o.meta.comfy_prompt_id, 'p-gen')
    assert.ok(o.meta.gen_ms >= 0)
    assert.ok(o.video.byteLength > 0, 'video bytes fetched')
    assert.ok(o.poster.byteLength > 0, 'poster bytes fetched')
    assert.deepEqual(progress.map((p) => p.comfy_prompt_id), ['p-gen', 'p-gen'])
  } finally {
    __setPollIntervalForTests(2000)
    restore()
  }
})

test('comfyGenerateVideo: unknown model → typed unknown_model before any fetch; missing refs pre-submit', async () => {
  const restore = stubFetch(async (url) => {
    throw new Error(`no fetch allowed — ${url}`)
  })
  try {
    const base = resolveVideoGenRequest({ prompt: 'x' })
    await assert.rejects(
      () => comfyGenerateVideo(BASE, { ...base, model: 'does-not-exist' }, {}),
      (err) => err instanceof ComfyUIError && err.code === 'unknown_model' && /wan22-ti2v-5b/.test(err.message),
    )
    // i2v without the uploaded ref → build-order validation_failed before submit.
    const i2v = resolveVideoGenRequest({ prompt: 'x', mode: 'clip', source_image_path: 'a.png', preset: 'final' })
    await assert.rejects(
      () => comfyGenerateVideo(BASE, i2v, {}),
      (err) => err instanceof ComfyUIError && err.code === 'validation_failed' && /sourceImageRef/.test(err.message),
    )
    const loop = resolveVideoGenRequest({ prompt: 'x', mode: 'loop', source_image_path: 'a.png' })
    await assert.rejects(
      () => comfyGenerateVideo(BASE, loop, {}),
      (err) => err instanceof ComfyUIError && err.code === 'validation_failed',
    )
    const restyle = resolveVideoGenRequest({ prompt: 'x', mode: 'restyle', source_video_path: 'c.mp4' })
    await assert.rejects(
      () => comfyGenerateVideo(BASE, restyle, {}),
      (err) => err instanceof ComfyUIError && err.code === 'validation_failed' && /sourceVideoRef/.test(err.message),
    )
  } finally {
    restore()
  }
})

test('coerceBackendHealth: unknown JSON → BackendHealth (host IPC replay) with honest defaults', () => {
  const h = coerceBackendHealth({ ok: true, url: 'http://127.0.0.1:8188', version: '0.39.2', vram_free_bytes: '30000000000', garbage: 1 })
  assert.equal(h.ok, true)
  assert.equal(h.version, '0.39.2')
  assert.equal(h.vram_free_bytes, 30_000_000_000)
  assert.equal(h.queue_depth, undefined)
  const dead = coerceBackendHealth('nope')
  assert.equal(dead.ok, false)
})

test('resolveComfyEndpoint: configured port down + sibling up → sibling url with ITS health (found live 2026-10-13)', async () => {
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
      return jsonResponse(url, { system: { comfyui_version: '0.3.29' }, devices: [{ name: 'RTX 5090', vram_total: 3, vram_free: 2 }] })
    if (url === `${BASE}/queue`) return jsonResponse(url, { queue_running: [], queue_pending: [] })
    throw new Error(`unexpected ${url}`)
  })
  try {
    const up = await resolveComfyEndpoint(BASE)
    assert.equal(up.url, BASE)
    assert.equal(up.health.version, '0.3.29')
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