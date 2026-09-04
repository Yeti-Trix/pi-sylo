---
name: spreadsheet
description: Read .xlsx/.ods as JSON and create .xlsx workbooks with data and native charts via read_spreadsheet / write_spreadsheet.
metadata:
  sylo:
    category: documents
    icon: table
---

# Spreadsheet reader + writer

Use **`read_spreadsheet`** to read **`.xlsx`** and **`.ods`**, and **`write_spreadsheet`** to **create `.xlsx`** workbooks with data and native Excel charts. For **`.csv`**, use Pi **`read`** (plain text is enough); there is no `.csv` writer.

## Tools

| Tool | When |
|------|------|
| `read_spreadsheet` | Operator attached/referenced an existing workbook; you need tabular data |
| `write_spreadsheet` | Operator asked you to create an Excel file, export a table, or build a chart |

## read_spreadsheet

1. **Confirm path** — extension must be `.xlsx` or `.ods`.
2. **Pick sheet** — omit for first sheet; use name or 1-based index when named.
3. **Bound output** — default **200** data rows after the header row; raise `max_rows` or use `range` (`B2:F100`) for wide sheets.
4. **Answer from JSON** — `headers` + `rows`; cite sheet name. If `truncated: true`, say so and offer a narrower range.

Parameters: `max_rows` (default 200, max 5000), `range` (A1 notation), `include_formulas` (xlsx only).

```json
{
  "path": "C:/Projects/bom.xlsx",
  "sheet": "Parts",
  "max_rows": 100,
  "range": "A1:H150"
}
```

## write_spreadsheet

Create/overwrite a `.xlsx` workbook. Pass a **workbook definition** (JSON) with `sheets` (required) and optional `charts`.

### Sheets

Each sheet object:

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Tab name |
| `title` | no | Bold title written in row 1 |
| `headers` | no | Bold header row |
| `rows` | yes | List of rows; each row is a list of cell values (`string`/`number`/`boolean`/`null`) |
| `column_widths` | no | Excel width units |
| `freeze_header` | no | Freeze panes at row after header (bool) |
| `auto_filter` | no | Enable auto-filter dropdowns on header row (bool) |

> When a `title` is present, the header row is written three rows down (title row, blank, headers). Compute chart ranges accordingly (see example below).

### Charts (native Excel — bar, line, pie, scatter)

Each chart object:

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `bar`, `line`, `pie`, or `scatter` |
| `sheet` | yes | Sheet name containing the data (and where the chart anchors) |
| `series` | yes | List of series. `bar`/`line`/`pie` use `values`; `scatter` uses `x` + `y`. Optional `name` per series (legend label). |
| `categories` | no (bar/line/pie) | A1 range of category labels, e.g. `A2:A10` |
| `title`, `x_axis_title`, `y_axis_title` | no | `x/y` axis titles ignored for pie |
| `anchor` | no | A1 cell to anchor the chart, e.g. `H2`. Default: two columns right of used data. |
| `width_cm`, `height_cm` | no | Defaults 15 / 8 |

Ranges are A1 and must match cells you wrote in the same sheet.

### Example — sheet + bar chart

```json
{
  "path": "C:/Projects/q1.xlsx",
  "overwrite": true,
  "sheets": [
    {
      "name": "Sales",
      "title": "Q1 Sales by Month",
      "headers": ["Month", "Revenue", "Cost"],
      "rows": [
        ["Jan", 1000, 600],
        ["Feb", 1200, 650],
        ["Mar", 1500, 700]
      ],
      "column_widths": [12, 12, 12],
      "freeze_header": true,
      "auto_filter": true
    }
  ],
  "charts": [
    {
      "type": "bar",
      "sheet": "Sales",
      "title": "Revenue vs Cost",
      "categories": "A4:A6",
      "series": [
        { "name": "Revenue", "values": "B4:B6" },
        { "name": "Cost", "values": "C4:C6" }
      ],
      "x_axis_title": "Month",
      "y_axis_title": "USD",
      "anchor": "E4"
    }
  ]
}
```

> Title in row 1 → blank row 2 → headers in row 3 → data rows 4–6, so categories/series ranges start at row 4. If you omit `title`, headers land in row 1 and data starts at row 2.

### Example — scatter chart

```json
{
  "type": "scatter",
  "sheet": "Runs",
  "title": "Y over X",
  "series": [ { "name": "Run", "x": "A2:A6", "y": "B2:B6" } ],
  "x_axis_title": "X",
  "y_axis_title": "Y"
}
```

## Rules

- **Overwrite safety:** `write_spreadsheet` refuses to clobber an existing file unless `overwrite: true`. Set it when the operator is regenerating a report.
- **One tool call per workbook.** Build the whole definition (all sheets + charts) in one `write_spreadsheet` call; there is no incremental append tool.
- **Chart ranges must point at cells you wrote.** Compute row offsets from `title`/`headers` placement (title adds 2 rows before headers).
- **Do not** read the same huge sheet repeatedly with rising `max_rows` — narrow `range` or ask which section matters.
- Legacy **`.xls`** is unsupported — ask for xlsx/ods/csv export.