import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { resolvePdfInput } from './pdf-source.ts'

const execFileAsync = promisify(execFile)

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS_DIR = path.join(PACKAGE_ROOT, 'scripts')
const DEFAULT_RENDER_DPI = 150
const DEFAULT_REGION_DPI = 300
const DEFAULT_REGION_PADDING = 0.02
const SCHEMATIC_RENDER_CACHE = path.join(tmpdir(), 'sylo-schematic-renders')
const STALE_RENDER_DIR_MS = 24 * 60 * 60 * 1000

function resolveRenderOutputDir(explicit?: string): { dir: string; ephemeral: boolean } {
  const trimmed = explicit?.trim()
  if (trimmed) return { dir: trimmed, ephemeral: false }
  pruneStaleRenderDirs()
  mkdirSync(SCHEMATIC_RENDER_CACHE, { recursive: true })
  return { dir: mkdtempSync(path.join(SCHEMATIC_RENDER_CACHE, 'run-')), ephemeral: true }
}

function pruneStaleRenderDirs(): void {
  try {
    if (!existsSync(SCHEMATIC_RENDER_CACHE)) return
    const cutoff = Date.now() - STALE_RENDER_DIR_MS
    for (const name of readdirSync(SCHEMATIC_RENDER_CACHE)) {
      const full = path.join(SCHEMATIC_RENDER_CACHE, name)
      try {
        const st = statSync(full)
        if (st.isDirectory() && st.mtimeMs < cutoff) {
          rmSync(full, { recursive: true, force: true })
        }
      } catch {
        /* skip entry */
      }
    }
  } catch {
    /* best effort */
  }
}

