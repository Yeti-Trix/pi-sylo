#!/usr/bin/env python3
"""Render markdown to .docx via Pandoc."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pandoc_util import INSTALL_HINT, find_pandoc, pandoc_version  # noqa: E402

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REFERENCE = PACKAGE_ROOT / "templates" / "reference.docx"


def main() -> int:
    parser = argparse.ArgumentParser(description="Render markdown to .docx via Pandoc.")
    parser.add_argument("--output", "-o", type=Path, required=True)
    parser.add_argument("--markdown", type=str, default="")
    parser.add_argument("--markdown-path", type=Path, default=None)
    parser.add_argument("--reference-doc", type=Path, default=None)
    parser.add_argument("--toc", action="store_true")
    parser.add_argument("--number-sections", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    md_path: Path | None = args.markdown_path
    temp_md: Path | None = None
    resource_path = Path.cwd()

    if md_path is not None:
        if not md_path.is_file():
            print(json.dumps({"error": f"markdown_path not found: {md_path}"}))
            return 1
        resource_path = md_path.resolve().parent
    elif args.markdown.strip():
        fd, name = tempfile.mkstemp(suffix=".md", prefix="sylo-docx-")
        os.close(fd)
        temp_md = Path(name)
        temp_md.write_text(args.markdown, encoding="utf-8")
        md_path = temp_md
    else:
        print(json.dumps({"error": "Provide --markdown or --markdown-path."}))
        return 1

    output_path = args.output.resolve()
    if output_path.exists() and not args.overwrite:
        print(json.dumps({"error": f"Output exists (use --overwrite): {output_path}"}))
        return 1

    ref = (args.reference_doc or DEFAULT_REFERENCE).resolve()
    if not ref.is_file():
        print(json.dumps({"error": f"reference.docx not found: {ref}"}))
        return 1

    pandoc_exe = find_pandoc()
    if not pandoc_exe:
        print(json.dumps({"error": "Pandoc not found.", "install_hint": INSTALL_HINT}))
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(pandoc_exe),
        str(md_path.resolve()),
        "-o",
        str(output_path),
        "--from",
        "gfm+yaml_metadata_block",
        "--reference-doc",
        str(ref),
        "--resource-path",
        str(resource_path),
    ]
    if args.toc:
        cmd.append("--toc")
    if args.number_sections:
        cmd.append("--number-sections")

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(resource_path),
        )
    finally:
        if temp_md is not None:
            try:
                temp_md.unlink(missing_ok=True)
            except OSError:
                pass

    warnings = (proc.stderr or "").strip()
    if proc.returncode != 0:
        err = warnings or proc.stdout or "pandoc failed"
        print(json.dumps({"error": err}))
        return 1

    print(
        json.dumps(
            {
                "output_path": str(output_path),
                "pandoc_version": pandoc_version(pandoc_exe),
                "reference_doc": str(ref),
                "warnings": warnings or None,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
