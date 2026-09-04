---
name: pdf-reader
description: Search PDFs (datasheets, manuals, schematics) by text/OCR — local paths or http(s) URLs — then confirm with region crops.
metadata:
  sylo:
    category: documents
    icon: file-search
---

# PDF reader workflow (pdf-reader skill)

Use **targeted search → region crop + OCR → brief answer** for any PDF — electrical schematics, vendor datasheets, tension charts, manuals.

**`pdf_path` accepts a local file path or an `https://…/*.pdf` URL.** Online PDFs are downloaded to a cache automatically. Do **not** use `sylo_web_fetch` or bash `curl` for PDFs when these tools are available.

Industry pattern (engineering-drawing pipelines): **detect/crop regions first**, then run vision/OCR on the crop — full-page passes garble small text and invite hallucination.

## Tools

| Tool | When |
|------|------|
| `search_schematic_pdf` | Always first — locate pages; `render_on_best_hit: true` for a coarse full-page PNG |
| `render_schematic_page` | Know the page; need layout context (one call only) |
| `render_schematic_region` | Wire numbers / terminal labels too small on full page — **default 300 DPI crop** |
| `ocr_schematic_region` | Deterministic text tokens near a terminal block; pass `queries` for wire/tag numbers |

## Specific questions (wire, cable, port, tag)

1. **Narrow search** — 1–3 queries from the question (e.g. `["DGT-300+", "S-"]`). Do not re-scan the whole drawing set.
2. **Snippets locate pages only.** PDF text is often garbled — never treat snippet order as terminal wiring.
3. **One full-page look** — at most **one** `render_schematic_page` (or `render_on_best_hit`) per question to find the area. If small text is unreadable, **stop re-examining that PNG**.
4. **Region next** — `render_schematic_region` + `ocr_schematic_region` on the same `bbox` (normalized 0–1 fractions of page). Example bbox around lower-right detail: `{"x0":0.55,"y0":0.35,"x1":0.98,"y1":0.85}`.
5. **Cross-check** — prefer answers where OCR `matched_tokens` and region vision agree. If they disagree, widen `bbox` or raise `dpi` once — do not loop.
6. **Brief answer** — 2–4 sentences or a short table. State **verification level** (see below).

## Anti-rumination (required)

- **One look per unique image path** — never re-reason over the same PNG/DPI/bbox.
- **No hypothesis recycling** — if you already guessed an answer from color codes or pinout, do not re-derive it in later thinking; either verify with region OCR or label it **Inferred**.
- **Budget per question:** ≤1 full-page render, ≤2 region render/OCR pairs, ≤3 `search_schematic_pdf` calls.
- **When stuck:** ask one clarifying question or report what OCR/vision could not read — do not spend minutes on the same page.

## Answer calibration (required)

Tag every wire/tag answer:

| Level | When to use |
|-------|-------------|
| **Verified (schematic)** | OCR `matched_tokens` clearly show the wire at the terminal, or region crop vision unambiguously shows the label |
| **Inferred (convention)** | Color code, standard pinout, or industry practice — **not** read from the drawing |
| **Unreadable** | Region OCR empty and region vision ambiguous — say so; do not guess |

**Never** present **Inferred** as **Verified**. Example: "1242 (Verified — OCR on Actual Value S- terminal)" vs "likely 1242 (Inferred — WHITE is often S- on 4-wire cells; OCR did not confirm)".

## Survey / attached PDF (“what’s in this?”)

- Broader `query` list is fine to prove the tool and build a sheet index.
- JSON includes `page_count` and `hit_count`. `hits` is capped by `max_results` (default 8).
- No region renders until the operator asks a detail question.

## Parameters

- **`bbox`** — `{x0,y0,x1,y1}` or `[x0,y0,x1,y1]` as fractions of page size (0–1). Use `padding: 0.02` if labels clip.
- **`render_schematic_region` / `ocr_schematic_region`** — default **300 DPI** on the crop.
- **`ocr_schematic_region.queries`** — e.g. `["1242", "S-", "1240"]` to surface wire numbers in `matched_tokens`.
- **`use_ocr: true`** on search — scanned PDFs with empty text layer.
- **PNG output** — ephemeral by default (OS temp, deleted after the tool embeds the image). Pass `output_dir` only when the operator asks to keep files on disk.

## Rules

- **Never** render all pages.
- **Never** re-read the same full-page image hoping clarity improves.
- Snippets locate pages; **region OCR + crop vision** confirm numbers.

## Examples

**Wire to terminal:** “What wire goes to S- on DGT-300+?”

```json
{
  "pdf_path": ".../drawing.pdf",
  "query": ["DGT-300+", "S-"],
  "render_on_best_hit": true
}
```

Then region on page from top hit:

```json
{
  "pdf_path": ".../drawing.pdf",
  "page": 14,
  "bbox": { "x0": 0.5, "y0": 0.4, "x1": 0.98, "y1": 0.88 },
  "queries": ["1240", "1241", "1242", "1243", "S-"]
}
```

Run `ocr_schematic_region` with the same `page`/`bbox`/`queries`. Answer from `matched_tokens` when confident; otherwise **Unreadable** or **Inferred** with explicit label.

**Survey:** attached PDF → index queries, `max_results: 12`, no render until a detail question.
