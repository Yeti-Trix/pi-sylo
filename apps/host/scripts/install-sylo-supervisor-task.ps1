# install-sylo-supervisor-task.ps1 — per-user (NO ADMIN) setup for the Sylo
# restart watchdog, for machines where the NSSM service route
# (install-sylo-supervisor.ps1, needs elevation) is not available.
#
# Creates two per-user Scheduled Tasks:
#   1. StartSylo       — runs run-sylo.cmd in the operator's interactive session
#                        at logon (and on demand via `schtasks /Run`). This is
#                        how the supervisor relaunches the Sylo GUI.
#   2. SyloSupervisor  — runs sylo-supervisor.mjs (hidden, via
#                        run-supervisor-hidden.vbs) at logon + now.
#
# The supervisor derives everything from hostname/home dir: control topic
# sylo-<hostname>-control (must match the host's ntfy nodeName pref), ntfy
# server http://localhost:8090, token from ~\ntfy\ADMIN_CREDENTIALS.txt.
# Env overrides: see the CONFIG block in sylo-supervisor.mjs.
#
# Idempotent — re-run to update in place.

#Requires -Version 5.1
param(
  # Defaults derive from the operator's profile — no personal paths hardcoded.
  [string]$RepoRoot = $(@('pi-sylo-dev', 'sylo-dev') |
    ForEach-Object { Join-Path $env:USERPROFILE "Documents\GitHub\$_" } |
    Where-Object { Test-Path (Join-Path $_ 'run-sylo.cmd') } |
    Select-Object -First 1),
  [string]$TaskName = 'StartSylo',
  [string]$SupervisorTaskName = 'SyloSupervisor'
)

$ErrorActionPreference = 'Stop'
$RunCmd     = Join-Path $RepoRoot 'run-sylo.cmd'
$Supervisor = Join-Path $RepoRoot 'apps\host\scripts\sylo-supervisor.mjs'
$Launcher   = Join-Path $RepoRoot 'apps\host\scripts\run-supervisor-hidden.vbs'
$Wscript    = Join-Path $env:SystemRoot 'System32\wscript.exe'

function Assert($cond, $msg) { if (-not $cond) { throw $msg } }

Assert ($RepoRoot)     "No repo with run-sylo.cmd found under Documents\GitHub (sylo-dev / pi-sylo-dev)"
Assert (Test-Path $RunCmd)   "run-sylo.cmd not found at $RunCmd"
Assert (Test-Path $Supervisor) "supervisor not found at $Supervisor"
Assert (Test-Path $Launcher)   "hidden launcher not found at $Launcher"
$node = Get-Command node.exe -ErrorAction SilentlyContinue
Assert ($node) "node.exe not on PATH"

$User = "$env:USERDOMAIN\$env:USERNAME"
Write-Host "Operator user: $User"
Write-Host "Repo:          $RepoRoot"
Write-Host ""

$principal  = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive
$settings   = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# --- 1. StartSylo (relaunch hook used by the supervisor + logon autostart) ---
Write-Host "Creating Scheduled Task '$TaskName' (runs $RunCmd at logon)..."
$action  = New-ScheduledTaskAction -Execute $RunCmd
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "  OK (on demand: schtasks /Run /TN $TaskName)"

# --- 2. SyloSupervisor (the watchdog itself; hidden, starts now + at logon) ---
Write-Host "Creating Scheduled Task '$SupervisorTaskName' (hidden watchdog)..."
$action    = New-ScheduledTaskAction -Execute $Wscript -Argument "`"//B`" `"//Nologo`" `"$Launcher`""
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $User
$svcSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName $SupervisorTaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $svcSettings -Force | Out-Null
Write-Host "  OK (log: $RepoRoot\logs\supervisor.log)"

# --- start the supervisor now ---
Write-Host "Starting '$SupervisorTaskName'..."
Start-ScheduledTask -TaskName $SupervisorTaskName
Start-Sleep -Seconds 3
$log = Join-Path $RepoRoot 'logs\supervisor.log'
if (Test-Path $log) {
  Get-Content $log -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
Write-Host "DONE. Trigger a rebuild/restart from the phone companion UI, or manually:" -ForegroundColor Green
$nodeName = $env:COMPUTERNAME.ToLower()
Write-Host "  publish 'restart' (or 'rebuild') to the ntfy topic 'sylo-$nodeName-control'."