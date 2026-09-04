#!/usr/bin/env python3
"""Search a PDF for text matches page-by-page. Optional OCR fallback for scanned pages."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def _snippet(text: str, query: str, radius: int = 100) -> str:
    lower = text.lower()
    q = query.lower()
    idx = lower.find(q)
    if idx < 0:
        return text[: radius * 2].strip()
    start = max(0, idx - radius)
    end = min(len(text), idx + len(query) + radius)
    out = text[start:end].strip()
    if start > 0:
        out = "…" + out
    if end < len(text):
        out = out + "…"
    return out


def _score_page(text: str, queries: list[str]) -> tuple[float, str, str]:
    lower = text.lower()
    best_score = 0.0
    best_query = queries[0]
    for q in queries:
        if not q:
            continue
        ql = q.lower()
        count = lower.count(ql)
        if count == 0:
            continue
        # Prefer exact tag-like tokens and multiple hits.
        token_bonus = 2.0 if re.search(rf"\b{re.escape(ql)}\b", lower) else 0.0
        score = count * (1.0 + token_bonus + min(len(ql), 20) / 40.0)
        if score > best_score:
            best_score = score
            best_query = q
    return best_score, best_query, _snippet(text, best_query)


def _ocr_page(page) -> str:
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "OCR requested but pytesseract/Pillow not installed. "
            "Run: pip install pytesseract pillow — and install Tesseract OCR on the system."
        ) from exc

    pix = page.get_pixmap(dpi=200, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return pytesseract.image_to_string(img)


def search_pdf(
    pdf_path: Path,
    queries: list[str],
    *,
    max_results: int = 8,
    use_ocr: bool = False,
    ocr_if_chars_below: int = 40,
) -> dict:
    import fitz  # PyMuPDF

    doc = fitz.open(pdf_path)
    page_count = doc.page_count
    hits: list[dict] = []

    try:
        for page_index in range(page_count):
            page = doc.load_page(page_index)
            text = page.get_text("text") or ""
            method = "text"

            if use_ocr and len(text.strip()) < ocr_if_chars_below:
                try:
                    ocr_text = _ocr_page(page)
                    if len(ocr_text.strip()) > len(text.strip()):
                        text = ocr_text
                        method = "ocr"
                except RuntimeError:
                    raise
                except Exception:
                    pass

            score, matched_query, snippet = _score_page(text, queries)
            if score <= 0:
                continue

            hits.append(
                {
                    "page": page_index + 1,
                    "score": round(score, 3),
                    "matched_query": matched_query,
                    "snippet": snippet,
                    "text_chars": len(text.strip()),
                    "method": method,
                }
            )
    finally:
        doc.close()

    hits.sort(key=lambda h: (-h["score"], h["page"]))
    return {
        "pdf_path": str(pdf_path.resolve()),
        "page_count": page_count,
        "queries": queries,
        "hits": hits[:max_results],
        "hit_count": len(hits),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Search a PDF for query strings.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--query", action="append", required=True, help="Search term (repeatable)")
    parser.add_argument("--max-results", type=int, default=8)
    parser.add_argument("--use-ocr", action="store_true")
    parser.add_argument("--ocr-if-chars-below", type=int, default=40)
    args = parser.parse_args()

    if not args.pdf.is_file():
        print(json.dumps({"error": f"PDF not found: {args.pdf}"}))
        return 1

    try:
        result = search_pdf(
            args.pdf,
            args.query,
            max_results=args.max_results,
            use_ocr=args.use_ocr,
            ocr_if_chars_below=args.ocr_if_chars_below,
        )
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