function cleanupEphemeralRenderDir(dir: string | undefined): void {
  if (!dir) return
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

function resolvePython(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function runPythonScript(
  scriptName: string,
  args: string[],
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  try {
    const { stdout, stderr } = await execFileAsync(resolvePython(), [scriptPath, ...args], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    const trimmed = stdout.trim()
    if (!trimmed) {
      return { ok: false, error: stderr.trim() || `${scriptName} produced no output` }
    }
    try {
      return { ok: true, data: JSON.parse(trimmed) as unknown }
    } catch {
      return { ok: false, error: `Invalid JSON from ${scriptName}: ${trimmed.slice(0, 400)}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error:
        `${message}\n` +
        `Ensure Python deps: pip install -r ${path.join(SCRIPTS_DIR, 'requirements.txt')}`,
    }
  }
}

function toolError(text: string): { content: ToolContentBlock[] } {
  return { content: [{ type: 'text', text }] }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function resolveRenderDpi(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(400, Math.max(72, Math.floor(raw)))
  }
  return DEFAULT_RENDER_DPI
}

async function runRenderPage(
  pdfPath: string,
  page: number,
  dpi: number,
  outputDir?: string,
): Promise<
  | { ok: true; data: Record<string, unknown>; ephemeralDir?: string }
  | { ok: false; error: string }
> {
  const { dir, ephemeral } = resolveRenderOutputDir(outputDir)
  const args = ['--page', String(page), '--dpi', String(dpi), '--output-dir', dir]
  args.unshift(pdfPath)
  const result = await runPythonScript('render_page.py', args)
  if (!result.ok) {
    cleanupEphemeralRenderDir(ephemeral ? dir : undefined)
    return result
  }
  const data = asRecord(result.data)
  if (!data) {
    cleanupEphemeralRenderDir(ephemeral ? dir : undefined)
    return { ok: false, error: 'render_page returned non-object JSON' }
  }
  if (data.error) {
    cleanupEphemeralRenderDir(ephemeral ? dir : undefined)
    return { ok: false, error: String(data.error) }
  }
  return { ok: true, data, ephemeralDir: ephemeral ? dir : undefined }
}

async function runRenderRegion(
  pdfPath: string,
  page: number,
  bbox: Record<string, number>,
  dpi: number,
  padding: number,
  outputDir?: string,
): Promise<
  | { ok: true; data: Record<string, unknown>; ephemeralDir?: string }
  | { ok: false; error: string }
> {
  const { dir, ephemeral } = resolveRenderOutputDir(outputDir)
  const args = [
    '--page',
    String(page),
    '--bbox',
    JSON.stringify(bbox),
    '--dpi',
    String(dpi),
    '--padding',
    String(padding),
    '--output-dir',
    dir,
  ]
  args.unshift(pdfPath)
  const result = await runPythonScript('render_region.py', args)
  if (!result.ok) {
    cleanupEphemeralRenderDir(ephemeral ? dir : undefined)
    return result
  }
  const data = asRecord(result.data)
  if (!data) {
    cleanupEphemeralRenderDir(ephemeral ? dir : undefined)
    return { ok: false, error: 'render_region returned non-object JSON' }
  }
  if (data.error) {
    cleanupEphemeralRenderDir(ephemeral ? dir : undefined)
    return { ok: false, error: String(data.error) }
  }
  return { ok: true, data, ephemeralDir: ephemeral ? dir : undefined }
}

async function runOcrRegion(
  pdfPath: string,
  page: number,
  bbox: Record<string, number>,
  dpi: number,
  padding: number,
  queries: string[],
  minConfidence: number,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const args = [
    '--page',
    String(page),
    '--bbox',
    JSON.stringify(bbox),
    '--dpi',
    String(dpi),
    '--padding',
    String(padding),
    '--min-confidence',
    String(minConfidence),
  ]
  for (const q of queries) args.push('--query', q)
  args.unshift(pdfPath)
  const result = await runPythonScript('ocr_region.py', args)
  if (!result.ok) return result
  const data = asRecord(result.data)
  if (!data) return { ok: false, error: 'ocr_region returned non-object JSON' }
  if (data.error) return { ok: false, error: String(data.error) }
  return { ok: true, data }
}

function ocrRegionSummary(data: Record<string, unknown>, queries: string[]): string {
  const matched = Array.isArray(data.matched_tokens) ? data.matched_tokens : []
  const tokens = Array.isArray(data.tokens) ? data.tokens : []
  const bbox = asRecord(data.bbox_norm)
  const bboxText =
    bbox ?
      `bbox ${regionBboxLabel({
        x0: Number(bbox.x0),
        y0: Number(bbox.y0),
        x1: Number(bbox.x1),
        y1: Number(bbox.y1),
      })}`
    : 'bbox (unknown)'
  if (matched.length === 0 && tokens.length === 0) {
    return (
      `OCR found no readable tokens in region on page ${String(data.page)} (${bboxText}). ` +
      'Widen bbox, raise dpi, or try render_schematic_region and vision on the crop.'
    )
  }
  const sample = matched
    .slice(0, 12)
    .map((t) => {
      const rec = asRecord(t)
      if (!rec) return ''
      const text = String(rec.text ?? '')
      const conf = rec.confidence
      return conf === undefined || conf === null ? text : `${text} (${String(conf)}%)`
    })
    .filter(Boolean)
    .join(', ')
  const queryNote =
    queries.length > 0 ?
      ` Matched ${matched.length} token(s) for ${JSON.stringify(queries)}.`
    : ` ${tokens.length} token(s) total.`
  return (
    `OCR region on page ${String(data.page)} (${bboxText}).${queryNote}` +
    (sample ? ` Sample: ${sample}.` : '') +
    ' Use matched_tokens for wire/tag numbers; cross-check with a region render if needed.'
  )
}

function parseRegionBbox(raw: unknown): Record<string, number> | null {
  if (Array.isArray(raw) && raw.length === 4) {
    const [x0, y0, x1, y1] = raw.map((v) => Number(v))
    if ([x0, y0, x1, y1].every((v) => Number.isFinite(v))) {
      return { x0, y0, x1, y1 }
    }
    return null
  }
  const rec = asRecord(raw)
  if (!rec) return null
  const x0 = Number(rec.x0 ?? rec.x_min)
  const y0 = Number(rec.y0 ?? rec.y_min)
  const x1 = Number(rec.x1 ?? rec.x_max)
  const y1 = Number(rec.y1 ?? rec.y_max)
  if (![x0, y0, x1, y1].every((v) => Number.isFinite(v))) return null
  return { x0, y0, x1, y1 }
}

function regionBboxLabel(bbox: Record<string, number>): string {
  const fmt = (v: number) => Math.round(v * 100)
  return `${fmt(bbox.x0)}-${fmt(bbox.y0)}-${fmt(bbox.x1)}-${fmt(bbox.y1)}%`
}

function appendRenderedImage(
  content: ToolContentBlock[],
  renderData: Record<string, unknown>,
  dpi: number,
  options?: { kind?: 'page' | 'region'; ephemeral?: boolean },
): void {
  const pngPath = typeof renderData.png_path === 'string' ? renderData.png_path : ''
  const pdfPath = typeof renderData.pdf_path === 'string' ? renderData.pdf_path : ''
  const page = renderData.page
  const kind = options?.kind ?? 'page'
  const bbox = asRecord(renderData.bbox_norm)
  const regionHint =
    kind === 'region' && bbox ?
      ` Region ${regionBboxLabel({
        x0: Number(bbox.x0),
        y0: Number(bbox.y0),
        x1: Number(bbox.x1),
        y1: Number(bbox.y1),
      })}.`
    : ''
  const pathNote =
    options?.ephemeral ?
      'PNG embedded below (temp file removed after read).'
    : pngPath ?
      `→ ${pngPath}`
    : '(unknown path)'
  content.push({
    type: 'text',
    text:
      kind === 'region' ?
        `Rendered region on page ${String(page)} at ${dpi} DPI ${pathNote}.${regionHint} ` +
          'Region crops keep small wire numbers legible after vision downscale — prefer over full-page re-reads.'
      : `Rendered page ${String(page)} at ${dpi} DPI ${pathNote}. ` +
          '150 DPI is default — similar digits (6/8) may look alike; use render_schematic_region for small text.',
  })
  content.push({ type: 'text', text: JSON.stringify(renderData, null, 2) })
  if (!pngPath) return
  const previewLabel = kind === 'region' ? 'PDF region preview' : 'PDF page preview'
  content.push({
    type: 'text',
    text:
      `${previewLabel} (from your uploaded document). Page ${String(page)} at ${dpi} DPI.` +
      (pdfPath ? ` Source: ${pdfPath}` : ''),
  })
  try {
    const bytes = readFileSync(pngPath)
    content.push({
      type: 'image',
      data: bytes.toString('base64'),
      mimeType: 'image/png',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    content.push({
      type: 'text',
      text: `Could not embed PNG (${message}). Path: ${pngPath}`,
    })
  }
}

function searchSummary(data: Record<string, unknown>, hits: unknown[], queries: string[]): string {
  const pageCount = typeof data.page_count === 'number' ? data.page_count : '?'
  const hitCount = typeof data.hit_count === 'number' ? data.hit_count : hits.length
  if (hits.length === 0) {
    return (
      `No matches for ${JSON.stringify(queries)} (${pageCount} PDF pages scanned). ` +
      'Try alternate spellings, shorter tokens, use_ocr: true, or render a known page number.'
    )
  }
  const top = hits[0] as Record<string, unknown>
  const partial =
    hitCount > hits.length ?
      `${hitCount} page(s) matched; showing top ${hits.length} (max_results cap). PDF has ${pageCount} pages total.`
    : `${hits.length} page hit(s). PDF has ${pageCount} pages total.`
  return (
    `${partial} Top hit: page ${String(top.page)}, query "${String(top.matched_query)}". ` +
    'Snippets are often garbled — use for page location; confirm details with vision if needed.'
  )
}

async function resolveToolPdf(
  raw: string,
  ctx?: ExtensionContext,
): Promise<
  | { ok: true; path: string; sourceNote?: string }
  | { ok: false; error: string }
> {
  const resolved = await resolvePdfInput(raw, ctx?.cwd ?? process.cwd())
  if (!resolved.ok) return resolved
  const sourceNote =
    resolved.downloaded ?
      `Downloaded PDF from URL to ${resolved.path}`
    : resolved.source.startsWith('http') ?
      `Using cached PDF for ${resolved.source}`
    : undefined
  return { ok: true, path: resolved.path, sourceNote }
}

export default function piSyloSchematicReaderExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'search_schematic_pdf',
    label: 'Search PDF',
    description:
      'Text search across PDF pages (datasheets, manuals, schematics — optional OCR). ' +
      'pdf_path may be a local path or http(s) URL ending in .pdf. ' +
      'For specific questions use 1–3 targeted queries. render_on_best_hit attaches a page PNG for vision models.',
    parameters: Type.Object({
      pdf_path: Type.String({
        description: 'Local absolute/cwd-relative path OR http(s) URL to a PDF',
      }),
      query: Type.Union([
        Type.String({ description: 'Single search term (tag, cable ID, port label, etc.)' }),
        Type.Array(Type.String(), {
          description: 'Prefer 1–3 targeted terms for specific questions; broader list for sheet survey',
        }),
      ]),
      max_results: Type.Optional(
        Type.Number({ description: 'Max ranked hits returned (default 8)', minimum: 1, maximum: 30 }),
      ),
      use_ocr: Type.Optional(
        Type.Boolean({
          description: 'OCR pages with very little embedded text (pytesseract + Tesseract required)',
        }),
      ),
      render_on_best_hit: Type.Optional(
        Type.Boolean({
          description:
            'When true and there is a hit, also render the top page PNG (default 150 DPI) and attach for vision',
        }),
      ),
      render_dpi: Type.Optional(
        Type.Number({
          description: 'DPI when render_on_best_hit is true (default 150; use 200 for small digits)',
          minimum: 72,
          maximum: 400,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const rawPath = String(params.pdf_path ?? '').trim()
      if (!rawPath) return toolError('search_schematic_pdf requires pdf_path.')

      const resolved = await resolveToolPdf(rawPath, ctx)
      if (!resolved.ok) return toolError(resolved.error)
      const pdfPath = resolved.path

      const queries = Array.isArray(params.query)
        ? params.query.map((q) => String(q).trim()).filter(Boolean)
        : [String(params.query ?? '').trim()].filter(Boolean)
      if (queries.length === 0) return toolError('search_schematic_pdf requires at least one query.')

      const args = ['--query', queries[0]!]
      for (let i = 1; i < queries.length; i++) args.push('--query', queries[i]!)
      if (typeof params.max_results === 'number') args.push('--max-results', String(params.max_results))
      if (params.use_ocr === true) args.push('--use-ocr')
      args.unshift(pdfPath)

      const result = await runPythonScript('search_pdf.py', args)
      if (!result.ok) return toolError(result.error)

      const data = asRecord(result.data)
      if (!data) return toolError('search_pdf returned non-object JSON')
      if (data.error) return toolError(String(data.error))

      const hits = Array.isArray(data.hits) ? data.hits : []
      const content: ToolContentBlock[] = []
      if (resolved.sourceNote) {
        content.push({ type: 'text', text: resolved.sourceNote })
      }
      content.push(
        { type: 'text', text: searchSummary(data, hits, queries) },
        { type: 'text', text: JSON.stringify(result.data, null, 2) },
      )

      if (params.render_on_best_hit === true && hits.length > 0) {
        const top = asRecord(hits[0])
        const page = top ? Number(top.page) : NaN
        if (Number.isFinite(page) && page >= 1) {
          const dpi = resolveRenderDpi(params.render_dpi)
          const rendered = await runRenderPage(pdfPath, Math.floor(page), dpi)
          try {
            if (!rendered.ok) {
              content.push({ type: 'text', text: `Render on best hit failed: ${rendered.error}` })
            } else {
              appendRenderedImage(content, rendered.data, dpi, { ephemeral: Boolean(rendered.ephemeralDir) })
            }
          } finally {
            cleanupEphemeralRenderDir(rendered.ok ? rendered.ephemeralDir : undefined)
          }
        }
      } else if (params.render_on_best_hit === true) {
        content.push({ type: 'text', text: 'render_on_best_hit skipped — no search hits.' })
      } else if (hits.length > 0) {
        content.push({
          type: 'text',
          text: 'Next: answer from snippet if clear, else render_schematic_page or re-run with render_on_best_hit: true.',
        })
      }

      return { content }
    },
  })

  pi.registerTool({
    name: 'render_schematic_page',
    label: 'Render PDF page',
    description:
      'Render one PDF page to PNG for vision (default 150 DPI). pdf_path may be local or http(s) URL. ' +
      'Use after search when you need a specific page or higher resolution.',
    parameters: Type.Object({
      pdf_path: Type.String({ description: 'Local path or http(s) URL to a PDF' }),
      page: Type.Number({ description: '1-based page number', minimum: 1 }),
      dpi: Type.Optional(
        Type.Number({
          description: 'Default 150; use 200 when verifying small wire numbers (6 vs 8, etc.)',
          minimum: 72,
          maximum: 400,
        }),
      ),
      output_dir: Type.Optional(
        Type.String({
          description:
            'Optional directory to keep PNG on disk. Omit for ephemeral temp render (embedded in tool result only).',
        }),
      ),
      include_image: Type.Optional(
        Type.Boolean({
          description: 'When true (default), attach PNG bytes in the tool result for vision-capable models',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const rawPath = String(params.pdf_path ?? '').trim()
      const page = Number(params.page)
      if (!rawPath) return toolError('render_schematic_page requires pdf_path.')
      if (!Number.isFinite(page) || page < 1) return toolError('render_schematic_page requires page >= 1.')

      const resolved = await resolveToolPdf(rawPath, ctx)
      if (!resolved.ok) return toolError(resolved.error)
      const pdfPath = resolved.path

      const dpi = resolveRenderDpi(params.dpi)
      const rendered = await runRenderPage(
        pdfPath,
        Math.floor(page),
        dpi,
        typeof params.output_dir === 'string' ? params.output_dir : undefined,
      )
      if (!rendered.ok) return toolError(rendered.error)

      const includeImage = params.include_image !== false
      const content: ToolContentBlock[] = []
      try {
        if (includeImage) {
          appendRenderedImage(content, rendered.data, dpi, { ephemeral: Boolean(rendered.ephemeralDir) })
        } else {
          content.push({
            type: 'text',
            text: `Rendered page ${page} at ${dpi} DPI (image not attached).`,
          })
          content.push({ type: 'text', text: JSON.stringify(rendered.data, null, 2) })
        }
        return { content }
      } finally {
        cleanupEphemeralRenderDir(rendered.ephemeralDir)
      }
    },
  })

  const BboxSchema = Type.Union([
    Type.Object({
      x0: Type.Number({ description: 'Left edge as fraction of page width (0–1)' }),
      y0: Type.Number({ description: 'Top edge as fraction of page height (0–1)' }),
      x1: Type.Number({ description: 'Right edge as fraction of page width (0–1)' }),
      y1: Type.Number({ description: 'Bottom edge as fraction of page height (0–1)' }),
    }),
    Type.Array(Type.Number(), {
      description: 'Alternate form: [x0, y0, x1, y1] normalized fractions',
      minItems: 4,
      maxItems: 4,
    }),
  ])

  pi.registerTool({
    name: 'render_schematic_region',
    label: 'Render PDF region',
    description:
      'Crop one PDF region to PNG for vision (default 300 DPI). pdf_path may be local or http(s) URL.',
    parameters: Type.Object({
      pdf_path: Type.String({ description: 'Local path or http(s) URL to a PDF' }),
      page: Type.Number({ description: '1-based page number', minimum: 1 }),
      bbox: BboxSchema,
      dpi: Type.Optional(
        Type.Number({
          description: 'Default 300 for region crops; 72–400',
          minimum: 72,
          maximum: 400,
        }),
      ),
      padding: Type.Optional(
        Type.Number({
          description: 'Expand bbox by this fraction on each side (default 0.02)',
          minimum: 0,
          maximum: 0.2,
        }),
      ),
      output_dir: Type.Optional(
        Type.String({
          description:
            'Optional directory to keep PNG on disk. Omit for ephemeral temp render (embedded in tool result only).',
        }),
      ),
      include_image: Type.Optional(
        Type.Boolean({
          description: 'When true (default), attach PNG bytes in the tool result for vision-capable models',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const rawPath = String(params.pdf_path ?? '').trim()
      const page = Number(params.page)
      if (!rawPath) return toolError('render_schematic_region requires pdf_path.')
      if (!Number.isFinite(page) || page < 1) {
        return toolError('render_schematic_region requires page >= 1.')
      }

      const resolved = await resolveToolPdf(rawPath, ctx)
      if (!resolved.ok) return toolError(resolved.error)
      const pdfPath = resolved.path

      const bbox = parseRegionBbox(params.bbox)
      if (!bbox) {
        return toolError(
          'render_schematic_region requires bbox as {x0,y0,x1,y1} or [x0,y0,x1,y1] with values in 0–1.',
        )
      }

      const dpi = resolveRenderDpi(params.dpi ?? DEFAULT_REGION_DPI)
      const padding =
        typeof params.padding === 'number' && Number.isFinite(params.padding) ?
          Math.min(0.2, Math.max(0, params.padding))
        : DEFAULT_REGION_PADDING

      const rendered = await runRenderRegion(
        pdfPath,
        Math.floor(page),
        bbox,
        dpi,
        padding,
        typeof params.output_dir === 'string' ? params.output_dir : undefined,
      )
      if (!rendered.ok) return toolError(rendered.error)

      const includeImage = params.include_image !== false
      const content: ToolContentBlock[] = []
      try {
        if (includeImage) {
          appendRenderedImage(content, rendered.data, dpi, {
            kind: 'region',
            ephemeral: Boolean(rendered.ephemeralDir),
          })
        } else {
          content.push({
            type: 'text',
            text: `Rendered region on page ${page} at ${dpi} DPI (image not attached).`,
          })
          content.push({ type: 'text', text: JSON.stringify(rendered.data, null, 2) })
        }
        return { content }
      } finally {
        cleanupEphemeralRenderDir(rendered.ephemeralDir)
      }
    },
  })

  pi.registerTool({
    name: 'ocr_schematic_region',
    label: 'OCR PDF region',
    description:
      'Run Tesseract OCR on a cropped PDF region. pdf_path may be local or http(s) URL.',
    parameters: Type.Object({
      pdf_path: Type.String({ description: 'Local path or http(s) URL to a PDF' }),
      page: Type.Number({ description: '1-based page number', minimum: 1 }),
      bbox: BboxSchema,
      dpi: Type.Optional(
        Type.Number({
          description: 'Default 300 for OCR crops; 72–400',
          minimum: 72,
          maximum: 400,
        }),
      ),
      padding: Type.Optional(
        Type.Number({
          description: 'Expand bbox by this fraction on each side (default 0.02)',
          minimum: 0,
          maximum: 0.2,
        }),
      ),
      queries: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Optional filter — highlight tokens matching wire/tag numbers (e.g. ["1242", "S-"])',
        }),
      ),
      min_confidence: Type.Optional(
        Type.Number({
          description: 'Drop OCR tokens below this confidence (default 30)',
          minimum: 0,
          maximum: 100,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const rawPath = String(params.pdf_path ?? '').trim()
      const page = Number(params.page)
      if (!rawPath) return toolError('ocr_schematic_region requires pdf_path.')
      if (!Number.isFinite(page) || page < 1) {
        return toolError('ocr_schematic_region requires page >= 1.')
      }

      const resolved = await resolveToolPdf(rawPath, ctx)
      if (!resolved.ok) return toolError(resolved.error)
      const pdfPath = resolved.path

      const bbox = parseRegionBbox(params.bbox)
      if (!bbox) {
        return toolError(
          'ocr_schematic_region requires bbox as {x0,y0,x1,y1} or [x0,y0,x1,y1] with values in 0–1.',
        )
      }

      const dpi = resolveRenderDpi(params.dpi ?? DEFAULT_REGION_DPI)
      const padding =
        typeof params.padding === 'number' && Number.isFinite(params.padding) ?
          Math.min(0.2, Math.max(0, params.padding))
        : DEFAULT_REGION_PADDING
      const queries = Array.isArray(params.queries) ?
        params.queries.map((q) => String(q).trim()).filter(Boolean)
      : []
      const minConfidence =
        typeof params.min_confidence === 'number' && Number.isFinite(params.min_confidence) ?
          Math.min(100, Math.max(0, Math.floor(params.min_confidence)))
        : 30

      const ocr = await runOcrRegion(pdfPath, Math.floor(page), bbox, dpi, padding, queries, minConfidence)
      if (!ocr.ok) return toolError(ocr.error)

      const content: ToolContentBlock[] = [
        { type: 'text', text: ocrRegionSummary(ocr.data, queries) },
        { type: 'text', text: JSON.stringify(ocr.data, null, 2) },
      ]
      return { content }
    },
  })
}
