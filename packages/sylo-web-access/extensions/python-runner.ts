/**
 * Shell out to package Python helpers (S2 search, F2 headless fetch).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS_DIR = path.join(PACKAGE_ROOT, 'scripts')

function resolvePython(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * Run a JSON-emitting script under `scripts/`.
 *
  * @param scriptName - Basename e.g. `search_ddgs.py`.
 * @param args - CLI args after the script path.
 * @param env - Extra env vars merged over `process.env` (e.g. API keys).
 */
export async function runPythonScript(
  scriptName: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  try {
    const { stdout, stderr } = await execFileAsync(resolvePython(), [scriptPath, ...args], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 24 * 1024 * 1024,
      windowsHide: true,
      timeout: 120_000,
      env: env ? { ...process.env, ...env } : process.env,
    })
    const trimmed = stdout.trim()
    if (!trimmed) {
      return { ok: false, error: stderr.trim() || `${scriptName} produced no output` }
    }
    try {
      return { ok: true, data: JSON.parse(trimmed) as unknown }
    } catch {
      return { ok: false, error: `Invalid JSON from ${scriptName}: ${trimmed.slice(0, 400)}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error:
        `${message}\n` +
        `Heavy tiers need Python deps: pip install -r ${path.join(SCRIPTS_DIR, 'requirements.txt')}`,
    }
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ?
      (value as Record<string, unknown>)
    : null
}
