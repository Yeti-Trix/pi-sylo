import { splitUserMessageAttachments } from './chatUserAttachments'
import type {
  ExportThinkTankReport,
  ExportThinkTankTurn,
} from './components/think-tank/mergeThinkTankExportTurns'
import {
  extractThinkingFromThinkTankWorkflow,
  isThinkTankFragmentTurn,
  splitThinkTankTopic,
  stripThinkTankStanceFooter,
} from './components/think-tank/thinkTankExportFormat'
import { formatImageDeliveryForExport } from '../../shared/chat-image-delivery.js'
import { extensionDisplayTitle } from '../../shared/capability-display-names.js'
import {
  compactionNoticeBody,
  compactionNoticeTitle,
  compactionTriggerLabel,
  parseCompactionNoticeContent,
} from '../../shared/compaction-notice.js'
import {
  auditWorkflowTiming,
  buildAssistantSegments,
  buildSummaryBars,
  classifyStoredTelemetryRaw,
  extractToolRuns,
  findTurnEnvelope,
  formatDurationMs,
  collapseConsecutiveTimelineEvents,
  formatCollapsedTimelineLine,
  gapsForOrderedChatSegments,
  mergedWorkflowTelemetry,
  summarizeToolArgsPreview,
  totalSpanMs,
  type AssistantSegment,
  type WorkflowStampedEntry,
} from './workflowTimeline'

export type ExportMessage = {
  id: string
  role: string
  content: string
  tool_calls_json: string | null
  status: string
  created_at: number
}

export type ExportConversation = {
  id: string
  title: string
  pi_session_relpath: string | null
  created_at?: number
  updated_at?: number
}

export type ExportWorkspace = {
  name: string
  cwd: string
}

export type ExportAgentModel = {
  provider: string
  modelId: string
  displayName?: string
  input: ('text' | 'image')[]
  visionCapable: boolean
}

export type ExportCapabilitySkill = {
  name: string
  path: string
  origin: string
  excludedFromAgent: boolean
}

export type ExportCapabilityTool = {
  name: string
  excludedFromAgent: boolean
}

export type ExportCapabilityExtension = {
  name: string
  path: string
  origin: string
  excludedFromAgent: boolean
  tools: ExportCapabilityTool[]
  commandNames: string[]
}

/** Pi skills, extensions, tools, and packages visible to the broker at export time. */
export type ExportCapabilitiesSnapshot = {
  brokerOk: boolean
  brokerReady: boolean
  brokerError?: string
  agentDir: string
  piCwd: string
  skills: ExportCapabilitySkill[]
  extensions: ExportCapabilityExtension[]
  packages: string[]
  loadErrors: { path: string; error: string }[]
  toolNameCollisions: Record<string, string[]>
}

export type BuildConversationMarkdownInput = {
  conversation: ExportConversation
  workspace?: ExportWorkspace | null
  messages: ExportMessage[]
  /** Live IPC telemetry tail keyed by assistant message id (active streaming turn). */
  liveTelemetryByMessageId?: Record<string, WorkflowStampedEntry[]>
  /** Think tank seat turns (merged DB + live UI); includes partial/stopped sessions. */
  thinkTankTurns?: ExportThinkTankTurn[]
  /** Final reports from think tank sessions linked to this conversation. */
  thinkTankReports?: ExportThinkTankReport[]
  /** Broker model at export time (may differ from model used on older turns). */
  agentModel?: ExportAgentModel | null
  /** Skills, extensions, and tool registry at export time (same source as Capability manager). */
  capabilities?: ExportCapabilitiesSnapshot | null
  exportedAt?: Date
}

function formatWallTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return String(ms)
  }
}

function fenceJson(value: unknown, lang = 'json'): string {
  if (value === undefined || value === null) return '_(none)_'
  try {
    const body =
      typeof value === 'string' ? value
      : typeof value === 'object' ? JSON.stringify(value, null, 2)
      : String(value)
    return ['```' + lang, body, '```'].join('\n')
  } catch {
    return ['```', String(value), '```'].join('\n')
  }
}

