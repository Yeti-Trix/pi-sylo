/**
 * Sylo optional packages run Python helper scripts via pip/extensions.
 * Gate unsupported Python versions before pip (native wheels vary by release).
 *
 * Why we prefer 3.12: several pinned optional-package deps ship prebuilt wheels
 * for cp312/cp313 but NOT cp314. The headline case is crawl4ai (sylo-web-access),
 * which pins `lxml~=5.3` (i.e. lxml < 6); lxml 5.x has no cp314 wheels on Windows,
 * so pip falls back to a source build that needs libxml2 headers and fails.
 * Preferring 3.12 (via the Windows `py` launcher) makes a fresh install "just
 * work" without forcing the operator to set SYLO_PYTHON by hand.
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { extname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Inclusive: 3.11.0 through 3.14.x */
export const SYLO_PYTHON_MIN = { major: 3, minor: 11 } as const
export const SYLO_PYTHON_MAX_MINOR = 14

/**
 * The minor version Sylo prefers for optional-package pip installs, because it
 * has the broadest prebuilt-wheel coverage for our pinned native deps. We look
 * for this version first on Windows; anything 3.11–3.14 is still accepted if
 * that is all that is available.
 */
export const SYLO_PYTHON_PREFERRED_MINOR = 12

let cachedPython: string | null = null

/**
 * Resolve the real python.exe path for a given minor version on Windows using
 * the `py` launcher (`py -3.12 -c "import sys;print(sys.executable)"`). Returns
 * null if the launcher is absent or that version is not installed.
 */
function resolvePyLauncherVersion(minor: number): string | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync(
      'py',
      [`-3.${minor}`, '-c', 'import sys; sys.stdout.write(sys.executable)'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    // The `py` launcher already ran this interpreter, so trust its path even when
    // existsSync() lies — Microsoft Store installs live under WindowsApps\ as
    // App Execution Aliases (0-byte reparse points) that stat() cannot resolve.
    const exe = out.trim()
    if (exe) return exe
  } catch {
    /* py launcher not present, or that minor version is not installed */
  }
  return null
}

