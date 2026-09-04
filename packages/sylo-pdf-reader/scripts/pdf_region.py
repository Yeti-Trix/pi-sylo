"""Shared PDF region crop, render, and OCR helpers."""

from __future__ import annotations

import re
import tempfile
from pathlib import Path
from typing import Any

DEFAULT_DPI = 150
DEFAULT_REGION_DPI = 300
DEFAULT_OCR_DPI = 300
DEFAULT_PADDING = 0.02


def default_render_output_dir() -> Path:
    base = Path(tempfile.gettempdir()) / "sylo-schematic-renders"
    base.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="run-", dir=base))


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def parse_bbox_norm(bbox: Any) -> tuple[float, float, float, float]:
    """Parse normalized bbox (x0, y0, x1, y1) as fractions of page width/height (0–1)."""
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        x0, y0, x1, y1 = (float(v) for v in bbox)
    elif isinstance(bbox, dict):
        x0 = float(bbox.get("x0", bbox.get("x_min", 0)))
        y0 = float(bbox.get("y0", bbox.get("y_min", 0)))
        x1 = float(bbox.get("x1", bbox.get("x_max", 1)))
        y1 = float(bbox.get("y1", bbox.get("y_max", 1)))
    else:
        raise ValueError("bbox must be {x0,y0,x1,y1} or [x0,y0,x1,y1] with values in 0–1")

    x0, x1 = clamp01(x0), clamp01(x1)
    y0, y1 = clamp01(y0), clamp01(y1)
    if x0 > x1:
        x0, x1 = x1, x0
    if y0 > y1:
        y0, y1 = y1, y0
    if x1 - x0 < 0.001 or y1 - y0 < 0.001:
        raise ValueError("bbox too small after normalization")
    return x0, y0, x1, y1


def apply_padding(
    bbox: tuple[float, float, float, float],
    padding: float,
) -> tuple[float, float, float, float]:
    pad = max(0.0, float(padding))
    x0, y0, x1, y1 = bbox
    return (
        clamp01(x0 - pad),
        clamp01(y0 - pad),
        clamp01(x1 + pad),
        clamp01(y1 + pad),
    )


def norm_bbox_to_rect(page: Any, bbox_norm: tuple[float, float, float, float]) -> Any:
    import fitz

    rect = page.rect
    x0, y0, x1, y1 = bbox_norm
    return fitz.Rect(
        rect.x0 + x0 * rect.width,
        rect.y0 + y0 * rect.height,
        rect.x0 + x1 * rect.width,
        rect.y0 + y1 * rect.height,
    )


def region_slug(bbox_norm: tuple[float, float, float, float]) -> str:
    x0, y0, x1, y1 = bbox_norm
    return f"r{int(x0 * 100):02d}{int(y0 * 100):02d}{int(x1 * 100):02d}{int(y1 * 100):02d}"


def render_region(
    pdf_path: Path,
    page: int,
    bbox: Any,
    *,
    dpi: int = DEFAULT_REGION_DPI,
    padding: float = DEFAULT_PADDING,
    output_dir: Path | None = None,
) -> dict[str, Any]:
    import fitz

    doc = fitz.open(pdf_path)
    try:
        if page < 1 or page > doc.page_count:
            raise ValueError(f"Page {page} out of range (1–{doc.page_count})")

        pg = doc.load_page(page - 1)
        bbox_norm = apply_padding(parse_bbox_norm(bbox), padding)
        clip = norm_bbox_to_rect(pg, bbox_norm)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = pg.get_pixmap(matrix=matrix, clip=clip, alpha=False)

        out_dir = output_dir or default_render_output_dir()
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = pdf_path.stem
        slug = region_slug(bbox_norm)
        out_path = out_dir / f"{stem}-p{page:03d}-{slug}-{dpi}dpi.png"
        pix.save(out_path)

        return {
            "pdf_path": str(pdf_path.resolve()),
            "page": page,
            "page_count": doc.page_count,
            "dpi": dpi,
            "padding": padding,
            "bbox_norm": {
                "x0": round(bbox_norm[0], 4),
                "y0": round(bbox_norm[1], 4),
                "x1": round(bbox_norm[2], 4),
                "y1": round(bbox_norm[3], 4),
            },
            "width_px": pix.width,
            "height_px": pix.height,
            "png_path": str(out_path.resolve()),
        }
    finally:
        doc.close()