function mdEscapeInline(text: string): string {
  return text.replace(/\r/g, '')
}

function orderSegments(segments: AssistantSegment[]): AssistantSegment[] {
  return segments.slice().sort((a, b) => {
    const ao = a.textOffset ?? Number.POSITIVE_INFINITY
    const bo = b.textOffset ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    return a.startTs - b.startTs
  })
}

function mcpToolResultFootnote(resultPreview: unknown): string | null {
  if (!resultPreview || typeof resultPreview !== 'object') return null
  const details = (resultPreview as { details?: { error?: string } }).details
  if (details?.error !== 'not_initialized') return null
  return (
    '_Sylo note: `MCP not initialized` means pi-mcp-adapter never received Pi `session_start` ' +
    '(embedded hosts must call `session.bindExtensions()` after creating AgentSession). ' +
    'If this persists after a broker restart, check `.mcp.json` in the workspace Pi cwd and Unity Bridge status._'
  )
}

function segmentMarkdown(seg: AssistantSegment): string {
  if (seg.kind === 'thinking') {
    const title = seg.text.trim() ? 'Thought' : 'Thinking (no text captured)'
    const dur =
      seg.endTs !== null ? formatDurationMs(Math.max(0, seg.endTs - seg.startTs))
      : seg.live ? 'in progress'
      : '—'
    const lines = [`#### ${title} (${dur})`, '']
    if (seg.text.trim()) {
      lines.push('```thinking', mdEscapeInline(seg.text), '```')
    } else {
      lines.push('_No reasoning text was captured for this block._')
    }
    return lines.join('\n')
  }

  if (seg.kind === 'compaction') {
    const dur =
      seg.endTs !== null ? formatDurationMs(Math.max(0, seg.endTs - seg.startTs))
      : seg.live ? 'in progress'
      : '—'
    const tokenLine =
      seg.tokensBefore != null && seg.tokensAfter != null ?
        ` · ${seg.tokensBefore.toLocaleString()} → ${seg.tokensAfter.toLocaleString()} tokens`
      : seg.tokensBefore != null ?
        ` · ${seg.tokensBefore.toLocaleString()} tokens before`
      : seg.tokensAfter != null ?
        ` · ${seg.tokensAfter.toLocaleString()} tokens after`
      : ''
    const lines = [
      `#### Context compaction (${dur}${tokenLine})`,
      '',
      `**Trigger:** ${compactionTriggerLabel(
        seg.reason === 'manual' || seg.reason === 'overflow' ? seg.reason : 'threshold',
      )}`,
      '',
    ]
    if (seg.summary?.trim()) {
      lines.push('**Summary:**', '', seg.summary.trim())
    } else {
      lines.push('_Compaction ran; no summary text was captured in telemetry._')
    }
    return lines.join('\n')
  }

  const status =
    seg.isError ? 'error'
    : seg.endTs === null ? 'running'
    : 'ok'
  const dur = seg.durationMs !== null ? formatDurationMs(seg.durationMs) : 'in progress'
  const lines = [`#### Tool: \`${seg.toolName}\` (${dur}, ${status})`, '', '**Args:**', '']
  lines.push(fenceJson(seg.args))
  lines.push('', '**Result:**', '')
  if (seg.resultPreview !== undefined) {
    lines.push(fenceJson(seg.resultPreview))
    if (seg.toolName === 'mcp') {
      const hint = mcpToolResultFootnote(seg.resultPreview)
      if (hint) lines.push('', hint)
    }
  } else if (seg.endTs === null) {
    lines.push('_Still running at export time._')
  } else {
    lines.push('_(no result payload)_')
  }
  return lines.join('\n')
}

