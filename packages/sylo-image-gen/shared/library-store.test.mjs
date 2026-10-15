// Unit tests for the per-workspace image library store (plan §4.2, §8 step 3).
// Fully offline: real temp directories + minimal PNG bytes, no network, no
// ComfyUI. Covers: atomic index writes, the §3.2 query contract (full filter
// matrix), organize semantics, malformed-index recovery (corrupt rename +
// rebuild-from-files), concurrent-write stress through the in-flight queue,
// delete-removes-file-and-record, and the sylo-image-gen:changed fan
// (process.send stubbed per the client.test.mjs pattern).
// Run: npm run test:store — esbuild → node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'

import {
  IMAGE_FORMAT,
  LIBRARY_FILES_DIR,
  LIBRARY_GITIGNORE_LINE,
  LIBRARY_INDEX_FILE,
  RECOVERY_TAG,
  __resetLibraryStoreForTests,
  createRecord,
  enqueueWrite,
  fileRelForRecord,
  getRecord,
  imageFileAbs,
  libraryRootForWorkspace,
  loadLibrary,
  organizeRecords,
  queryLibrary,
  requireLibraryRoot,
  resolveLibraryIndexPath,
  resolveLibraryPath,
  resolveLibraryRoot,
} from './library-store.ts'

/** Minimal PNG whose IHDR carries w/h (store reads dims from the first 24 bytes). */
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

function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'sylo-imglib-'))
  return { ws, root: libraryRootForWorkspace(ws) }
}

const base = {
  prompt: 'a test image',
  model: 'z-image-turbo',
  preset: 'final',
  width: 32,
  height: 32,
}

function mk(root, overrides = {}) {
  return createRecord({ ...base, data: pngBytes(32, 32), libraryRoot: root, ...overrides })
}

test('layout constants, fileRelForRecord, gitignore line (§4.1)', () => {
  assert.equal(LIBRARY_INDEX_FILE, 'library.json')
  assert.equal(LIBRARY_FILES_DIR, 'files')
  assert.equal(IMAGE_FORMAT, 'png')
  assert.equal(LIBRARY_GITIGNORE_LINE, '.sylo/images/files/')
  assert.equal(libraryRootForWorkspace('/tmp/ws'), join('/tmp/ws', '.sylo', 'images'))
  const iso = '2026-02-07T12:34:56.000Z'
  const d = new Date(iso)
  const expected = ['files', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), `abc.${IMAGE_FORMAT}`].join('/')
  assert.equal(fileRelForRecord('abc', iso), expected)
})

