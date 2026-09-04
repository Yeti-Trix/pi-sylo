"""Locate a working Pandoc executable on the host."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

INSTALL_HINT = (
    "Pandoc is required for render_docx. Install: winget install --id JohnMacFarlane.Pandoc "
    "or see https://pandoc.org/installing.html"
)


def _pandoc_candidates() -> list[Path]:
    candidates: list[Path] = []
    if sys.platform == "win32":
        for env in ("ProgramFiles", "ProgramFiles(x86)"):
            base = os.environ.get(env, "")
            if base:
                candidates.append(Path(base) / "Pandoc" / "pandoc.exe")
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            candidates.append(Path(local) / "Pandoc" / "pandoc.exe")
    found = shutil.which("pandoc")
    if found:
        candidates.append(Path(found))
    # Preserve order but drop duplicates
    seen: set[str] = set()
    unique: list[Path] = []
    for path in candidates:
        key = str(path).lower()
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def _pandoc_works(exe: Path) -> bool:
    if not exe.is_file():
        return False
    try:
        proc = subprocess.run(
            [str(exe), "--version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        return proc.returncode == 0 and "pandoc" in (proc.stdout or "").lower()
    except Exception:  # noqa: BLE001
        return False


def find_pandoc() -> Path | None:
    for candidate in _pandoc_candidates():
        if _pandoc_works(candidate):
            return candidate
    return None


def pandoc_version(exe: Path) -> str:
    try:
        proc = subprocess.run(
            [str(exe), "--version"],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
        lines = (proc.stdout or "").splitlines()
        return lines[0].strip() if lines else "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"