function buildInterleavedAssistantBody(
  body: string,
  segments: AssistantSegment[],
  assistantCreatedAt: number,
): string {
  const ordered = orderSegments(segments)
  const gapByBeforeId = new Map(
    gapsForOrderedChatSegments(ordered, assistantCreatedAt).map((g) => [
      g.beforeSegmentId,
      { ms: g.ms, label: g.label },
    ]),
  )

  const parts: string[] = []
  let cursor = 0

  for (const seg of ordered) {
    const rawOffset = seg.textOffset ?? body.length
    const offset = Math.max(cursor, Math.min(rawOffset, body.length))
    if (offset > cursor) {
      const chunk = body.slice(cursor, offset).trim()
      if (chunk) parts.push(chunk)
      cursor = offset
    }

    const gap = gapByBeforeId.get(seg.id)
    if (gap) {
      parts.push(`> **Timing:** ${gap.label} — ${formatDurationMs(gap.ms)}`)
      parts.push('')
    }

    parts.push(segmentMarkdown(seg))
    parts.push('')
  }

  if (cursor < body.length) {
    const tail = body.slice(cursor).trim()
    if (tail) parts.push(tail)
  }

  if (parts.length === 0 && body.trim()) return body.trim()
  return parts.join('\n').trim()
}

function buildAssistantWorkflowAppendix(input: {
  message: ExportMessage
  telemetryRows: WorkflowStampedEntry[]
  precedingUserCreatedAt: number | null
}): string {
  const { message, telemetryRows, precedingUserCreatedAt } = input
  const storageKind = classifyStoredTelemetryRaw(message.tool_calls_json)
  const toolRuns = extractToolRuns(telemetryRows)
  const turnEnv = findTurnEnvelope(telemetryRows)
  const spanTelemetry = totalSpanMs(telemetryRows)
  const spanTurnEnvelope =
    turnEnv.turnStartTs !== null && turnEnv.turnEndTs !== null ?
      Math.max(0, turnEnv.turnEndTs - turnEnv.turnStartTs)
    : null
  const summaryBars = buildSummaryBars(telemetryRows, toolRuns)
  const timingAudit = auditWorkflowTiming({
    assistantCreatedAt: message.created_at,
    precedingUserCreatedAt,
    entries: telemetryRows,
  })

  const lines: string[] = ['### Workflow telemetry', '']

  if (storageKind === 'legacy_plain' || storageKind === 'mixed') {
    lines.push(
      '> **Timing note:** This message predates stamped telemetry. Durations may be reconstructed with synthetic spacing and can be unreliable.',
      '',
    )
  }

  if (telemetryRows.length === 0) {
    lines.push('_No telemetry rows were logged for this message._')
    return lines.join('\n')
  }

  lines.push(
    `- Raw events logged: **${telemetryRows.length}**`,
    `- Telemetry window: **${spanTelemetry !== null ? formatDurationMs(spanTelemetry) : '—'}**`,
    `- Turn envelope (Pi turn): **${spanTurnEnvelope !== null ? formatDurationMs(spanTurnEnvelope) : '—'}**`,
    `- Chat-visible segment total: **${formatDurationMs(timingAudit.chatVisibleMs)}**`,
  )
  if (timingAudit.untrackedInWindowMs !== null) {
    lines.push(
      `- Untracked inside telemetry window: **${formatDurationMs(timingAudit.untrackedInWindowMs)}**`,
    )
  }
  if (timingAudit.flags.length > 0) {
    lines.push(`- Flags: ${timingAudit.flags.join(', ')}`)
  }
  lines.push('')

  if (timingAudit.gaps.length > 0) {
    lines.push('#### Timing gaps (not shown on chat cards)', '')
    lines.push('| Interval | Duration | Stage |')
    lines.push('| --- | ---: | --- |')
    for (const g of timingAudit.gaps) {
      const detail = g.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      lines.push(`| ${g.label} | ${formatDurationMs(g.ms)} | ${g.stage.replace(/_/g, ' ')} |`)
      lines.push(`| ↳ _${detail}_ | | |`)
    }
    lines.push('')
  }

  if (toolRuns.length > 0) {
    lines.push('#### Tool executions (summary table)', '')
    lines.push('| Tool | Args | Wall duration | Status |')
    lines.push('| --- | --- | ---: | --- |')
    for (const run of toolRuns) {
      const args = summarizeToolArgsPreview(run.args, 2000).replace(/\|/g, '\\|').replace(/\n/g, ' ')
      const dur = run.durationMs !== null ? formatDurationMs(run.durationMs) : 'still running'
      const st = run.isError === true ? 'error' : run.durationMs !== null ? 'ok' : 'open'
      lines.push(`| \`${run.toolName}\` | ${args} | ${dur} | ${st} |`)
    }
    lines.push('')
  }

  if (summaryBars.length > 0) {
    lines.push('#### Collapsed durations', '')
    for (const bar of summaryBars) {
      lines.push(`- ${bar.label}: **${formatDurationMs(bar.ms)}**`)
    }
    lines.push('')
  }

  const collapsedTimeline = collapseConsecutiveTimelineEvents(telemetryRows)
  lines.push('#### Raw event timeline', '')
  if (collapsedTimeline.length < telemetryRows.length) {
    lines.push(
      `_Consecutive identical events merged: **${telemetryRows.length}** raw → **${collapsedTimeline.length}** rows._`,
      '',
    )
  }
  let prevEndTs: number | null = null
  collapsedTimeline.forEach((row, i) => {
    lines.push(formatCollapsedTimelineLine(row, i, prevEndTs))
    prevEndTs = row.endTs
  })

  return lines.join('\n')
}

