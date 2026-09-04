#!/usr/bin/env python3
"""Render one PDF page to PNG for vision inspection."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

DEFAULT_DPI = 150


def default_render_output_dir() -> Path:
    base = Path(tempfile.gettempdir()) / "sylo-schematic-renders"
    base.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="run-", dir=base))


def render_page(
    pdf_path: Path,
    page: int,
    *,
    dpi: int = DEFAULT_DPI,
    output_dir: Path | None = None,
) -> dict:
    import fitz  # PyMuPDF

    doc = fitz.open(pdf_path)
    try:
        if page < 1 or page > doc.page_count:
            raise ValueError(f"Page {page} out of range (1–{doc.page_count})")

        pg = doc.load_page(page - 1)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = pg.get_pixmap(matrix=matrix, alpha=False)

        out_dir = output_dir or default_render_output_dir()
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = pdf_path.stem
        out_path = out_dir / f"{stem}-p{page:03d}-{dpi}dpi.png"
        pix.save(out_path)

        return {
            "pdf_path": str(pdf_path.resolve()),
            "page": page,
            "page_count": doc.page_count,
            "dpi": dpi,
            "width_px": pix.width,
            "height_px": pix.height,
            "png_path": str(out_path.resolve()),
        }
    finally:
        doc.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a PDF page to PNG.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--page", type=int, required=True, help="1-based page number")
    parser.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    parser.add_argument("--output-dir", type=Path, default=None)
    args = parser.parse_args()

    if not args.pdf.is_file():
        print(json.dumps({"error": f"PDF not found: {args.pdf}"}))
        return 1

    try:
        result = render_page(args.pdf, args.page, dpi=args.dpi, output_dir=args.output_dir)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
