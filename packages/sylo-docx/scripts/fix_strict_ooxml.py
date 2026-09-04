#!/usr/bin/env python3
"""Convert Strict OOXML .docx to Transitional so python-docx can open it.

Read-only variant of the template-docx-writer helper: always writes to a
destination path and never mutates the source file.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import zipfile
from pathlib import Path

STRICT_NAMESPACE_MARKER = "purl.oclc.org/ooxml"

STRICT_TO_TRANSITIONAL = {
    "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument": (
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    ),
    "http://purl.oclc.org/ooxml/drawingml/main": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing": (
        "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    ),
    "http://purl.oclc.org/ooxml/wordprocessingml/main": (
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    ),
    "http://purl.oclc.org/ooxml/markup-compatibility/2006": (
        "http://schemas.openxmlformats.org/markup-compatibility/2006"
    ),
}


def is_strict_ooxml(docx_path: Path) -> bool:
    """Sniff package relationships for the Strict OOXML namespace."""
    try:
        with zipfile.ZipFile(docx_path, "r") as zf:
            rels = zf.read("_rels/.rels").decode("utf-8", errors="replace")
            return STRICT_NAMESPACE_MARKER in rels
    except (OSError, KeyError, zipfile.BadZipFile):
        return False


def patch_xml(text: str) -> str:
    out = text
    for strict, trans in STRICT_TO_TRANSITIONAL.items():
        out = out.replace(strict, trans)
    # Strict paths omit /2006/ segment in some tags
    out = out.replace("/wordprocessingml/main", "/wordprocessingml/2006/main")
    out = out.replace("/drawingml/main", "/drawingml/2006/main")
    return out


def convert_docx(src: Path, dest: Path) -> Path:
    """Write a Transitional copy of ``src`` to ``dest`` (source untouched)."""
    src = src.resolve()
    dest = Path(dest).resolve()
    if dest == src:
        raise ValueError("dest must differ from src; this converter never edits in place")
    with tempfile.TemporaryDirectory() as tmp:
        extracted = Path(tmp) / "doc"
        with zipfile.ZipFile(src, "r") as zin:
            zin.extractall(extracted)
        for pattern in ("*.xml", "*.rels"):
            for xml_file in extracted.rglob(pattern):
                text = xml_file.read_text(encoding="utf-8")
                patched = patch_xml(text)
                if patched != text:
                    xml_file.write_text(patched, encoding="utf-8")
        dest.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
            for file in extracted.rglob("*"):
                if file.is_file():
                    zout.write(file, file.relative_to(extracted).as_posix())
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch Strict OOXML docx for python-docx (to copy).")
    parser.add_argument("docx", type=Path)
    parser.add_argument("dest", type=Path, help="Output path for the converted copy")
    args = parser.parse_args()
    if not args.docx.is_file():
        print(json.dumps({"error": f"Not found: {args.docx}"}))
        return 1
    try:
        path = convert_docx(args.docx, args.dest)
        print(json.dumps({"ok": True, "path": str(path.resolve())}))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
