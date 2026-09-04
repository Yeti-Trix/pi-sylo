import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

const execFileAsync = promisify(execFile)

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS_DIR = path.join(PACKAGE_ROOT, 'scripts')
const DEFAULT_MAX_PARAGRAPHS = 400

type ToolContentBlock = { type: 'text'; text: string }

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

function readSummary(data: Record<string, unknown>): string {
  const title = String(data.title_guess ?? '?')
  const headings = Array.isArray(data.headings) ? data.headings.length : 0
  const tables = typeof data.table_count === 'number' ? data.table_count : 0
  const images = typeof data.image_ref_count === 'number' ? data.image_ref_count : 0
  const chars = typeof data.char_count === 'number' ? data.char_count : 0
  const strict = data.converted_from_strict === true ? ' (Strict OOXML, converted in memory)' : ''
  const truncNote =
    data.truncated === true
      ? ` Truncated — re-run with offset=${String(data.next_offset ?? '?')} for the rest.`
      : ''
  return (
    `Read "${title}"${strict}: ${headings} heading(s), ${tables} table(s), ` +
    `${images} inline image ref(s), ${chars} chars.${truncNote} ` +
    `[image: imageN.ext] markers in paragraphs match extract_docx_images media names.`
  )
}

function renderSummary(data: Record<string, unknown>): string {
  const out = String(data.output_path ?? '?')
  const version = String(data.pandoc_version ?? '?')
  const ref = String(data.reference_doc ?? '?')
  const warnings = typeof data.warnings === 'string' && data.warnings.trim() ? data.warnings.trim() : ''
  const warnNote = warnings ? ` Pandoc warnings: ${warnings.slice(0, 200)}` : ''
  return (
    `Rendered Word document to ${out} (Pandoc ${version}, reference ${ref}).` +
    ` Run read_docx on the output to verify headings, tables, and images.${warnNote}`
  )
}

