/**
 * sylo-coder — coding-quality package for Pi/Sylo.
 *
 * Phase 1 (this file): `smart_edit` — a fuzzy/whitespace-tolerant replacement
 * for Pi's exact-match `edit` tool. See extensions/smart-edit.ts for the
 * matching algorithm and failure modes.
 *
 * Phase 1.6 (this file): multi-block `edits[]` (parity with Pi `edit`) + a
 * deterministic refusal-visibility gate. Returning `isError: true` from
 * `execute()` is a silent no-op (the agent loop owns that flag); instead a
 * `pi.on('tool_result', ...)` handler keys off `details.applied !== true` and
 * flips the chat pill to red on every smart_edit refusal, so the operator (and
 * the model, which then sees a tool error) can tell a refusal from a success.
 *
 * Phase 2 (planned, not yet wired): `semantic_search` + codebase indexing
 * (local Ollama embeddings, SQLite store). Phase 3: subagent chain wrapper
 * lives in the skill, not here. See
 * features_tracker/active/2026-07-21_14-30-00_sylo_coder_package.md.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { smartEditMany, type EditPair } from './smart-edit.ts'

type TextBlock = { type: 'text'; text: string }

function textResult(text: string, details?: unknown): { content: TextBlock[]; details: unknown } {
  return { content: [{ type: 'text', text }], details: details ?? {} }
}

export default function syloCoderExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'smart_edit',
    label: 'Smart edit',
    description:
      'Edit an existing file by replacing oldText with newText. Tolerant of whitespace/indentation drift: if the exact text is not found, ' +
      'it matches a normalized (whitespace-collapsed, case-insensitive) version and splices the real bytes. ' +
      'On a unique match it applies; on multiple matches it returns candidate line ranges, each annotated with its enclosing function/class/def, so you can add surrounding context (or the enclosing header) to oldText and retry; ' +
      'on no match it returns the closest region it found so you can `read` it and retry with exact text. ' +
      'Pass edits: [{ oldText, newText }, ...] to apply multiple disjoint edits in one call (each oldText is matched against the ORIGINAL file, not incrementally; non-overlapping; all-or-nothing). ' +
      'For backward compatibility you may also pass a single oldText/newText pair. ' +
      'Use smart_edit (not Pi `edit`) for any targeted edit to an existing file; it exact-matches first, then falls back to normalized matching, and accepts the same edits[] array as `edit` — so it is a strict superset of `edit` for existing files. ' +
      'For new files use `write`; for large rewrites of a whole file use `write`.',
    promptSnippet:
      'smart_edit(path, edits: [{oldText,newText},...]) or smart_edit(path, oldText, newText) — default tool for editing an existing file (not Pi edit); whitespace-tolerant, multi-block edits[] in one call, annotates ambiguous candidates with their enclosing function/class, returns closest region on no match.',
    promptGuidelines: [
      'Use smart_edit (not Pi edit) for any targeted edit to an existing file; it exact-matches first, then falls back to normalized whitespace-tolerant matching.',
      'When changing multiple separate locations in one file, use one smart_edit call with multiple entries in edits[] instead of multiple smart_edit calls. Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits; merge nearby changes into one edit.',
      'Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.',
      'When smart_edit reports ambiguous candidates, use the enclosing function/class label it annotates each candidate with — include that header in oldText and retry, usually without a separate read.',
      'When smart_edit reports no match, read the closest region it surfaced and retry with the exact current text.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'Path to the file to edit (relative or absolute).' }),
      edits: Type.Optional(
        Type.Array(
          Type.Object(
            {
              oldText: Type.String({
                description:
                  'Text to replace. Must match a unique, non-overlapping region of the ORIGINAL file (exact or whitespace-normalized). Include enough context to be unique.',
              }),
              newText: Type.String({ description: 'Replacement text for this edit.' }),
            },
            { additionalProperties: false },
          ),
          {
            description:
              'One or more targeted replacements. Each oldText is matched against the ORIGINAL file, not incrementally. Do not include overlapping or nested edits; merge nearby changes into one edit instead.',
          },
        ),
      ),
      oldText: Type.Optional(
        Type.String({
          description: 'Single-edit shorthand — the text to replace. Use edits[] for multiple disjoint edits. If both edits[] and oldText are given, edits[] wins.',
        }),
      ),
      newText: Type.Optional(Type.String({ description: 'Replacement text when using the single-edit shorthand.' })),
      allow_fuzzy: Type.Optional(
        Type.Boolean({
          description: 'Allow whitespace-tolerant normalized matching when exact match fails (default true).',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const filePath = String(params.path ?? '').trim()
      if (!filePath) return textResult('smart_edit requires a path.', { error: 'missing path' })

      // Normalize input: edits[] wins; else the single-pair shorthand.
      const rawEdits = params.edits
      let editPairs: EditPair[]
      if (Array.isArray(rawEdits) && rawEdits.length > 0) {
        editPairs = rawEdits.map((e: { oldText?: unknown; newText?: unknown }) => ({
          oldText: String(e?.oldText ?? ''),
          newText: String(e?.newText ?? ''),
        }))
      } else {
        const ot = String(params.oldText ?? '')
        const nt = String(params.newText ?? '')
        if (!ot) return textResult('smart_edit requires edits[] or a non-empty oldText/newText pair.', { error: 'missing edits' })
        editPairs = [{ oldText: ot, newText: nt }]
      }

      // Resolve relative to the session cwd (mirrors Pi read/edit behavior).
      const { resolve } = await import('node:path')
      const resolved = resolve(ctx.cwd, filePath)

      const result = smartEditMany(resolved, editPairs, {
        allowFuzzy: params.allow_fuzzy !== false,
      })

      if (!result.ok) {
        const idx = result.editIndex !== undefined ? ` (edits[${result.editIndex}])` : ''
        return textResult(`smart_edit failed${idx}: ${result.error}`, {
          error: result.error,
          editIndex: result.editIndex,
          bestCandidate: result.bestCandidate,
        })
      }
      if (!result.applied) {
        const lines = [
          `smart_edit could not apply edits[${result.editIndex}] in ${filePath} — ${result.reason}. ` +
            (result.reason === 'ambiguous'
              ? `Add more surrounding context to that oldText so the match is unique, then retry.`
              : `Read the closest region it surfaced and retry with the exact current text.`),
          '',
        ]
        if (result.reason === 'ambiguous' && result.candidates) {
          lines.push(
            ...result.candidates.map((c, i) => {
              const r = c.lineRange
              const scope = c.enclosingScope ? ` · enclosing ${c.enclosingScope.label} (line ${c.enclosingScope.line})` : ''
              return `Candidate ${i + 1} — lines ${r.startLine}-${r.endLine} (${c.matchMode})${scope}:\n${c.preview}`
            }),
          )
        } else if (result.bestCandidate) {
          const b = result.bestCandidate
          lines.push(
            `Closest region is lines ${b.lineRange.startLine}-${b.lineRange.endLine} ` +
              `(token similarity ${(b.similarity * 100).toFixed(0)}%):\n${b.preview}`,
          )
        }
        return textResult(lines.join('\n'), {
          applied: false,
          reason: result.reason,
          editIndex: result.editIndex,
          matchMode: result.matchMode,
          candidates: result.candidates,
          bestCandidate: result.bestCandidate,
        })
      }

      // Success: summarize every applied edit.
      const summary = result.edits
        .map((e, i) => `edit ${i + 1}: ${e.matchMode} match @ lines ${e.lineRange.startLine}-${e.lineRange.endLine}`)
        .join('\n')
      const msg =
        `smart_edit applied ${result.edits.length} edit(s) to ${filePath} (${result.bytesWritten} bytes written).\n` +
        `${summary}\n\nFirst changed region preview:\n${result.preview}`
      // Keep back-compat single-edit fields (matchMode/lineRange) for n=1 callers,
      // plus the full per-edit array.
      const first = result.edits[0]
      return textResult(msg, {
        applied: true,
        matchMode: first.matchMode,
        lineRange: first.lineRange,
        edits: result.edits,
        bytesWritten: result.bytesWritten,
      })
    },
  })

  /**
   * Deterministic refusal-visibility gate.
   *
   * Returning `isError: true` from execute() is a silent no-op — the agent loop
   * hardcodes isError from its own execution path and never reads result.isError
   * (verified: agent-session.js / runner.js emitToolResult). The supported
   * extension contract is `on('tool_result', ...)` → ToolResultEventResult.isError,
   * which the runner applies as an override. Keying off `details.applied !== true`
   * flips the chat pill from green "ok" to red on every smart_edit refusal
   * (ambiguous / no-match / guard error), so the operator can distinguish a
   * refusal from a success in a no-diff-UI chat stream, and the model receives a
   * tool-error signal that prompts a retry instead of treating the refusal text
   * as an informational success.
   */
  pi.on('tool_result', (event) => {
    if (event.toolName !== 'smart_edit') return undefined
    const details = event.details as { applied?: boolean } | undefined
    if (details?.applied !== true) {
      return { isError: true }
    }
    return undefined
  })
}