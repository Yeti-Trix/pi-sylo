' run-supervisor-hidden.vbs — launch sylo-supervisor.mjs with no visible window
' (used by the per-user "SyloSupervisor" scheduled task; the supervisor also
' writes its own log to <repo>/logs/supervisor.log).
' Paths are derived from this script's location — no machine-specific values.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName) ' ...\apps\host\scripts
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(scriptDir)))
nodeExe = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
supervisor = fso.BuildPath(repoRoot, "apps\host\scripts\sylo-supervisor.mjs")
sh.Run """" & nodeExe & """ """ & supervisor & """", 0, False