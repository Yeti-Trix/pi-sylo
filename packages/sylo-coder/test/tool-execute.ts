/**
 * Tool-execute integration — validates the `smart_edit` tool wrapper that the
 * matching-scenario suite skips: path resolution against ctx.cwd, result text
 * formatting, and error surfacing.
 *
 * Loads the extension with a fake ExtensionAPI that captures registerTool(),
 * then calls execute() with a mock ctx pointing at a temp cwd.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import syloCoderExtension from '../extensions/index.ts'
import { record } from './harness.ts'

type AnyTool = {
  name: string
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { cwd: string },
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>
}

type ToolResultHandler = (event: { toolName: string; details: unknown }) => unknown

function loadSmartEditTool(): { tool: AnyTool; onToolResult?: ToolResultHandler } {
  let captured: AnyTool | undefined
  let onToolResult: ToolResultHandler | undefined
  const fakeApi = {
    registerTool(tool: AnyTool) {
      if (tool.name === 'smart_edit') captured = tool
    },
    on(event: string, handler: ToolResultHandler) {
      if (event === 'tool_result') onToolResult = handler
    },
  } as unknown as Parameters<typeof syloCoderExtension>[0]
  syloCoderExtension(fakeApi)
  if (!captured) throw new Error('extension did not register smart_edit')
  return { tool: captured, onToolResult }
}

export async function runToolExecuteSuite(): Promise<void> {
  console.log('\n=== smart_edit tool-execute integration ===')
  const { tool, onToolResult } = loadSmartEditTool()
  const dir = mkdtempSync(join(tmpdir(), 'sylo-coder-tool-test-'))
  try {
    const ctx = { cwd: dir }

    // T1: relative path resolves against ctx.cwd; applied result text + details.
    {
      const file = join(dir, 'rel.ts')
      writeFileSync(file, 'export const X = 1\n', 'utf8')
      const res = await tool.execute('id1', { path: 'rel.ts', oldText: 'export const X = 1', newText: 'export const X = 2' }, undefined, undefined, ctx)
      const text = res.content[0]?.text ?? ''
      record('T1 relative path resolves against cwd + applies', text.includes('applied') && (res.details as any).applied === true, text.slice(0, 120))
      record('T1 file actually changed', readFileSync(file, 'utf8').includes('X = 2'), 'file not updated')
    }

    // T2: missing path -> error text, no throw.
    {
      const res = await tool.execute('id2', { path: 'missing.ts', oldText: 'x', newText: 'y' }, undefined, undefined, ctx)
      const text = res.content[0]?.text ?? ''
      record('T2 missing path returns error text (no throw)', text.toLowerCase().includes('failed') || text.toLowerCase().includes('could not read'), text.slice(0, 120))
    }

    // T3: empty oldText -> guarded error.
    {
      const res = await tool.execute('id3', { path: 'rel.ts', oldText: '', newText: 'y' }, undefined, undefined, ctx)
      const text = res.content[0]?.text ?? ''
      record('T3 empty oldText rejected', text.includes('non-empty oldText') || text.includes('requires'), text.slice(0, 120))
    }

    // T4: ambiguous -> candidates surfaced in text, file untouched.
    {
      const file = join(dir, 'amb.ts')
      const src = ['export function a() {', '  return 1', '}', 'export function b() {', '  return 1', '}'].join('\n')
      writeFileSync(file, src, 'utf8')
      const res = await tool.execute('id4', { path: 'amb.ts', oldText: '  return 1\n}', newText: '  return 2\n}' }, undefined, undefined, ctx)
      const text = res.content[0]?.text ?? ''
      record('T4 ambiguous surfaces candidates', /candidate/i.test(text) && (res.details as any).reason === 'ambiguous', text.slice(0, 140))
      record('T4 ambiguous leaves file untouched', readFileSync(file, 'utf8') === src, 'file changed on ambiguous!')
    }

    // T5: normalized apply via tool (indent drift) + details.matchMode.
    {
      const file = join(dir, 'norm.ts')
      writeFileSync(file, ['export function bar(x) {', '  if (x) {', '    return x', '  }', '}'].join('\n'), 'utf8')
      const res = await tool.execute('id5', { path: 'norm.ts', oldText: 'if (x) {\n\t\treturn x\n\t}', newText: 'if (x) {\n\t\treturn x * 2\n\t}' }, undefined, undefined, ctx)
      const text = res.content[0]?.text ?? ''
      record('T5 tool normalized apply + matchMode in details', (res.details as any).applied === true && (res.details as any).matchMode === 'normalized', text.slice(0, 120))
      record('T5 tool normalized wrote newText', readFileSync(file, 'utf8').includes('return x * 2'), 'newText not written')
    }

    // T6: no-match near-miss -> error text mentions closest region.
    {
      const file = join(dir, 'nomatch.ts')
      writeFileSync(file, ['export function bar(x) {', '  return x * 2', '}'].join('\n'), 'utf8')
      const res = await tool.execute('id6', { path: 'nomatch.ts', oldText: 'export function bar(x) {\n  return x * 3\n}', newText: 'y' }, undefined, undefined, ctx)
      const text = res.content[0]?.text ?? ''
      record('T6 no-match surfaces closest region in text', text.toLowerCase().includes('closest region') || text.includes('similarity'), text.slice(0, 160))
    }

    // T7: absolute path works (not just relative).
    {
      const file = join(dir, 'abs.ts')
      writeFileSync(file, 'const A = 1\n', 'utf8')
      const res = await tool.execute('id7', { path: file, oldText: 'const A = 1', newText: 'const A = 2' }, undefined, undefined, ctx)
      record('T7 absolute path applies', (res.details as any).applied === true && readFileSync(file, 'utf8').includes('A = 2'), JSON.stringify(res.details).slice(0, 120))
    }

    // T8: multi-block edits[] applies N disjoint edits in one call.
    {
      const file = join(dir, 'multi.ts')
      writeFileSync(file, ['const A = 1', 'const B = 2', 'const C = 3'].join('\n'), 'utf8')
      const res = await tool.execute('id8', { path: 'multi.ts', edits: [{ oldText: 'const A = 1', newText: 'const A = 10' }, { oldText: 'const C = 3', newText: 'const C = 30' }] }, undefined, undefined, ctx)
      const out = readFileSync(file, 'utf8')
      record('T8 edits[] applies multiple disjoint edits', (res.details as any).applied === true && (res.details as any).edits?.length === 2 && out.includes('A = 10') && out.includes('C = 30') && out.includes('B = 2'), JSON.stringify(res.details).slice(0, 140))
    }

    // T9: single-pair shorthand still works (backward compat with existing prompts).
    {
      const file = join(dir, 'legacy.ts')
      writeFileSync(file, 'export const X = 1\n', 'utf8')
      const res = await tool.execute('id9', { path: 'legacy.ts', oldText: 'export const X = 1', newText: 'export const X = 2' }, undefined, undefined, ctx)
      const out = readFileSync(file, 'utf8')
      record('T9 single-pair shorthand applies (back-compat)', (res.details as any).applied === true && (res.details as any).matchMode === 'exact' && out.includes('X = 2'), JSON.stringify(res.details).slice(0, 140))
    }

    // T10: deterministic refusal-visibility gate (the think-tank key recommendation).
    // Returning isError from execute() is a silent no-op; the on('tool_result')
    // handler is the supported lever. Applied => no override; refusal => isError:true.
    {
      record('T10 tool_result handler registered', typeof onToolResult === 'function')
      const appliedOverride = onToolResult?.({ toolName: 'smart_edit', details: { applied: true } })
      record('T10 tool_result handler leaves applied calls as-is (no override)', appliedOverride === undefined)
      const refusedOverride = onToolResult?.({ toolName: 'smart_edit', details: { applied: false, reason: 'ambiguous' } }) as { isError?: boolean } | undefined
      record('T10 tool_result handler flips isError on refusal', refusedOverride?.isError === true)
      const otherOverride = onToolResult?.({ toolName: 'edit', details: {} })
      record('T10 tool_result handler ignores non-smart_edit tools', otherOverride === undefined)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}