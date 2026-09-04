import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { parsePythonScriptJsonStdout } from '../shared/python-script-json.js'
import { resolveToolsPackageDir } from './tools-bundles.js'

const execFileAsync = promisify(execFile)

export function onenoteConfigDir(): string {
  return join(homedir(), '.sylo', 'onenote')
}

export function syloOneNotePackageRoot(repoRoot: string): string {
  // Package moved to the sylo-tools-onenote bundle (2026-09-02); in-repo path kept as fallback.
  return resolveToolsPackageDir(repoRoot, 'sylo-tools-onenote', 'sylo-onenote')
}

function resolvePython(): string {
  const t = process.env.SYLO_PYTHON?.trim()
  if (t) return t
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function onenoteScriptEnv(): Record<string, string> {
  const dir = onenoteConfigDir()
  mkdirSync(dir, { recursive: true })
  return {
    SYLO_ONENOTE_CONFIG_DIR: dir,
  }
}

export async function runOneNoteScript(
  repoRoot: string,
  scriptName: string,
  args: string[] = [],
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const packageRoot = syloOneNotePackageRoot(repoRoot)
  const scriptPath = join(packageRoot, 'scripts', scriptName)
  if (!existsSync(scriptPath)) {
    return { ok: false, error: `missing_script:${scriptName}` }
  }
  const { stdout, stderr } = await execFileAsync(resolvePython(), [scriptPath, ...args], {
    cwd: packageRoot,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    timeout: timeoutMs,
    env: { ...process.env, ...onenoteScriptEnv() },
  })
  const trimmed = stdout.trim()
  if (!trimmed) {
    return { ok: false, error: stderr.trim() || `${scriptName} produced no output` }
  }
  return parsePythonScriptJsonStdout(trimmed)
}

export async function runOneNoteSettingsSave(
  repoRoot: string,
  settings: unknown,
): Promise<Record<string, unknown>> {
  const json = JSON.stringify(settings ?? {})
  return runOneNoteScript(repoRoot, 'onenote_ui_settings_save.py', ['--json', json])
}
