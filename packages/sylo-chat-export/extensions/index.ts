/**
 * sylo-chat-export extension — export chat(s) from the on-disk session JSONL.
 *
 * Compaction-proof: Pi compaction appends a summary entry but never deletes the
 * raw user/assistant messages. This tool reads those raw entries, so it
 * captures the FULL conversation even after compaction, and from resumed
 * sessions. Transcripts are written to files (not returned inline) to avoid
 * bloating the live context.
 *
 * Modes:
 *   - default: export the current session's active branch.
 *   - all_sessions=true: export every session for the current workspace cwd
 *     (via SessionManager.list), one file per session.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

interface ExportResult {
  path: string
  userTurns: number
  assistantTurns: number
  branchEntries: number
  firstTs?: string
  lastTs?: string
  toc: string[]
}

function extractBranch(
  sm: SessionManager,
  opts: { includeThinking: boolean; includeTools: boolean },
): {
  body: string
  userTurns: number
  assistantTurns: number
  firstTs?: string
  lastTs?: string
  toc: string[]
} {
  const branch = ((sm.getBranch() as any[]) ?? []).slice()
  branch.sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')))

  const out: string[] = []
  let userTurns = 0
  let assistantTurns = 0
  let firstTs: string | undefined
  let lastTs: string | undefined
  const toc: string[] = []

  for (const e of branch) {
    if (e.type !== 'message') continue
    const m = e.message
    if (!m) continue
    const ts: string | undefined = e.timestamp
    if (ts) {
      if (!firstTs) firstTs = ts
      lastTs = ts
    }

    if (m.role === 'user') {
      let text = ''
      let imgCount = 0
      if (typeof m.content === 'string') {
        text = m.content
      } else if (Array.isArray(m.content)) {
        for (const c of m.content) {
          if (c.type === 'text') text += c.text + '\n'
          else if (c.type === 'image') imgCount++
        }
      }
      text = text.trim()
      userTurns++
      if (text) toc.push(text.replace(/\s+/g, ' ').slice(0, 160))
      out.push(`## User  ${ts ?? ''}`)
      out.push('')
      out.push(text || (imgCount ? `_(image attachment x${imgCount})_` : '_(empty)_'))
      out.push('')
    } else if (m.role === 'assistant') {
      const blocks: any[] = Array.isArray(m.content) ? m.content : []
      const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text)
      const thinking = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking)
      const toolCalls = blocks.filter((b) => b.type === 'toolCall')
      const hasContent =
        texts.length ||
        (opts.includeThinking && thinking.length) ||
        (opts.includeTools && toolCalls.length)
      if (!hasContent) continue
      assistantTurns++
      out.push(`## Assistant  ${ts ?? ''}${m.model ? `  (${m.model})` : ''}`)
      out.push('')
      if (texts.length) {
        out.push(texts.join('\n'))
        out.push('')
      }
      if (opts.includeThinking && thinking.length) {
        out.push('<details><summary>thinking</summary>')
        out.push('')
        out.push(thinking.join('\n\n'))
        out.push('')
        out.push('</details>')
        out.push('')
      }
      if (opts.includeTools && toolCalls.length) {
        for (const tc of toolCalls) {
          const args = JSON.stringify(tc.arguments ?? {})
          out.push(`- tool \`${tc.name}\` ${args.slice(0, 200)}`)
        }
        out.push('')
      }
    } else if (m.role === 'toolResult' && opts.includeTools) {
      const t = Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
        : ''
      out.push(`<details><summary>tool result: ${m.toolName}</summary>`)
      out.push('')
      out.push((t || '').slice(0, 1500))
      out.push('')
      out.push('</details>')
      out.push('')
    }
  }

  return { body: out.join('\n'), userTurns, assistantTurns, firstTs, lastTs, toc }
}

function stampFromHeader(sm: SessionManager): string {
  try {
    const h = sm.getHeader() as any
    const ts: string | undefined = h?.timestamp
    if (ts) return ts.replace(/[:.]/g, '-').slice(0, 19)
  } catch {
    /* ignore */
  }
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export default function piSyloChatExportExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'sylo_chat_export',
    label: 'Chat export',
    description:
      'Export chat(s) from the on-disk session JSONL to markdown file(s) under journal/. ' +
      'Compaction-proof: reads the full raw transcript, so it works even after context compaction or from a resumed session. ' +
      'Default: export the current session. Set all_sessions=true to export every session for the current workspace. ' +
      'Writes transcripts to files (not returned inline) and returns a manifest with paths, turn counts, spans, and a table-of-contents per session. ' +
      'Use for chat-recap / journal-entry workflows.',
    parameters: Type.Object({
      all_sessions: Type.Optional(
        Type.Boolean({
          description:
            'Export every session for the current workspace cwd (one file per session) instead of just the current session. Default false.',
        }),
      ),
      include_thinking: Type.Optional(
        Type.Boolean({ description: 'Include assistant thinking blocks (default false).' }),
      ),
      include_tools: Type.Optional(
        Type.Boolean({ description: 'Include tool calls + results (default false).' }),
      ),
      out_path: Type.Optional(
        Type.String({
          description:
            'Override output file path (single-session mode only). Default: journal/.chat-export-<timestamp>.md',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const includeThinking = !!params.include_thinking
      const includeTools = !!params.include_tools
      const opts = { includeThinking, includeTools }
      const journalDir = join(ctx.cwd, 'journal')
      if (!existsSync(journalDir)) mkdirSync(journalDir, { recursive: true })

      const results: ExportResult[] = []

      const exportOne = (sm: SessionManager, outPath: string): ExportResult => {
        const r = extractBranch(sm, opts)
        const branchLen = ((sm.getBranch() as any[]) ?? []).length
        const header: string[] = [
          '# Chat export',
          '',
          `- Session file: \`${sm.getSessionFile() ?? '?'}\``,
          `- Exported: ${new Date().toISOString()}`,
          `- Branch entries: ${branchLen}`,
          '',
          '---',
          '',
        ]
        writeFileSync(outPath, header.join('\n') + r.body, 'utf8')
        return {
          path: outPath,
          userTurns: r.userTurns,
          assistantTurns: r.assistantTurns,
          branchEntries: branchLen,
          firstTs: r.firstTs,
          lastTs: r.lastTs,
          toc: r.toc,
        }
      }

      if (params.all_sessions) {
        const sessions = await SessionManager.list(ctx.cwd)
        const seen = new Set<string>()
        for (const s of sessions) {
          const file: string | undefined = (s as any).file
          if (!file || seen.has(file)) continue
          seen.add(file)
          let sm: SessionManager
          try {
            sm = SessionManager.open(file) as SessionManager
          } catch {
            continue
          }
          const stamp = stampFromHeader(sm)
          const shortId = (sm.getSessionId() ?? stamp).slice(0, 8)
          const outPath = join(journalDir, `.chat-export-${stamp}-${shortId}.md`)
          results.push(exportOne(sm, outPath))
        }
      } else {
        const sm = ctx.sessionManager
        const file = sm.getSessionFile()
        if (!file) {
          return {
            content: [{ type: 'text' as const, text: 'No persisted session (in-memory). Nothing to export.' }],
            details: {},
          }
        }
        let outPath: string | undefined = params.out_path as string | undefined
        if (!outPath) {
          const stamp = stampFromHeader(sm)
          outPath = join(journalDir, `.chat-export-${stamp}.md`)
        }
        results.push(exportOne(sm, outPath))
      }

      // Build manifest.
      const lines: string[] = []
      lines.push(`Exported ${results.length} session(s) to ${journalDir}`)
      lines.push('')
      for (const r of results) {
        lines.push(`### ${r.path}`)
        lines.push(
          `User turns: ${r.userTurns} | Assistant turns: ${r.assistantTurns} | Span: ${r.firstTs ?? '?'} -> ${r.lastTs ?? '?'}`,
        )
        const toc = r.toc.slice(0, 5)
        if (toc.length) {
          lines.push('User messages (first 5):')
          for (let i = 0; i < toc.length; i++) lines.push(`  ${i + 1}. ${toc[i]}`)
        }
        lines.push('')
      }
      lines.push(
        'Next: for each export file, read it and write a concise journal entry to journal/YYYY-MM-DD-<slug>.md, then delete the export file.',
      )

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { exports: results.map((r) => r.path), count: results.length },
      }
    },
  })
}