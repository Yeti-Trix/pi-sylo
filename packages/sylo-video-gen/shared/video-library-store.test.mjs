// Unit tests for the per-workspace video library store (plan §4.1/§4.2/§4.4/§4.5,
// §8 step 5). Fully offline: real temp directories + arbitrary clip bytes + minimal
// PNG poster bytes, no network, no ComfyUI. Mirrors image-gen's library-store.test.mjs
// structure: atomic index writes, the §3.2 query contract (full filter matrix incl.
// the video-only mode/until filters), organize semantics, malformed-index recovery
// (corrupt rename + rebuild-from-files, poster-IHDR dims), concurrent-write stress
// through the in-flight queue, delete-removes-clip+poster+record, the one-way
// from_image_id lineage discipline (§3.5 — no image-library touches), and the
// sylo-video-gen:changed fan (process.send stubbed per the client.test.mjs pattern).
// Run: npm run test:store — esbuild → node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import {
  LIBRARY_FILES_DIR,
  LIBRARY_GITIGNORE_LINE,
  LIBRARY_INDEX_FILE,
  POSTER_SUFFIX,
  RECOVERY_TAG,
  VIDEO_FORMATS,
  __resetLibraryStoreForTests,
  createRecord,
  enqueueWrite,
  fileRelForRecord,
  getRecord,
  libraryRootForWorkspace,
  loadLibrary,
  organizeRecords,
  posterRelForRecord,
  queryLibrary,
  requireLibraryRoot,
  resolveLibraryIndexPath,
  resolveLibraryPath,
  resolveLibraryRoot,
  videoFileAbs,
} from './video-library-store.ts'

/** Minimal PNG whose IHDR carries w/h (the recovery probe reads dims from the first 24 bytes). */
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

/** Deterministic opaque clip payload (the store treats bytes as opaque containers). */
function clipBytes(n, tag = 0xab) {
  return new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7 + tag) & 255))
}

function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'sylo-vidlib-'))
  return { ws, root: libraryRootForWorkspace(ws) }
}

const base = {
  prompt: 'a test clip',
  model: 'wan22-ti2v-5b',
  mode: 'clip',
  preset: 'draft',
  resolution: { width: 832, height: 480 },
  framerate: 24,
  duration_seconds: 5,
  frame_count: 121,
  seed: 42,
  video_format: 'mp4',
}

function mk(root, overrides = {}) {
  return createRecord({ ...base, data: clipBytes(4096), libraryRoot: root, ...overrides })
}

