<#
.SYNOPSIS
  Installs (or refreshes) the Sylo Start Menu shortcut.

.DESCRIPTION
  Creates "Sylo" in the Start Menu pointing at the Electron binary and the built app
  in THIS repo, so Sylo behaves like an installed application while still running the
  code in this folder. Rebuilding with build-sylo.cmd is picked up on the next launch,
  so the shortcut never has to be reinstalled unless the repo moves.

  Generates a multi-resolution .ico from apps/host/resources/icon.png (Windows
  shortcuts cannot use a PNG) and stamps the shortcut with the same AppUserModelID
  the app sets at runtime, so pinning to the taskbar merges with the running window
  instead of creating a second button.

  Kept ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI unless
  they carry a BOM, so non-ASCII punctuation here breaks the parser.

.PARAMETER Uninstall
  Remove the shortcut and the generated icon instead of installing.
#>
[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# Must match SYLO_APP_USER_MODEL_ID in apps/host/src/main/app-icon.ts.
$AppUserModelId = 'YetiTrix.Sylo'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'Sylo.lnk'
$IconDir = Join-Path $env:LOCALAPPDATA 'Sylo'
$IconPath = Join-Path $IconDir 'Sylo.ico'

if ($Uninstall) {
    Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $IconPath -Force -ErrorAction SilentlyContinue
    Write-Host "Removed the Sylo Start Menu shortcut."
    return
}

$ElectronExe = Join-Path $RepoRoot 'node_modules\electron\dist\electron.exe'
$AppDir = Join-Path $RepoRoot 'apps\host'
$MainEntry = Join-Path $AppDir 'out\main\index.js'
$RendererEntry = Join-Path $AppDir 'out\renderer\index.html'
$SourceIcon = Join-Path $AppDir 'resources\icon.png'

if (-not (Test-Path -LiteralPath $ElectronExe)) {
    throw "Electron is not installed at $ElectronExe. Run full-build-run-sylo.cmd once, then try again."
}
if (-not (Test-Path -LiteralPath $MainEntry) -or -not (Test-Path -LiteralPath $RendererEntry)) {
    throw "Sylo has not been compiled yet (missing out\main or out\renderer). Run build-sylo.cmd first."
}

# --- Icon ---------------------------------------------------------------------
# Windows picks a different size for the Start Menu, taskbar, Alt+Tab, and Explorer,
# so pack all of them rather than letting it downscale one 512 px image.
function New-SyloIcon {
    param([string]$Png, [string]$Destination)

    Add-Type -AssemblyName System.Drawing
    $sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
    $source = [System.Drawing.Image]::FromFile($Png)
    $frames = @()
    try {
        foreach ($size in $sizes) {
            $bitmap = New-Object System.Drawing.Bitmap($size, $size)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.DrawImage($source, 0, 0, $size, $size)
            } finally {
                $graphics.Dispose()
            }
            $buffer = New-Object System.IO.MemoryStream
            # Vista+ icons may hold PNG frames directly, which keeps the alpha channel
            # intact and avoids hand-rolling a DIB with an AND mask.
            $bitmap.Save($buffer, [System.Drawing.Imaging.ImageFormat]::Png)
            $bitmap.Dispose()
            $frames += , @{ Size = $size; Bytes = $buffer.ToArray() }
            $buffer.Dispose()
        }
    } finally {
        $source.Dispose()
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    $stream = [System.IO.File]::Create($Destination)
    $writer = New-Object System.IO.BinaryWriter($stream)
    try {
        $writer.Write([uint16]0)                # reserved
        $writer.Write([uint16]1)                # type: icon
        $writer.Write([uint16]$frames.Count)

        # Directory entries come first, so every image offset is past the whole table.
        $offset = 6 + (16 * $frames.Count)
        foreach ($frame in $frames) {
            # 256 px is encoded as 0 in the single-byte width/height fields.
            $dim = if ($frame.Size -ge 256) { 0 } else { $frame.Size }
            $writer.Write([byte]$dim)           # width
            $writer.Write([byte]$dim)           # height
            $writer.Write([byte]0)              # palette entries
            $writer.Write([byte]0)              # reserved
            $writer.Write([uint16]1)            # colour planes
            $writer.Write([uint16]32)           # bits per pixel
            $writer.Write([uint32]$frame.Bytes.Length)
            $writer.Write([uint32]$offset)
            $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) {
            $writer.Write($frame.Bytes)
        }
    } finally {
        $writer.Dispose()
        $stream.Dispose()
    }
}

if (Test-Path -LiteralPath $SourceIcon) {
    New-SyloIcon -Png $SourceIcon -Destination $IconPath
} else {
    Write-Warning "No icon at $SourceIcon; the shortcut will use the default Electron icon."
}

# --- Shortcut -----------------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($ShortcutPath)
$link.TargetPath = $ElectronExe
# Quoted so a repo path containing spaces still resolves to one argument.
$link.Arguments = '"{0}"' -f $AppDir
$link.WorkingDirectory = $RepoRoot
$link.Description = 'Sylo - local-first desktop host for Pi'
if (Test-Path -LiteralPath $IconPath) {
    $link.IconLocation = "$IconPath,0"
}
$link.Save()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

# --- AppUserModelID -----------------------------------------------------------
# WScript.Shell cannot write shell property-store values, so set the ID through
# IPropertyStore on the saved .lnk. Without this Windows derives an implicit ID from
# the shortcut target while the running window advertises the explicit one, and the
# pinned icon and the live window stay separate taskbar buttons.
if (-not ('SyloShortcut.Aumid' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace SyloShortcut
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey
    {
        public Guid fmtid;
        public uint pid;
        public PropertyKey(Guid guid, uint id) { fmtid = guid; pid = id; }
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        void GetCount(out uint cProps);
        void GetAt(uint iProp, out PropertyKey pkey);
        void GetValue(ref PropertyKey key, out PropVariant pv);
        void SetValue(ref PropertyKey key, ref PropVariant pv);
        void Commit();
    }

    [ComImport, Guid("0000010B-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPersistFile
    {
        void GetClassID(out Guid pClassID);
        [PreserveSig] int IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, [MarshalAs(UnmanagedType.Bool)] bool remember);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    public class ShellLink { }

    public static class Aumid
    {
        // PKEY_AppUserModel_ID
        private static readonly PropertyKey Key =
            new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);

        private const uint StgmReadWrite = 0x00000002;
        private const ushort VtLpwstr = 31;

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropVariant pvar);

        public static void Apply(string shortcutPath, string appId)
        {
            object link = new ShellLink();
            try
            {
                IPersistFile file = (IPersistFile)link;
                file.Load(shortcutPath, StgmReadWrite);

                IPropertyStore store = (IPropertyStore)link;
                PropVariant value = new PropVariant
                {
                    vt = VtLpwstr,
                    pointerValue = Marshal.StringToCoTaskMemUni(appId)
                };
                PropertyKey key = Key;
                store.SetValue(ref key, ref value);
                store.Commit();
                PropVariantClear(ref value);

                file.Save(shortcutPath, true);
            }
            finally
            {
                Marshal.ReleaseComObject(link);
            }
        }
    }
}
'@
}

try {
    [SyloShortcut.Aumid]::Apply($ShortcutPath, $AppUserModelId)
} catch {
    Write-Warning "Could not stamp the AppUserModelID on the shortcut: $($_.Exception.Message)"
    Write-Warning "The shortcut still works; pinning it may create a separate taskbar button."
}

Write-Host ""
Write-Host "Installed: $ShortcutPath"
Write-Host "  runs:    $ElectronExe"
Write-Host "  app:     $AppDir"
Write-Host ""
Write-Host "Press Start and type 'Sylo'. Right-click the running window to pin it to the taskbar."
Write-Host "After changing Sylo's code, run build-sylo.cmd; the shortcut picks it up next launch."
