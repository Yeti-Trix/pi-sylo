/**
 * smart_edit scenario corpus. Append a Scenario to add coverage.
 *
 * Coverage map:
 *   01 exact unique apply
 *   02 exact ambiguous (duplicate) refuses + file untouched
 *   03 normalized apply (indent drift, tabs vs spaces)
 *   04 normalized apply preserves untouched lines + writes newText literally
 *   05 normalized ambiguous refuses
 *   06 no-match near-miss surfaces closest-region hint
 *   07 no-match zero-overlap returns error, no fabricated hint
 *   08 identical old/new rejected
 *   09 partial-line fragment edit (exact within a line)
 *   10 multiline block edit (whole function body)
 *   11 first-line boundary edit
 *   12 last-line boundary edit
 *   13 trailing-whitespace drift (normalized)
 *   14 CRLF vs LF line endings (normalized collapses both)
 *   15 real-repo refactor: rename + return change on a representative TS file
 *   16 adjacent identical blocks — normalized must NOT match across the boundary
 */

export type SmartEditExpectation = {
  outcome: 'applied' | 'ambiguous' | 'error'
  matchMode?: 'exact' | 'normalized'
  minCandidates?: number
  expectHint?: boolean
  resultContains?: string
  resultNotContains?: string
  resultEquals?: string
  preserved?: string
  /** Expected enclosing-scope labels present among ambiguous candidates
   * (order-independent). When set, every candidate must also have a populated
   * enclosingScope. */
  enclosingScopes?: string[]
}

export type Scenario = {
  name: string
  description?: string
  fileName?: string
  fixture: string
  args: { oldText: string; newText: string; allowFuzzy?: boolean }
  expect: SmartEditExpectation
}

/** Expectation for a multi-block (smartEditMany) scenario. */
export type MultiExpectation = {
  outcome: 'applied' | 'ambiguous' | 'nomatch' | 'error'
  /** When applied, substrings that must each appear in the result. */
  resultContainsAll?: string[]
  /** When applied, substrings that must NOT appear in the result. */
  resultNotContainsAny?: string[]
  /** When not applied, the result must equal the original fixture (file untouched). */
  fileUntouched?: boolean
  /** When not applied, the 0-based edit index that blocked the call. */
  editIndex?: number
  /** When ambiguous, minimum candidate count for the blocking edit. */
  minCandidates?: number
  /** When error, the result error text must contain this substring. */
  errorContains?: string
  /** When applied, expected count of applied edits. */
  appliedCount?: number
}

export type MultiScenario = {
  name: string
  description?: string
  fileName?: string
  fixture: string
  edits: Array<{ oldText: string; newText: string }>
  expect: MultiExpectation
}

const UNIQUE_FN = [
  'import { foo } from "./foo"',
  '',
  'export function bar(x: number) {',
  '  if (x > 0) {',
  '    return x * 2',
  '  }',
  '  return -x',
  '}',
].join('\n')

const DUP_FN = [
  'export function bar(x: number) {',
  '  if (x > 0) {',
  '    return x * 2',
  '  }',
  '  return -x',
  '}',
  '',
  'export function bar(x: number) {',
  '  if (x > 0) {',
  '    return x * 2',
  '  }',
  '  return -x',
  '}',
].join('\n')

