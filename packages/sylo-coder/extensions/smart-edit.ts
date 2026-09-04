/**
 * smart-edit — deterministic fuzzy/whitespace-tolerant file edit for sylo-coder.
 *
 * Design goals (see features_tracker/active/2026-07-21_14-30-00_sylo_coder_package.md):
 *   - Match Pi's `edit` semantics when oldText is an exact unique substring.
 *   - Tolerate whitespace/indentation drift via a normalized-text match that maps
 *     back to original offsets (so we splice the real bytes, not normalized ones).
 *   - NEVER blind-apply an ambiguous match. On multiple candidates, return them so
 *     the agent can disambiguate by including more surrounding context in oldText.
 *   - On no match, return the closest region we found so the agent can `read` it
 *     and retry with exact text. Fail closed; do not guess.
 *   - Multi-block: `smartEditMany` applies N disjoint edits in one call, each
 *     matched against the ORIGINAL file (not incrementally) — parity with Pi
 *     `edit`'s `edits[]`. Non-overlapping; all-or-nothing (one bad edit refuses
 *     the whole call and leaves the file untouched, so the agent never gets a
 *     half-applied file).
 *
 * Non-goals for Phase 1: AST-aware node matching (TS/JS/Python/ST). The normalized
 * match covers the dominant real-world failure (indent drift). AST mode is a
 * Phase 1.5 stretch — the extension point is `matchMode` in the result.
 */
import { readFileSync, writeFileSync } from 'node:fs'

export type SmartEditOptions = {
  /** Allow normalized (whitespace-tolerant) matching when exact match fails. Default true. */
  allowFuzzy?: boolean
  /** Minimum normalized-token Jaccard similarity for the "best candidate" hint on no match. Default 0.6. */
  minSimilarityHint?: number
  /** Max candidate regions to report on ambiguity. Default 5. */
  maxCandidates?: number
}

export type LineRange = { startLine: number; endLine: number }

export type SmartEditCandidate = {
  lineRange: LineRange
  /** A short snippet of the matched region (first 2 lines, truncated). */
  preview: string
  matchMode: 'exact' | 'normalized'
  /** Nearest named scope header above the candidate (e.g. `function bar`), so the
   * agent can disambiguate by name without a separate read. Undefined if no
   * named header is found within the lookback window. */
  enclosingScope?: { label: string; line: number }
}

export type SmartEditResult =
  | {
      ok: true
      applied: true
      matchMode: 'exact' | 'normalized'
      lineRange: LineRange
      /** First ~6 lines of the updated file region, for the agent to verify. */
      preview: string
      bytesWritten: number
    }
  | {
      ok: true
      applied: false
      reason: 'ambiguous'
      matchMode: 'exact' | 'normalized'
      candidates: SmartEditCandidate[]
    }
  | {
      ok: false
      error: string
      /** Closest region we could find, to help the agent re-read and retry. */
      bestCandidate?: { lineRange: LineRange; preview: string; similarity: number }
    }

/** A single edit pair for multi-block application. */
export type EditPair = { oldText: string; newText: string }

/** Per-edit outcome in a successful multi-block apply (input order). */
export type AppliedEdit = { matchMode: 'exact' | 'normalized'; lineRange: LineRange }

export type SmartEditManyResult =
  | {
      ok: true
      applied: true
      /** Per-edit outcome, in input order. */
      edits: AppliedEdit[]
      /** First ~6 lines of the first changed region in the updated file. */
      preview: string
      bytesWritten: number
    }
  | {
      ok: true
      applied: false
      /** Which edit (0-based index) blocked the call and why. File is untouched. */
      reason: 'ambiguous' | 'nomatch'
      editIndex: number
      matchMode: 'exact' | 'normalized'
      candidates?: SmartEditCandidate[]
      bestCandidate?: { lineRange: LineRange; preview: string; similarity: number }
    }
  | {
      ok: false
      error: string
      /** 0-based index of the edit that failed validation, when applicable. */
      editIndex?: number
      bestCandidate?: { lineRange: LineRange; preview: string; similarity: number }
    }

/** Collapse every run of whitespace to a single space and return a position map. */
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = ''
  const map: number[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      normalized += ' '
      map.push(i) // normalized char maps to the first whitespace char of the run
      while (i < text.length && /\s/.test(text[i])) i++
    } else {
      normalized += ch.toLowerCase()
      map.push(i)
      i++
    }
  }
  return { normalized, map }
}

