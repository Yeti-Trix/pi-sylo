import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  listConversations,
  listMessages,
  resolveSyloUserDir,
  setConversationModel,
  setPref,
  getPref,
  defaultWorkspaceId,
} from './database.js'

/**
 * Weekly review sweep (ADR-38 Phase B0).
 *
 * A host-level timer (not the chat scheduler) checks for its due time and
 * fires ONE sweep conversation per week. The conversation:
 * - is created host-side with the Settings-selected READER model override
 *   (operator picks a local fast model so raw chat reading never burns the
 *   global model),
 * - receives a transcript of chat messages since the last reviewed position —
 *   per-conversation markers mean resumed chats are only re-scanned in their
 *   new tail — capped in size,
 * - is instructed to extract corrections / disagreements / tool failures /
 *   confusions / durable facts and write a CAPPED digest to
 *   `<sylo-user>/.sylo/proposals/sweeps/<date>.md`, plus draft proposal files
 *   into the right pending queue (NEVER applying — the dashboard is the only
 *   apply path).
 *
 * Marker state lives in machine-local prefs (`sylo.sweep.*`), matching the
 * operator's rule: reviewed chats are not reviewed again. Transcript files
 * live in userData (never in a repo — chat content is private-class).
 */

const SWEEP_TITLE_PREFIX = 'Weekly review sweep'

export type SweepConfig = {
  enabled: boolean
  day_of_week: number // 0 = Sunday
  time_local: string // 'HH:MM' 24h
  reader_provider: string // '' = inherit global default
  reader_model_id: string // '' = inherit global default
  max_findings: number
  max_transcript_chars: number
  last_run_at: number
  last_status: string
}

export function getSweepConfig(): SweepConfig {
  return {
    enabled: getPref('sylo.sweep.enabled', true) === true,
    day_of_week: typeof getPref('sylo.sweep.day_of_week', 0) === 'number' ? (getPref('sylo.sweep.day_of_week', 0) as number) : 0,
    time_local: String(getPref('sylo.sweep.time_local', '00:00') || '00:00'),
    reader_provider: String(getPref('sylo.sweep.reader_provider', '') || ''),
    reader_model_id: String(getPref('sylo.sweep.reader_model_id', '') || ''),
    max_findings: typeof getPref('sylo.sweep.max_findings', 12) === 'number' ? (getPref('sylo.sweep.max_findings', 12) as number) : 12,
    max_transcript_chars:
      typeof getPref('sylo.sweep.max_transcript_chars', 120000) === 'number'
        ? (getPref('sylo.sweep.max_transcript_chars', 120000) as number)
        : 120000,
    last_run_at: typeof getPref('sylo.sweep.last_run_at', 0) === 'number' ? (getPref('sylo.sweep.last_run_at', 0) as number) : 0,
    last_status: String(getPref('sylo.sweep.last_status', 'never run') || 'never run'),
  }
}

export function setSweepConfig(patch: Partial<SweepConfig>): SweepConfig {
  const p = patch as Record<string, unknown>
  if (typeof p.enabled === 'boolean') setPref('sylo.sweep.enabled', p.enabled)
  if (typeof p.day_of_week === 'number' && p.day_of_week >= 0 && p.day_of_week <= 6)
    setPref('sylo.sweep.day_of_week', Math.floor(p.day_of_week))
  if (typeof p.time_local === 'string' && /^\d{1,2}:\d{2}$/.test(p.time_local.trim()))
    setPref('sylo.sweep.time_local', p.time_local.trim())
  if (typeof p.reader_provider === 'string') setPref('sylo.sweep.reader_provider', p.reader_provider.trim())
  if (typeof p.reader_model_id === 'string') setPref('sylo.sweep.reader_model_id', p.reader_model_id.trim())
  if (typeof p.max_findings === 'number' && p.max_findings > 0) setPref('sylo.sweep.max_findings', Math.floor(p.max_findings))
  if (typeof p.max_transcript_chars === 'number' && p.max_transcript_chars >= 10000)
    setPref('sylo.sweep.max_transcript_chars', Math.floor(p.max_transcript_chars))
  return getSweepConfig()
}

/** Most recent past occurrence of the configured weekday+time (local time). */
function lastOccurrence(dayOfWeek: number, timeLocal: string, now: number): number {
  const [hh, mm] = timeLocal.split(':').map((s) => parseInt(s, 10))
  const t = new Date(now)
  t.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
  if (t.getTime() > now) t.setDate(t.getDate() - 7)
  while (t.getDay() !== dayOfWeek) t.setDate(t.getDate() - 1)
  return t.getTime()
}

function sweepConversationIds(): string[] {
  const v = getPref('sylo.sweep.conv_ids', [])
  return Array.isArray(v) ? (v as string[]) : []
}

/**
 * Unmarked chat transcript since the last sweep. Per-conversation positions
 * (last message created_at) mean resumed conversations only contribute their
 * new tail. First-ever run starts from a 14-day baseline instead of all time.
 */