export default function piSyloDocxExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'read_docx',
    label: 'Read Word document',
    description:
      'Read a .docx as structured JSON: title_guess, headings outline, paragraphs in document order ' +
      '(with [image: imageN.ext] markers where pictures sit), tables_summary, char_count. Read-only; ' +
      'handles Strict OOXML without touching the source file. Use extract_docx_images to pull the pictures.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or cwd-relative path to a .docx' }),
      max_paragraphs: Type.Optional(
        Type.Number({
          description: `Max non-empty paragraphs returned (default ${DEFAULT_MAX_PARAGRAPHS})`,
          minimum: 1,
          maximum: 5000,
        }),
      ),
      offset: Type.Optional(
        Type.Number({
          description: 'Body block index to resume from (next_offset of a truncated read)',
          minimum: 0,
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const filePath = String(params.path ?? '').trim()
      if (!filePath) return toolError('read_docx requires path.')

      const args = [filePath]
      if (typeof params.max_paragraphs === 'number' && Number.isFinite(params.max_paragraphs)) {
        args.push('--max-paragraphs', String(Math.min(5000, Math.max(1, Math.floor(params.max_paragraphs)))))
      }
      if (typeof params.offset === 'number' && Number.isFinite(params.offset) && params.offset > 0) {
        args.push('--offset', String(Math.floor(params.offset)))
      }

      const result = await runPythonScript('read_docx.py', args)
      if (!result.ok) return toolError(result.error)

      const data = asRecord(result.data)
      if (!data) return toolError('read_docx returned non-object JSON')
      if (data.error) return toolError(String(data.error))

      return {
        content: [
          { type: 'text', text: readSummary(data) },
          { type: 'text', text: JSON.stringify(result.data, null, 2) },
        ],
      }
    },
  })

  pi.registerTool({
    name: 'extract_docx_images',
    label: 'Extract Word document images',
    description:
      'Extract embedded pictures from a .docx. Each image is annotated with its body anchor ' +
      '(block_index matching read_docx paragraph indexes), caption_guess, context_text, and alt_text. ' +
      'Default: OS temp (pruned after 24h). Pass output_dir to keep files in a project folder.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or cwd-relative path to a .docx' }),
      output_dir: Type.Optional(
        Type.String({
          description: 'Destination folder to keep extracted images (created if missing)',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const filePath = String(params.path ?? '').trim()
      if (!filePath) return toolError('extract_docx_images requires path.')

      const args = [filePath]
      const outDir = String(params.output_dir ?? '').trim()
      if (outDir) args.push('--output-dir', outDir)

      const result = await runPythonScript('extract_docx_images.py', args)
      if (!result.ok) return toolError(result.error)

      const data = asRecord(result.data)
      if (!data) return toolError('extract_docx_images returned non-object JSON')
      if (data.error) return toolError(String(data.error))

      const count = typeof data.image_count === 'number' ? data.image_count : 0
      const referenced = typeof data.referenced_count === 'number' ? data.referenced_count : 0
      const ephemeral = data.ephemeral === true
      const destNote =
        ephemeral ?
          `Extracted ${count} image(s) (${referenced} referenced in body text) to OS temp (${String(data.output_dir ?? '?')}; auto-pruned after 24h unless output_dir was set).`
        : `Extracted ${count} image(s) (${referenced} referenced in body text) to ${String(data.output_dir ?? '?')}.`
      return {
        content: [
          {
            type: 'text',
            text:
              `${destNote} ` +
              `Use block_index + caption_guess to match pictures to read_docx paragraphs.`,
          },
          { type: 'text', text: JSON.stringify(result.data, null, 2) },
        ],
      }
    },
  })

  pi.registerTool({
    name: 'render_docx',
    label: 'Render Word document from markdown',
    description:
      'Create or replace a .docx from markdown using Pandoc and a reference style template. ' +
      'Author the full document as markdown first, then render. Styling comes from reference.docx ' +
      '(shipped default or pass reference_doc). Requires Pandoc on the PC. Verify with read_docx.',
    parameters: Type.Object({
      markdown: Type.Optional(
        Type.String({ description: 'Full markdown content (use markdown_path for long docs)' }),
      ),
      markdown_path: Type.Optional(
        Type.String({ description: 'Path to a .md file (preferred when the source is saved on disk)' }),
      ),
      output_path: Type.String({ description: 'Destination .docx path' }),
      reference_doc: Type.Optional(
        Type.String({ description: 'Custom reference .docx for fonts/styles (default: package template)' }),
      ),
      toc: Type.Optional(Type.Boolean({ description: 'Include table of contents (F9 in Word to refresh)' })),
      number_sections: Type.Optional(Type.Boolean({ description: 'Number section headings' })),
      overwrite: Type.Optional(
        Type.Boolean({ description: 'Replace output_path if it exists (default false)' }),
      ),
    }),
    async execute(_toolCallId, params) {
      const outputPath = String(params.output_path ?? '').trim()
      if (!outputPath) return toolError('render_docx requires output_path.')

      const markdownPath = String(params.markdown_path ?? '').trim()
      const markdown = typeof params.markdown === 'string' ? params.markdown : ''
      if (!markdownPath && !markdown.trim()) {
        return toolError('render_docx requires markdown or markdown_path.')
      }

      let tempMd: string | undefined
      const args = ['--output', outputPath]

      if (markdownPath) {
        args.push('--markdown-path', markdownPath)
      } else {
        tempMd = path.join(os.tmpdir(), `sylo-docx-${Date.now()}-${process.pid}.md`)
        fs.writeFileSync(tempMd, markdown, 'utf8')
        args.push('--markdown-path', tempMd)
      }

      const refDoc = String(params.reference_doc ?? '').trim()
      if (refDoc) args.push('--reference-doc', refDoc)
      if (params.toc === true) args.push('--toc')
      if (params.number_sections === true) args.push('--number-sections')
      if (params.overwrite === true) args.push('--overwrite')

      try {
        const result = await runPythonScript('render_docx.py', args)
        if (!result.ok) return toolError(result.error)

        const data = asRecord(result.data)
        if (!data) return toolError('render_docx returned non-object JSON')
        if (data.error) {
          const hint =
            typeof data.install_hint === 'string' ? `\n${data.install_hint}` : ''
          return toolError(`${String(data.error)}${hint}`)
        }

        return {
          content: [
            { type: 'text', text: renderSummary(data) },
            { type: 'text', text: JSON.stringify(result.data, null, 2) },
          ],
        }
      } finally {
        if (tempMd) {
          try {
            fs.unlinkSync(tempMd)
          } catch {
            /* ignore */
          }
        }
      }
    },
  })
}
