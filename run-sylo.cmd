@echo off
REM Sylo quiet launcher (GUI only, no terminal) — for the Windows Startup folder.
REM
REM Launches electron-vite dev DETACHED and HIDDEN so only the Sylo window appears;
REM no cmd window stays open. Hot reload still works (renderer HMR + main-process
REM auto-restart), so edits to Sylo source apply on the fly.
REM
REM This script SKIPS npm install and prepare:dev for a fast boot. It assumes the
REM repo is already prepared. After you pull changes, edit skill surfaces, broker,
REM companion, or add deps, run full-build-run-sylo.cmd once (with console) to rebuild,
REM then use run-sylo.cmd for normal launches.
cd /d "%~dp0"

REM Personal tools (health/news/reddit) are an app-level user package now:
REM the host resolves the installed sylo-tools-personal bundle at runtime
REM (apps/host/src/main/personal-plugin.ts) - no build flag needed.

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not on PATH. Run full-build-run-sylo.cmd first to set up the repo.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo.
  echo node_modules not found. Run full-build-run-sylo.cmd once to install and prepare the repo.
  pause
  exit /b 1
)

REM --- Rebuild flag (set by sylo-supervisor for "rebuild & restart") ------------
REM When .sylo-rebuild-flag exists, run npm install + prepare:dev so companion,
REM broker, and skill-surface changes are applied before launching. The flag is
REM consumed here. Output goes to logs\rebuild-*.log (no pause — launched by task).
if exist ".sylo-rebuild-flag" (
  del ".sylo-rebuild-flag" >nul 2>&1
  if not exist "logs" mkdir logs
  echo Rebuild flag detected — running npm install + prepare:dev...
  call npm install >"logs\rebuild-install.log" 2>"logs\rebuild-install.err.log"
  if errorlevel 1 (
    echo npm install failed ^(retrying with --ignore-scripts^)... see logs\rebuild-install.err.log
    call npm install --ignore-scripts >"logs\rebuild-install-retry.log" 2>"logs\rebuild-install-retry.err.log"
  )
  echo Running prepare:dev...
  call npm run prepare:dev -w apps/host >"logs\rebuild-prepare.log" 2>"logs\rebuild-prepare.err.log"
  if errorlevel 1 (
    echo prepare:dev FAILED — see logs\rebuild-prepare.err.log. Supervisor will revert if Sylo fails to boot.
  )
)
REM ---------------------------------------------------------------------------

echo.
echo Stopping leftover Sylo/Electron processes from this repo (if any)...
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*pi-sylo*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
timeout /t 2 /nobreak >nul

echo Ensuring Electron binary is installed...
node scripts\ensure-electron.mjs
if errorlevel 1 (
  echo.
  echo Electron setup failed. Run full-build-run-sylo.cmd to diagnose.
  pause
  exit /b 1
)

echo.
echo Starting Sylo (quiet, no terminal)...
if not exist "logs" mkdir logs
REM Start-Process with -WindowStyle Hidden detaches the dev server from this console
REM so the cmd window can close. Start output is captured to logs\ for troubleshooting.
powershell -NoProfile -Command "Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','start','--ignore-scripts','-w','apps/host' -WorkingDirectory '%CD%' -WindowStyle Hidden -RedirectStandardOutput 'logs\sylo-dev.log' -RedirectStandardError 'logs\sylo-dev.err.log'"
if errorlevel 1 (
  echo.
  echo Failed to launch Sylo in the background. Run full-build-run-sylo.cmd to diagnose.
  pause
  exit /b 1
)

echo.
echo Sylo is starting. This window will close shortly.
echo Dev logs: logs\sylo-dev.log ^(stdout^) and logs\sylo-dev.err.log ^(stderr^).
timeout /t 3 /nobreak >nul