function capabilityRowLabel(name: string, excluded: boolean): string {
  return excluded ? `~~${name}~~ _(excluded)_` : name
}

/** Markdown block inserted after document metadata and before turn sections. */
export function buildCapabilitiesMarkdown(snapshot: ExportCapabilitiesSnapshot): string {
  const lines: string[] = ['## Capabilities (at export)', '']
  lines.push(
    '_Snapshot when export ran (`capabilities:list`); may differ from what Pi had loaded on older turns._',
    '',
  )

  const brokerLabel =
    snapshot.brokerOk ? 'connected'
    : snapshot.brokerReady ? 'not responding'
    : 'not running'
  lines.push(`- **Broker:** ${brokerLabel}`)
  if (snapshot.brokerError) {
    lines.push(`- **Broker error:** ${snapshot.brokerError}`)
  }
  lines.push(`- **Pi agent dir:** \`${snapshot.agentDir}\``)
  if (snapshot.piCwd) {
    lines.push(`- **Pi cwd (capabilities scan):** \`${snapshot.piCwd}\``)
  }
  lines.push('')

  const enabledSkills = snapshot.skills.filter((s) => !s.excludedFromAgent)
  const excludedSkills = snapshot.skills.filter((s) => s.excludedFromAgent)
  lines.push(
    `### Skills (${enabledSkills.length} enabled${excludedSkills.length ? `, ${excludedSkills.length} excluded` : ''})`,
    '',
  )
  if (snapshot.skills.length === 0) {
    lines.push('_No skills discovered._', '')
  } else {
    for (const s of snapshot.skills) {
      lines.push(
        `- ${capabilityRowLabel(s.name, s.excludedFromAgent)} — \`${s.path}\` _(${s.origin})_`,
      )
    }
    lines.push('')
  }

  const enabledExts = snapshot.extensions.filter((e) => !e.excludedFromAgent)
  const excludedExts = snapshot.extensions.filter((e) => e.excludedFromAgent)
  lines.push(
    `### Extensions (${enabledExts.length} enabled${excludedExts.length ? `, ${excludedExts.length} excluded` : ''})`,
    '',
  )
  if (snapshot.extensions.length === 0) {
    lines.push('_No extensions discovered._', '')
  } else {
    for (const ext of snapshot.extensions) {
      const extTitle = extensionDisplayTitle(ext.name, ext.path)
      lines.push(
        `#### ${capabilityRowLabel(extTitle, ext.excludedFromAgent)}`,
        '',
        `- **Path:** \`${ext.path}\` _(${ext.origin})_`,
      )
      if (ext.tools.length > 0) {
        const toolBits = ext.tools.map((t) =>
          t.excludedFromAgent ? `~~\`${t.name}\`~~ _(excluded)_` : `\`${t.name}\``,
        )
        lines.push(`- **Tools:** ${toolBits.join(', ')}`)
      } else {
        lines.push('- **Tools:** _(none registered)_')
      }
      if (ext.commandNames.length > 0) {
        lines.push(`- **Commands:** ${ext.commandNames.map((c) => `\`${c}\``).join(', ')}`)
      }
      lines.push('')
    }
  }

  const flatTools = snapshot.extensions.flatMap((ext) =>
    ext.tools
      .filter((t) => !t.excludedFromAgent && !ext.excludedFromAgent)
      .map((t) => t.name),
  )
  const uniqueTools = [...new Set(flatTools)].sort((a, b) => a.localeCompare(b))
  lines.push(`### Agent tools available (${uniqueTools.length})`, '')
  if (uniqueTools.length === 0) {
    lines.push('_No enabled extension tools (broker may be offline)._', '')
  } else {
    lines.push(uniqueTools.map((t) => `\`${t}\``).join(', '), '')
  }

  lines.push('### Pi packages', '')
  if (snapshot.packages.length === 0) {
    lines.push('_No packages listed in Pi settings._', '')
  } else {
    for (const pkg of snapshot.packages) {
      lines.push(`- \`${pkg}\``)
    }
    lines.push('')
  }

  const collisionEntries = Object.entries(snapshot.toolNameCollisions).filter(
    ([, paths]) => paths.length > 0,
  )
  if (collisionEntries.length > 0) {
    lines.push('### Tool name collisions', '')
    for (const [toolName, paths] of collisionEntries.sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`- \`${toolName}\`: ${paths.map((p) => `\`${p}\``).join(', ')}`)
    }
    lines.push('')
  }

  if (snapshot.loadErrors.length > 0) {
    lines.push('### Capability load errors', '')
    for (const err of snapshot.loadErrors) {
      lines.push(`- \`${err.path}\`: ${err.error.replace(/\n/g, ' ')}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function buildUserMessageMarkdown(content: string): string {
  const { text, attachments, delivery } = splitUserMessageAttachments(content)
  const lines: string[] = []
  if (text.trim()) lines.push(mdEscapeInline(text.trim()))
  if (attachments.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('**Attachments:**', '')
    for (const a of attachments) {
      lines.push(`- \`${a.path}\` _(name: ${a.name})_`)
    }
  }
  if (delivery) {
    if (lines.length > 0) lines.push('')
    lines.push(...formatImageDeliveryForExport(delivery))
  }
  if (lines.length === 0) return '_(empty message)_'
  return lines.join('\n')
}

