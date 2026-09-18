; Custom NSIS hooks for the Sylo one-click installer.
;
; Upgrade path: a newer setup must overwrite %LOCALAPPDATA%\Programs\sylo in
; place. Chats and prefs live outside that folder and are never touched.
;
; electron-builder's default upgrade runs the previous "Uninstall Sylo.exe"
; first. On this payload (asar off, tens of thousands of files) that helper
; often returns non-zero because a file is briefly locked by the indexer or
; antivirus — even when Sylo.exe is not running. After five retries it shows
; "Sylo cannot be closed" and aborts. customInit removes only the old
; UninstallString so that step is skipped; INSTDIR still comes from
; InstallLocation, and the new files replace the program tree.
;
; The default CHECK_APP_RUNNING also matches every process whose path starts
; with INSTDIR. We replace that with an exact Sylo.exe image check.

!macro syloClearOldUninstallString ROOT_KEY
  DeleteRegValue ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
  !endif
!macroend

!macro customInit
  !insertmacro syloClearOldUninstallString SHELL_CONTEXT
  !insertmacro syloClearOldUninstallString HKCU
!macroend

!macro customCheckAppRunning
  Push $R0
  Push $R1

  StrCpy $R1 0

  sylo_check_loop:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq Sylo.exe" /FI "USERNAME eq %USERNAME%" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"Sylo.exe\""`
    Pop $R0
    ${if} $R0 != 0
      Goto sylo_not_running
    ${endif}

    IntOp $R1 $R1 + 1
    ${if} $R1 > 3
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Sylo.exe is still running.$\r$\n$\r$\nQuit Sylo (tray / Task Manager), then click OK to continue the upgrade. Chat history is not removed." /SD IDOK IDOK sylo_not_running
      Quit
    ${endif}

    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM Sylo.exe /T /FI "USERNAME eq %USERNAME%"`
    Pop $R0
    Sleep 800
    Goto sylo_check_loop

  sylo_not_running:
  Pop $R1
  Pop $R0
!macroend

!macro customUnInstallCheck
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  ClearErrors
!macroend