/** 1-based line number for a character offset. */
function lineOf(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

/** Find all start offsets of needle in haystack. */
function findAll(haystack: string, needle: string): number[] {
  const positions: number[] = []
  if (!needle) return positions
  let from = 0
  let idx = haystack.indexOf(needle, from)
  while (idx !== -1) {
    positions.push(idx)
    from = idx + 1
    if (from >= haystack.length) break
    idx = haystack.indexOf(needle, from)
  }
  return positions
}

/** Build a short preview of a line range from file text (1-based line args). */
function previewLines(text: string, startLine: number, endLine: number, maxLines = 4): string {
  const lines = text.split('\n')
  const start = Math.max(0, startLine - 1)
  const end = Math.min(lines.length, endLine)
  const slice = lines.slice(start, end)
  const trimmed = slice.slice(0, maxLines).map((l) => (l.length > 120 ? l.slice(0, 117) + '...' : l))
  const suffix = slice.length > maxLines ? `\n... (+${slice.length - maxLines} more lines)` : ''
  return trimmed.join('\n') + suffix
}

/** Token Jaccard similarity between two text blocks (whitespace split, lowercased). */
function jaccard(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const sb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (sa.size === 0 && sb.size === 0) return 1
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}

/**
 * Slide a window the size of oldText's line count over the file and find the
 * region with the highest token overlap. Used only to produce a "best candidate"
 * hint when exact and normalized matching both fail.
 */
function bestFuzzyRegion(fileText: string, oldText: string): {
  lineRange: LineRange
  preview: string
  similarity: number
} | null {
  const fileLines = fileText.split('\n')
  const oldLines = oldText.split('\n').filter((l) => l.trim().length > 0)
  if (oldLines.length === 0 || fileLines.length === 0) return null
  const windowSize = Math.max(1, oldLines.length)
  let best = -1
  let bestStart = -1
  for (let i = 0; i + windowSize <= fileLines.length; i++) {
    const block = fileLines.slice(i, i + windowSize).join('\n')
    const sim = jaccard(block, oldText)
    if (sim > best) {
      best = sim
      bestStart = i
    }
  }
  if (bestStart < 0) return null
  return {
    lineRange: { startLine: bestStart + 1, endLine: bestStart + windowSize },
    preview: previewLines(fileText, bestStart + 1, bestStart + windowSize),
    similarity: best,
  }
}

/**
 * Classify a source line as a named scope header (function/class/const/def/FB…).
 * Returns a short label like `function bar` or null if the line is not a named
 * declaration header. Conservative — false negatives just mean no annotation;
 * false positives are cosmetic noise, not errors. Covers TS/JS/Python/ST.
 */
function scopeLabel(line: string): string | null {
  const s = line.trim()
  if (!s) return null
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?function\s+(\w+)/))) return `function ${m[1]}`
  if ((m = s.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/))) return `class ${m[1]}`
  if ((m = s.match(/^(?:export\s+)?(const|let|var)\s+(\w+)\s*=/))) return `${m[1]} ${m[2]}`
  if ((m = s.match(/^(?:async\s+)?def\s+(\w+)/))) return `def ${m[1]}`
  if ((m = s.match(/^class\s+(\w+)/))) return `class ${m[1]}`
  if ((m = s.match(/^(FUNCTION_BLOCK|FUNCTION|METHOD|ACTION|PROGRAM)\s+(\w+)/i))) return `${m[1].toUpperCase()} ${m[2]}`
  return null
}

/**
 * Walk upward from the line above a candidate's start line to find the nearest
 * named scope header. Used to annotate ambiguous candidates so the agent can
 * disambiguate by name without a separate read.
 */
function findEnclosingScope(fileText: string, startLine1Based: number): { label: string; line: number } | null {
  const lines = fileText.split('\n')
  const from = startLine1Based - 2 // 0-based index of the line above the candidate
  const maxLookback = 200
  for (let i = from; i >= 0 && i >= from - maxLookback; i--) {
    const label = scopeLabel(lines[i])
    if (label) return { label, line: i + 1 }
  }
  return null
}

/** Outcome of locating one oldText within the file text. Pure — no I/O. */
type LocateOutcome =
  | { kind: 'matched'; startOrig: number; endOrig: number; matchMode: 'exact' | 'normalized' }
  | { kind: 'ambiguous'; matchMode: 'exact' | 'normalized'; candidates: SmartEditCandidate[] }
  | { kind: 'nomatch'; bestCandidate?: { lineRange: LineRange; preview: string; similarity: number } }

/**
 * Locate one oldText in fileText: exact unique match first, then a single
 * normalized (whitespace-tolerant) match. Returns the matched byte range in the
 * ORIGINAL file, or ambiguity/no-match diagnostics. Shared by single- and
 * multi-block paths so their matching semantics are identical.
 */