test('resolveLibraryPath mirrors SYLO_PI_CWD (tasks-store.ts:37-39) and mutators fail fast', () => {
  const prev = process.env.SYLO_PI_CWD
  try {
    process.env.SYLO_PI_CWD = '/tmp/ws-env'
    assert.equal(resolveLibraryPath(), join('/tmp/ws-env', '.sylo', 'images', LIBRARY_INDEX_FILE))
    // Explicit cwd wins over env.
    assert.equal(resolveLibraryPath('/tmp/other'), join('/tmp/other', '.sylo', 'images', LIBRARY_INDEX_FILE))
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

test('imageFileAbs rejects rel paths escaping the library root', () => {
  const { root } = makeWorkspace()
  assert.equal(imageFileAbs(root, 'files/2026/10/x.png'), join(root, 'files', '2026', '10', 'x.png'))
  assert.throws(() => imageFileAbs(root, '../escape.png'), /escapes the image library root/)
  assert.throws(() => imageFileAbs(root, 'files/../../outside.png'), /escapes the image library root/)
})

test('createRecord: byte save first, coerced record, atomic index write, no tmp residue', async () => {
  const { root, ws } = makeWorkspace()
  const bytes = pngBytes(64, 48)
  const res = await mk(root, {
    prompt: 'red bicycle at dusk',
    negative_prompt: 'blurry',
    preset: 'draft',
    aspect: '16:9',
    width: 64,
    height: 48,
    data: bytes,
    steps: 8,
    guidance: 3.5,
    seed: 42,
    sampler: 'res_multistep',
    gen_ms: 5432,
    tags: ['bikes', 'draft'],
    origin: 'agent',
    comfy_prompt_id: 'prompt-1',
    parent_id: 'parent-1',
  })
  assert.match(res.record.id, /^[0-9a-f-]{36}$/i)
  // Byte save: exact bytes at the layout path.
  assert.ok(existsSync(res.file_abs))
  assert.deepEqual(new Uint8Array(readFileSync(res.file_abs)), bytes)
  const rel = fileRelForRecord(res.record.id, res.record.created_at).split(sep).join('/')
  assert.equal(res.record.file_rel, rel)
  assert.ok(rel.startsWith('files/'))
  assert.equal(res.index_path, resolveLibraryIndexPath(root))
  // Index record: full §4.2 field set.
  assert.deepEqual(res.record, {
    id: res.record.id,
    created_at: res.record.created_at,
    file_rel: rel,
    width: 64,
    height: 48,
    bytes: bytes.byteLength,
    model: 'z-image-turbo',
    backend: 'comfyui',
    preset: 'draft',
    prompt: 'red bicycle at dusk',
    negative_prompt: 'blurry',
    params: { steps: 8, guidance: 3.5, seed: 42, sampler: 'res_multistep', aspect: '16:9' },
    gen_ms: 5432,
    parent_id: 'parent-1',
    origin: 'agent',
    tags: ['bikes', 'draft'],
    favorite: false,
    comfy_prompt_id: 'prompt-1',
  })
  const store = loadLibrary(root)
  assert.equal(store.version, 1)
  assert.equal(store.images.length, 1)
  // Atomic write: renameSync consumed the temp file.
  assert.deepEqual(readdirSync(root).filter((f) => f.endsWith('.tmp')), [])
  assert.deepEqual(JSON.parse(readFileSync(res.index_path, 'utf8')).images[0].id, res.record.id)
  rmSync(ws, { recursive: true, force: true })
})

test('createRecord input validation', async () => {
  const { root } = makeWorkspace()
  await assert.rejects(mk(root, { preset: 'bogus' }), /preset must be 'draft' or 'final'/)
  await assert.rejects(mk(root, { prompt: '   ' }), /non-empty prompt/)
  await assert.rejects(createRecord({ ...base, data: new Uint8Array(0), libraryRoot: root }), /non-empty image bytes/)
  await assert.rejects(mk(root, { width: 0 }), /positive width\/height/)
  await assert.rejects(mk(root, { aspect: '21:9' }), /aspect must be one of/)
})

test('getRecord: full record incl. lineage; null for unknown id', async () => {
  const { root } = makeWorkspace()
  const { record } = await mk(root, { parent_id: 'p-1' })
  const got = await getRecord({ image_id: record.id, libraryRoot: root })
  assert.equal(got.id, record.id)
  assert.equal(got.parent_id, 'p-1')
  assert.equal(await getRecord({ image_id: 'nope', libraryRoot: root }), null)
  // Missing workspace is graceful for readers.
  assert.equal(await getRecord({ image_id: 'nope' }), null)
})

test('query: substring case-insensitive over prompt / tags / caption (§3.2)', async () => {
  const { root, ws } = makeWorkspace()
  await mk(root, { prompt: 'Red bicycle at dusk', tags: ['bikes'] })
  await mk(root, { prompt: 'city skyline', tags: ['mood-red'] })
  await mk(root, { prompt: 'mountain lake', tags: ['landscape'], caption: 'A calm red-tinted sunset' })
  await mk(root, { prompt: 'blue boat' })
  for (const needle of ['red', 'RED', 'ReD']) {
    const { items, total } = await queryLibrary({ libraryRoot: root, query: needle })
    assert.equal(total, 3, `query ${needle}`)
    assert.deepEqual(items.map((i) => i.prompt).sort(), ['Red bicycle at dusk', 'city skyline', 'mountain lake'])
  }
  const empty = await queryLibrary({ libraryRoot: root, query: 'zebra' })
  assert.deepEqual(empty.items, [])
  assert.equal(empty.total, 0)
  // Compact contract fields + absolute existing path.
  const all = await queryLibrary({ libraryRoot: root })
  for (const item of all.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      'created_at', 'favorite', 'gen_ms', 'height', 'id', 'model', 'path', 'preset', 'prompt', 'tags', 'width',
    ])
    assert.ok(isAbsolute(item.path) && existsSync(item.path))
  }
  rmSync(ws, { recursive: true, force: true })
})

test('query: tags all-match, favorite, model, since filters (§3.2)', async () => {
  const { root, ws } = makeWorkspace()
  const jan = '2026-01-10T12:00:00.000Z'
  const feb = '2026-02-20T12:00:00.000Z'
  const mar = '2026-03-05T12:00:00.000Z'
  await mk(root, { prompt: 'a', tags: ['bikes'], created_at: jan })
  await mk(root, { prompt: 'b', tags: ['bikes', 'mood-red'], favorite: true, model: 'qwen-image-2', created_at: feb })
  await mk(root, { prompt: 'c', tags: ['bikes', 'mood-red', 'extra'], model: 'QWEN-IMAGE-2', created_at: mar })
  await mk(root, { prompt: 'd', tags: ['landscape'], created_at: jan })

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

  const model = await queryLibrary({ libraryRoot: root, model: 'qwen-image-2' })
  assert.equal(model.total, 2) // case-insensitive exact match
  const model2 = await queryLibrary({ libraryRoot: root, model: 'QWEN-IMAGE-2' })
  assert.equal(model2.total, 2)

  const since = await queryLibrary({ libraryRoot: root, since: '2026-02-01T00:00:00.000Z' })
  assert.equal(since.total, 2)
  // Newest first.
  assert.deepEqual(since.items.map((i) => i.prompt), ['c', 'b'])
  const sinceMar = await queryLibrary({ libraryRoot: root, since: '2026-03-05T12:00:00.000Z' })
  assert.equal(sinceMar.total, 1)
  assert.equal(sinceMar.items[0].prompt, 'c')

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
  for (let i = 0; i < 25; i++) await mk(root, { prompt: `img ${i}`, created_at: iso(i) })
  const def = await queryLibrary({ libraryRoot: root })
  assert.equal(def.items.length, 20)
  assert.equal(def.total, 25)
  // Newest first.
  assert.equal(def.items[0].prompt, 'img 24')
  const page = await queryLibrary({ libraryRoot: root, limit: 5, offset: 3 })
  // Newest-first window after skipping img 24…22.
  assert.deepEqual(page.items.map((i) => i.prompt), ['img 21', 'img 20', 'img 19', 'img 18', 'img 17'])
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

test('organize: tags add/remove (case-insensitive identity, no dupes), favorite, album set/clear', async () => {
  const { root, ws } = makeWorkspace()
  const { record } = await mk(root, { tags: ['bikes'] })
  let { updated } = await organizeRecords({ libraryRoot: root, image_ids: [record.id], add_tags: ['Bikes', 'Mood Red'] })
  assert.deepEqual(updated[0].tags, ['bikes', 'Mood Red']) // dedupe by key, keep original casing for new tag
  // Remove first, then add (add expresses latest intent).
  ;({ updated } = await organizeRecords({
    libraryRoot: root,
    image_ids: [record.id],
    remove_tags: ['BIKES'],
    add_tags: ['bike'],
  }))
  assert.deepEqual(updated[0].tags, ['Mood Red', 'bike'])
  // favorite only changes when a boolean is passed.
  ;({ updated } = await organizeRecords({ libraryRoot: root, image_ids: [record.id], favorite: true }))
  assert.equal(updated[0].favorite, true)
  ;({ updated } = await organizeRecords({ libraryRoot: root, image_ids: [record.id], add_tags: ['x'] }))
  assert.equal(updated[0].favorite, true)
  ;({ updated } = await organizeRecords({ libraryRoot: root, image_ids: [record.id], favorite: false }))
  assert.equal(updated[0].favorite, false)
  // Album: string sets, ''/null clear, undefined = no change.
  ;({ updated } = await organizeRecords({ libraryRoot: root, image_ids: [record.id], album: 'Concepts' }))
  assert.equal(updated[0].album, 'Concepts')
  ;({ updated } = await organizeRecords({ libraryRoot: root, image_ids: [record.id], favorite: true }))
  assert.equal(updated[0].album, 'Concepts')
  ;({ updated } = await organizeRecords({ libraryRoot: root, image_ids: [record.id], album: '' }))
  assert.equal(updated[0].album, undefined)
  ;({ updated } = await organizeRecords({ libraryRoot: root, image_ids: [record.id], album: null }))
  assert.equal(updated[0].album, undefined)
  // Unknown ids are no-ops.
  const miss = await organizeRecords({ libraryRoot: root, image_ids: ['missing-id'], add_tags: ['y'] })
  assert.deepEqual(miss.updated, [])
  rmSync(ws, { recursive: true, force: true })
})

test('organize delete: removes file AND record, rewrites index; delete takes precedence; tolerates missing file', async () => {
  const { root, ws } = makeWorkspace()
  const a = await mk(root, { prompt: 'keep me file-less' })
  const b = await mk(root, { prompt: 'delete me' })
  assert.ok(existsSync(b.file_abs))
  const res = await organizeRecords({ libraryRoot: root, image_ids: [b.record.id], delete: true, add_tags: ['ignored'] })
  assert.deepEqual(res.deleted, [b.record.id])
  assert.deepEqual(res.updated, [])
  assert.equal(existsSync(b.file_abs), false)
  assert.equal(await getRecord({ image_id: b.record.id, libraryRoot: root }), null)
  assert.deepEqual(JSON.parse(readFileSync(resolveLibraryIndexPath(root), 'utf8')).images.map((im) => im.id), [
    a.record.id,
  ])
  // Missing file never blocks the record drop.
  await organizeRecords({ libraryRoot: root, image_ids: [a.record.id], delete: true })
  assert.equal(loadLibrary(root).images.length, 0)
  // Deleting an unknown id is a no-op.
  const none = await organizeRecords({ libraryRoot: root, image_ids: ['unknown'], delete: true })
  assert.deepEqual(none.deleted, [])
  rmSync(ws, { recursive: true, force: true })
})

test('malformed recovery: corrupt JSON → corrupt-<ts> rename + rebuild from files/ (metadata loss documented)', async () => {
  const { root, ws } = makeWorkspace()
  // Orphan PNGs with no index at all.
  const id1 = '11111111-1111-4111-8111-111111111111'
  const id2 = '22222222-2222-4222-8222-222222222222'
  const dir = join(root, 'files', '2026', '01')
  mkdirSync(dir, { recursive: true })
  const p1 = join(dir, `${id1}.png`)
  const p2 = join(dir, `${id2}.png`)
  writeFileSync(p1, pngBytes(640, 480))
  writeFileSync(p2, new Uint8Array([1, 2, 3, 4, 5])) // not a PNG → dims 0, still recovered
  writeFileSync(resolveLibraryIndexPath(root), '{corrupt json !!')
  const { items, total } = await queryLibrary({ libraryRoot: root })
  assert.equal(total, 2)
  const one = items.find((i) => i.id === id1)
  assert.ok(one)
  assert.equal(one.width, 640)
  assert.equal(one.height, 480)
  // Full record shape: rebuilt metadata is documented placeholders + RECOVERY_TAG.
  const rec = await getRecord({ image_id: id2, libraryRoot: root })
  assert.equal(rec.file_rel.split(sep).join('/'), `files/2026/01/${id2}.png`)
  assert.equal(rec.width, 0)
  assert.equal(rec.height, 0)
  assert.deepEqual(rec.tags, [RECOVERY_TAG])
  assert.equal(rec.model, 'unknown')
  assert.equal(rec.preset, 'final')
  assert.equal(rec.prompt, '')
  assert.equal(rec.favorite, false)
  assert.ok(!Number.isNaN(Date.parse(rec.created_at))) // file mtime fallback
  // Evidence kept, evidence renamed, index rewritten atomically.
  assert.deepEqual(readdirSync(root).filter((f) => f.startsWith(`${LIBRARY_INDEX_FILE}.corrupt-`)).length, 1)
  assert.deepEqual(readdirSync(root).filter((f) => f.endsWith('.tmp')), [])
  JSON.parse(readFileSync(resolveLibraryIndexPath(root), 'utf8'))
  rmSync(ws, { recursive: true, force: true })
})

test('malformed recovery: shape-invalid JSON and missing index; recovery on mutation', async () => {
  const { root, ws } = makeWorkspace()
  const id = '33333333-3333-4333-8333-333333333333'
  const dir = join(root, 'files', '2026', '03')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.png`), pngBytes(16, 16))
  // Parses as JSON but violates the LibraryStore shape → recovery, not throw.
  writeFileSync(resolveLibraryIndexPath(root), JSON.stringify({ version: 'x', images: 'nope' }))
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
  assert.equal(after.images.length, 2)
  assert.deepEqual(after.images.map((im) => im.prompt).sort(), ['', 'after recovery'])
  // The newly-created record is metadata-complete; rebuilt ones carry the loss marker.
  assert.ok(!after.images.find((im) => im.id === res.record.id).tags.includes(RECOVERY_TAG))
  assert.ok(after.images.filter((im) => im.id !== res.record.id).every((im) => im.tags.includes(RECOVERY_TAG)))
  rmSync(ws, { recursive: true, force: true })
  rmSync(freshWs, { recursive: true, force: true })
})

test('concurrent-write stress: 30 creates + 30 organizes through the queue → zero lost writes, no temp residue', async () => {
  await __resetLibraryStoreForTests()
  const { root, ws } = makeWorkspace()
  // Phase A — concurrent creates.
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      mk(root, { prompt: `stress-${i}`, tags: [`n${i}`] }),
    ),
  )
  const ids = results.map((r) => r.record.id)
  assert.equal(new Set(ids).size, 30)
  assert.equal(loadLibrary(root).images.length, 30)
  // Phase B — concurrent organizes interleaved with the queue's ordering.
  await Promise.all([
    ...ids.map((id, i) =>
      organizeRecords({ libraryRoot: root, image_ids: [id], add_tags: ['stress'], favorite: i % 2 === 0 }),
    ),
  ])
  const store = loadLibrary(root)
  assert.equal(store.images.length, 30)
  for (const [i, rec] of store.images.entries()) {
    assert.ok(rec.tags.includes('stress'), `record ${i} missing stress tag`)
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

test('change fan: process.send emits {type, workspaceKey, reason} per mutation; guarded when absent', async () => {
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
    await organizeRecords({ libraryRoot: root, image_ids: [a.record.id], favorite: true, workspaceCwd: ws })
    await organizeRecords({ libraryRoot: root, image_ids: [a.record.id], delete: true, workspaceCwd: ws })
    assert.deepEqual(sent, [
      { type: 'sylo-image-gen:changed', workspaceKey: ws, reason: 'create' },
      { type: 'sylo-image-gen:changed', workspaceKey: ws, reason: 'organize' },
      { type: 'sylo-image-gen:changed', workspaceKey: ws, reason: 'delete' },
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
  rmSync(ws, { recursive: true, force: true })
})

test('workspaceCwd resolution end-to-end (broker path parity)', async () => {
  const { ws, root } = makeWorkspace()
  const res = await mk('', { workspaceCwd: ws }) // explicit cwd instead of libraryRoot
  assert.equal(resolveLibraryRoot({ workspaceCwd: ws }), root)
  assert.ok(res.file_abs.startsWith(root))
  assert.ok(existsSync(res.file_abs))
  assert.equal(loadLibrary(root).images.length, 1)
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