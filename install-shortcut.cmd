@echo off
REM Create/refresh the Sylo Start Menu shortcut without rebuilding.
REM Use this if the shortcut is missing or the repo moved; use build-sylo.cmd
REM when you also want to compile (it refreshes the shortcut as its last step).
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-shortcut.ps1" %*
if errorlevel 1 (
  echo.
  echo Shortcut install failed. See the message above.
  pause
  exit /b 1
)

pause
