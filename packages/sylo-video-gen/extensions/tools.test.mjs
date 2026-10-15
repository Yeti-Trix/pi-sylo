/**
 * §3/§8.6 agent-surface tests (extensions/) — added at §8.6 even though plan §8
 * step 6 does not name a test script (operator build spec: schema roundtrip +
 * coerce interplay + image-link soft-fail discipline; the script joins the
 * package's test:* family in the §8.5 retarget mold).
 *   — schema roundtrip: every registered tool's typebox schema serializes to
 *     plain JSON and round-trips byte-stable (names/keys are FIXED at build time).
 *   — coerce interplay: the shared coerceVideoGenRequest (route-side) output
 *     must FEED resolveVideoGenRequest without re-throwing (count clamp, the
 *     -1 unseeded sentinel, from_image_id folding) — the §8.7 host route composes
 *     exactly this pair.
 *   — image-link soft-fail against a stub: missing module → canonical plain-
 *     language reason; a stub module is read-only (its write APIs, if present,
 *     must never be called); the REAL sylo-image-gen store interplay runs against
 *     a bundled sibling artifact with the image library byte-unchanged + no back
 *     -writes (asserted at the file level).
 * Offline — no ComfyUI involved.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'

import register from './index.ts'
import { GENERATE_PARAMS, buildRequestFromParams } from './tools/generate.ts'
import { DEFAULT_VIDEOGEN_CONFIG, coerceVideoGenRequest } from '../shared/types.ts'
import { resolveVideoGenRequest, MAX_VIDEOS_PER_CALL, workflowVariantFor } from '../shared/catalog.ts'
import { resolveVideoStillLink } from '../shared/image-link.ts'
import { decodePngToRgba, downscaleRgba, encodeJpeg, previewDims } from './tools/preview-image.ts'

// ── Register surface + name-fixedness (§3.1–§3.6) ───────────────────────────

const V1_NAMES = [
  'sylo_video_gen_generate',
  'sylo_video_gen_list',
  'sylo_video_gen_get',
  'sylo_video_gen_organize',
  'sylo_video_gen_doctor',
]
const V2_NAMES = [
  'sylo_video_gen_upscale',
  'sylo_video_gen_restyle',
  'sylo_video_gen_shot_manifest',
  'sylo_video_gen_open_on_canvas',
  'sylo_video_gen_poster',
]

const registered = []
register({ registerTool: (tool) => registered.push(tool) })

test('§3 name-fixedness: exactly the five v1 + five v2 §3.6 tools, no drift', () => {
  const names = registered.map((tool) => tool.name)
  assert.deepEqual(names.sort(), [...V1_NAMES, ...V2_NAMES].sort())
  assert.equal(registered.length, 10)
})

test('§3.1 discipline baked into the generate surface (description + promptSnippet + schema keys)', () => {
  const gen = registered.find((tool) => tool.name === 'sylo_video_gen_generate')
  assert.ok(gen.description.includes('sylo_video_gen_doctor'), 'doctor-on-failure hint')
  assert.ok(gen.description.includes('count 2'), 'draft economics hint')
  assert.ok(gen.promptSnippet.includes('from_image_id'), 'Images lineage hint')
  assert.ok(gen.promptSnippet.includes('library'), 'library-first hint')
  // Parameters ARE the exported GENERATE_PARAMS (same object registered).
  assert.equal(gen.parameters, GENERATE_PARAMS)
  const propNames = Object.keys(GENERATE_PARAMS.properties)
  for (const key of ['prompt', 'mode', 'preset', 'model', 'resolution', 'orientation', 'duration_seconds', 'loop_motion_strength', 'restyle_strength', 'count', 'from_image_id', 'from_video_id', 'source_image_path', 'source_video_id', 'source_video_path', 'seed', 'tags', 'save']) {
    assert.ok(propNames.includes(key), `schema key fixed at build time: ${key}`)
  }
  assert.equal(GENERATE_PARAMS.properties.count.maximum, MAX_VIDEOS_PER_CALL, 'count cap 1–2 from the catalog')
  assert.equal(GENERATE_PARAMS.properties.mode.anyOf.map((variant) => variant.const).sort().join(','), 'clip,loop,restyle')
})

test('§3.6 v2 reservations: schemas stable JSON (roundtrip) + disclosure-clause executes, zero implementation', async () => {
  for (const name of V2_NAMES) {
    const tool = registered.find((t) => t.name === name)
    assert.ok(tool, `v2 reservation registered: ${name}`)
    const roundtrip = JSON.parse(JSON.stringify(tool.parameters))
    assert.deepEqual(roundtrip, tool.parameters, `schema plain-JSON stable: ${name}`)
    const result = await tool.execute('test-call', {}, undefined, undefined)
    const text = result.content[0].text
    assert.equal(result.content[0].type, 'text')
    assert.ok(text.includes('v2 tool (plan §3.6)'), `${name} anchors the plan`)
    assert.ok(text.includes('not wired'), `${name} names the v1 stance`)
    assert.ok(/nothing was (rendered|changed|opened|extracted|queued)/.test(text), `${name} states nothing happened`)
  }
})

test('§3.2–§3.3 v1 list/get/organize/doctor schemas roundtrip + carry their binding notes', () => {
  for (const name of ['sylo_video_gen_list', 'sylo_video_gen_get', 'sylo_video_gen_organize', 'sylo_video_gen_doctor']) {
    const tool = registered.find((t) => t.name === name)
    const roundtrip = JSON.parse(JSON.stringify(tool.parameters))
    assert.deepEqual(roundtrip, tool.parameters)
  }
  const listTool = registered.find((t) => t.name === 'sylo_video_gen_list')
  assert.ok(listTool.description.includes('Check here before regenerating'), 'library-first check stance')
  // video query additions on the image-gen contract (§3.2): mode + until
  assert.ok(Object.keys(listTool.parameters.properties).includes('mode'))
  assert.ok(Object.keys(listTool.parameters.properties).includes('until'))
  const organizeTool = registered.find((t) => t.name === 'sylo_video_gen_organize')
  assert.ok(organizeTool.description.includes('Confirm deletes'), 'delete-with-confirm discipline (§3.3)')
})

// ── Coerce interplay (route coerce → catalog resolver — the §8.7 composition) ──

test('coerce interplay: count clamps 1–2 with a plain-language note and the resolver accepts the coerced request', () => {
  const { request, notes } = coerceVideoGenRequest({ prompt: 'a drone shot over fog', count: 5 }, DEFAULT_VIDEOGEN_CONFIG)
  assert.equal(request.count, 2)
  assert.equal(notes.length, 1)
  assert.match(notes[0], /outside 1–2/)
  const resolved = resolveVideoGenRequest(request, {})
  assert.equal(resolved.count, 2)
  assert.equal(resolved.model, DEFAULT_VIDEOGEN_CONFIG.draft_model)
  assert.equal(resolved.preset, 'draft')
})

test('coerce interplay: from_image_id folds into source_image_id; loop forces final preset + A14B + 4n+1 frames', () => {
  const { request } = coerceVideoGenRequest({ mode: 'loop', from_image_id: 'img-1', prompt: 'pulse the lights' }, DEFAULT_VIDEOGEN_CONFIG)
  assert.equal(request.source_image_id, 'img-1') // §3.5 alias folded
  const resolved = resolveVideoGenRequest(request, {})
  assert.equal(resolved.model, DEFAULT_VIDEOGEN_CONFIG.final_model)
  assert.equal(resolved.preset, 'final')
  assert.equal(resolved.duration_seconds, 5)
  assert.equal(resolved.framerate, 16)
  assert.equal(resolved.frame_count, 81) // 5 s @ 16 fps → 4n+1 (§2.5 table)
  assert.equal(workflowVariantFor({ mode: resolved.mode, source_image: 'x' }), 'flf2v')
})

test('coerce interplay: the -1 absent-seed sentinel rolls a fresh random instead of throwing (catalog fix at §8.6)', () => {
  const { request } = coerceVideoGenRequest({ prompt: 'unseeded clip' }, DEFAULT_VIDEOGEN_CONFIG)
  assert.equal(request.seed, -1)
  const resolved = resolveVideoGenRequest(request, {})
  assert.ok(Number.isInteger(resolved.seed) && resolved.seed >= 0 && resolved.seed !== -1)
})

test('coerce interplay: restyle via source_video_id passes through; source-less coerce still resolves prompt-required downstream', () => {
  const restyled = coerceVideoGenRequest({ mode: 'restyle', source_video_id: 'vid-1', prompt: 'oil painting' }, DEFAULT_VIDEOGEN_CONFIG)
  const restyledResolved = resolveVideoGenRequest(restyled.request, {})
  assert.equal(restyledResolved.mode, 'restyle')
  assert.equal(workflowVariantFor({ mode: 'restyle', source_image: '' }), 'v2v')
  const sourceless = coerceVideoGenRequest({}, DEFAULT_VIDEOGEN_CONFIG)
  assert.equal(sourceless.request.mode, 'clip') // coerce NEVER throws
  assert.throws(() => resolveVideoGenRequest(sourceless.request, {}), /prompt is required/)
})

// ── generate.ts param mapping + from_video_id inheritance (§3.1) ─────────────

function parentRecord(overrides = {}) {
  return {
    id: 'parent-1',
    created_at: '2026-10-12T00:00:00.000Z',
    prompt: 'parent shot',
    model: 'wan22-ti2v-5b',
    mode: 'clip',
    preset: 'draft',
    resolution: { width: 1280, height: 704 },
    framerate: 24,
    duration_seconds: 4,
    frame_count: 97,
    seed: 7,
    file_rel: 'files/2026/10/parent-1.mp4',
    bytes: 100,
    video_format: 'mp4',
    render_ms: 1,
    lineage: {},
    tags: [],
    favorite: false,
    ...overrides,
  }
}

test('from_video_id inheritance: prompt/seed/resolution(+orientation px reverse-map)/duration, explicit values win', () => {
  const inherited = buildRequestFromParams({}, parentRecord())
  assert.equal(inherited.prompt, 'parent shot')
  assert.equal(inherited.seed, 7)
  assert.equal(inherited.resolution, '720p')
  assert.equal(inherited.orientation, 'landscape')
  assert.equal(inherited.duration_seconds, 4)
  const resolved = resolveVideoGenRequest(inherited, {})
  assert.equal(resolved.frame_count, 97) // 4 s @ 24 fps (§2.5)
  const explicit = buildRequestFromParams(
    { prompt: 'new take', seed: 99, resolution: '480p', orientation: 'portrait', duration_seconds: 8 },
    parentRecord(),
  )
  assert.equal(explicit.prompt, 'new take')
  assert.equal(explicit.seed, 99)
  assert.equal(explicit.duration_seconds, 8)
  // 480p is not supported by the 5B draft model — the resolver says so plainly.
  const draftModel = resolveVideoGenRequest(inherited, {})
  assert.equal(draftModel.model, 'wan22-ti2v-5b')
})

test('from_video_id + restyle mode: the parent clip becomes the source (via the VIDEO store, not image-link)', () => {
  const input = buildRequestFromParams({ mode: 'restyle' }, parentRecord())
  // The tool resolves the parent's file_rel → abs (video-store path); input keeps
  // from_video_id so the resolver's lineage echo stays intact. The restyle source
  // check: no source → resolver throws its plain error when input carries neither.
  assert.equal(input.from_video_id, undefined)
  const seeded = { ...input, prompt: 'restyle take', source_video_path: 'C:/tmp/parent-1.mp4' }
  const resolved = resolveVideoGenRequest(seeded, {})
  assert.equal(resolved.mode, 'restyle')
  assert.equal(resolved.source_video_path, 'C:/tmp/parent-1.mp4')
})

// ── §3.5 image-link: soft-fail + stub read-only interplay ────────────────────

test('image-link: soft-fail on a missing sylo-image-gen module — canonical plain-language note', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sylo-imagelink-fail-'))
  try {
    const link = await resolveVideoStillLink('img-1', { modulePath: join(tmp, 'definitely-not-installed.mjs') })
    assert.equal(link.ok, false)
    assert.match(link.reason, /sylo-image-gen not available/)
    assert.match(link.reason, /source_image_path/) // the §3.5 wording
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('image-link: stubbed sibling store — read-only contract (writes must never be called), same-root options flow through', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sylo-imagelink-stub-'))
  try {
    const stubPath = join(tmp, 'imagegen-store.stub.mjs')
    writeFileSync(
      stubPath,
      [
        'export const calls = { getRecord: [], resolveLibraryRoot: [], imageFileAbs: [], createRecord: [], organizeRecords: [] }',
        'export async function getRecord(args) { calls.getRecord.push(args);',
        "  return { id: args.image_id, file_rel: 'files/2026/10/abc.png', width: 64, height: 64, prompt: 'p', model: 'm', preset: 'draft', created_at: '2026-10-12T00:00:00.000Z', bytes: 100, tags: [] } }",
        'export function resolveLibraryRoot(opts) { calls.resolveLibraryRoot.push(opts); return opts.libraryRoot || null }',
        'export function imageFileAbs(root, fileRel) { calls.imageFileAbs.push([root, fileRel]); return root + "/" + fileRel }',
        'export async function createRecord() { calls.createRecord.push(1); throw new Error("MUST NOT write into the image library") }',
        'export async function organizeRecords() { calls.organizeRecords.push(1); throw new Error("MUST NOT write into the image library") }',
      ].join('\n'),
      'utf8',
    )
    const link = await resolveVideoStillLink('abc-123', {
      workspaceCwd: join(tmp, 'video-workspace'),
      libraryRoot: join(tmp, 'image-workspace', '.sylo', 'images'),
      modulePath: stubPath,
    })
    assert.equal(link.ok, true)
    assert.equal(link.record.id, 'abc-123')
    assert.equal(link.record.width, 64)
    assert.ok(link.image_path.endsWith('files/2026/10/abc.png'))
    assert.ok(link.image_path.includes('image-workspace'), 'the IMAGE library root is used, not the video workspace')
    // The read-only contract: exactly one getRecord (+ its own path helpers)
    // and ZERO write calls into the sibling module.
    const calls = await importStub(stubPath)
    assert.equal(calls.getRecord.length, 1)
    assert.equal(calls.getRecord[0].image_id, 'abc-123')
    assert.ok(calls.getRecord[0].workspaceCwd && calls.getRecord[0].workspaceCwd.endsWith('video-workspace'))
    assert.equal(calls.createRecord.length, 0)
    assert.equal(calls.organizeRecords.length, 0)
    // The video workspace must not have gained an images dir from the link.
    assert.ok(!existsSync(join(tmp, 'video-workspace', '.sylo', 'images')))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

async function importStub(stubPath) {
  const mod = await import(pathToFileURL(stubPath).href)
  return mod.calls ?? { getRecord: [], createRecord: [], organizeRecords: [] }
}

test('image-link: REAL sylo-image-gen store interplay — seed → resolve, library.json byte-unchanged, no video-side writes', async () => {
  // The bundled sibling artifact is produced by the test:tools script (esbuild —
  // the SAME pattern as this suite's own bundle). Skipped (with context) when the
  // artifact is absent so the suite still runs in a bare checkout.
  const fixture = fileURLToPath(new URL('./imagegen-library-store.for-tests.mjs', import.meta.url))
  if (!existsSync(fixture)) {
    return console.log('# skip: imagegen-library-store fixture not bundled (non-monorepo run)')
  }
  const tmp = mkdtempSync(join(tmpdir(), 'sylo-imagelink-real-'))
  try {
    const imagegenStore = await import(pathToFileURL(fixture).href)
    const imageRoot = join(tmp, '.sylo', 'images')
    const seeded = await imagegenStore.createRecord({
      libraryRoot: imageRoot,
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
      prompt: 'sunset over the ridge',
      model: 'z-image-turbo',
      preset: 'draft',
      width: 64,
      height: 64,
      steps: 1,
      guidance: 1,
      seed: 3,
      tags: ['test-keyframe'],
    })
    const indexBefore = readFileSync(join(imageRoot, 'library.json'), 'utf8')
    const filesBefore = readdirSync(join(imageRoot, 'files'), { recursive: true }).length

    const link = await resolveVideoStillLink(seeded.record.id, { workspaceCwd: tmp, modulePath: fixture })
    assert.equal(link.ok, true, `expected the real-store link to resolve — ${link.ok ? '' : link.reason}`)
    assert.equal(link.record.id, seeded.record.id)
    assert.equal(link.record.prompt, 'sunset over the ridge')
    assert.equal(link.record.width, 64)
    assert.ok(link.image_path.endsWith('.png'))
    assert.ok(existsSync(link.image_path))
    assert.ok(link.image_path.replace(/\\/g, '/').includes('.sylo/images/'), 'the path is inside the IMAGE library (read-only)')

    // No back-writes: the image library bytes + file tree are byte-identical.
    const indexAfter = readFileSync(join(imageRoot, 'library.json'), 'utf8')
    assert.equal(indexAfter, indexBefore, 'library.json untouched by the video-side read')
    assert.equal(readdirSync(join(imageRoot, 'files'), { recursive: true }).length, filesBefore)
    // And no video library appeared in the image workspace (one-way lineage only).
    assert.ok(!existsSync(join(tmp, '.sylo', 'videos')))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// ── §3.4 preview codec smoke (the cloned image-gen codec, exercised in-repo) ──

function realPngBytes(width, height) {
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  const chunk = (type, data) => [...u32(data.length), ...type, ...data, 0, 0, 0, 0] // CRCs unchecked by the decoder
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = [...u32(width), ...u32(height), 8, 2, 0, 0, 0]
  const stride = width * 3
  const raw = new Uint8Array((stride + 1) * height)
  for (let row = 0; row < height; row++) {
    raw[row * (stride + 1)] = 0 // filter 0
    for (let x = 0; x < stride; x++) raw[row * (stride + 1) + 1 + x] = (row * 31 + x * 17) % 256
  }
  const idat = deflateSync(raw)
  const bytes = [
    ...sig,
    ...chunk([0x49, 0x48, 0x44, 0x52], ihdr),
    ...chunk([0x49, 0x44, 0x41, 0x54], new Uint8Array(Array.from(idat))),
    ...chunk([0x49, 0x45, 0x4e, 0x44], []),
  ]
  return Uint8Array.from(bytes)
}

test('§3.4 preview codec: poster PNG → ≤512 px JPEG (SOI/EOI framed, size sane) + downscale cap', () => {
  const png = realPngBytes(1024, 512)
  const decoded = decodePngToRgba(png)
  assert.equal(decoded.width, 1024)
  const downscaled = downscaleRgba(decoded)
  assert.deepEqual(previewDims(1024, 512), { width: 512, height: 256 })
  assert.equal(downscaled.width, 512)
  const jpeg = encodeJpeg(downscaled)
  assert.equal(jpeg[0], 0xff, 'SOI marker')
  assert.equal(jpeg[1], 0xd8)
  assert.equal(jpeg[jpeg.length - 2], 0xff, 'EOI marker')
  assert.equal(jpeg[jpeg.length - 1], 0xd9)
  assert.ok(jpeg.byteLength > 200, 'non-degenerate JPEG')
  assert.ok(jpeg.byteLength < 200_000, 'inline preview under the telemetry cap')
})