test('layout constants, fileRelForRecord/posterRelForRecord, gitignore line (§4.1)', () => {
  assert.equal(LIBRARY_INDEX_FILE, 'library.json')
  assert.equal(LIBRARY_FILES_DIR, 'files')
  assert.equal(POSTER_SUFFIX, '.poster.png')
  assert.deepEqual(VIDEO_FORMATS, ['mp4', 'webm', 'mkv', 'mov'])
  assert.equal(LIBRARY_GITIGNORE_LINE, '.sylo/videos/files/')
  assert.equal(libraryRootForWorkspace('/tmp/ws'), join('/tmp/ws', '.sylo', 'videos'))
  const iso = '2026-02-07T12:34:56.000Z'
  const d = new Date(iso)
  const dir = ['files', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')].join('/')
  assert.equal(fileRelForRecord('abc', iso), `${dir}/abc.mp4`)
  assert.equal(fileRelForRecord('abc', iso, 'webm'), `${dir}/abc.webm`)
  assert.equal(fileRelForRecord('abc', ''), 'files/1970/01/abc.mp4', 'unparseable created_at → 1970/01')
  assert.equal(posterRelForRecord('abc', iso), `${dir}/abc.poster.png`)
})

test('resolveLibraryPath mirrors SYLO_PI_CWD (tasks-store.ts:37-39) and mutators fail fast', () => {
  const prev = process.env.SYLO_PI_CWD
  try {
    process.env.SYLO_PI_CWD = '/tmp/ws-env'
    assert.equal(resolveLibraryPath(), join('/tmp/ws-env', '.sylo', 'videos', LIBRARY_INDEX_FILE))
    // Explicit cwd wins over env.
    assert.equal(resolveLibraryPath('/tmp/other'), join('/tmp/other', '.sylo', 'videos', LIBRARY_INDEX_FILE))
    assert.equal(resolveLibraryRoot(), libraryRootForWorkspace('/tmp/ws-env'))
    process.env.SYLO_PI_CWD = '   ' // whitespace-only counts as absent
    assert.equal(resolveLibraryPath(), null)
    assert.equal(resolveLibraryRoot({}), null)
    delete process.env.SYLO_PI_CWD
    assert.throws(() => requireLibraryRoot({}), /SYLO_PI_CWD is not set/)
  } finally {
    if (prev === undefined) delete process.env.SYLO_PI_CWD
    else process.env.SYLO_PI_CWD = prev
  }
})

test('videoFileAbs rejects rel paths escaping the library root (works for clip AND poster rels)', () => {
  const { root } = makeWorkspace()
  assert.equal(videoFileAbs(root, 'files/2026/10/x.mp4'), join(root, 'files', '2026', '10', 'x.mp4'))
  assert.equal(videoFileAbs(root, 'files\\2026\\10\\x.poster.png'), join(root, 'files', '2026', '10', 'x.poster.png'))
  assert.throws(() => videoFileAbs(root, '../escape.mp4'), /escapes the video library root/)
  assert.throws(() => videoFileAbs(root, 'files/../../outside.mp4'), /escapes the video library root/)
})

test('createRecord: clip + poster byte save first, coerced §8.2 record, atomic index write, no tmp residue', async () => {
  const { root, ws } = makeWorkspace()
  const bytes = clipBytes(8192, 3)
  const poster = pngBytes(832, 480)
  const res = await mk(root, {
    prompt: 'red bicycle dolly at dusk',
    negative_prompt: 'blurry',
    data: bytes,
    render_ms: 5432,
    tags: ['bikes', 'clip'],
    comfy_prompt_id: 'prompt-1',
    lineage: { source_image_id: 'img-9' },
    poster_data: poster,
  })
  assert.match(res.record.id, /^[0-9a-f-]{36}$/i)
  // Byte saves: exact bytes at the layout paths, poster beside the clip.
  assert.ok(existsSync(res.file_abs))
  assert.deepEqual(new Uint8Array(readFileSync(res.file_abs)), bytes)
  assert.ok(existsSync(res.poster_abs))
  assert.deepEqual(new Uint8Array(readFileSync(res.poster_abs)), poster)
  const rel = fileRelForRecord(res.record.id, res.record.created_at).replaceAll('\\', '/')
  assert.equal(res.record.file_rel, rel)
  assert.ok(rel.startsWith('files/'))
  assert.equal(res.record.poster_rel, `${rel.slice(0, rel.lastIndexOf('/'))}/${res.record.id}.poster.png`)
  assert.equal(res.index_path, resolveLibraryIndexPath(root))
  // Index record: full §8.2 VideoRecord field set (verbatim contract — nothing added).
  assert.deepEqual(res.record, {
    id: res.record.id,
    created_at: res.record.created_at,
    prompt: 'red bicycle dolly at dusk',
    negative_prompt: 'blurry',
    model: 'wan22-ti2v-5b',
    mode: 'clip',
    preset: 'draft',
    resolution: { width: 832, height: 480 },
    framerate: 24,
    duration_seconds: 5,
    frame_count: 121,
    seed: 42,
    file_rel: rel,
    poster_rel: res.record.poster_rel,
    bytes: 8192,
    video_format: 'mp4',
    render_ms: 5432,
    comfy_prompt_id: 'prompt-1',
    lineage: { source_image_id: 'img-9' },
    tags: ['bikes', 'clip'],
    favorite: false,
  })
  const store = loadLibrary(root)
  assert.equal(store.version, 1)
  assert.equal(store.videos.length, 1)
  // In-memory record equals its JSON round-trip (undefined-key normalization).
  const rec = await getRecord({ video_id: res.record.id, libraryRoot: root })
  assert.deepEqual(rec, res.record)
  // Atomic write: renameSync consumed the temp file.
  assert.deepEqual(readdirSync(root).filter((f) => f.endsWith('.tmp')), [])
  assert.deepEqual(JSON.parse(readFileSync(res.index_path, 'utf8')).videos[0].id, res.record.id)
  rmSync(ws, { recursive: true, force: true })
})

test('createRecord: no poster bytes → poster_rel absent; poster_rel override honored for import backfills', async () => {
  const { root, ws } = makeWorkspace()
  const a = await mk(root, {})
  assert.equal(a.record.poster_rel, undefined)
  assert.equal(a.poster_abs, undefined)
  const b = await createRecord({
    ...base,
    prompt: 'imported without bytes',
    libraryRoot: root,
    data: clipBytes(2048, 5),
    id: 'b0a7111e-0000-4000-8000-000000000001',
    created_at: '2026-02-10T08:00:00.000Z',
    file_rel: 'files/2026/02/b0a7111e-0000-4000-8000-000000000001.webm',
    poster_rel: 'files/2026/02/b0a7111e-0000-4000-8000-000000000001.poster.png',
    video_format: 'webm',
  })
  assert.equal(b.record.video_format, 'webm', 'override + format')
  assert.equal(b.record.poster_rel, 'files/2026/02/b0a7111e-0000-4000-8000-000000000001.poster.png')
  assert.equal(b.poster_abs, join(root, 'files', '2026', '02', 'b0a7111e-0000-4000-8000-000000000001.poster.png'))
  assert.equal(loadLibrary(root).videos.length, 2)
  rmSync(ws, { recursive: true, force: true })
})

test('createRecord input validation (plain-language fail-fasts)', async () => {
  const { root } = makeWorkspace()
  await assert.rejects(mk(root, { preset: 'bogus' }), /preset must be 'draft' or 'final'/)
  await assert.rejects(mk(root, { mode: 'panorama' }), /mode must be one of/)
  await assert.rejects(mk(root, { prompt: '   ' }), /non-empty prompt/)
  await assert.rejects(createRecord({ ...base, data: new Uint8Array(0), libraryRoot: root }), /non-empty video bytes/)
  await assert.rejects(mk(root, { resolution: { width: 0, height: 480 } }), /positive width\/height/)
  await assert.rejects(mk(root, { framerate: 0 }), /framerate must be a positive fps/)
  await assert.rejects(mk(root, { duration_seconds: -1 }), /duration_seconds must be finite ≥ 0/)
  await assert.rejects(mk(root, { frame_count: NaN }), /frame_count must be finite ≥ 0/)
  await assert.rejects(mk(root, { seed: -5 }), /seed must be ≥ -1/)
  await assert.rejects(mk(root, { motion_strength: 1.5 }), /motion_strength must be within 0–1/)
  await assert.rejects(mk(root, { video_format: 'avi' }), /video_format must be one of/)
})

test('getRecord: full record incl. lineage; null for unknown id; graceful without workspace', async () => {
  const { root } = makeWorkspace()
  const { record } = await mk(root, { lineage: { source_image_id: 'img-3', source_image_path: 'C:/stills/a.png', parent_video_id: 'v-1' } })
  const got = await getRecord({ video_id: record.id, libraryRoot: root })
  assert.equal(got.id, record.id)
  assert.deepEqual(got.lineage, { source_image_id: 'img-3', source_image_path: 'C:/stills/a.png', parent_video_id: 'v-1' })
  assert.equal(await getRecord({ video_id: 'nope', libraryRoot: root }), null)
  // Missing workspace is graceful for readers.
  assert.equal(await getRecord({ video_id: 'nope' }), null)
})

test('from_image_id lineage persists one-way; NOTHING touches the image-gen library (§3.5)', async () => {
  const { ws, root } = makeWorkspace()
  await mk(root, { lineage: { source_image_id: 'img-7' } })
  assert.ok(existsSync(resolveLibraryIndexPath(root)), 'video index written')
  // The one-way discipline at store level: no import / no write ever reaches the
  // image-gen store path — a back-write would have created .sylo/images/ here.
  assert.equal(existsSync(join(ws, '.sylo', 'images')), false, 'no image-library back-write')
  const rec = await getRecord({ video_id: (await queryLibrary({ libraryRoot: root })).items[0].id, libraryRoot: root })
  assert.deepEqual(rec.lineage, { source_image_id: 'img-7' })
  rmSync(ws, { recursive: true, force: true })
})

test('query: substring case-insensitive over prompt / tags (§3.2)', async () => {
  const { root, ws } = makeWorkspace()
  await mk(root, { prompt: 'Red bicycle at dusk', tags: ['bikes'] })
  await mk(root, { prompt: 'city skyline', tags: ['mood-red'] })
  await mk(root, { prompt: 'mountain lake', tags: ['landscape', 'red-tint'] })
  await mk(root, { prompt: 'blue boat' })
  for (const needle of ['red', 'RED', 'ReD']) {
    const { items, total } = await queryLibrary({ libraryRoot: root, query: needle })
    assert.equal(total, 3, `query ${needle}`)
    assert.deepEqual(items.map((i) => i.prompt).sort(), ['Red bicycle at dusk', 'city skyline', 'mountain lake'])
  }
  const empty = await queryLibrary({ libraryRoot: root, query: 'zebra' })
  assert.deepEqual(empty.items, [])
  assert.equal(empty.total, 0)
  // Compact contract fields + absolute existing paths (poster only when present).
  const all = await queryLibrary({ libraryRoot: root })
  for (const item of all.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      'created_at', 'duration_seconds', 'favorite', 'frame_count', 'framerate', 'height', 'id', 'mode', 'model',
      'path', 'preset', 'prompt', 'render_ms', 'tags', 'width',
    ])
    assert.ok(isAbsolute(item.path) && existsSync(item.path))
  }
  const withPoster = await mk(root, { prompt: 'postered', poster_data: pngBytes(4, 4) })
  const found = (await queryLibrary({ libraryRoot: root, query: 'postered' })).items[0]
  assert.ok(isAbsolute(found.poster_path) && existsSync(found.poster_path))
  assert.ok(found.path.endsWith('.mp4'))
  rmSync(ws, { recursive: true, force: true })
  void withPoster
})

