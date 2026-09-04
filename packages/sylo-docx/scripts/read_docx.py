#!/usr/bin/env python3
"""Read a .docx as structured JSON (title, headings, ordered paragraphs with image markers)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from docx_reader_lib import read_docx_summary  # noqa: E402

DEFAULT_MAX_PARAGRAPHS = 400


def main() -> int:
    parser = argparse.ArgumentParser(description="Read .docx as structured JSON.")
    parser.add_argument("docx", type=Path)
    parser.add_argument(
        "--max-paragraphs",
        type=int,
        default=DEFAULT_MAX_PARAGRAPHS,
        help=f"Max non-empty paragraphs returned (default {DEFAULT_MAX_PARAGRAPHS})",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Body block index to start from (use next_offset from a truncated read)",
    )
    args = parser.parse_args()

    try:
        result = read_docx_summary(
            args.docx,
            max_paragraphs=max(1, args.max_paragraphs),
            offset=max(0, args.offset),
        )
    except ImportError:
        print(
            json.dumps(
                {
                    "error": "python-docx is required. "
                    "pip install -r packages/sylo-docx/scripts/requirements.txt"
                }
            )
        )
        return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
