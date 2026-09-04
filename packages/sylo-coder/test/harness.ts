/**
 * sylo-coder test harness — data-driven scenario runner for smart_edit.
 *
 * Two layers, one entry point (run.ts):
 *   1. Matching scenarios  — run smartEdit() directly against fixture files.
 *   2. Tool-execute suite  — drive the registered tool's execute() via a fake
 *      ExtensionAPI + mock ctx, validating path resolution + result formatting.
 *
 * Adding a scenario = append one object to scenarios.ts. Phase 1.5 (AST) and
 * Phase 2 (semantic_search) add their own scenario files and reuse this harness.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { smartEdit, smartEditMany, type SmartEditResult, type SmartEditManyResult } from '../extensions/smart-edit.ts'
import type { Scenario, SmartEditExpectation, MultiScenario, MultiExpectation } from './scenarios.ts'
import { SCENARIOS, MULTI_SCENARIOS } from './scenarios.ts'

export type CheckResult = { name: string; pass: boolean; reason?: string }

let pass = 0
let fail = 0
const failures: CheckResult[] = []

function record(name: string, cond: boolean, reason = ''): void {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    failures.push({ name, pass: false, reason })
    console.log(`  FAIL  ${name}${reason ? '  — ' + reason : ''}`)
  }
}

function evalExpectation(
  result: SmartEditResult,
  fileContent: string,
  expect: SmartEditExpectation,
): string | null {
  // outcome
  if (expect.outcome === 'applied') {
    if (!(result.ok && result.applied === true)) return `expected applied, got ${JSON.stringify(result).slice(0, 200)}`
    if (expect.matchMode && result.matchMode !== expect.matchMode) return `expected matchMode ${expect.matchMode}, got ${result.matchMode}`
    if (expect.resultContains && !fileContent.includes(expect.resultContains)) return `result missing "${expect.resultContains}"`
    if (expect.resultNotContains && fileContent.includes(expect.resultNotContains)) return `result still contains "${expect.resultNotContains}"`
    if (expect.resultEquals && fileContent !== expect.resultEquals) return `result not equal to expected full content`
    if (expect.preserved && !fileContent.includes(expect.preserved)) return `preserved text missing: "${expect.preserved}"`
    return null
  }
  if (expect.outcome === 'ambiguous') {
    if (!(result.ok && result.applied === false && (result as any).reason === 'ambiguous')) return `expected ambiguous, got ${JSON.stringify(result).slice(0, 200)}`
    const candidates: any[] = (result as any).candidates ?? []
    if (expect.minCandidates && candidates.length < expect.minCandidates) return `expected >=${expect.minCandidates} candidates, got ${candidates.length}`
    if (expect.enclosingScopes) {
      const labels = candidates.map((c) => c.enclosingScope?.label).filter(Boolean) as string[]
      if (labels.length !== candidates.length) return `expected every candidate to have an enclosingScope, got ${labels.length}/${candidates.length}`
      for (const want of expect.enclosingScopes) {
        if (!labels.includes(want)) return `expected enclosing scope "${want}" among candidates, got [${labels.join(', ')}]`
      }
    }
    return null
  }
  if (expect.outcome === 'error') {
    if (result.ok !== false) return `expected error, got ${JSON.stringify(result).slice(0, 200)}`
    if (expect.expectHint === true && !(result as any).bestCandidate) return `expected bestCandidate hint, none returned`
    if (expect.expectHint === false && (result as any).bestCandidate) return `expected no hint, got one`
    return null
  }
  return `unknown expected outcome: ${expect.outcome}`
}

export function runMatchingScenarios(): void {
  console.log('\n=== smart_edit matching scenarios ===')
  const dir = mkdtempSync(join(tmpdir(), 'sylo-coder-test-'))
  try {
    for (const sc of SCENARIOS) {
      const fileName = sc.fileName ?? 'sample.ts'
      const filePath = join(dir, fileName)
      writeFileSync(filePath, sc.fixture, 'utf8')
      const result = smartEdit(filePath, sc.args.oldText, sc.args.newText, {
        allowFuzzy: sc.args.allowFuzzy !== false,
      })
      const content = existsSync(filePath) ? readFileSync(filePath, 'utf8') : sc.fixture
      const reason = evalExpectation(result, content, sc.expect)
      record(sc.name, reason === null, reason ?? '')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function evalMultiExpectation(
  result: SmartEditManyResult,
  fileContent: string,
  originalFixture: string,
  expect: MultiExpectation,
): string | null {
  if (expect.outcome === 'applied') {
    if (!(result.ok && result.applied === true)) return `expected applied, got ${JSON.stringify(result).slice(0, 200)}`
    if (expect.appliedCount && result.edits.length !== expect.appliedCount) return `expected ${expect.appliedCount} applied edits, got ${result.edits.length}`
    for (const s of expect.resultContainsAll ?? []) {
      if (!fileContent.includes(s)) return `result missing "${s}"`
    }
    for (const s of expect.resultNotContainsAny ?? []) {
      if (fileContent.includes(s)) return `result still contains "${s}"`
    }
    return null
  }
  // All non-applied outcomes must leave the file untouched (all-or-nothing).
  if (expect.fileUntouched && fileContent !== originalFixture) return `expected file untouched, but it changed`
  if (expect.outcome === 'ambiguous') {
    if (!(result.ok && result.applied === false && (result as any).reason === 'ambiguous')) return `expected ambiguous, got ${JSON.stringify(result).slice(0, 200)}`
    if (expect.editIndex !== undefined && (result as any).editIndex !== expect.editIndex) return `expected editIndex ${expect.editIndex}, got ${(result as any).editIndex}`
    if (expect.minCandidates && (((result as any).candidates ?? []).length < expect.minCandidates)) return `expected >=${expect.minCandidates} candidates, got ${((result as any).candidates ?? []).length}`
    return null
  }
  if (expect.outcome === 'nomatch') {
    if (!(result.ok && result.applied === false && (result as any).reason === 'nomatch')) return `expected nomatch, got ${JSON.stringify(result).slice(0, 200)}`
    if (expect.editIndex !== undefined && (result as any).editIndex !== expect.editIndex) return `expected editIndex ${expect.editIndex}, got ${(result as any).editIndex}`
    return null
  }
  if (expect.outcome === 'error') {
    if (result.ok !== false) return `expected error, got ${JSON.stringify(result).slice(0, 200)}`
    if (expect.errorContains && !(result as any).error?.includes(expect.errorContains)) return `expected error containing "${expect.errorContains}", got "${(result as any).error ?? ''}"`
    return null
  }
  return `unknown expected outcome: ${expect.outcome}`
}

export function runMultiScenarios(): void {
  console.log('\n=== smart_edit multi-block scenarios ===')
  const dir = mkdtempSync(join(tmpdir(), 'sylo-coder-multi-test-'))
  try {
    for (const sc of MULTI_SCENARIOS) {
      const fileName = sc.fileName ?? 'multi-sample.ts'
      const filePath = join(dir, fileName)
      writeFileSync(filePath, sc.fixture, 'utf8')
      const result = smartEditMany(filePath, sc.edits, { allowFuzzy: true })
      const content = existsSync(filePath) ? readFileSync(filePath, 'utf8') : sc.fixture
      const reason = evalMultiExpectation(result, content, sc.fixture, sc.expect)
      record(sc.name, reason === null, reason ?? '')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function summarize(): void {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  - ${f.name}${f.reason ? ': ' + f.reason : ''}`)
    process.exitCode = 1
  }
}

export { record }