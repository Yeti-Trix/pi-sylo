#!/usr/bin/env python3
"""Extract embedded images from a .docx with body anchors, captions, and alt text."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from docx_reader_lib import extract_docx_images  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract .docx embedded images to a folder.")
    parser.add_argument("docx", type=Path)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Destination folder (default: <docx dir>/docx-extract/<docx stem>/)",
    )
    args = parser.parse_args()

    try:
        result = extract_docx_images(args.docx, output_dir=args.output_dir)
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
