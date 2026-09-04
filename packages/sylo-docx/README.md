# sylo-docx

Word (**`.docx`**) read and write tools for the agent.

## Read

- **`read_docx`** — structured JSON: `title_guess`, `headings` outline, paragraphs in document order with `[image: imageN.ext]` markers, `tables_summary`, `char_count`. Strict OOXML via in-memory temp copy (source file untouched).
- **`extract_docx_images`** — embedded pictures to OS temp by default (24h prune); pass `output_dir` to keep files. Each annotated with body anchor (`block_index`), `caption_guess`, `context_text`, and `alt_text`.

## Write

- **`render_docx`** — markdown → styled `.docx` via **Pandoc** and `templates/reference.docx`. Author markdown first, render, then **`read_docx`** to verify. Edits = revise markdown and re-render with `overwrite: true`.

**Pandoc** is required for `render_docx` and is installed **automatically (best-effort, per-user via winget)** when you enable the DOCX package. If the auto-install is unavailable (no winget / offline), install it yourself: `winget install --id JohnMacFarlane.Pandoc`. Read tools work without Pandoc.

Control manuals from Word templates remain **sylo-template-docx-writer** - not this package.

## Install

1. **Sylo → Capability manager → Sylo optional packages** → turn **DOCX** **On**. This runs `pip install` for `python-docx` (read tools) and a **best-effort post-enable step** that installs **Pandoc** per-user via winget (`render_docx`) if it's not already present. If winget is unavailable, the enable still succeeds and the message tells you to install Pandoc manually.
2. **Restart broker**
3. Once from dev repo: `npm run bootstrap-pi` (copies `docx` skill to `~/.pi/agent/skills`)

> If the post-enable step could not install Pandoc (no winget, offline, elevation refused), install it yourself: `winget install --id JohnMacFarlane.Pandoc`. Read tools work without Pandoc.

## Regenerate reference template

```bash
python packages/sylo-docx/scripts/build_reference_docx.py
```

Requires Pandoc + python-docx. Commits `packages/sylo-docx/templates/reference.docx`.

## Formats

| Format | Read | Write |
|--------|------|-------|
| `.docx` (Transitional) | Yes | Yes (`render_docx`) |
| `.docx` (Strict OOXML) | Yes (temp copy) | N/A (output is Transitional) |
| `.doc` (legacy binary) | Not supported | Not supported |

## Publish (later)

```bash
npm publish --access public
pi install npm:sylo-docx
```
