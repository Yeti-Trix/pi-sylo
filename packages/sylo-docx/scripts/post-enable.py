#!/usr/bin/env python3
"""Post-enable (sylo-docx): best-effort install of Pandoc so render_docx works.

Why this exists: enabling the DOCX package only pip-installs python-docx
(the read tools: read_docx / extract_docx_images). render_docx additionally
needs the Pandoc binary, which is not a pip package. This script tries to
install Pandoc per-user via winget (no elevation) so a one-click enable gives
a working render_docx.

Best-effort and NON-FATAL: if winget is missing, offline, or the install fails,
we still emit ok=True with a clear hint so the package enable itself is not
blocked — the read tools work either way and the operator can install Pandoc
manually later. Never emit ok=False here; that would block enabling DOCX.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys

from pandoc_util import find_pandoc, pandoc_version

WINGET_ID = "JohnMacFarlane.Pandoc"


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _winget_install() -> tuple[bool, str]:
    winget = shutil.which("winget")
    if not winget:
        return False, "winget not found on PATH"
    try:
        proc = subprocess.run(
            [
                winget,
                "install",
                "--id",
                WINGET_ID,
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--silent",
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        detail = ((proc.stdout or "") + (proc.stderr or "")).strip()
        return proc.returncode == 0, detail[-400:]
    except Exception as exc:  # noqa: BLE001
        return False, f"winget install raised: {exc}"


def main() -> None:
    existing = find_pandoc()
    if existing:
        _emit(
            {
                "ok": True,
                "message": f"Pandoc already installed ({pandoc_version(existing)}). render_docx ready.",
            }
        )
        return

    _ok, _detail = _winget_install()
    after = find_pandoc()
    if after:
        _emit(
            {
                "ok": True,
                "message": (
                    f"Pandoc installed via winget ({pandoc_version(after)}). "
                    "render_docx ready — restart the broker."
                ),
            }
        )
        return

    # Best-effort: do NOT block the enable. Read tools still work.
    _emit(
        {
            "ok": True,
            "message": (
                "Pandoc could not be installed automatically (winget unavailable or failed). "
                "The read tools work, but render_docx needs Pandoc. "
                "Install it yourself: winget install --id JohnMacFarlane.Pandoc"
            ),
        }
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        # Never block the enable on this setup script.
        _emit({"ok": True, "message": f"Pandoc setup skipped (non-fatal): {exc}"})