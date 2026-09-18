@echo off
setlocal
rem Build the single-file Sylo installer: dist\installer\Sylo-Setup-<version>.exe
rem
rem Produces a per-user NSIS setup that installs to %LOCALAPPDATA%\Programs\Sylo.
rem Running a newer setup over an existing install upgrades it in place and
rem leaves every chat, credential, and setting untouched (all of that lives in
rem %APPDATA%\@sylo\host, %USERPROFILE%\.pi\agent, and your workspace folders).
rem
rem Pass through any flags supported by scripts\make-installer.mjs, e.g.
rem   make-installer.cmd --skip-build --keep-deps

cd /d "%~dp0"

echo.
echo === Sylo installer build =========================================
echo.

rem Sylo locks files in node_modules while it runs, and the staging step reads
rem the whole tree. Close a running instance from this repo first.
taskkill /f /fi "IMAGENAME eq electron.exe" >nul 2>&1

call npm install
if errorlevel 1 goto :failed

call node scripts\make-installer.mjs %*
if errorlevel 1 goto :failed

echo.
echo Done. The installer is in dist\installer.
echo.
pause
exit /b 0

:failed
echo.
echo *** Installer build FAILED. Scroll up for the first error. ***
echo.
pause
exit /b 1