function buildThinkTankTurnMarkdown(turn: ExportThinkTankTurn): string {
  const displayBody = stripThinkTankStanceFooter(turn.body)
  const thinking = extractThinkingFromThinkTankWorkflow(turn.tool_calls_json)
  const fragment = isThinkTankFragmentTurn(turn.body)

  const header = `#### Think Tank · C${turn.cycle} · ${turn.seatLabel} · ${turn.stance.replace(/_/g, ' ')}`
  const lines: string[] = [
    header,
    '',
    `**Time:** ${formatWallTime(turn.created_at)}`,
    `**Status:** ${turn.status}`,
    `**Seat agent:** \`${turn.seatAgent}\` (${turn.seatId})`,
    `**Message ID:** \`${turn.id}\``,
  ]
  if (turn.model) lines.push(`**Model:** \`${turn.model}\``)
  lines.push('', '##### Debate turn', '')

  if (displayBody.trim()) {
    lines.push(mdEscapeInline(displayBody.trim()), '')
  } else if (turn.status === 'streaming') {
    lines.push('_Think tank seat still running or stopped before any captured output at export time._', '')
  } else {
    lines.push('_(empty seat reply)_', '')
  }

  if (fragment) {
    lines.push(
      '> _Seat output looks like a stray-token hold. Substantive argument may only exist in the reasoning trace below._',
      '',
    )
  }

  if (turn.debug_json) {
    lines.push('<details>', '<summary>Seat spawn debug</summary>', '', '```json', turn.debug_json, '```', '', '</details>', '')
  }

  if (thinking.length > 0) {
    lines.push('<details>', '<summary>Reasoning trace (not operator-facing debate text)</summary>', '')
    lines.push('```thinking', mdEscapeInline(thinking), '```', '', '</details>', '')
  }

  return lines.join('\n').trimEnd()
}

