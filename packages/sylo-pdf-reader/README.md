# sylo-pdf-reader

Search PDFs quickly, then confirm with vision on one page (schematics, datasheets, manuals).

## Install

1. **Sylo → Capability manager → Sylo optional packages** → turn **PDF reader** **On** (installs PyMuPDF via pip)
2. **Restart broker**
3. Once from dev repo: `npm run bootstrap-pi` (copies skill to `~/.pi/agent/skills`)
4. Enable **Supports vision** on your model in Settings

## Publish (later)

```bash
npm publish --access public
pi install npm:sylo-pdf-reader
```

## Tools

- **`search_schematic_pdf`** — embedded text per page; optional OCR; `render_on_best_hit` combines search + 150 DPI PNG
- **`render_schematic_page`** — full page PNG at chosen DPI (default 150)
- **`render_schematic_region`** — crop a page region to PNG (default 300 DPI) for legible wire numbers
- **`ocr_schematic_region`** — Tesseract OCR on a crop; returns text tokens with positions (`queries` filter wire/tag hits)

Region OCR requires **Tesseract** on the system plus `pytesseract` / `Pillow` (installed with the package pip requirements).

## Workflow

See `skills/pdf-reader/SKILL.md` — search → one full-page look → region crop + OCR; no re-reading the same image.
