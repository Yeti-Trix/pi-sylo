#!/usr/bin/env python3
"""OCR a cropped PDF region and return text tokens with positions."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pdf_region import DEFAULT_OCR_DPI, ocr_region


def main() -> int:
    parser = argparse.ArgumentParser(description="OCR a cropped PDF region.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--page", type=int, required=True, help="1-based page number")
    parser.add_argument("--bbox", required=True, help='Normalized bbox JSON: {"x0":0,"y0":0,"x1":1,"y1":1}')
    parser.add_argument("--dpi", type=int, default=DEFAULT_OCR_DPI)
    parser.add_argument("--padding", type=float, default=0.02)
    parser.add_argument("--query", action="append", default=[], help="Highlight tokens matching query (repeatable)")
    parser.add_argument("--min-confidence", type=int, default=30)
    args = parser.parse_args()

    if not args.pdf.is_file():
        print(json.dumps({"error": f"PDF not found: {args.pdf}"}))
        return 1

    try:
        bbox = json.loads(args.bbox)
        result = ocr_region(
            args.pdf,
            args.page,
            bbox,
            dpi=args.dpi,
            padding=args.padding,
            queries=args.query,
            min_confidence=args.min_confidence,
        )
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