function buildThinkTankReportMarkdown(report: ExportThinkTankReport): string {
  const picked = report.selected ? ' · **picked**' : ''
  const lines: string[] = [
    `#### ${report.seatLabel}${picked}`,
    '',
    `- **Report ID:** \`${report.id}\``,
    `- **Seat:** \`${report.seatId}\``,
    `- **Time:** ${formatWallTime(report.created_at)}`,
    '',
    stripThinkTankStanceFooter(report.body).trim() || '_(empty report)_',
    '',
  ]
  if (report.metadata_json && report.metadata_json !== '{}') {
    lines.push('<details>', '<summary>Report validation debug</summary>', '', '```json', report.metadata_json, '```', '', '</details>', '')
  }
  return lines.join('\n')
}

function buildThinkTankDebateMarkdown(
  turns: ExportThinkTankTurn[],
  reports: ExportThinkTankReport[],
): string {
  if (turns.length === 0 && reports.length === 0) return ''
  const lines: string[] = ['## Think tank debate', '']
  let currentSession = ''

  for (const turn of turns) {
    if (turn.sessionId !== currentSession) {
      currentSession = turn.sessionId
      const { context, question } = splitThinkTankTopic(turn.topic.trim() || '(think tank topic)')
      lines.push(`### Session — ${question}`, '')
      lines.push(`- **Session ID:** \`${turn.sessionId}\``)
      lines.push(`- **Session status:** ${turn.sessionStatus}`, '')
      if (context) {
        lines.push('<details>', '<summary>Workspace context passed to think tank</summary>', '', context, '', '</details>', '')
      }
    }
    lines.push(buildThinkTankTurnMarkdown(turn), '---', '')
  }

  const sessionIds = [...new Set(reports.map((r) => r.sessionId))]
  for (const sessionId of sessionIds) {
    const sessionReports = reports.filter((r) => r.sessionId === sessionId)
    if (sessionReports.length === 0) continue
    lines.push(`### Final reports — session \`${sessionId}\``, '')
    for (const report of sessionReports) {
      lines.push(buildThinkTankReportMarkdown(report), '---', '')
    }
  }

  return lines.join('\n').trimEnd()
}

