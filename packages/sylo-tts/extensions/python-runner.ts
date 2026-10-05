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

/** Real import chain per backend (runs the same modules synthesis needs). */
const BACKEND_PROBE: Record<string, string> = {
  kokoro: 'from kokoro import KPipeline; import soundfile as sf, numpy',
  orpheus: 'from orpheus_cpp import OrpheusCpp; import llama_cpp',
}

const BACKEND_REQ_FILE: Record<string, string> = {
  kokoro: 'requirements.txt',
  orpheus: 'requirements-orpheus.txt',
}

const depsReadyByBackend = new Map<string, Promise<void>>()

/**
 * Self-heal TTS Python deps for one backend: probe the real import chain;
 * on failure pip-install that backend's requirements, then re-probe and
 * surface the surviving import error. Works standalone (vanilla Pi) — the
 * host's Capability manager does the same install at enable time.
 */
async function ensureBackendDeps(python: string, backend: string): Promise<void> {
  let cached = depsReadyByBackend.get(backend)
  if (!cached) {
    cached = (async () => {
      const probeCode = BACKEND_PROBE[backend]
      const reqFile = BACKEND_REQ_FILE[backend]
      if (!probeCode || !reqFile) return
      const importBroken = async (): Promise<boolean> => {
        try {
          await execFileAsync(python, ['-c', probeCode], {
            cwd: SCRIPTS_DIR,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
            timeout: 120_000,
          })
          return false
        } catch {
          return true
        }
      }
      if (await importBroken()) {
        const reqPath = path.join(SCRIPTS_DIR, reqFile)
        try {
          await execFileAsync(python, ['-m', 'pip', 'install', '-r', reqPath], {
            cwd: SCRIPTS_DIR,
            maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
            timeout: 600_000,
          })
        } catch {
          /* repair failed — the re-probe below surfaces the real import error */
        }
        if (await importBroken()) {
          throw new Error(
            `TTS Python deps for ${backend} are missing or broken. ` +
              `Fix: pip install -r ${reqPath}`,
          )
        }
      }
    })()
    depsReadyByBackend.set(backend, cached)
  }
  try {
    await cached
  } catch (err) {
    // Drop the cached failure so the next call retries after a manual repair.
    depsReadyByBackend.delete(backend)
    throw err
  }
}

export async function runPythonScript(
  scriptName: string,
  args: string[],
  pythonPath?: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  const python = resolvePython(pythonPath)
  const backendArg = args.indexOf('--backend') >= 0 ? args[args.indexOf('--backend') + 1] : ''
  await ensureBackendDeps(python, backendArg)
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