test('query: tags all-match, favorite, model, mode, since/until filters (§3.2 + video additions)', async () => {
  const { root, ws } = makeWorkspace()
  const jan = '2026-01-10T12:00:00.000Z'
  const feb = '2026-02-20T12:00:00.000Z'
  const mar = '2026-03-05T12:00:00.000Z'
  await mk(root, { prompt: 'a', tags: ['bikes'], created_at: jan })
  await mk(root, { prompt: 'b', tags: ['bikes', 'mood-red'], favorite: true, model: 'wan22-a14b', created_at: feb })
  await mk(root, { prompt: 'c', tags: ['bikes', 'mood-red'], model: 'WAN22-A14B', created_at: mar, mode: 'restyle' })
  await mk(root, { prompt: 'd', tags: ['landscape'], created_at: '2026-01-02T00:00:00.000Z', mode: 'loop' })

  const bikes = await queryLibrary({ libraryRoot: root, tags: ['bikes'] })
  assert.equal(bikes.total, 3)
  const allMatch = await queryLibrary({ libraryRoot: root, tags: ['bikes', 'mood-red'] })
  assert.equal(allMatch.total, 2)
  assert.deepEqual((await queryLibrary({ libraryRoot: root, tags: ['bikes', 'nope'] })).total, 0)

  const favs = await queryLibrary({ libraryRoot: root, favorite: true })
  assert.equal(favs.total, 1)
  assert.equal(favs.items[0].prompt, 'b')
  const nonFavs = await queryLibrary({ libraryRoot: root, favorite: false })
  assert.equal(nonFavs.total, 3)

  const model = await queryLibrary({ libraryRoot: root, model: 'wan22-a14b' })
  assert.equal(model.total, 2) // case-insensitive exact match
  const model2 = await queryLibrary({ libraryRoot: root, model: 'WAN22-A14B' })
  assert.equal(model2.total, 2)

  const modes = await queryLibrary({ libraryRoot: root, mode: 'restyle' })
  assert.equal(modes.total, 1)
  assert.equal(modes.items[0].prompt, 'c')

  const since = await queryLibrary({ libraryRoot: root, since: '2026-02-01T00:00:00.000Z' })
  assert.equal(since.total, 2)
  // Newest first.
  assert.deepEqual(since.items.map((i) => i.prompt), ['c', 'b'])
  const range = await queryLibrary({ libraryRoot: root, since: '2026-01-10T12:00:00.000Z', until: '2026-02-20T12:00:00.000Z' })
  assert.equal(range.total, 2)
  assert.deepEqual(range.items.map((i) => i.prompt), ['b', 'a'])

  // Filters compose.
  const combo = await queryLibrary({ libraryRoot: root, tags: ['bikes'], favorite: true, since: jan })
  assert.equal(combo.total, 1)
  assert.equal(combo.items[0].prompt, 'b')
  rmSync(ws, { recursive: true, force: true })
})