export function buildConversationMarkdown(input: BuildConversationMarkdownInput): string {
  const exportedAt = input.exportedAt ?? new Date()
  const live = input.liveTelemetryByMessageId ?? {}
  const title = input.conversation.title.trim() || '(untitled)'
  const lines: string[] = [
    `# Conversation: ${title}`,
    '',
    `- **Exported:** ${exportedAt.toISOString()}`,
    `- **Conversation ID:** \`${input.conversation.id}\``,
  ]

  if (input.conversation.created_at) {
    lines.push(`- **Created:** ${formatWallTime(input.conversation.created_at)}`)
  }
  if (input.conversation.updated_at) {
    lines.push(`- **Updated:** ${formatWallTime(input.conversation.updated_at)}`)
  }
  if (input.workspace) {
    lines.push(`- **Workspace:** ${input.workspace.name}`)
    lines.push(`- **Pi cwd:** \`${input.workspace.cwd}\``)
  }
  if (input.conversation.pi_session_relpath) {
    lines.push(`- **Pi session file:** \`${input.conversation.pi_session_relpath}\``)
  }
  if (input.agentModel) {
    const m = input.agentModel
    const label =
      m.displayName ? `${m.displayName} (\`${m.modelId}\`)` : `\`${m.modelId}\``
    lines.push(`- **Pi model (at export):** ${label} (${m.provider})`)
    lines.push(
      `- **Vision capable:** ${m.visionCapable ? 'yes' : 'no'} (\`input\`: \`${JSON.stringify(m.input)}\`)`,
    )
  }

  if (input.capabilities) {
    lines.push('', buildCapabilitiesMarkdown(input.capabilities), '', '---', '')
  } else {
    lines.push('', '---', '')
  }

  let turn = 0
  let precedingUserCreatedAt: number | null = null

  for (const msg of input.messages) {
    if (msg.role === 'user') {
      turn += 1
      precedingUserCreatedAt = msg.created_at
      lines.push(`## Turn ${turn} — User`, '')
      lines.push(`**Time:** ${formatWallTime(msg.created_at)}`, '')
      lines.push(buildUserMessageMarkdown(msg.content), '', '---', '')
      continue
    }

    if (msg.role === 'assistant') {
      lines.push(`## Turn ${turn} — Assistant`, '')
      lines.push(
        `**Time:** ${formatWallTime(msg.created_at)}`,
        `**Status:** ${msg.status}`,
        `**Message ID:** \`${msg.id}\``,
        '',
      )

      const telemetryRows = mergedWorkflowTelemetry(msg, live)
      const segments = buildAssistantSegments(telemetryRows)
      const interleaved = buildInterleavedAssistantBody(msg.content, segments, msg.created_at)

      lines.push('### Reply (interleaved)', '')
      if (interleaved.trim()) {
        lines.push(interleaved, '')
      } else if (msg.status === 'streaming') {
        lines.push('_Assistant reply still streaming at export time._', '')
      } else {
        lines.push('_(empty reply)_', '')
      }

      lines.push(buildAssistantWorkflowAppendix({ message: msg, telemetryRows, precedingUserCreatedAt }), '')
      lines.push('---', '')
      continue
    }

    if (msg.role === 'system') {
      const compaction = parseCompactionNoticeContent(msg.content)
      if (compaction) {
        lines.push('## Context compaction', '')
        lines.push(`**Time:** ${formatWallTime(msg.created_at)}`, '')
        lines.push(`**${compactionNoticeTitle(compaction)}**`, '')
        lines.push(mdEscapeInline(compactionNoticeBody(compaction)), '')
        lines.push(`**Trigger:** ${compactionTriggerLabel(compaction.reason)}`, '')
        if (compaction.summary?.trim()) {
          lines.push('', '### Summary', '', compaction.summary.trim(), '')
        }
        lines.push('---', '')
        continue
      }
      lines.push('## System', '')
      lines.push(`**Time:** ${formatWallTime(msg.created_at)}`, '')
      lines.push(mdEscapeInline(msg.content.trim() || '_(empty)_'), '', '---', '')
    }
  }

  const thinkTankMd = buildThinkTankDebateMarkdown(
    input.thinkTankTurns ?? [],
    input.thinkTankReports ?? [],
  )
  if (thinkTankMd) {
    lines.push(thinkTankMd, '')
  }

  lines.push(
    '',
    '_Generated by Sylo. Tool results reflect SQLite persistence (broker may truncate very large payloads). ' +
      'Think tank debate turns show persisted seat body text; reasoning traces are collapsed when present. ' +
      'Final reports are included when the session completed the report phase._',
  )

  return lines.join('\n').trimEnd() + '\n'
}

export function sanitizeExportFilename(title: string, now: Date = new Date()): string {
  const base = (title.trim() || 'conversation')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  return `${base || 'conversation'}-${stamp}`
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.md') ? filename : `${filename}.md`
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
