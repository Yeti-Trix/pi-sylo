#!/usr/bin/env python3
"""Build packages/sylo-docx/templates/reference.docx (Pandoc default + style tuning)."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pandoc_util import find_pandoc  # noqa: E402

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = PACKAGE_ROOT / "templates"
OUTPUT = TEMPLATES_DIR / "reference.docx"
RAW = TEMPLATES_DIR / "_reference_raw.docx"

NAVY = "1F3864"


def fetch_default_pandoc_ref(dest: Path) -> None:
    pandoc = find_pandoc()
    if not pandoc:
        raise SystemExit(
            "Pandoc required. Install: winget install --id JohnMacFarlane.Pandoc"
        )
    subprocess.run(
        [str(pandoc), "-o", str(dest), "--print-default-data-file", "reference.docx"],
        check=True,
    )


def tune_styles(docx_path: Path) -> None:
    from docx import Document
    from docx.enum.style import WD_STYLE_TYPE
    from docx.enum.text import WD_LINE_SPACING
    from docx.shared import Inches, Pt, RGBColor

    doc = Document(str(docx_path))

    for section in doc.sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)

    style_cfg: dict[str, dict] = {
        "Normal": {"size": 11, "font": "Calibri", "spacing": 1.15},
        "Body Text": {"size": 11, "font": "Calibri", "spacing": 1.15},
        "Heading 1": {"size": 16, "font": "Calibri", "color": NAVY, "bold": True},
        "Heading 2": {"size": 13, "font": "Calibri", "color": NAVY, "bold": True},
        "Heading 3": {"size": 12, "font": "Calibri", "color": NAVY, "bold": True},
        "Caption": {"size": 9, "font": "Calibri", "italic": True},
    }

    for name, cfg in style_cfg.items():
        try:
            style = doc.styles[name]
        except KeyError:
            continue
        if style.type != WD_STYLE_TYPE.PARAGRAPH:
            continue
        font = style.font
        if "font" in cfg:
            font.name = cfg["font"]
        if "size" in cfg:
            font.size = Pt(cfg["size"])
        if cfg.get("bold"):
            font.bold = True
        if cfg.get("italic"):
            font.italic = True
        if "color" in cfg:
            font.color.rgb = RGBColor.from_string(cfg["color"])
        if "spacing" in cfg:
            pf = style.paragraph_format
            pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            pf.line_spacing = cfg["spacing"]

    doc.save(str(docx_path))


def main() -> int:
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    fetch_default_pandoc_ref(RAW)
    shutil.copy2(RAW, OUTPUT)
    tune_styles(OUTPUT)
    RAW.unlink(missing_ok=True)
    print(f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
