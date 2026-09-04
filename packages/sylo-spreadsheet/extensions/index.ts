import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

const execFileAsync = promisify(execFile)

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS_DIR = path.join(PACKAGE_ROOT, 'scripts')
const DEFAULT_MAX_ROWS = 200

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

/** Run a Python script with a JSON document piped to stdin. */
async function runPythonScriptWithStdin(
  scriptName: string,
  args: string[],
  stdinJson: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  try {
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
      (resolve) => {
        const child = spawn(resolvePython(), [scriptPath, ...args], {
          cwd: PACKAGE_ROOT,
          windowsHide: true,
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => (stdout += d.toString()))
        child.stderr.on('data', (d) => (stderr += d.toString()))
        child.on('error', (err) =>
          resolve({ stdout, stderr: stderr + String(err), code: -1 }),
        )
        child.on('close', (code) => resolve({ stdout, stderr, code }))
        child.stdin.on('error', () => undefined)
        child.stdin.end(stdinJson)
      },
    )
    const trimmed = result.stdout.trim()
    if (!trimmed) {
      return {
        ok: false,
        error:
          (result.stderr.trim() || `${scriptName} produced no output`) +
          (result.code ? ` (exit ${result.code})` : ''),
      }
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

function toolError(text: string): { content: ToolContentBlock[]; details: undefined } {
  return { content: [{ type: 'text', text }], details: undefined }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function resolveMaxRows(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(5000, Math.max(1, Math.floor(raw)))
  }
  return DEFAULT_MAX_ROWS
}

function readSummary(data: Record<string, unknown>): string {
  const sheet = String(data.sheet ?? '?')
  const format = String(data.format ?? '?')
  const names = Array.isArray(data.sheet_names) ? data.sheet_names : []
  const truncated = data.truncated === true
  const dims = asRecord(data.dimensions)
  const returned = dims && typeof dims.returned_rows === 'number' ? dims.returned_rows : '?'
  const total =
    dims && typeof dims.total_rows_in_range === 'number' ? dims.total_rows_in_range : '?'
  const truncNote = truncated ? ` Truncated (${returned}/${total} rows in range). Raise max_rows or narrow range.` : ''
    return (
    `Read ${format.toUpperCase()} sheet "${sheet}" (${names.length} sheet(s) in workbook).` +
    `${truncNote} Use headers + rows JSON below; for .csv use Pi read instead.`
  )
}

function writeSummary(data: Record<string, unknown>): string {
  const sheets = typeof data.sheets === 'number' ? data.sheets : '?'
  const charts = typeof data.charts === 'number' ? data.charts : 0
  const names = Array.isArray(data.sheet_names) ? data.sheet_names : []
  const overwrote = data.overwrote === true
  const p = String(data.path ?? '?')
  return (
    `Created .xlsx workbook at ${p} (${sheets} sheet(s): ${names.join(', ')}; ${charts} chart(s)).` +
    `${overwrote ? ' Replaced an existing file.' : ''} Open with Excel/LibreOffice to view.`
  )
}

export default function piSyloSpreadsheetExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'read_spreadsheet',
    label: 'Read spreadsheet',
        description:
      'Read .xlsx or .ods as structured JSON (sheet names, headers, rows). Default max 200 data rows. ' +
      'Use Pi read for .csv. To create .xlsx files use write_spreadsheet.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or cwd-relative path to .xlsx or .ods' }),
      sheet: Type.Optional(
        Type.Union([
          Type.String({ description: 'Sheet name' }),
          Type.Number({ description: '1-based sheet index', minimum: 1 }),
        ]),
      ),
      max_rows: Type.Optional(
        Type.Number({
          description: `Max data rows after header (default ${DEFAULT_MAX_ROWS})`,
          minimum: 1,
          maximum: 5000,
        }),
      ),
      range: Type.Optional(
        Type.String({ description: 'Optional A1 range, e.g. B2:F50 (limits columns and rows)' }),
      ),
      include_formulas: Type.Optional(
        Type.Boolean({
          description: 'When true, return formula strings for xlsx instead of cached values (default false)',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const filePath = String(params.path ?? '').trim()
      if (!filePath) return toolError('read_spreadsheet requires path.')

      const args: string[] = []
      if (params.sheet !== undefined && params.sheet !== null) {
        args.push('--sheet', String(params.sheet))
      }
      const maxRows = resolveMaxRows(params.max_rows)
      args.push('--max-rows', String(maxRows))
      if (typeof params.range === 'string' && params.range.trim()) {
        args.push('--range', params.range.trim())
      }
      if (params.include_formulas === true) args.push('--include-formulas')
      args.unshift(filePath)

      const result = await runPythonScript('read_spreadsheet.py', args)
      if (!result.ok) return toolError(result.error)

      const data = asRecord(result.data)
      if (!data) return toolError('read_spreadsheet returned non-object JSON')
      if (data.error) return toolError(String(data.error))

            return {
        content: [
          { type: 'text', text: readSummary(data) },
          { type: 'text', text: JSON.stringify(result.data, null, 2) },
        ],
        details: undefined,
      }
    },
  })

  pi.registerTool({
    name: 'write_spreadsheet',
    label: 'Create spreadsheet',
    description:
      'Create or overwrite an .xlsx workbook with one or more sheets of data and optional native Excel ' +
      'charts (bar/column, line, pie, scatter). Pass a workbook definition as JSON. Output path must end ' +
      'with .xlsx. Refuses to overwrite an existing file unless overwrite=true.',
    parameters: Type.Object({
      path: Type.String({ description: 'Output .xlsx path (absolute or cwd-relative). Must end with .xlsx' }),
      overwrite: Type.Optional(
        Type.Boolean({
          description: 'When true, replace an existing file at path. Default false (refuses to clobber).',
        }),
      ),
      sheets: Type.Array(
        Type.Object({
          name: Type.String({ description: 'Sheet tab name' }),
          title: Type.Optional(
            Type.String({ description: 'Optional title written in row 1 above the headers' }),
          ),
          headers: Type.Optional(
            Type.Array(Type.String(), { description: 'Optional header row (bolded)' }),
          ),
          rows: Type.Array(
            Type.Array(Type.Any()),
            { description: 'Data rows; each row is a list of cell values (string/number/boolean/null)' },
          ),
          column_widths: Type.Optional(
            Type.Array(Type.Number(), { description: 'Optional column widths in Excel width units' }),
          ),
          freeze_header: Type.Optional(
            Type.Boolean({ description: 'Freeze panes at the row after the header (default false)' }),
          ),
          auto_filter: Type.Optional(
            Type.Boolean({ description: 'Enable auto-filter dropdowns on the header row (default false)' }),
          ),
        }),
        { description: 'Sheets to create (at least one). The first sheet is the active sheet.' },
      ),
      charts: Type.Optional(
        Type.Array(
          Type.Object({
            type: Type.Union([Type.Literal('bar'), Type.Literal('line'), Type.Literal('pie'), Type.Literal('scatter')], {
              description: 'Chart type',
            }),
            sheet: Type.String({ description: 'Sheet name where the data lives and where the chart anchors' }),
            title: Type.Optional(Type.String({ description: 'Optional chart title' })),
            anchor: Type.Optional(
              Type.String({ description: 'A1 cell to anchor the chart, e.g. H2. Default: right of data.' }),
            ),
            width_cm: Type.Optional(Type.Number({ description: 'Chart width in cm (default 15)' })),
            height_cm: Type.Optional(Type.Number({ description: 'Chart height in cm (default 8)' })),
            x_axis_title: Type.Optional(
              Type.String({ description: 'X axis title (ignored for pie charts)' }),
            ),
            y_axis_title: Type.Optional(
              Type.String({ description: 'Y axis title (ignored for pie charts)' }),
            ),
            categories: Type.Optional(
              Type.String({
                description: 'A1 range of category labels, e.g. A2:A10 (bar/line/pie only)',
              }),
            ),
            series: Type.Array(
              Type.Object({
                name: Type.Optional(Type.String({ description: 'Series name (legend label)' })),
                values: Type.Optional(
                  Type.String({
                    description: 'A1 range of values, e.g. B2:B10 (bar/line/pie series)',
                  }),
                ),
                x: Type.Optional(
                  Type.String({ description: 'A1 range of x values, e.g. A2:A10 (scatter series)' }),
                ),
                y: Type.Optional(
                  Type.String({ description: 'A1 range of y values, e.g. B2:B10 (scatter series)' }),
                ),
              }),
              { description: 'Chart series. bar/line/pie use values; scatter uses x + y.' },
            ),
          }),
          { description: 'Optional native Excel charts to embed in sheets' },
        ),
      ),
    }),
    async execute(_toolCallId, params) {
      const outPath = String(params.path ?? '').trim()
      if (!outPath) return toolError('write_spreadsheet requires path.')
      if (!/\.xlsx$/i.test(outPath))
        return toolError('write_spreadsheet path must end with .xlsx')
      if (!Array.isArray(params.sheets) || params.sheets.length === 0)
        return toolError('write_spreadsheet requires at least one sheet.')

      const definition = {
        path: outPath,
        overwrite: params.overwrite === true,
        sheets: params.sheets,
        charts: Array.isArray(params.charts) ? params.charts : [],
      }

      const result = await runPythonScriptWithStdin('write_spreadsheet.py', [], JSON.stringify(definition))
      if (!result.ok) return toolError(result.error)

      const data = asRecord(result.data)
      if (!data) return toolError('write_spreadsheet returned non-object JSON')
      if (data.error) return toolError(String(data.error))

      return {
        content: [
          { type: 'text', text: writeSummary(data) },
          { type: 'text', text: JSON.stringify(result.data, null, 2) },
        ],
        details: undefined,
      }
    },
  })
}