function buildTranscript(cfg: SweepConfig, now: number): {
  text: string
  convCount: number
  msgCount: number
  positions: Record<string, number>
} {
  const prev = ((): Record<string, number> => {
    const v = getPref('sylo.sweep.reviewed_positions', {})
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {}
  })()
  const skipIds = new Set(sweepConversationIds())
  const baseline = now - 14 * 24 * 60 * 60 * 1000
  const perMessage = 1200
  const lines: string[] = []
  const positions: Record<string, number> = { ...prev }
  let msgCount = 0
  let chars = 0

  const convs = listConversations()
    .filter((c) => !skipIds.has(c.id))
    .map((c) => ({ row: c, updated: c.updated_at }))
    .sort((a, b) => b.updated - a.updated)

  for (const { row } of convs) {
    if (chars >= cfg.max_transcript_chars) break
    const since = typeof prev[row.id] === 'number' ? prev[row.id] : baseline
    const msgs = listMessages(row.id)
      .filter(
        (m) =>
          (m.role === 'user' || m.role === 'assistant') &&
          m.status === 'complete' &&
          (m.created_at ?? 0) > since,
      )
      .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
    if (msgs.length === 0) continue
    let maxTs = since
    let capped = false
    for (const m of msgs) {
      maxTs = Math.max(maxTs, m.created_at ?? 0)
      const ts = m.created_at ? new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ') : '?'
      const body = String(m.content ?? '').slice(0, perMessage).replace(/\s+/g, ' ').trim()
      if (!body) continue
      const line = `[${ts}] (${row.title || 'untitled chat'} / ${m.role}) ${body}`
      chars += line.length + 1
      lines.push(line)
      msgCount += 1
      if (chars >= cfg.max_transcript_chars) {
        lines.push('--- transcript truncated at cap (older messages picked up next week) ---')
        capped = true
        break
      }
    }
    // Only mark included conversations as reviewed; capped-out ones keep their
    // old marker so the next sweep picks up the remainder.
    if (!capped) positions[row.id] = maxTs
  }

  return { text: lines.join('\n'), convCount: lines.length ? convs.length : 0, msgCount, positions }
}

const SWEEP_PROMPT_TEMPLATE = (opts: {
  dateStr: string
  commonsDir: string
  transcriptPath: string
  maxFindings: number
}) => `You are running the WEEKLY REVIEW SWEEP for Sylo (ADR-38). One pass, no conversation with the operator.

Read the transcript file at:
${opts.transcriptPath}

It contains chat messages (operator + assistant) since the last sweep, oldest to newest. RECURRENCE BAR: only surface patterns that occurred TWO OR MORE TIMES across different conversations (the same correction, the same mistake on the same workflow, the same repeated confusion), or standing preferences the operator restated about recurring work. ONE-TIME EVENTS DO NOT COUNT: a single bug, a one-session debugging story, a decision already made and implemented (architecture choices, default flips, process design — those live in ADRs/docs already; re-proposing them is rejected as noise), or routine dev chores. When in doubt, leave it out — a quiet week with 0 findings is the correct outcome; ${opts.maxFindings} is a ceiling, not a quota.

For every finding you keep, cite the recurrence evidence: the conversation titles + dates where the pattern showed up more than once. No evidence of repetition means you drop it.

Extract findings, in priority order, all subject to the recurrence bar above:
1. CORRECTIONS — the operator corrected the agent (wrong fact, wrong approach, environment gotcha like wrong cwd/CLI behavior)
2. DISAGREEMENTS — the operator pushed back on or overrode an agent decision
3. FAILURES — tool calls / commands that errored and how they were actually fixed
4. CONFUSIONS — moments the agent misunderstood the operator, the machine, or itself
5. DURABLE FACTS & PREFERENCES — stable new information worth remembering (paths, workflow preferences, tool behaviors)

Then do exactly two things:

A) Write the digest to:
${opts.commonsDir}\\.sylo\\proposals\\sweeps\\${opts.dateStr}.md
Format: a short intro line, then one "## <category>: <one-line title>" section per finding with its recurrence evidence (which conversations, which dates) and a one-sentence "why it matters for REPEATED work". If nothing met the recurrence bar, write a one-line "no recurring-pattern findings this week" digest WITHOUT filing any proposals.

B) For each CONCRETE, DURABLE improvement (not one-off troubleshooting), create a proposal file — never modify the target files yourself, NEVER apply anything. Follow the queue protocol: frontmatter id "P-${opts.dateStr.replace(/-/g, '')}-NN" (NN = 01, 02, ...), title, "status: pending", scope "commons" | "private" | "machine-local", target (path relative to the queue's repo, or "~/..." for machine-local), "source: weekly-sweep ${opts.dateStr}"; body with "## Rationale" (link the finding back to its digest section) and "## Proposed change" (the exact new file content, or a unified diff for edits). Queue routing:
- commons AND private proposals → ${opts.commonsDir}\\.sylo\\proposals\\pending\\ (the repo is private by design — vault retired 2026-09-01)
Read <sylo-user>\\references\\environment-gotchas.md first and do not propose what is already recorded there. Also skip anything already documented or implemented: scan commons AGENTS.md + references/ + .sylo/workflows/ before proposing; anything describing a decision shipped in host code or an ADR is a recap, not a proposal.

PRIVACY RULE: chat content is private to this machine. Findings and quotes go into the digest only if short; no long verbatim excerpts anywhere outside the transcript file. Never copy private details into commons proposals.

Finish with a one-line summary: findings count, digest path, proposals written.`

