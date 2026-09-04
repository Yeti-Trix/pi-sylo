# sylo-spreadsheet

Read **`.xlsx`** and **`.ods`** as structured JSON (`read_spreadsheet`) and **create `.xlsx`** workbooks with data and native Excel charts (`write_spreadsheet`).

## Install

1. **Sylo → Capability manager → Sylo optional packages** → turn **Spreadsheet** **On** (installs `openpyxl` + `odfpy` via pip)
2. **Restart broker**
3. Once from dev repo: `npm run bootstrap-pi` (copies `spreadsheet` skill to `~/.pi/agent/skills`)

## Tools

- **`read_spreadsheet`** — sheet names, headers, rows; default **200** data rows; optional A1 `range`
- **`write_spreadsheet`** — create/overwrite a `.xlsx` from a workbook definition (sheets + optional charts). Refuses to clobber an existing file unless `overwrite: true`.

## Formats

| Format | Support |
|--------|---------|
| `.xlsx` | Read + Write (with charts) |
| `.ods` | Read only |
| `.csv` | Use Pi `read` (no tool here) |
| `.xls` | Not supported |

## Charts (write_spreadsheet)

Native Excel charts via openpyxl, embedded in any sheet:

- **bar** / **line** / **pie** — `categories` (A1 range) + `series[].values`
- **scatter** — `series[].x` + `series[].y`

Optional `title`, `x_axis_title`, `y_axis_title`, `anchor` (A1 cell, default: right of data), `width_cm`/`height_cm`. See the `spreadsheet` skill for the full schema and examples.

## Publish (later)

```bash
npm publish --access public
pi install npm:sylo-spreadsheet
```