import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getShellConfig, type SettingsManager } from '@earendil-works/pi-coding-agent'

/** Prefer PowerShell 7 when installed; every Windows SKU still ships Windows PowerShell 5.x. */
export function resolveWindowsPiShellExe(): string | null {
  const programFiles = process.env.ProgramFiles
  if (programFiles) {
    const pwsh7 = join(programFiles, 'PowerShell', '7', 'pwsh.exe')
    if (existsSync(pwsh7)) return pwsh7
  }
  const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const windowsPs = join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(windowsPs) ? windowsPs : null
}

function shellProbeCommand(shellPath: string): string {
  const sh = shellPath.replace(/\\/g, '/').toLowerCase()
  if (sh.includes('powershell.exe') || sh.endsWith('/pwsh.exe')) return 'Write-Output SYLO_SHELL_PROBE'
  return 'echo SYLO_SHELL_PROBE'
}

/** True if Pi's resolved shell runs a trivial command (catches broken WSL bash.exe shim). */
export function probeResolvedShell(shell: string, args: string[], piCwd: string): boolean {
  if (!existsSync(piCwd)) return true
  const cmd = shellProbeCommand(shell)
  const r = spawnSync(shell, [...args, cmd], {
    cwd: piCwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  })
  if (r.status !== 0) return false
  const err = (r.stderr ?? '').toLowerCase()
  if (err.includes('wsl') && err.includes('error')) return false
  if (err.includes('execvpe(/bin/bash)')) return false
  return true
}

function applyPowerShellFallback(settingsManager: SettingsManager, ps: string, reason: string): void {
  console.warn(`[sylo] Pi bash tool: ${reason}; using PowerShell for this broker: ${ps}`)
  settingsManager.setShellPath(ps)
  settingsManager.applyOverrides({ shellPath: ps })
  try {
    getShellConfig(settingsManager.getShellPath())
  } catch (e) {
    console.warn('[sylo] Pi bash tool: PowerShell fallback failed verification:', e)
  }
}

/**
 * Pi's `bash` tool resolves a real shell via {@link getShellConfig}. Pi merges **project**
 * `.pi/settings.json` over **global** `~/.pi/agent/settings.json`. On Windows, `where bash.exe`
 * may resolve to **System32\\bash.exe** (WSL relay) even when WSL has no usable distro — config
 * succeeds but every spawn fails; we smoke-test and fall back to PowerShell.
 */
export function ensureWindowsPiShellFallback(settingsManager: SettingsManager, piCwd: string): void {
  if (process.platform !== 'win32') return

  const ps = resolveWindowsPiShellExe()

  let cfg: ReturnType<typeof getShellConfig>
  try {
    cfg = getShellConfig(settingsManager.getShellPath())
  } catch {
    if (!ps) {
      console.warn(
        '[sylo] Pi bash tool: no bash/Git shell found and PowerShell is missing; install Git for Windows or set shellPath in ~/.pi/agent/settings.json.',
      )
      return
    }
    const prev = settingsManager.getShellPath()
    const detail =
      prev?.trim() ?
        `configured shellPath "${prev}" is invalid or unreachable (often from <cwd>/.pi/settings.json)`
      : 'no usable bash on PATH'
    applyPowerShellFallback(settingsManager, ps, detail)
    return
  }

  if (probeResolvedShell(cfg.shell, cfg.args, piCwd)) return

  if (!ps) {
    console.warn(
      `[sylo] Pi bash tool: resolved shell "${cfg.shell}" failed smoke test and PowerShell is missing.`,
    )
    return
  }
  applyPowerShellFallback(
    settingsManager,
    ps,
    `resolved shell "${cfg.shell}" failed smoke test (broken WSL shim or missing distro?)`,
  )
}
