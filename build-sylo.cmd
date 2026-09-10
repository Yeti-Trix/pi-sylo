@echo off
REM Sylo production compile — builds what the Start Menu shortcut launches.
REM
REM Unlike full-build-run-sylo.cmd (which ends in electron-vite dev), this produces
REM the compiled app under apps\host\out and then exits. The Start Menu shortcut runs
REM that output directly, so anything built here shows up the next time you launch Sylo.
REM
REM Run this after: git pull, editing Sylo source, changing skills, or adding deps.
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not on PATH.
  pause
  exit /b 1
)

echo.
echo Stopping any running Sylo so the build can replace files in use...
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*pi-sylo*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
timeout /t 2 /nobreak >nul

call npm install
if errorlevel 1 (
  echo.
  echo npm install failed.
  echo Common cause: better-sqlite3 rebuild — EPERM / EBUSY while Sylo holds the native module.
  if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
    echo.
    echo Retrying without native rebuild ^(existing better_sqlite3.node found^)...
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
echo Bootstrapping Pi skills and skill-surface fixtures...
call npm run prepare:dev -w apps/host
if errorlevel 1 (
  echo.
  echo prepare:dev failed. See messages above.
  pause
  exit /b 1
)

echo.
echo Compiling Sylo (main, preload, renderer, broker)...
call npm run build -w apps/host
if errorlevel 1 (
  echo.
  echo Build failed. See messages above.
  pause
  exit /b 1
)

echo.
echo Refreshing the Start Menu shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-shortcut.ps1"
if errorlevel 1 (
  echo.
  echo Shortcut install failed ^(the build itself succeeded^).
  pause
  exit /b 1
)

echo.
echo Done. Launch Sylo from the Start Menu.
pause