export const SCENARIOS: Scenario[] = [
  {
    name: '01 exact unique apply',
    fixture: UNIQUE_FN,
    args: { oldText: 'import { foo } from "./foo"', newText: 'import { foo, bar } from "./foo"' },
    expect: { outcome: 'applied', matchMode: 'exact', resultContains: 'import { foo, bar }', preserved: 'export function bar' },
  },
  {
    name: '02 exact ambiguous refuses (file untouched)',
    fixture: DUP_FN,
    args: { oldText: '    return x * 2\n  }\n  return -x\n}', newText: '    return x * 4\n  }\n  return -x\n}' },
    expect: { outcome: 'ambiguous', matchMode: 'exact', minCandidates: 2, resultEquals: DUP_FN },
  },
  {
    name: '03 normalized apply (tab-indent drift)',
    fixture: UNIQUE_FN,
    args: {
      oldText: 'export function bar(x: number) {\n\t\tif (x > 0) {\n\t\t\treturn x * 2\n\t\t}\n\t\treturn -x\n\t}',
      newText: 'export function bar(x: number) {\n\t\tif (x > 0) {\n\t\t\treturn x * 9\n\t\t}\n\t\treturn -x\n\t}',
    },
    expect: { outcome: 'applied', matchMode: 'normalized', resultContains: 'return x * 9' },
  },
  {
    name: '04 normalized partial-block apply preserves untouched lines',
    fixture: UNIQUE_FN,
    args: {
      // oldText uses tab indent; fixture uses 2-space => forces normalized match on a partial block.
      oldText: 'if (x > 0) {\n\t\treturn x * 2\n\t}',
      newText: 'if (x > 0) {\n\t\treturn x * 9\n\t}',
    },
    expect: { outcome: 'applied', matchMode: 'normalized', resultContains: 'return x * 9', preserved: 'import { foo } from "./foo"' },
  },
  {
    name: '05 normalized ambiguous refuses',
    fixture: DUP_FN,
    args: {
      oldText: 'if (x > 0) {\n    return x * 2\n  }',
      newText: 'if (x > 0) {\n    return x * 4\n  }',
    },
    expect: { outcome: 'ambiguous', matchMode: 'normalized', minCandidates: 2 },
  },
  {
    name: '06 no-match near-miss surfaces hint',
    fixture: UNIQUE_FN,
    args: {
      oldText: 'export function bar(x: number) {\n  if (x > 0) {\n    return x * 3\n  }\n  return -x\n}',
      newText: 'whatever',
    },
    expect: { outcome: 'error', expectHint: true },
  },
  {
    name: '07 no-match zero-overlap no hint',
    fixture: UNIQUE_FN,
    args: { oldText: 'zzzzz qqqqq totally unrelated tokens', newText: 'whatever' },
    expect: { outcome: 'error', expectHint: false },
  },
  {
    name: '08 identical old/new rejected',
    fixture: UNIQUE_FN,
    args: { oldText: 'return x * 2', newText: 'return x * 2' },
    expect: { outcome: 'error' },
  },
  {
    name: '09 partial-line fragment edit',
    fixture: ['export function bar(x: number) {', '  const result = compute(x)', '  return result', '}'].join('\n'),
    args: { oldText: 'compute(x)', newText: 'compute(x, opts)' },
    expect: { outcome: 'applied', matchMode: 'exact', resultContains: 'compute(x, opts)', resultNotContains: 'compute(x)' },
  },
  {
    name: '10 multiline whole-body edit',
    fixture: UNIQUE_FN,
    args: {
      oldText: 'export function bar(x: number) {\n  if (x > 0) {\n    return x * 2\n  }\n  return -x\n}',
      newText: 'export function bar(x: number) {\n  return Math.abs(x)\n}',
    },
    expect: { outcome: 'applied', matchMode: 'exact', resultContains: 'Math.abs(x)', resultNotContains: 'return x * 2' },
  },
  {
    name: '11 first-line boundary edit',
    fixture: UNIQUE_FN,
    args: { oldText: 'import { foo } from "./foo"', newText: 'import { foo } from "./foo"\nimport { baz } from "./baz"' },
    expect: { outcome: 'applied', matchMode: 'exact', resultContains: 'import { baz }', preserved: 'export function bar' },
  },
  {
    name: '12 last-line boundary edit',
    fixture: UNIQUE_FN,
    args: { oldText: '  return -x\n}', newText: '  return -x\n}\n\nexport const DONE = true' },
    expect: { outcome: 'applied', matchMode: 'exact', resultContains: 'DONE = true', preserved: 'import { foo }' },
  },
  {
    name: '13 trailing-whitespace drift (normalized)',
    fixture: ['export function bar(x: number) {', '  if (x > 0) {', '    return x * 2   ', '  }', '  return -x', '}'].join('\n'),
    args: { oldText: '    return x * 2\n  }', newText: '    return x * 7\n  }' },
    expect: { outcome: 'applied', matchMode: 'normalized', resultContains: 'return x * 7' },
  },
  {
    name: '14 CRLF vs LF line endings (normalized)',
    fileName: 'crlf.ts',
    fixture: ['export function bar(x: number) {', '  if (x > 0) {', '    return x * 2', '  }', '  return -x', '}'].join('\r\n'),
    // oldText uses LF; exact match fails on CRLF file. Normalized collapses \r and \n to single spaces.
    args: { oldText: '  if (x > 0) {\n    return x * 2\n  }', newText: '  if (x > 0) {\n    return x * 8\n  }' },
    expect: { outcome: 'applied', matchMode: 'normalized', resultContains: 'return x * 8' },
  },
  {
    name: '15 real-repo refactor: rename + return change',
    fileName: 'metric.ts',
    fixture: [
      'export function formatMs(ms: number): string {',
      '  if (ms < 1000) {',
      '    return `${ms}ms`',
      '  }',
      '  return `${(ms / 1000).toFixed(1)}s`',
      '}',
    ].join('\n'),
    args: {
      oldText: 'export function formatMs(ms: number): string {\n  if (ms < 1000) {\n    return `${ms}ms`\n  }\n  return `${(ms / 1000).toFixed(1)}s`\n}',
      newText: 'export function formatDuration(ms: number): string {\n  if (ms < 1000) {\n    return `${ms}ms`\n  }\n  return `${(ms / 1000).toFixed(2)}s`\n}',
    },
    expect: {
      outcome: 'applied',
      matchMode: 'exact',
      resultContains: 'formatDuration',
      resultNotContains: 'formatMs',
    },
  },
  {
    name: '16 adjacent identical blocks do not cross-boundary match',
    fixture: [
      'export function a() {',
      '  return 1',
      '}',
      'export function b() {',
      '  return 1',
      '}',
    ].join('\n'),
    // `return 1\n}` appears in both a() and b() — must be ambiguous, not a cross-boundary splice.
    args: { oldText: '  return 1\n}', newText: '  return 2\n}' },
    expect: { outcome: 'ambiguous', minCandidates: 2, enclosingScopes: ['function a', 'function b'] },
  },
  {
    name: '17 normalized apply with leading/trailing whitespace in oldText',
    fixture: UNIQUE_FN,
    args: {
      // Leading newline + extra trailing spaces (4) vs fixture's 2-space indent forces normalized match.
      oldText: '\n  if (x > 0) {\n    return x * 2\n  }\n    ',
      newText: '\n  if (x > 0) {\n    return x * 6\n  }\n    ',
    },
    expect: { outcome: 'applied', matchMode: 'normalized', resultContains: 'return x * 6', preserved: 'import { foo }' },
  },
  {
    name: '18 enclosing-scope annotation on normalized-ambiguous candidates',
    fixture: [
      'export function bar(x: number) {',
      '  if (x > 0) {',
      '    return x * 2',
      '  }',
      '}',
      'export function baz(x: number) {',
      '  if (x > 0) {',
      '    return x * 2',
      '  }',
      '}',
    ].join('\n'),
    args: {
      // Tab-indented oldText forces normalized match; the block appears in both bar() and baz().
      oldText: 'if (x > 0) {\n\t\treturn x * 2\n\t}',
      newText: 'if (x > 0) {\n\t\treturn x * 6\n\t}',
    },
    expect: { outcome: 'ambiguous', matchMode: 'normalized', minCandidates: 2, enclosingScopes: ['function bar', 'function baz'] },
  },
]

