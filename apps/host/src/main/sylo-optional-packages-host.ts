import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import {
  findSyloOptionalPackage,
  isSyloOptionalPackageEnabled,
  SYLO_OPTIONAL_PACKAGES,
  type SyloOptionalPackage,
} from '../shared/sylo-optional-packages.js'
import {
  augmentPipFailureMessage,
  formatUnsupportedPythonError,
  getPythonReadiness as sharedGetPythonReadiness,
  isPythonVersionSupported,
  readPythonVersion,
  resolvePythonExecutable,
  resolveSetupScriptCommand,
  type ParsedPythonVersion,
  type PythonReadiness,
} from '../shared/resolve-python.js'

const execFileAsync = promisify(execFile)

export function resolveSyloRepoRootFromMain(mainDirname: string): string {
  return join(mainDirname, '../../../..')
}

/** Capability manager readiness probe (preferred Python 3.12 detection). */
export function getPythonReadiness(): Promise<PythonReadiness> {
  return sharedGetPythonReadiness()
}

export function resolveSyloOptionalPackageExtensionPath(
  repoRoot: string,
  pkg: SyloOptionalPackage,
): string {
  return join(repoRoot, pkg.extensionRelPath)
}

/** Extension paths for enabled optional packages that exist on disk (Sylo repo dev layout). */
export function enabledOptionalExtensionPaths(
  repoRoot: string,
  pref: Record<string, boolean>,
): string[] {
  const paths: string[] = []
  for (const pkg of SYLO_OPTIONAL_PACKAGES) {
    if (!isSyloOptionalPackageEnabled(pref, pkg.id)) continue
    const abs = resolveSyloOptionalPackageExtensionPath(repoRoot, pkg)
    if (existsSync(abs)) paths.push(abs)
  }
  return paths
}

export type InstallOptionalPackagePythonResult =
  | { ok: true; skipped: true; message: string }
  | { ok: true; skipped: false; message: string }
  | { ok: false; error: string }

async function runPackageSetupScript(
  repoRoot: string,
  rel: string,
  python: string,
  label: 'Pre-enable' | 'Post-enable',
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const scriptPath = join(repoRoot, rel)
  if (!existsSync(scriptPath)) {
    return { ok: false, error: `${label} script not found: ${scriptPath}` }
  }

  try {
    const [cmd, args] = resolveSetupScriptCommand(scriptPath, python)
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: repoRoot,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      timeout: 300_000,
    })
    const trimmed = (stdout || '').trim()
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as { ok?: boolean; message?: string; error?: string }
        if (parsed.ok === false) {
          return {
            ok: false,
            error: parsed.error ?? stderr.trim() ?? `${label} script failed.`,
          }
        }
        if (parsed.message) return { ok: true, message: parsed.message }
      } catch {
        /* not JSON */
      }
    }
    const note = trimmed || stderr.trim()
    return { ok: true, message: note || `${label} setup completed.` }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n').trim()
    return { ok: false, error: `${label} script failed (${rel}).\n${detail}` }
  }
}

async function runPreEnableScript(
  repoRoot: string,
  pkg: SyloOptionalPackage,
  python: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const rel = pkg.preEnableScriptRelPath
  if (!rel) return { ok: true, message: '' }
  return runPackageSetupScript(repoRoot, rel, python, 'Pre-enable')
}

async function runPostEnableScript(
  repoRoot: string,
  pkg: SyloOptionalPackage,
  python: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const rel = pkg.postEnableScriptRelPath
  if (!rel) return { ok: true, message: '' }
  return runPackageSetupScript(repoRoot, rel, python, 'Post-enable')
}

async function assertPythonSupportedForOptionalPackages(
  python: string,
): Promise<{ ok: true; version: ParsedPythonVersion } | { ok: false; error: string }> {
  const ver = await readPythonVersion(python)
  if (!ver.ok) return ver
  if (!isPythonVersionSupported(ver.version)) {
    return { ok: false, error: formatUnsupportedPythonError(python, ver.version) }
  }
  return ver
}

export async function installOptionalPackagePythonDeps(
  repoRoot: string,
  packageId: string,
): Promise<InstallOptionalPackagePythonResult> {
  const pkg = findSyloOptionalPackage(packageId)
  if (!pkg) return { ok: false, error: `Unknown optional package: ${packageId}` }
  const python = resolvePythonExecutable()

  const pyCheck = await assertPythonSupportedForOptionalPackages(python)
  if (!pyCheck.ok) return { ok: false, error: pyCheck.error }

  const pre = await runPreEnableScript(repoRoot, pkg, python)
  if (!pre.ok) return { ok: false, error: pre.error }

  if (!pkg.pythonRequirementsRelPath) {
    const postOnly = await runPostEnableScript(repoRoot, pkg, python)
    if (!postOnly.ok) return { ok: false, error: postOnly.error }
    const parts = [pre.message, postOnly.message].filter(Boolean)
    return {
      ok: true,
      skipped: true,
      message: parts.join('\n') || 'No Python dependencies for this package.',
    }
  }

  const reqPath = join(repoRoot, pkg.pythonRequirementsRelPath)
  if (!existsSync(reqPath)) {
    return {
      ok: false,
      error: `Requirements file not found: ${reqPath}. Is Sylo running from the dev repo?`,
    }
  }

  const reqDir = dirname(reqPath)
  let message = pre.message || ''
  try {
    const { stdout, stderr } = await execFileAsync(
      python,
      ['-m', 'pip', 'install', '-r', reqPath],
      {
        cwd: reqDir,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        timeout: 180_000,
      },
    )
    const tail = (stdout || stderr || '').trim().split('\n').slice(-3).join('\n')
    const pipNote = tail ? `Python deps installed.\n${tail}` : 'Python deps installed.'
    message = message ? `${message}\n${pipNote}` : pipNote

    const post = await runPostEnableScript(repoRoot, pkg, python)
    if (!post.ok) return { ok: false, error: post.error }
    if (post.message) message = `${message}\n${post.message}`

    return { ok: true, skipped: false, message }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    const detail = augmentPipFailureMessage(
      [e.stderr, e.stdout, e.message].filter(Boolean).join('\n').trim(),
      python,
      pyCheck.version,
    )
    return {
      ok: false,
      error:
        `pip install failed (${python} -m pip install -r ${pkg.pythonRequirementsRelPath}).\n` +
        `${detail}\n` +
        'Sylo uses the python on PATH (or SYLO_PYTHON). It does not create a venv.',
    }
  }
}
