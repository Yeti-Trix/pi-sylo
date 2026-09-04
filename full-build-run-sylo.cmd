@echo off
REM Sylo full-build launcher (console visible) — full dev flow with live logs.
REM Runs, in order:
REM   1. npm install
REM   2. prepare:dev — bootstrap-pi (~/.pi/agent skills), build health/tts/think-tank UI,
REM      broker, companion, sync skill-surface fixtures
REM   3. electron-vite dev (renderer + main hot reload) in the FOREGROUND so you see
REM      errors stream and the window pauses on any failure.
REM
REM Use this when you are actively editing Sylo. For a quiet "just the GUI" launch
REM (e.g. from the Windows Startup folder), use run-sylo.cmd instead.
cd /d "%~dp0"

REM Personal tools (health/news/reddit) are an app-level user package now:
REM the host resolves the installed sylo-tools-personal bundle at runtime
REM (apps/host/src/main/personal-plugin.ts) - no build flag needed.

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not on PATH.
  pause
  exit /b 1
)

echo.
echo Stopping leftover Sylo/Electron processes from this repo (if any)...
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*sylo-dev*' -or $_.Path -like '*pi-sylo*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
timeout /t 2 /nobreak >nul

echo Close any running Sylo window before continuing...
echo.

call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. If Sylo is still running, close it and run full-build-run-sylo.cmd again.
  echo Common cause: better-sqlite3 rebuild — EPERM / EBUSY while Sylo holds the native module.
  if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
    echo.
    echo Retrying npm install without native rebuild ^(existing better_sqlite3.node found^)...
    call npm install --ignore-scripts
    if errorlevel 1 (
      echo Retry also failed.
      pause
      exit /b 1
    )
  ) else (
    pause
    exit /b 1
  )
)

echo.
echo Ensuring Electron binary is installed...
node scripts\ensure-electron.mjs
if errorlevel 1 (
  echo.
  echo Electron setup failed. See messages above.
  pause
  exit /b 1
)

echo.
echo Verifying Pi broker dependency (@earendil-works/pi-coding-agent)...
node scripts\verify-pi-broker-deps.mjs
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Preparing dev environment (bootstrap-pi, skill surfaces, broker, companion)...
call npm run prepare:dev -w apps/host
if errorlevel 1 (
  echo.
  echo prepare:dev failed. See messages above.
  pause
  exit /b 1
)

echo.
echo Starting Sylo (dev, console visible)...
call npm run start --ignore-scripts -w apps/host
if errorlevel 1 (
  echo.
  echo Sylo failed to start. See messages above.
  pause
  exit /b 1
)