import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const hostMainDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(hostMainDir, '..', '..', '..', '..')
const packageRoot = join(repoRoot, 'packages', 'sylo-logicforge')
const scriptsDir = join(packageRoot, 'scripts')

function resolvePythonInvocation(sdk = false): { command: string; prefixArgs: string[] } {
  if (sdk) {
    const sdkPython = process.env.SYLO_SDK_PYTHON?.trim()
    if (sdkPython) return { command: sdkPython, prefixArgs: [] }
    if (process.platform === 'win32') return { command: 'py', prefixArgs: ['-3.12'] }
  }
  const envPython = process.env.SYLO_PYTHON?.trim()
  if (envPython) return { command: envPython, prefixArgs: [] }
  return { command: process.platform === 'win32' ? 'python' : 'python3', prefixArgs: [] }
}

function runLogicForgeScript(
  scriptName: string,
  args: string[],
  opts?: { stdin?: string; timeoutMs?: number; sdk?: boolean },
): Promise<unknown> {
  const scriptPath = join(scriptsDir, scriptName)
  if (!existsSync(scriptPath)) {
    return Promise.reject(new Error(`missing script: ${scriptPath}`))
  }
  const sdk = opts?.sdk ?? scriptName === 'io_scaffold_apply.py'
  const { command, prefixArgs } = resolvePythonInvocation(sdk)
  return new Promise((res, rej) => {
    const child = execFile(
      command,
      [...prefixArgs, scriptPath, ...args],
      {
        cwd: packageRoot,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        timeout: opts?.timeoutMs ?? 300_000,
        env: {
          ...process.env,
          ...(sdk && process.platform === 'win32' && !process.env.SYLO_PYTHON
            ? { PYTHONIOENCODING: 'utf-8' }
            : {}),
        },
      },
      (err, stdout) => {
        if (err) {
          rej(err)
          return
        }
        const trimmed = String(stdout).trim()
        if (!trimmed) {
          rej(new Error(`${scriptName} produced no output`))
          return
        }
        try {
          const parsed = JSON.parse(trimmed) as { ok?: boolean; error?: string }
          if (parsed.ok === false) {
            rej(new Error(parsed.error ?? `${scriptName} failed`))
            return
          }
          res(parsed)
        } catch (e) {
          rej(e instanceof Error ? e : new Error(String(e)))
        }
      },
    )
    // `execFile` does NOT support the `input` option (only `exec`/`execSync`
    // do). Write stdin through the child handle so `io_review.py --action save`
    // actually receives the review JSON.
    if (opts?.stdin != null && child.stdin) {
      child.stdin.write(opts.stdin)
      child.stdin.end()
    }
  })
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function normalizeRunDir(runDir: string): string {
  const trimmed = runDir.trim()
  if (!trimmed) throw new Error('run_dir is required')
  const resolved = resolve(trimmed)
  const base = basename(resolved)
  if (base.toLowerCase() === 'parse') {
    const parent = dirname(resolved)
    if (
      existsSync(join(resolved, 'match_report.json')) ||
      existsSync(join(resolved, 'io_review.json')) ||
      existsSync(join(parent, 'working')) ||
      existsSync(join(parent, 'run.yaml'))
    ) {
      return parent
    }
    return parent
  }
  return resolved
}

function resolveRunDir(runDir: string): string {
  const resolved = normalizeRunDir(runDir)
  if (!existsSync(resolved)) throw new Error(`run_dir not found: ${resolved}`)
  return resolved
}

export type LogicForgeIoReviewPayload = {
  run_dir: string
  review?: unknown
  overwrite?: boolean
}

export async function logicforgeIoReviewGet(payload: LogicForgeIoReviewPayload): Promise<{
  ok: true
  run_dir: string
  path: string
  review: unknown
}> {
  const runDir = resolveRunDir(payload.run_dir)
  const result = (await runLogicForgeScript('io_review.py', ['--run-dir', runDir, '--action', 'get'], {
    timeoutMs: 120_000,
    sdk: false,
  })) as { review?: unknown; path?: string }
  const path = join(runDir, 'parse', 'io_review.json')
  return {
    ok: true,
    run_dir: runDir,
    path: String(result.path ?? path),
    review: result.review ?? readJsonFile(path),
  }
}

export async function logicforgeIoReviewReseed(payload: LogicForgeIoReviewPayload): Promise<{
  ok: true
  run_dir: string
  path: string
  review: unknown
}> {
  const runDir = resolveRunDir(payload.run_dir)
  const args = ['--run-dir', runDir, '--action', 'seed']
  if (payload.overwrite) args.push('--overwrite')
  const result = (await runLogicForgeScript('io_review.py', args, {
    timeoutMs: 120_000,
    sdk: false,
  })) as { review?: unknown; path?: string }
  const path = join(runDir, 'parse', 'io_review.json')
  return {
    ok: true,
    run_dir: runDir,
    path: String(result.path ?? path),
    review: result.review ?? readJsonFile(path),
  }
}

export function logicforgeIoReviewSave(payload: LogicForgeIoReviewPayload): Promise<{
  ok: true
  run_dir: string
  path: string
  review: unknown
}> {
  const runDir = resolveRunDir(payload.run_dir)
  if (payload.review == null || typeof payload.review !== 'object') {
    return Promise.reject(new Error('review object is required'))
  }
  const review = { ...(payload.review as Record<string, unknown>), status: 'draft' }
  return runLogicForgeScript(
    'io_review.py',
    ['--run-dir', runDir, '--action', 'save'],
    { stdin: `${JSON.stringify(review)}\n`, timeoutMs: 120_000, sdk: false },
  ).then((result) => {
    const path = join(runDir, 'parse', 'io_review.json')
    const parsed = result as { review?: unknown }
    return {
      ok: true as const,
      run_dir: runDir,
      path,
      review: parsed.review ?? readJsonFile(path),
    }
  })
}

export async function logicforgeIoReviewApproveBuild(payload: LogicForgeIoReviewPayload): Promise<{
  ok: true
  run_dir: string
  review_path: string
  scaffold: unknown
}> {
  const runDir = resolveRunDir(payload.run_dir)
  const projectDir = join(runDir, '..', '..')
  if (existsSync(join(projectDir, 'runs'))) {
    process.env.SYLO_PROJECT_DIR = projectDir
  }
  if (payload.review != null && typeof payload.review === 'object') {
    await logicforgeIoReviewSave({ run_dir: runDir, review: payload.review })
  }
  await runLogicForgeScript('io_review.py', ['--run-dir', runDir, '--action', 'approve'], {
    timeoutMs: 120_000,
    sdk: false,
  })
  const scaffold = await runLogicForgeScript(
    'io_scaffold_apply.py',
    ['--run-dir', runDir],
    { timeoutMs: 300_000, sdk: true },
  )
  return {
    ok: true,
    run_dir: runDir,
    review_path: join(runDir, 'parse', 'io_review.json'),
    scaffold,
  }
}