def _token_matches_queries(text: str, queries: list[str]) -> bool:
    lower = text.lower()
    for query in queries:
        q = query.strip().lower()
        if not q:
            continue
        if q in lower:
            return True
        if re.search(rf"\b{re.escape(q)}\b", lower):
            return True
    return False


def ocr_region(
    pdf_path: Path,
    page: int,
    bbox: Any,
    *,
    dpi: int = DEFAULT_OCR_DPI,
    padding: float = DEFAULT_PADDING,
    queries: list[str] | None = None,
    min_confidence: int = 30,
) -> dict[str, Any]:
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "Region OCR requires pytesseract and Pillow. "
            "Run: pip install pytesseract pillow — and install Tesseract OCR on the system."
        ) from exc

    import fitz

    doc = fitz.open(pdf_path)
    try:
        if page < 1 or page > doc.page_count:
            raise ValueError(f"Page {page} out of range (1–{doc.page_count})")

        pg = doc.load_page(page - 1)
        bbox_norm = apply_padding(parse_bbox_norm(bbox), padding)
        clip = norm_bbox_to_rect(pg, bbox_norm)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = pg.get_pixmap(matrix=matrix, clip=clip, alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        try:
            data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        except pytesseract.TesseractNotFoundError as exc:
            raise RuntimeError(
                "Tesseract OCR is not installed or not on PATH. "
                "Install Tesseract for Windows (or choco install tesseract) and restart the broker."
            ) from exc

        tokens: list[dict[str, Any]] = []
        lines: list[str] = []
        n = len(data["text"])
        for i in range(n):
            text = (data["text"][i] or "").strip()
            if not text:
                continue
            conf_raw = data["conf"][i]
            try:
                confidence = int(conf_raw)
            except (TypeError, ValueError):
                confidence = -1
            if confidence >= 0 and confidence < min_confidence:
                continue

            left = int(data["left"][i])
            top = int(data["top"][i])
            width = int(data["width"][i])
            height = int(data["height"][i])
            token = {
                "text": text,
                "confidence": confidence,
                "bbox_px": {
                    "x0": left,
                    "y0": top,
                    "x1": left + width,
                    "y1": top + height,
                },
                "bbox_norm_in_crop": {
                    "x0": round(left / max(pix.width, 1), 4),
                    "y0": round(top / max(pix.height, 1), 4),
                    "x1": round((left + width) / max(pix.width, 1), 4),
                    "y1": round((top + height) / max(pix.height, 1), 4),
                },
            }
            tokens.append(token)
            lines.append(text)

        filtered = tokens
        if queries:
            filtered = [t for t in tokens if _token_matches_queries(t["text"], queries)]
            if not filtered:
                filtered = [
                    t
                    for t in tokens
                    if any(q.strip().lower() in " ".join(lines).lower() for q in queries if q.strip())
                ]

        return {
            "pdf_path": str(pdf_path.resolve()),
            "page": page,
            "page_count": doc.page_count,
            "dpi": dpi,
            "padding": padding,
            "bbox_norm": {
                "x0": round(bbox_norm[0], 4),
                "y0": round(bbox_norm[1], 4),
                "x1": round(bbox_norm[2], 4),
                "y1": round(bbox_norm[3], 4),
            },
            "method": "tesseract",
            "token_count": len(tokens),
            "tokens": tokens,
            "matched_tokens": filtered if queries else tokens,
            "full_text": " ".join(lines).strip(),
            "queries": queries or [],
        }
    finally:
        doc.close()