test('query: limit default 20 / max 100, offset windows, total untouched', async () => {
  const { root, ws } = makeWorkspace()
  const iso = (n) => new Date(Date.UTC(2026, 0, 1, 0, n % 60, 0) + n * 60_000).toISOString()
  // Seed 25 records for the default-limit check.
  for (let i = 0; i < 25; i++) await mk(root, { prompt: `clip ${i}`, created_at: iso(i) })
  const def = await queryLibrary({ libraryRoot: root })
  assert.equal(def.items.length, 20)
  assert.equal(def.total, 25)
  // Newest first.
  assert.equal(def.items[0].prompt, 'clip 24')
  const page = await queryLibrary({ libraryRoot: root, limit: 5, offset: 3 })
  // Newest-first window after skipping clip 24…22.
  assert.deepEqual(page.items.map((i) => i.prompt), ['clip 21', 'clip 20', 'clip 19', 'clip 18', 'clip 17'])
  assert.equal(page.total, 25)
  const beyond = await queryLibrary({ libraryRoot: root, offset: 999 })
  assert.deepEqual(beyond.items, [])
  assert.equal(beyond.total, 25)

  // Clamp: seed to 105 via the queue (also pre-stress sanity), limit 500 → 100 items.
  await Promise.all(
    Array.from({ length: 80 }, (_, i) => mk(root, { prompt: `extra-${i}`, created_at: iso(1000 + i) })),
  )
  const clamped = await queryLibrary({ libraryRoot: root, limit: 500 })
  assert.equal(clamped.items.length, 100)
  assert.equal(clamped.total, 105)
  const zero = await queryLibrary({ libraryRoot: root, limit: 0 })
  assert.deepEqual(zero.items, [])
  assert.equal(zero.total, 105)
  rmSync(ws, { recursive: true, force: true })
})

