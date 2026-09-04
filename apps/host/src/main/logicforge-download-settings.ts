/** LogicForge download allowlist + PLC status — host main-process handlers.
 *
 * The allowlist (assets/download-allowlist.json) is read/written directly here,
 * mirroring logicforge-parse-rules. PLC reachability/keyswitch status runs the
 * `plc_status.py` script which uses the vendored ciplogix (pycomm3 fork).
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolveToolsPackageDir } from './tools-bundles.js'

const execFileAsync = promisify(execFile)

const hostMainDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(hostMainDir, '..', '..', '..', '..')
const packageRoot = resolveToolsPackageDir(repoRoot, 'sylo-tools-controls', 'sylo-logicforge')
const scriptsDir = join(packageRoot, 'scripts')
const allowlistPath = join(packageRoot, 'assets', 'download-allowlist.json')

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function writeJsonFile(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function resolvePythonInvocation(sdk: boolean): { command: string; prefixArgs: string[] } {
  if (sdk) {
    const sdkPython = process.env.SYLO_SDK_PYTHON?.trim()
    if (sdkPython) return { command: sdkPython, prefixArgs: [] }
    if (process.platform === 'win32') return { command: 'py', prefixArgs: ['-3.12'] }
  }
  const envPython = process.env.SYLO_PYTHON?.trim()
  if (envPython) return { command: envPython, prefixArgs: [] }
  return { command: process.platform === 'win32' ? 'python' : 'python3', prefixArgs: [] }
}

function parseTrailingJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    /* fall through */
  }
  let idx = trimmed.lastIndexOf('\n{')
  while (idx >= 0) {
    try {
      return JSON.parse(trimmed.slice(idx + 1)) as Record<string, unknown>
    } catch {
      idx = trimmed.lastIndexOf('\n{', idx - 1)
    }
  }
  return null
}

export type LogicForgeDownloadAllowlistPayload = {
  allow_downloads?: boolean
  post_download_mode?: 'program' | 'run'
  ips?: Array<{ ip: string; label?: string; enabled?: boolean }>
  notes?: string
}

export function logicforgeDownloadAllowlistGet(): {
  ok: true
  path: string
  allowlist: unknown
} {
  const allowlist = readJsonFile(allowlistPath)
  if (allowlist == null) {
    throw new Error(
      'download-allowlist.json missing — restore packages/sylo-logicforge/assets/download-allowlist.json',
    )
  }
  return { ok: true, path: allowlistPath, allowlist }
}

export function logicforgeDownloadAllowlistSave(
  payload: LogicForgeDownloadAllowlistPayload,
): { ok: true; path: string } {
  const current = (readJsonFile(allowlistPath) ?? {}) as Record<string, unknown>
  const next: Record<string, unknown> = { ...current }
  if (payload.allow_downloads !== undefined) next['allow_downloads'] = payload.allow_downloads
  if (payload.post_download_mode !== undefined) {
    next['post_download_mode'] = payload.post_download_mode
  }
  if (payload.ips !== undefined) next['ips'] = payload.ips
  if (payload.notes !== undefined) next['notes'] = payload.notes
  writeJsonFile(allowlistPath, next)
  return { ok: true, path: allowlistPath }
}

export async function logicforgeDownloadPlcStatus(
  ip: string,
): Promise<Record<string, unknown>> {
  const trimmed = ip.trim()
  if (!trimmed) throw new Error('ip is required')
  const scriptPath = join(scriptsDir, 'plc_status.py')
  if (!existsSync(scriptPath)) throw new Error(`missing script: ${scriptPath}`)
  const { command, prefixArgs } = resolvePythonInvocation(true)
  const { stdout, stderr } = await execFileAsync(
    command,
    [...prefixArgs, scriptPath, '--ip', trimmed],
    {
      cwd: packageRoot,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      timeout: 60_000,
      env: {
        ...process.env,
        ...(process.platform === 'win32' && !process.env.SYLO_PYTHON
          ? { PYTHONIOENCODING: 'utf-8' }
          : {}),
      },
    },
  )
  const parsed = parseTrailingJson(stdout)
  if (!parsed) {
    throw new Error(stderr.trim() || `plc_status.py produced no output for ${trimmed}`)
  }
  if (parsed.ok === false) {
    throw new Error(String(parsed.error ?? `plc_status.py failed for ${trimmed}`))
  }
  return parsed
}