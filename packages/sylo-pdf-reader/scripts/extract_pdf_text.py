#!/usr/bin/env python3
"""Extract plain text from every page of a PDF (datasheets, manuals, schematics)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def extract_pdf_text(pdf_path: Path, *, max_chars: int = 120_000) -> dict:
    import fitz  # PyMuPDF

    doc = fitz.open(pdf_path)
    try:
        parts: list[str] = []
        total = 0
        for i in range(doc.page_count):
            text = doc.load_page(i).get_text("text").strip()
            if not text:
                continue
            block = f"### Page {i + 1}\n\n{text}"
            if total + len(block) > max_chars:
                remaining = max_chars - total
                if remaining > 200:
                    parts.append(block[:remaining] + "\n\n… (truncated)")
                break
            parts.append(block)
            total += len(block)
        markdown = "\n\n".join(parts) if parts else "(no extractable text — scanned PDF may need OCR via search_schematic_pdf use_ocr: true)"
        return {
            "ok": True,
            "pdf_path": str(pdf_path.resolve()),
            "page_count": doc.page_count,
            "char_count": len(markdown),
            "markdown": markdown,
        }
    finally:
        doc.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract PDF text as markdown sections per page.")
    parser.add_argument("pdf_path", type=Path)
    parser.add_argument("--max-chars", type=int, default=120_000)
    args = parser.parse_args()
    if not args.pdf_path.is_file():
        print(json.dumps({"ok": False, "error": f"PDF not found: {args.pdf_path}"}))
        return 1
    try:
        print(json.dumps(extract_pdf_text(args.pdf_path, max_chars=args.max_chars)))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