export type SweepFireFn = (
  title: string,
  prompt: string,
  reader: { provider: string; modelId: string } | null,
) => Promise<{ conversationId: string; ok: boolean; error?: string }>

let fireFn: SweepFireFn | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined
let firing = false
let notifyChanged: (() => void) | undefined

export function initSweepService(opts: { fire: SweepFireFn; notifyChanged?: () => void }): void {
  fireFn = opts.fire
  notifyChanged = opts.notifyChanged
  // Install baseline on first boot after this feature ships: do not
  // auto-fire an immediate sweep; wait for the next scheduled occurrence.
  if (!(getPref('sylo.sweep.last_run_at', 0) as number)) {
    setPref('sylo.sweep.last_run_at', Date.now())
  }
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(() => void sweepTick(), 30_000)
}

export function shutdownSweepService(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = undefined
  }
}

async function sweepTick(): Promise<void> {
  const cfg = getSweepConfig()
  if (!cfg.enabled || firing) return
  const occ = lastOccurrence(cfg.day_of_week, cfg.time_local, Date.now())
  if (occ <= cfg.last_run_at) return
  if (Date.now() - occ > 8 * 24 * 60 * 60 * 1000) return // machine was off too long; wait for next week
  await runSweep(false)
}

export async function runSweep(manual: boolean): Promise<
  | { ok: true; conversationId: string; msgCount: number }
  | { ok: false; error: string }
> {
  if (firing) return { ok: false, error: 'sweep_already_running' }
  firing = true
  try {
    const cfg = getSweepConfig()
    const commonsDir = resolveSyloUserDir()
    if (!commonsDir) return { ok: false, error: 'sylo_user_dir_unresolved' }
    const now = Date.now()
    const dateStr = new Date(now).toISOString().slice(0, 10)

    const prepared = buildTranscript(cfg, now)
    if (prepared.msgCount === 0 && !manual) {
      setPref('sylo.sweep.last_run_at', now)
      setPref('sylo.sweep.last_status', `${dateStr}: no new messages — skipped`)
      notifyChanged?.()
      return { ok: true, conversationId: '', msgCount: 0 }
    }

    const transcriptDir = join(process.env.APPDATA || '.', '@sylo', 'host', 'sylo-data', 'sweeps')
    mkdirSync(transcriptDir, { recursive: true })
    const transcriptPath = join(transcriptDir, `${dateStr}-transcript.md`)
    const header = `# Sweep transcript ${dateStr}\n\n(conversations with new messages since the last sweep; message bodies truncated per message)\n\n`
    writeFileSync(transcriptPath, header + prepared.text + (prepared.text ? '\n' : ''))
    // Write the transcript even when empty so manual runs always have the file.

    // Never hand the sweep chat its own past transcripts again.
    const priorIds = sweepConversationIds()
    const reader =
      cfg.reader_provider.trim() && cfg.reader_model_id.trim()
        ? { provider: cfg.reader_provider.trim(), modelId: cfg.reader_model_id.trim() }
        : null
    const prompt = SWEEP_PROMPT_TEMPLATE({
      dateStr,
      commonsDir,
      transcriptPath,
      maxFindings: cfg.max_findings,
    })

    const result = fireFn
      ? await fireFn(`${SWEEP_TITLE_PREFIX} ${dateStr}`, prompt, reader)
      : { conversationId: '', ok: false, error: 'sweep_not_ready' }

    if (result.ok && result.conversationId) {
      setPref('sylo.sweep.reviewed_positions', prepared.positions)
      setPref('sylo.sweep.conv_ids', [...priorIds, result.conversationId].slice(-40))
      setPref('sylo.sweep.last_run_at', now)
      setPref('sylo.sweep.last_status', `${dateStr}: fired (conversation ${result.conversationId.slice(0, 8)}, ${prepared.msgCount} messages)`)
    } else {
      setPref('sylo.sweep.last_status', `${dateStr}: FAILED — ${result.error ?? 'fire_failed'}`)
    }
    notifyChanged?.()
    return { ok: true, conversationId: result.conversationId, msgCount: prepared.msgCount }
  } finally {
    firing = false
  }
}