/** Standard python.org install dirs to probe (short paths, no long-path issues). */
function resolveWindowsStandardPath(minor: number): string | null {
  if (process.platform !== 'win32') return null
  const candidates: string[] = []
  const local = process.env.LOCALAPPDATA
  if (local) {
    candidates.push(join(local, 'Programs', 'Python', `Python3${minor}`, 'python.exe'))
  }
  candidates.push(`C:\\Program Files\\Python3${minor}\\python.exe`)
  candidates.push(`C:\\Python3${minor}\\python.exe`)
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/** True for Microsoft Store Python installs (deep sandboxed site-packages). */
export function isStorePythonPath(exe: string): boolean {
  return /\\WindowsApps\\PythonSoftwareFoundation\.Python\.|AppData\\Local\\Packages\\PythonSoftwareFoundation\.Python\./i.test(
    exe,
  )
}

/**
 * Pick the Python interpreter Sylo will use for optional-package installs.
 * Resolution order:
 *   1. `SYLO_PYTHON` env (explicit operator override — always honored first).
 *   2. python.org 3.12 install dir (short path, best for heavy pip packages),
 *      then the `py -3.12` launcher, then 3.13 the same way. python.org installs
 *      are preferred over Microsoft Store Python because the Store sandbox's
 *      deep site-packages path breaks heavy packages (e.g. crawl4ai's litellm)
 *      when Windows Long Path support is off.
 *   3. `python` (win) / `python3` (unix) on PATH (original behavior).
 *
 * The result is cached for the process. `SYLO_PYTHON` is re-read each call so a
 * test or a runtime env change is respected until something is resolved.
 */
export function resolvePythonExecutable(): string {
  if (cachedPython) return cachedPython

  const fromEnv = process.env.SYLO_PYTHON?.trim()
  if (fromEnv) {
    cachedPython = fromEnv
    return fromEnv
  }

  if (process.platform === 'win32') {
    // Prefer 3.12 (widest wheel coverage for pinned native deps), then 3.13.
    // python.org (standard path) first, then the py launcher (may be Store).
    for (const minor of [SYLO_PYTHON_PREFERRED_MINOR, 13]) {
      const found = resolveWindowsStandardPath(minor) ?? resolvePyLauncherVersion(minor)
      if (found) {
        cachedPython = found
        return found
      }
    }
    cachedPython = 'python'
    return 'python'
  }

  cachedPython = 'python3'
  return 'python3'
}

/** Forget the cached interpreter (used by tests that mutate process.env). */
export function resetResolvedPythonCache(): void {
  cachedPython = null
}

/**
 * Detect a *good* Python 3.12 install — a python.org install (short path), not
 * the Microsoft Store build. Used by the capability manager to warn when only
 * the Store 3.12 (or no 3.12) is present, since the Store sandbox's deep
 * site-packages path breaks heavy pip packages like crawl4ai's litellm when
 * Windows Long Path support is off.
 */
export function detectPreferredPythonExe(): string | null {
  if (process.platform === 'win32') {
    const std = resolveWindowsStandardPath(SYLO_PYTHON_PREFERRED_MINOR)
    if (std) return std
    const launched = resolvePyLauncherVersion(SYLO_PYTHON_PREFERRED_MINOR)
    if (launched && !isStorePythonPath(launched)) return launched
    return null
  }
  // On non-Windows, the preferred minor is whatever `python3` resolves to if it
  // is 3.12; we don't shell out here — the readiness check below reads the version.
  return null
}

/** Detect any 3.12 install, including the Microsoft Store build. */
function detectAny312Exe(): string | null {
  if (process.platform === 'win32') {
    return (
      resolveWindowsStandardPath(SYLO_PYTHON_PREFERRED_MINOR) ??
      resolvePyLauncherVersion(SYLO_PYTHON_PREFERRED_MINOR)
    )
  }
  return null
}

export type PythonReadinessStatus = 'ok' | 'missing-preferred' | 'unusable'

export type PythonReadiness = {
  /** True when Python 3.12 (the preferred minor) is installed and discoverable. */
  preferredInstalled: boolean
  /** The interpreter Sylo will actually use for pip installs. */
  resolvedExe: string
  /** Parsed version of resolvedExe, if it could be read. */
  resolvedVersion: ParsedPythonVersion | null
  /** 'ok' = 3.12 ready; 'missing-preferred' = 3.12 absent but a supported python exists; 'unusable' = no supported python. */
  status: PythonReadinessStatus
  /** Short human-facing message for the capability manager UI. */
  message: string
}

/**
 * Report whether the preferred Python 3.12 (python.org build) is available for
 * pip-based optional packages, so the capability manager can warn on a fresh
 * install. Sylo still *runs* regardless; this only gates pip packages.
 */
export async function getPythonReadiness(): Promise<PythonReadiness> {
  const preferredExe = detectPreferredPythonExe()
  const resolvedExe = resolvePythonExecutable()
  const ver = await readPythonVersion(resolvedExe)
  const resolvedVersion = ver.ok ? ver.version : null
  const resolvedIsStore = isStorePythonPath(resolvedExe)

  if (preferredExe) {
    return {
      preferredInstalled: true,
      resolvedExe,
      resolvedVersion,
      status: 'ok',
      message: `Python 3.12 (python.org build) detected. Sylo will use it for pip installs (sylo-web-access, etc.).`,
    }
  }

  // No python.org 3.12. If the resolved interpreter is a Store 3.12, warn that
  // the Store build is known to break heavy pip packages via long-path limits.
  if (resolvedIsStore && resolvedVersion && resolvedVersion.minor === SYLO_PYTHON_PREFERRED_MINOR) {
    return {
      preferredInstalled: false,
      resolvedExe,
      resolvedVersion,
      status: 'missing-preferred',
      message:
        `Python 3.12 is installed, but it's the Microsoft Store build. Its ` +
        `site-packages live under a deep sandboxed path that breaks heavy pip ` +
        `packages like crawl4ai's litellm (long-path errors) when Windows Long ` +
        `Path support is off. Install the python.org 3.12 build from ` +
        `https://www.python.org/downloads/windows/ (check "Add to PATH"), or set ` +
        `SYLO_PYTHON to that python.exe, then restart Sylo. (Enabling Windows Long ` +
        `Paths also works, but the python.org build is recommended.)`,
    }
  }

  // No 3.12 at all, but some 3.12 might be reachable via launcher? (covered above)
  if (ver.ok && isPythonVersionSupported(ver.version)) {
    const any312 = detectAny312Exe()
    const haveStore312 = any312 && isStorePythonPath(any312)
    return {
      preferredInstalled: false,
      resolvedExe,
      resolvedVersion,
      status: 'missing-preferred',
      message:
        `Python 3.12 was not found. Sylo prefers 3.12 for sylo-web-access and other ` +
        `pip packages (some pinned native deps, e.g. crawl4ai's lxml, have no cp314 ` +
        `wheels). Your current python is ${ver.version.major}.${ver.version.minor}.${ver.version.patch} ` +
        `— installs may fail. Install the python.org 3.12 build from ` +
        `https://www.python.org/downloads/windows/ (check "Add to PATH"), ` +
        (haveStore312 ? `not the Microsoft Store build, ` : '') +
        `or set SYLO_PYTHON, then restart Sylo.`,
    }
  }

  return {
    preferredInstalled: false,
    resolvedExe,
    resolvedVersion,
    status: 'unusable',
    message:
      `Python 3.12 was not found and no supported Python (3.11–3.14) is on PATH. ` +
      `Install the python.org 3.12 build from https://www.python.org/downloads/windows/ ` +
      `(check "Add to PATH") to use sylo-web-access and other pip packages, then ` +
      `restart Sylo.`,
  }
}

export type ParsedPythonVersion = {
  major: number
  minor: number
  patch: number
  raw: string
}

export function parsePythonVersionString(text: string): ParsedPythonVersion | null {
  const m = text.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i)
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    raw: m[0],
  }
}