test('query: prompt truncated to ≤120 chars', async () => {
  const { root, ws } = makeWorkspace()
  const long = 'x'.repeat(300) + ' tail'
  await mk(root, { prompt: long })
  const { items } = await queryLibrary({ libraryRoot: root })
  assert.equal(items[0].prompt.length, 120)
  assert.ok(items[0].prompt.endsWith('…'))
  rmSync(ws, { recursive: true, force: true })
})

test('organize: tags add/remove (case-insensitive identity, no dupes), favorite only-when-boolean, unknown ids no-op', async () => {
  const { root, ws } = makeWorkspace()
  const { record } = await mk(root, { tags: ['bikes'] })
  let { updated } = await organizeRecords({ libraryRoot: root, video_ids: [record.id], add_tags: ['Bikes', 'Mood Red'] })
  assert.deepEqual(updated[0].tags, ['bikes', 'Mood Red']) // dedupe by key, keep original casing for new tag
  // Remove first, then add (add expresses latest intent).
  ;({ updated } = await organizeRecords({
    libraryRoot: root,
    video_ids: [record.id],
    remove_tags: ['BIKES'],
    add_tags: ['bike'],
  }))
  assert.deepEqual(updated[0].tags, ['Mood Red', 'bike'])
  // favorite only changes when a boolean is passed.
  ;({ updated } = await organizeRecords({ libraryRoot: root, video_ids: [record.id], favorite: true }))
  assert.equal(updated[0].favorite, true)
  ;({ updated } = await organizeRecords({ libraryRoot: root, video_ids: [record.id], add_tags: ['x'] }))
  assert.equal(updated[0].favorite, true)
  ;({ updated } = await organizeRecords({ libraryRoot: root, video_ids: [record.id], favorite: false }))
  assert.equal(updated[0].favorite, false)
  // The §8.2 record contract has no album/caption — organize offers no such knobs.
  assert.equal(updated[0].album, undefined)
  assert.equal(updated[0].caption, undefined)
  // Unknown ids are no-ops.
  const miss = await organizeRecords({ libraryRoot: root, video_ids: ['missing-id'], add_tags: ['y'] })
  assert.deepEqual(miss.updated, [])
  rmSync(ws, { recursive: true, force: true })
})