function locateEdit(fileText: string, oldText: string, opts: SmartEditOptions): LocateOutcome {
  const allowFuzzy = opts.allowFuzzy !== false
  const maxCandidates = opts.maxCandidates ?? 5

  if (!oldText || oldText.trim().length === 0) return { kind: 'nomatch' }

  // 1. Exact unique match (Pi edit parity).
  const exactPositions = findAll(fileText, oldText)
  if (exactPositions.length === 1) {
    const start = exactPositions[0]
    return { kind: 'matched', startOrig: start, endOrig: start + oldText.length, matchMode: 'exact' }
  }
  if (exactPositions.length > 1) {
    return {
      kind: 'ambiguous',
      matchMode: 'exact',
      candidates: exactPositions.slice(0, maxCandidates).map((p) => {
        const sl = lineOf(fileText, p)
        const el = lineOf(fileText, p + oldText.length)
        return {
          lineRange: { startLine: sl, endLine: el },
          preview: previewLines(fileText, sl, el, 2),
          matchMode: 'exact' as const,
          enclosingScope: findEnclosingScope(fileText, sl) ?? undefined,
        }
      }),
    }
  }

  if (!allowFuzzy) {
    // Still surface a closest-region hint even when fuzzy apply is disabled.
    const best = bestFuzzyRegion(fileText, oldText)
    return { kind: 'nomatch', bestCandidate: best ?? undefined }
  }

  // 2. Normalized (whitespace-tolerant) match. Map back to original offsets.
  const { normalized: normFile, map } = normalizeWithMap(fileText)
  const { normalized: normOld } = normalizeWithMap(oldText)
  const trimmedOld = normOld.trim()
  if (!trimmedOld) return { kind: 'nomatch' }

  const normPositions = findAll(normFile, trimmedOld)
  if (normPositions.length === 1) {
    const p = normPositions[0]
    const startNorm = p
    const endNorm = p + trimmedOld.length - 1
    return { kind: 'matched', startOrig: map[startNorm], endOrig: map[endNorm] + 1, matchMode: 'normalized' }
  }
  if (normPositions.length > 1) {
    return {
      kind: 'ambiguous',
      matchMode: 'normalized',
      candidates: normPositions.slice(0, maxCandidates).map((p) => {
        const startOrig = map[p]
        const endOrig = map[p + trimmedOld.length - 1] + 1
        const sl = lineOf(fileText, startOrig)
        const el = lineOf(fileText, endOrig)
        return {
          lineRange: { startLine: sl, endLine: el },
          preview: previewLines(fileText, sl, el, 2),
          matchMode: 'normalized' as const,
          enclosingScope: findEnclosingScope(fileText, sl) ?? undefined,
        }
      }),
    }
  }

  const best = bestFuzzyRegion(fileText, oldText)
  return { kind: 'nomatch', bestCandidate: best ?? undefined }
}

/**
 * Apply a fuzzy-tolerant edit to an existing file (single replacement).
 *
 * Returns a discriminated result. Callers (the tool wrapper) should surface
 * `applied: false` ambiguous results and `ok: false` errors as text to the model
 * so it can self-correct (read the region, add context, retry).
 */