/** Multi-block (smartEditMany) corpus — Phase 1.6. */
export const MULTI_SCENARIOS: MultiScenario[] = [
  {
    name: 'M1 two disjoint exact edits apply together',
    fileName: 'multi.ts',
    fixture: ['export const A = 1', 'export const B = 2', 'export const C = 3'].join('\n'),
    edits: [
      { oldText: 'export const A = 1', newText: 'export const A = 7' },
      { oldText: 'export const C = 3', newText: 'export const C = 8' },
    ],
    expect: { outcome: 'applied', appliedCount: 2, resultContainsAll: ['A = 7', 'B = 2', 'C = 8'] },
  },
  {
    name: 'M2 mixed exact + normalized edits apply together',
    fileName: 'mixed.ts',
    fixture: ['export function bar(x) {', '  if (x) {', '    return x', '  }', '}', 'export const K = 1'].join('\n'),
    edits: [
      // edit 0: normalized (tab-indent drift against 2-space fixture)
      { oldText: 'if (x) {\n\t\treturn x\n\t}', newText: 'if (x) {\n\t\treturn x * 2\n\t}' },
      // edit 1: exact
      { oldText: 'export const K = 1', newText: 'export const K = 2' },
    ],
    expect: { outcome: 'applied', appliedCount: 2, resultContainsAll: ['return x * 2', 'K = 2'] },
  },
  {
    name: 'M3 second edit ambiguous refuses + file untouched',
    fileName: 'amb2.ts',
    fixture: ['export const A = 1', 'export function p() {', '  return 1', '}', 'export function q() {', '  return 1', '}'].join('\n'),
    edits: [
      { oldText: 'export const A = 1', newText: 'export const A = 9' },
      { oldText: '  return 1\n}', newText: '  return 2\n}' }, // appears in p() and q()
    ],
    expect: { outcome: 'ambiguous', editIndex: 1, minCandidates: 2, fileUntouched: true },
  },
  {
    name: 'M4 second edit no-match refuses + file untouched',
    fileName: 'nomatch2.ts',
    fixture: ['export const A = 1', 'export const B = 2'].join('\n'),
    edits: [
      { oldText: 'export const A = 1', newText: 'export const A = 9' },
      { oldText: 'export const Z = 999 totally missing', newText: 'x' },
    ],
    expect: { outcome: 'nomatch', editIndex: 1, fileUntouched: true },
  },
  {
    name: 'M5 overlapping edits refuse + file untouched',
    fileName: 'overlap.ts',
    fixture: ['export function bar(x) {', '  if (x) {', '    return x', '  }', '}'].join('\n'),
    edits: [
      { oldText: '  if (x) {', newText: '  if (x > 0) {' },
      { oldText: '  if (x) {\n    return x', newText: '  if (x > 0) {\n    return x' }, // overlaps edit 0
    ],
    expect: { outcome: 'error', errorContains: 'overlap', fileUntouched: true },
  },
  {
    name: 'M6 three disjoint edits all apply',
    fileName: 'three.ts',
    fixture: ['const X = 1', 'const Y = 2', 'const Z = 3'].join('\n'),
    edits: [
      { oldText: 'const X = 1', newText: 'const X = 11' },
      { oldText: 'const Y = 2', newText: 'const Y = 22' },
      { oldText: 'const Z = 3', newText: 'const Z = 33' },
    ],
    expect: { outcome: 'applied', appliedCount: 3, resultContainsAll: ['X = 11', 'Y = 22', 'Z = 33'] },
  },
]