test('organize delete: removes clip AND poster AND record; delete takes precedence; tolerates missing files (§3.3 GC)', async () => {
  const { root, ws } = makeWorkspace()
  const a = await mk(root, { prompt: 'keep me' })
  const b = await mk(root, { prompt: 'delete me', poster_data: pngBytes(10, 10) })
  assert.ok(existsSync(b.file_abs) && existsSync(b.poster_abs))
  const res = await organizeRecords({ libraryRoot: root, video_ids: [b.record.id], delete: true, add_tags: ['ignored'] })
  assert.deepEqual(res.deleted, [b.record.id])
  assert.deepEqual(res.updated, [])
  assert.equal(existsSync(b.file_abs), false)
  assert.equal(existsSync(b.poster_abs), false, 'poster GC — no orphan poster (§3.3)')
  assert.equal(await getRecord({ video_id: b.record.id, libraryRoot: root }), null)
  assert.deepEqual(JSON.parse(readFileSync(resolveLibraryIndexPath(root), 'utf8')).videos.map((v) => v.id), [a.record.id])
  // Missing files never block the record drop.
  await organizeRecords({ libraryRoot: root, video_ids: [a.record.id], delete: true })
  assert.equal(loadLibrary(root).videos.length, 0)
  // Deleting an unknown id is a no-op.
  const none = await organizeRecords({ libraryRoot: root, video_ids: ['unknown'], delete: true })
  assert.deepEqual(none.deleted, [])
  rmSync(ws, { recursive: true, force: true })
})

