/**
 * Shell out to sylo-tts Python helpers.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { parsePythonScriptJsonStdout } from './parse-python-json.ts'

const execFileAsync = promisify(execFile)

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SCRIPTS_DIR = path.join(PACKAGE_ROOT, 'scripts')

export function resolvePython(configured?: string): string {
  const t = configured?.trim()
  if (t) return t
  return process.platform === 'win32' ? 'python' : 'python3'
}

export async function runPythonScript(
  scriptName: string,
  args: string[],
  pythonPath?: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  const python = resolvePython(pythonPath)
  try {
    const { stdout, stderr } = await execFileAsync(python, [scriptPath, ...args], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      timeout: 600_000,
    })
    const trimmed = stdout.trim()
    if (!trimmed) {
      return { ok: false, error: stderr.trim() || `${scriptName} produced no output` }
    }
    try {
      return { ok: true, data: parsePythonScriptJsonStdout(trimmed) }
    } catch (parseErr) {
      const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      const stderrNote = stderr.trim() ? `\n${stderr.trim()}` : ''
      return { ok: false, error: `${parseMsg}${stderrNote}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stderr =
      err !== null && typeof err === 'object' && 'stderr' in err ?
        String((err as { stderr?: string }).stderr ?? '')
      : ''
    const importHint =
      /ModuleNotFoundError|ImportError|No module named/i.test(`${message}\n${stderr}`) ?
        `\nTTS needs Python deps: pip install -r ${path.join(SCRIPTS_DIR, 'requirements.txt')}`
      : ''
    return {
      ok: false,
      error: `${message}${stderr.trim() ? `\n${stderr.trim()}` : ''}${importHint}`,
    }
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ?
      (value as Record<string, unknown>)
    : null
}
