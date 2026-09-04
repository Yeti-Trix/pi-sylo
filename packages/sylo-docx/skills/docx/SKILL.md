---
name: docx
description: Word (.docx) read and write. Read files as structured JSON (read_docx), extract embedded pictures with text anchors (extract_docx_images), and create styled documents from markdown (render_docx via Pandoc + reference.docx). Reads never modify the source file.
metadata:
  sylo:
    category: documents
    icon: file-text
---

# DOCX (read + write)

Read Word files and create new ones. Reads **never edit the source file** (Strict OOXML is converted in a temp copy). Writing is **markdown-first**: author the full document as markdown, then `render_docx` converts it with Pandoc — styling comes from a reference `.docx`, not from your prose. For **control manuals built from a Word template**, use **template-docx-writer**, not this skill.

## Tools

| Tool | When |
|------|------|
| `read_docx` | Operator attached or referenced a `.docx`; you need its text, outline, or structure — also to **verify your own rendered output** |
| `extract_docx_images` | You need the embedded pictures on disk (vendor manual figures, old-manual screenshots) |
| `render_docx` | Operator wants a new Word document (report, letter, spec, summary) with no existing template workflow |

## Reading

1. **`read_docx`** first — returns `title_guess`, `headings` (outline with levels), `paragraphs` in document order, `tables_summary`, `char_count`. Paragraphs containing pictures carry inline `[image: imageN.ext]` markers.
2. **Big documents** — default 400 paragraphs. If `truncated: true`, re-run with `offset` = `next_offset`. The `headings` outline is always complete; use it to decide whether you need the rest.
3. **Pictures** — `extract_docx_images` writes embedded images to **OS temp by default** (auto-pruned after 24h). Pass `output_dir` when the operator wants files kept. Each entry has:
   - `media_name` — matches the `[image: ...]` marker in `read_docx` output
   - `block_index` — paragraph index where the picture sits
   - `caption_guess` / `context_text` / `alt_text` — nearby caption or surrounding prose
   - `referenced_in_body: false` — header/footer/theme media, usually skip these
4. **View** an extracted image by attaching or embedding its absolute path. `.emf` / `.wmf` / `.tif` may not render for vision (see `format_note`).

## Writing

### Workflow

1. **Author the complete document as markdown first.** Draft the whole thing — do not render section-by-section. If the operator wants review, show the markdown (or key sections) in chat before rendering.
2. **`render_docx`** with either `markdown` (content string) or `markdown_path` (a `.md` on disk), plus `output_path`. For documents the operator will iterate on, prefer saving the markdown to a file first — the `.md` is the source of truth for later edits.
3. **Verify**: `read_docx` the output and check headings, tables, and image markers landed as intended. Fix problems in the **markdown**, then re-render with `overwrite: true`.
4. **Edits later** = revise the markdown source and re-render. Never try to patch the `.docx` directly.

### Markdown authoring rules (these decide output quality)

- **Headings**: ATX only (`#`, `##`, `###`), one `#` H1 as the document title area, never skip levels. Word heading styles map 1:1.
- **Front matter** for document metadata:

  ```yaml
  ---
  title: "Pump Station Controls Overview"
  author: "Your Company"
  date: "07-09-2026"
  ---
  ```

- **Tables**: pipe tables only. Keep cell content short; put explanation in prose around the table, not inside cells. No merged cells (markdown can't express them — if the operator needs merged cells, say so and suggest a manual Word touch-up).
- **Images**: `![Caption text](C:/absolute/path/to/image.png)` on its own line. The alt text becomes the visible caption. Prefer PNG/JPG; relative paths resolve against the markdown file's folder (`markdown_path` mode) so absolute paths are safer for `markdown` string mode.
- **Lists**: `-` for bullets, `1.` for numbered, indent 2 spaces per nesting level. Don't fake lists with unicode bullets — they render as plain paragraphs.
- **Emphasis**: `**bold**`, `*italic*`, `` `code` ``. Fenced code blocks get monospace formatting.
- **Page structure**: for a long document set `toc: true` (operator presses F9 in Word to populate) and `number_sections: true` for numbered headings. Don't hand-number headings in the text when `number_sections` is on.
- **No HTML** in the markdown — Pandoc's docx writer drops most of it silently.

### Styling

- Default styling comes from the package `templates/reference.docx` (fonts, heading colors, table look, margins). Your markdown carries **structure only**.
- If the operator has a company-styled reference doc, pass its path as `reference_doc`. Offer this when output needs to match existing company documents: any `.docx` whose *styles* (not content) look right can serve after cleanup, and a purpose-built one beats retrofitting.
- Do not try to control fonts/colors from markdown. If the operator asks for different styling, the answer is editing/replacing the reference doc, not markdown hacks.

### Failure modes

- **Pandoc missing**: `render_docx` returns an install hint (`winget install pandoc`). Enabling the DOCX package runs a best-effort post-enable step that installs Pandoc per-user via winget, so this is rare; if it still fails (no winget / offline), install it manually and retry. Read tools work regardless.
- **Existing output file**: rendering refuses to overwrite unless `overwrite: true`. Use `true` only when re-rendering your own output or the operator asked to replace the file.

## FieldBrain catalog

For cataloging a vendor `.docx`: `read_docx` → write your summary from `title_guess` + `headings` + key paragraphs → `fieldbrain_document_catalog` with `description` and `outline_json` built from `headings`.

## Template-docx-writer handoff

- **Pulling figures** from an old `.docx` manual for a new draft: `extract_docx_images` with `output_dir` = the manual project's `projects/<id>/inputs/`, then reference `inputs/<media_name>` in staged markdown. Use `caption_guess` as the `![caption](...)` alt text.
- **Building a control manual** (section catalog, `{PLACEHOLDER}` template, HMI screens, revision table): that is **template-docx-writer's** job. Do not use `render_docx` for manuals that belong in that workflow.

## Rules

- Do **not** use Pi `read` on binary `.docx`.
- Do **not** edit a rendered `.docx` in place — fix the markdown and re-render.
- Do **not** use template-docx-writer tools just to read a document, and do not use `render_docx` to build template-based control manuals.
- `.doc` (legacy binary Word) is unsupported — ask for a `.docx` export.