test('malformed recovery: corrupt JSON → corrupt-<ts> rename + rebuild from files/ (poster IHDR dims + placeholders)', async () => {
  const { root, ws } = makeWorkspace()
  // Orphan clips + poster, no index at all.
  const id1 = '11111111-1111-4111-8111-111111111111'
  const id2 = '22222222-2222-4222-8222-222222222222'
  const dir = join(root, 'files', '2026', '01')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id1}.mp4`), clipBytes(1024, 1))
  writeFileSync(join(dir, `${id1}${POSTER_SUFFIX}`), pngBytes(640, 480))
  writeFileSync(join(dir, `${id2}.webm`), clipBytes(512, 2))
  writeFileSync(join(dir, 'stray-junk.txt'), new Uint8Array([1, 2, 3])) // not a container → not indexed
  writeFileSync(resolveLibraryIndexPath(root), '{corrupt json !!')
  const { items, total } = await queryLibrary({ libraryRoot: root })
  assert.equal(total, 2, 'only container files index')
  const one = items.find((i) => i.id === id1)
  assert.ok(one)
  assert.equal(one.width, 640, 'dims from the poster PNG IHDR (§4.4)')
  assert.equal(one.height, 480)
  assert.ok(one.poster_path.endsWith(`${id1}.poster.png`))
  assert.equal(one.path.endsWith('.mp4'), true)
  // Full record shape: rebuilt metadata is documented placeholders + RECOVERY_TAG.
  const rec = await getRecord({ video_id: id2, libraryRoot: root })
  assert.equal(rec.file_rel, `files/2026/01/${id2}.webm`)
  assert.equal(rec.poster_rel, undefined, 'no poster sibling → poster absent, tolerated')
  assert.equal(rec.video_format, 'webm', 'format from file extension')
  assert.equal(rec.resolution.width, 0)
  assert.equal(rec.resolution.height, 0)
  assert.deepEqual(rec.tags, [RECOVERY_TAG])
  assert.equal(rec.model, 'unknown')
  assert.equal(rec.mode, 'clip')
  assert.equal(rec.preset, 'final')
  assert.equal(rec.prompt, '')
  assert.equal(rec.render_ms, 0)
  assert.deepEqual(rec.lineage, {})
  assert.ok(!Number.isNaN(Date.parse(rec.created_at))) // file mtime fallback
  // Evidence kept, index rewritten atomically, no tmp residue.
  assert.deepEqual(readdirSync(root).filter((f) => f.startsWith(`${LIBRARY_INDEX_FILE}.corrupt-`)).length, 1)
  assert.deepEqual(readdirSync(root).filter((f) => f.endsWith('.tmp')), [])
  JSON.parse(readFileSync(resolveLibraryIndexPath(root), 'utf8'))
  rmSync(ws, { recursive: true, force: true })
})

test('malformed recovery: shape-invalid JSON and missing index; recovery folded into mutations', async () => {
  const { root, ws } = makeWorkspace()
  const id = '33333333-3333-4333-8333-333333333333'
  const dir = join(root, 'files', '2026', '03')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.mp4`), clipBytes(128, 9))
  // Parses as JSON but violates the VideoLibraryStore shape → recovery, not throw.
  writeFileSync(resolveLibraryIndexPath(root), JSON.stringify({ version: 'x', videos: 'nope' }))
  const first = await queryLibrary({ libraryRoot: root })
  assert.equal(first.total, 1)

  // Missing index → fresh store, nothing materialized on disk, no corrupt- file.
  const { root: freshRoot, ws: freshWs } = makeWorkspace()
  const fresh = await queryLibrary({ libraryRoot: freshRoot })
  assert.deepEqual(fresh, { items: [], total: 0 })
  assert.equal(existsSync(freshRoot), false)
  assert.equal(existsSync(resolveLibraryIndexPath(freshRoot)), false)

  // Corrupt index + createRecord: rebuild is folded into the mutation's read.
  writeFileSync(resolveLibraryIndexPath(root), '][')
  const res = await mk(root, { prompt: 'after recovery' })
  const after = loadLibrary(root)
  assert.equal(after.videos.length, 2)
  assert.deepEqual(after.videos.map((v) => v.prompt).sort(), ['', 'after recovery'])
  // The newly-created record is metadata-complete; rebuilt ones carry the loss marker.
  assert.ok(!after.videos.find((v) => v.id === res.record.id).tags.includes(RECOVERY_TAG))
  assert.ok(after.videos.filter((v) => v.id !== res.record.id).every((v) => v.tags.includes(RECOVERY_TAG)))
  // recoverFromCorruptIndex is exported for the doctor (§3.3) — direct call also rebuilds.
  writeFileSync(resolveLibraryIndexPath(root), '&&&')
  const manual = loadLibrary(root)
  assert.equal(manual.videos.length, 2)
  const corruptFiles = readdirSync(root).filter((f) => f.startsWith(`${LIBRARY_INDEX_FILE}.corrupt-`))
  assert.equal(corruptFiles.length, 3, 'shape-invalid + ][ + &&& — three recoveries, evidence accumulating')
  rmSync(ws, { recursive: true, force: true })
  rmSync(freshWs, { recursive: true, force: true })
})

