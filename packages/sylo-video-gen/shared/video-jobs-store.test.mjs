/**
 * §4.3 durable render-ledger tests (shared/video-jobs-store.ts) — the §8.5
 * carve-out's "job replay" test portion, landed with its consumers at §8.6.
 * Offline (temp dirs only, no ComfyUI).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  __resetVideoJobsStoreForTests,
  createJob,
  getJob,
  JOBS_INDEX_FILE,
  listJobs,
  loadJobsWithRecovery,
  updateJob,
} from './video-jobs-store.ts'
import { resolveVideoGenRequest } from './catalog.ts'

function resolvedRequest(overrides = {}) {
  return resolveVideoGenRequest({ prompt: 'test shot', seed: 42, ...overrides })
}

function freshWorkspace() {
  return mkdtempSync(join(tmpdir(), 'sylo-videogen-jobs-'))
}

test('jobs.json: create → running(+prompt id) → done lifecycle with the §4.3 row contract', async () => {
  const ws = freshWorkspace()
  try {
    await __resetVideoJobsStoreForTests()
    const job = await createJob({ request: resolvedRequest(), workspaceCwd: ws })
    assert.equal(job.status, 'queued')
    assert.ok(job.id)
    assert.equal(job.request.mode, 'clip')
    assert.equal(job.request.seed, 42)
    assert.ok(job.created_at)

    const running = await updateJob({ job_id: job.id, status: 'running', started_at: new Date().toISOString(), comfy_prompt_id: 'pid-1', workspaceCwd: ws })
    assert.equal(running.status, 'running')
    assert.equal(running.comfy_prompt_id, 'pid-1')
    assert.ok(running.started_at)

    const done = await updateJob({ job_id: job.id, status: 'done', finished_at: new Date().toISOString(), output_record_ids: ['v1'], workspaceCwd: ws })
    assert.equal(done.status, 'done')
    assert.deepEqual(done.output_record_ids, ['v1'])

    const ledger = JSON.parse(readFileSync(join(ws, '.sylo', 'videos', JOBS_INDEX_FILE), 'utf8'))
    assert.equal(ledger.version, 1)
    assert.equal(ledger.jobs.length, 1)
    assert.equal(ledger.jobs[0].request.mode, 'clip') // RESOLVED request echo (§4.3)
    assert.equal(ledger.jobs[0].id, job.id)
  } finally {
    rmSync(ws, { recursive: true, force: true })
    await __resetVideoJobsStoreForTests()
  }
})

test('jobs.json: error lifecycle keeps the failure + prompt id (replay input, §2.3/§4.3)', async () => {
  const ws = freshWorkspace()
  try {
    await __resetVideoJobsStoreForTests()
    const job = await createJob({ request: resolvedRequest(), workspaceCwd: ws })
    const withPromptId = await updateJob({ job_id: job.id, comfy_prompt_id: 'pid-2', workspaceCwd: ws })
    assert.equal(withPromptId.comfy_prompt_id, 'pid-2')
    await updateJob({ job_id: job.id, status: 'error', error: 'ComfyUI did not answer /history within 20 min', finished_at: new Date().toISOString(), workspaceCwd: ws })
    const row = await getJob({ job_id: job.id, workspaceCwd: ws })
    assert.equal(row?.status, 'error')
    assert.match(row?.error ?? '', /history within 20 min/)
    // prompt id survived the error update — that's the §4.3 restart-recovery input.
    assert.equal(row?.comfy_prompt_id, 'pid-2')
  } finally {
    rmSync(ws, { recursive: true, force: true })
    await __resetVideoJobsStoreForTests()
  }
})

test('jobs.json: listJobs newest-first + status filter (the §8.7 replay read)', async () => {
  const ws = freshWorkspace()
  try {
    await __resetVideoJobsStoreForTests()
    for (let i = 0; i < 4; i++) {
      await createJob({ id: `j-${i}`, request: resolvedRequest({ seed: i }), workspaceCwd: ws })
    }
    await updateJob({ job_id: 'j-1', status: 'done', output_record_ids: [], workspaceCwd: ws })
    const all = await listJobs({ workspaceCwd: ws })
    assert.equal(all.total, 4)
    assert.equal(all.jobs.length, 4)
    assert.ok(all.jobs[0].created_at >= all.jobs[3].created_at, 'newest first')
    const pending = await listJobs({ workspaceCwd: ws, status: 'queued' })
    assert.equal(pending.total, 3)
    assert.ok(pending.jobs.every((j) => j.status === 'queued'))
    const done = await listJobs({ workspaceCwd: ws, status: 'done' })
    assert.equal(done.total, 1)
    assert.equal(done.jobs[0].id, 'j-1')
  } finally {
    rmSync(ws, { recursive: true, force: true })
    await __resetVideoJobsStoreForTests()
  }
})

test('jobs.json: corrupt ledger → evidence kept + fresh empty start (no rebuild possible; library.json untouched)', async () => {
  const ws = freshWorkspace()
  try {
    await __resetVideoJobsStoreForTests()
    const dir = join(ws, '.sylo', 'videos')
    const corrupt = join(dir, JOBS_INDEX_FILE)
    mkdirSync(dir, { recursive: true })
    writeFileSync(corrupt, '{broken json', 'utf8')
    const { store, recovery_note } = loadJobsWithRecovery(dir)
    assert.equal(store.jobs.length, 0)
    assert.match(recovery_note ?? '', /corrupt/)
    const entries = readdirSync(dir)
    assert.ok(entries.some((f) => f.startsWith(`${JOBS_INDEX_FILE}.corrupt-`)), 'evidence kept')
    assert.ok(existsSync(corrupt), 'fresh empty ledger written')
    // The library index is UNAFFECTED by ledger recovery (separate files, §4.2).
    assert.ok(!existsSync(join(dir, 'library.json')), 'library.json untouched — separate store')
  } finally {
    rmSync(ws, { recursive: true, force: true })
    await __resetVideoJobsStoreForTests()
  }
})

test('jobs.json: unknown-id update throws plain; single-flight stress', async () => {
  const ws = freshWorkspace()
  try {
    await __resetVideoJobsStoreForTests()
    await createJob({ request: resolvedRequest(), workspaceCwd: ws })
    await assert.rejects(updateJob({ job_id: 'nope', status: 'running', workspaceCwd: ws }), /not in the render ledger/)
    // Single-flight chain: 8 concurrent appends serialize cleanly (§4.2 stance).
    const many = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => createJob({ request: resolvedRequest({ seed: 1000 + i }), workspaceCwd: ws })),
    )
    assert.ok(many.every((r) => r.status === 'fulfilled'))
    const ledger = JSON.parse(readFileSync(join(ws, '.sylo', 'videos', JOBS_INDEX_FILE), 'utf8'))
    assert.equal(ledger.jobs.length, 9)
  } finally {
    rmSync(ws, { recursive: true, force: true })
    await __resetVideoJobsStoreForTests()
  }
})

test('jobs.json: no workspace (no workspaceCwd AND no SYLO_PI_CWD) → plain fail-fast', async () => {
  // The broker injects SYLO_PI_CWD into agent runs — this suite runs INSIDE one —
  // so the env is pinned OFF for the no-workspace case (one leaked test row was
  // cleaned from the real workspace at §8.6; never again). Reads degrade to null,
  // writes fail fast with the plain-language §4 binding message.
  await __resetVideoJobsStoreForTests()
  const saved = process.env.SYLO_PI_CWD
  delete process.env.SYLO_PI_CWD
  try {
    await assert.rejects(createJob({ request: resolvedRequest() }), /needs a/)
    assert.equal(await getJob({ job_id: 'anything' }), null, 'reads degrade to null, no workspace')
    assert.deepEqual(await listJobs({}), { jobs: [], total: 0 })
  } finally {
    if (saved !== undefined) process.env.SYLO_PI_CWD = saved
    await __resetVideoJobsStoreForTests()
  }
})