/**
 * Print Pi shell resolution for debugging bash-tool failures.
 *
 *   npm run diagnose:shell -w apps/host
 *   npm run diagnose:shell -w apps/host -- "C:/path/with spaces/project"
 *
 * If npm strips quotes on Windows, run after build:broker:
 *   node scripts/diagnose-pi-shell.mjs "C:/path/with spaces/project"
 *
 * Env: SYLO_PI_AGENT_DIR (optional)
 */
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getShellConfig, SettingsManager } from '@earendil-works/pi-coding-agent'
import { ensureWindowsPiShellFallback, resolveWindowsPiShellExe } from '../out/broker/pi-shell-lib.mjs'

function defaultAgentDir() {
  const fromEnv = process.env.SYLO_PI_AGENT_DIR?.trim()
  if (fromEnv) return fromEnv.replace(/^~(?=[\\/])/, homedir())
  return join(homedir(), '.pi', 'agent')
}

const cwdArg = process.argv.slice(2).join(' ').trim()
const cwd = cwdArg || process.cwd()
const agentDir = defaultAgentDir()

console.log(JSON.stringify({ platform: process.platform, cwd, agentDir }, null, 2))
console.log('resolveWindowsPiShellExe:', resolveWindowsPiShellExe())

const sm = SettingsManager.create(cwd, agentDir)

let beforeErr
try {
  getShellConfig(sm.getShellPath())
} catch (e) {
  beforeErr = e instanceof Error ? e.message : String(e)
}

console.log(
  JSON.stringify(
    {
      mergedShellPathBeforeFallback: sm.getShellPath(),
      getShellConfigBeforeFallbackError: beforeErr,
    },
    null,
    2,
  ),
)

ensureWindowsPiShellFallback(sm, cwd)

let afterErr
try {
  getShellConfig(sm.getShellPath())
} catch (e) {
  afterErr = e instanceof Error ? e.message : String(e)
}

let spawnPreview = null
let spawnSmoke = null
if (!afterErr) {
  const cfg = getShellConfig(sm.getShellPath())
  spawnPreview = { shell: cfg.shell, args: cfg.args }
  const sh = cfg.shell.replace(/\\/g, '/').toLowerCase()
  const cmd =
    sh.includes('powershell.exe') || sh.endsWith('/pwsh.exe') ? 'Write-Output SYLO_DIAG_OK' : 'echo SYLO_DIAG_OK'
  const r = spawnSync(cfg.shell, [...cfg.args, cmd], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
  })
  spawnSmoke = {
    status: r.status,
    error: r.error ? String(r.error) : null,
    stderr: (r.stderr ?? '').slice(0, 800),
    stdout: (r.stdout ?? '').slice(0, 800),
  }
}

console.log(
  JSON.stringify(
    {
      effectiveShellPath: sm.getShellPath(),
      getShellConfigAfterFallbackError: afterErr,
      spawnPreview,
      spawnSmoke,
    },
    null,
    2,
  ),
)