test('concurrent-write stress: 30 creates + 30 organizes through the queue → zero lost writes, no temp residue', async () => {
  await __resetLibraryStoreForTests()
  const { root, ws } = makeWorkspace()
  // Phase A — concurrent creates.
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) => mk(root, { prompt: `stress-${i}`, tags: [`n${i}`] })),
  )
  const ids = results.map((r) => r.record.id)
  assert.equal(new Set(ids).size, 30)
  assert.equal(loadLibrary(root).videos.length, 30)
  // Phase B — concurrent organizes interleaved through the queue's ordering.
  await Promise.all([
    ...ids.map((id, i) =>
      organizeRecords({ libraryRoot: root, video_ids: [id], add_tags: ['stress'], favorite: i % 2 === 0 }),
    ),
  ])
  const store = loadLibrary(root)
  assert.equal(store.videos.length, 30)
  for (const rec of store.videos) {
    assert.ok(rec.tags.includes('stress'), `record ${rec.id} missing stress tag`)
    // Queue is serial + deterministic: the last op per record wins.
    const idx = ids.indexOf(rec.id)
    assert.equal(rec.favorite, idx % 2 === 0)
  }
  assert.deepEqual(readdirSync(root).filter((f) => f.endsWith('.tmp')), [])
  // Byte files intact.
  assert.ok(existsSync(results[0].file_abs))
  await __resetLibraryStoreForTests()
  rmSync(ws, { recursive: true, force: true })
})

test('enqueueWrite serializes mixed sync/async ops in submission order and survives errors', async () => {
  await __resetLibraryStoreForTests()
  const order = []
  await Promise.all([
    enqueueWrite(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push('slow-1')
    }),
    enqueueWrite(() => {
      order.push('fast-2')
      return 2
    }),
    enqueueWrite(() => {
      throw new Error('boom')
    }),
    enqueueWrite(() => order.push('after-error-4')),
  ]).catch((e) => assert.equal(e.message, 'boom'))
  assert.deepEqual(order, ['slow-1', 'fast-2', 'after-error-4'])
  // Reset leaves the chain drainable and empty (test hook parity with client.ts).
  await __resetLibraryStoreForTests()
})

test('change fan: process.send emits {type, workspaceKey, reason} per mutation; guarded when absent (§4.5)', async () => {
  const { root, ws } = makeWorkspace()
  const sent = []
  const fakeSend = (msg) => {
    sent.push(msg)
    return true
  }
  // Env determinism: the dev/broker shell may inject SYLO_PI_CWD globally —
  // the "libraryRoot-only ⇒ no workspace identity" case below requires it unset.
  const prevCwd = process.env.SYLO_PI_CWD
  delete process.env.SYLO_PI_CWD
  process.send = fakeSend
  try {
    const a = await mk(root, { workspaceCwd: ws })
    await organizeRecords({ libraryRoot: root, video_ids: [a.record.id], favorite: true, workspaceCwd: ws })
    await organizeRecords({ libraryRoot: root, video_ids: [a.record.id], delete: true, workspaceCwd: ws })
    assert.deepEqual(sent, [
      { type: 'sylo-video-gen:changed', workspaceKey: ws, reason: 'create' },
      { type: 'sylo-video-gen:changed', workspaceKey: ws, reason: 'organize' },
      { type: 'sylo-video-gen:changed', workspaceKey: ws, reason: 'delete' },
    ])
    // libraryRoot-only with no workspace identity → notify skipped, mutation still succeeds.
    const before = sent.length
    await mk(root)
    assert.equal(sent.length, before)
  } finally {
    delete process.send
    if (prevCwd === undefined) delete process.env.SYLO_PI_CWD
    else process.env.SYLO_PI_CWD = prevCwd
  }
  // Guarded without process.send (vanilla Pi): no crash.
  const b = await mk(root)
  assert.ok(b.file_abs.startsWith(root))
  rmSync(ws, { recursive: true, force: true })
})

test('workspaceCwd resolution end-to-end (broker path parity)', async () => {
  const { ws, root } = makeWorkspace()
  const res = await mk('', { workspaceCwd: ws }) // explicit cwd instead of libraryRoot
  assert.equal(resolveLibraryRoot({ workspaceCwd: ws }), root)
  assert.ok(res.file_abs.startsWith(root))
  assert.ok(existsSync(res.file_abs))
  assert.equal(loadLibrary(root).videos.length, 1)
  rmSync(ws, { recursive: true, force: true })
})

test('__resetLibraryStoreForTests drains in-flight writes before resetting', async () => {
  await __resetLibraryStoreForTests()
  const done = []
  enqueueWrite(async () => {
    await new Promise((r) => setTimeout(r, 25))
    done.push(1)
  })
  await __resetLibraryStoreForTests()
  assert.deepEqual(done, [1])
})