export function smartEdit(filePath: string, oldText: string, newText: string, opts: SmartEditOptions = {}): SmartEditResult {
  if (!oldText) return { ok: false, error: 'oldText is empty.' }
  if (oldText === newText) return { ok: false, error: 'oldText and newText are identical; nothing to change.' }

  let fileText: string
  try {
    fileText = readFileSync(filePath, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Could not read ${filePath}: ${msg}` }
  }

  const loc = locateEdit(fileText, oldText, opts)
  if (loc.kind === 'matched') {
    const updated = fileText.slice(0, loc.startOrig) + newText + fileText.slice(loc.endOrig)
    return commit(filePath, updated, fileText, loc.startOrig, loc.endOrig, loc.matchMode)
  }
  if (loc.kind === 'ambiguous') {
    return { ok: true, applied: false, reason: 'ambiguous', matchMode: loc.matchMode, candidates: loc.candidates }
  }
  return noMatchResult(fileText, oldText, filePath, opts, loc)
}

/**
 * Apply N disjoint fuzzy-tolerant edits to an existing file in one call.
 *
 * Each edit's oldText is matched against the ORIGINAL file (not incrementally),
 * matching Pi `edit`'s `edits[]` semantics. Edits must not overlap. All-or-
 * nothing: if any edit is ambiguous, has no match, or overlaps another, the
 * file is left untouched and the result names the offending edit index so the
 * agent can fix that one block and retry.
 */
export function smartEditMany(filePath: string, edits: EditPair[], opts: SmartEditOptions = {}): SmartEditManyResult {
  if (!Array.isArray(edits) || edits.length === 0) return { ok: false, error: 'edits is empty; pass at least one { oldText, newText }.' }
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]
    if (!e || !e.oldText) return { ok: false, error: `edits[${i}].oldText is empty — smart_edit requires non-empty oldText in every edit.`, editIndex: i }
    if (e.oldText === e.newText) return { ok: false, error: `edits[${i}].oldText and newText are identical; nothing to change.`, editIndex: i }
  }

  let fileText: string
  try {
    fileText = readFileSync(filePath, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Could not read ${filePath}: ${msg}` }
  }

  // Locate every edit against the ORIGINAL file (not incrementally).
  const located: Array<{
    startOrig: number
    endOrig: number
    matchMode: 'exact' | 'normalized'
    newText: string
    index: number
  }> = []
  for (let i = 0; i < edits.length; i++) {
    const loc = locateEdit(fileText, edits[i].oldText, opts)
    if (loc.kind === 'matched') {
      located.push({ startOrig: loc.startOrig, endOrig: loc.endOrig, matchMode: loc.matchMode, newText: edits[i].newText, index: i })
    } else if (loc.kind === 'ambiguous') {
      return {
        ok: true,
        applied: false,
        reason: 'ambiguous',
        editIndex: i,
        matchMode: loc.matchMode,
        candidates: loc.candidates,
      }
    } else {
      return {
        ok: true,
        applied: false,
        reason: 'nomatch',
        editIndex: i,
        matchMode: 'normalized',
        bestCandidate: loc.bestCandidate,
      }
    }
  }

  // Overlap check (against original offsets). Sort ascending by start.
  const sorted = [...located].sort((a, b) => a.startOrig - b.startOrig)
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].startOrig < sorted[k - 1].endOrig) {
      return {
        ok: false,
        error:
          `edits[${sorted[k - 1].index}] and edits[${sorted[k].index}] overlap in the original file. ` +
          `Merge them into one edit or choose non-overlapping regions.`,
        editIndex: sorted[k].index,
      }
    }
  }

  // Splice all edits in one pass (ascending by start).
  let updated = ''
  let cursor = 0
  for (const r of sorted) {
    updated += fileText.slice(cursor, r.startOrig) + r.newText
    cursor = r.endOrig
  }
  updated += fileText.slice(cursor)

  try {
    writeFileSync(filePath, updated, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Edits matched but write failed: ${msg}` }
  }

  // Per-edit line ranges in the ORIGINAL file (input order).
  const editOutcomes: AppliedEdit[] = located.map((r) => ({
    matchMode: r.matchMode,
    lineRange: { startLine: lineOf(fileText, r.startOrig), endLine: lineOf(fileText, r.endOrig) },
  }))

  // Preview the first changed region in the UPDATED file (lowest start offset).
  const firstStart = sorted[0].startOrig
  const firstLineUpdated = lineOf(updated, firstStart)
  const preview = previewLines(updated, firstLineUpdated, firstLineUpdated + 6, 6)

  return {
    ok: true,
    applied: true,
    edits: editOutcomes,
    preview,
    bytesWritten: Buffer.byteLength(updated, 'utf8'),
  }
}

function commit(
  filePath: string,
  updated: string,
  original: string,
  startOrig: number,
  endOrig: number,
  matchMode: 'exact' | 'normalized',
): SmartEditResult {
  try {
    writeFileSync(filePath, updated, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Edit matched but write failed: ${msg}` }
  }
  const startLine = lineOf(original, startOrig)
  const endLine = lineOf(original, endOrig)
  return {
    ok: true,
    applied: true,
    matchMode,
    lineRange: { startLine, endLine },
    preview: previewLines(updated, startLine, startLine + updated.slice(0, startOrig).split('\n').length - startLine + endLine - startLine + 1, 6),
    bytesWritten: Buffer.byteLength(updated, 'utf8'),
  }
}

function noMatchResult(
  fileText: string,
  oldText: string,
  filePath: string,
  opts: SmartEditOptions,
  loc: LocateOutcome,
): SmartEditResult {
  const minHint = opts.minSimilarityHint ?? 0.6
  const raw = loc.kind === 'nomatch' ? loc.bestCandidate : undefined
  const hint = raw && raw.similarity >= minHint ? raw : undefined
  let error = `No match for oldText in ${filePath} (exact and normalized both failed).`
  if (hint) {
    error +=
      ` Closest region is lines ${hint.lineRange.startLine}-${hint.lineRange.endLine} ` +
      `(token similarity ${(hint.similarity * 100).toFixed(0)}%):\n${hint.preview}\n\n` +
      `Read that region with the read tool and retry smart_edit with the exact text.`
  } else {
    error += ` Could not locate a close region. Use read/grep to find the current text, then retry.`
  }
  return { ok: false, error, bestCandidate: hint ?? undefined }
}