export async function readPythonVersion(
  python: string,
): Promise<{ ok: true; version: ParsedPythonVersion } | { ok: false; error: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(python, ['--version'], {
      windowsHide: true,
      timeout: 15_000,
    })
    const parsed = parsePythonVersionString(`${stdout}\n${stderr}`.trim())
    if (!parsed) {
      return { ok: false, error: `Could not parse version from: ${stdout || stderr}` }
    }
    return { ok: true, version: parsed }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `Python not runnable (${python} --version): ${message}`,
    }
  }
}

export function isPythonVersionSupported(v: ParsedPythonVersion): boolean {
  if (v.major !== 3) return false
  if (v.minor < SYLO_PYTHON_MIN.minor) return false
  if (v.minor > SYLO_PYTHON_MAX_MINOR) return false
  return true
}

export function formatUnsupportedPythonError(
  python: string,
  version: ParsedPythonVersion,
): string {
  return (
    `Python ${version.major}.${version.minor}.${version.patch} is not supported for Sylo optional packages.\n` +
    `Use Python ${SYLO_PYTHON_MIN.major}.${SYLO_PYTHON_MIN.minor}–${SYLO_PYTHON_MIN.major}.${SYLO_PYTHON_MAX_MINOR} ` +
    `(Sylo prefers ${SYLO_PYTHON_MIN.major}.${SYLO_PYTHON_PREFERRED_MINOR} for wheel coverage).\n\n` +
    `Fix:\n` +
    `1. Install Python ${SYLO_PYTHON_MIN.major}.${SYLO_PYTHON_PREFERRED_MINOR} from https://www.python.org/downloads/windows/ (check "Add to PATH").\n` +
    `   Sylo auto-detects it via the Windows \`py\` launcher — no env var needed.\n` +
    `2. Or set environment variable SYLO_PYTHON to a specific python.exe (User or System env).\n` +
    `   Example: SYLO_PYTHON=C:\\Users\\You\\AppData\\Local\\Programs\\Python\\Python312\\python.exe\n` +
    `3. Close Sylo completely and run full-build-run-sylo.cmd again, then enable the package.\n\n` +
    `Note: avoid Python 3.14 for now — some pinned native deps (e.g. crawl4ai's ` +
    `lxml~=5.3) have no cp314 wheels on Windows and force a source build that fails ` +
    `without libxml2 headers. 3.12/3.13 have the wheels.\n` +
    `Current interpreter tried: ${python}`
  )
}

export function augmentPipFailureMessage(
  detail: string,
  python: string,
  version?: ParsedPythonVersion,
): string {
  const lower = detail.toLowerCase()
  const verLine =
    version ? `Detected: Python ${version.major}.${version.minor}.${version.patch}. ` : ''

  // Long-path / Microsoft Store Python: heavy packages (e.g. crawl4ai's litellm)
  // fail to install because the Store sandbox's site-packages path exceeds
  // MAX_PATH when Windows Long Path support is off.
  const longPathHint =
    lower.includes('long path') ||
    lower.includes('no such file or directory') ||
    (lower.includes('litellm') && lower.includes('oerror'))
  if (longPathHint && isStorePythonPath(python)) {
    return (
      `${detail}\n\n` +
      `${verLine}This looks like a Windows long-path failure caused by the Microsoft ` +
      `Store Python build (its site-packages live under a deep sandboxed path). ` +
      `Install the python.org 3.12 build from https://www.python.org/downloads/windows/ ` +
      `(check "Add to PATH"), or set SYLO_PYTHON to that python.exe, then restart ` +
      `Sylo and try again. (Enabling Windows Long Paths also works.)`
    )
  }

  const nativeHint =
    lower.includes('lxml') ||
    lower.includes('building wheel') ||
    lower.includes('subprocess-exited-with-error') ||
    lower.includes('microsoft visual c++')
  if (!nativeHint) return detail

  return (
    `${detail}\n\n` +
    `${verLine}This usually means a pinned native dependency has no prebuilt wheel for ` +
    `your Python version, so pip tried to build from source and failed. ` +
    `Python 3.14 is known-bad here (e.g. crawl4ai pins lxml~=5.3, which has no cp314 ` +
    `wheel). Sylo prefers Python 3.12 automatically; install 3.12 (or set ` +
    `SYLO_PYTHON to a 3.12/3.13 python.exe), restart Sylo, and try again.`
  )
}

/** Pre/post enable scripts: .py via python, .mjs/.js via node. */
export function resolveSetupScriptCommand(scriptPath: string, python: string): [string, string[]] {
  const ext = extname(scriptPath).toLowerCase()
  if (ext === '.mjs' || ext === '.js') {
    return [process.execPath, [scriptPath]]
  }
  return [python, [scriptPath]]
}