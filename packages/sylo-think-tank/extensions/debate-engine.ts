import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { discoverThinkTankAgents, findThinkTankAgent } from './agents.ts'
import {
  clampCycleBounds,
  isModeratorSeat,
  readThinkTankConfigFromEnv,
  resolveSeatPiModel,
  validateThinkTankSeats,
  type ThinkTankSeatConfig,
} from './config.ts'
import type { ThinkTankSeatDebug, FinalReportValidation } from './fragment.ts'
import { runThinkTankSeatPrompt, type ThinkTankSeatRunContext } from './spawn-seat.ts'
import { capReasoningTrace, extractThinkingFromWorkflow } from './seat-workflow.ts'
import { allSeatsReady, parseDebateTurn } from './stance.ts'
import { formatTasksForPrompt, initTaskStoreFile, listTasks } from './task-store.ts'
import {
  buildDebaterFinalReportSections,
  buildDebaterPhaseInstructions,
  buildModeratorCycleInstructions,
  buildModeratorFinalReportSections,
  debaterRoleOverrideBlock,
  inferDebatePhase,
  STANCE_FOOTER_INSTRUCTIONS,
} from './debate-prompts.ts'
import { assertThinkTankCriticalGaps, assertThinkTankTopicUsable, resolveThinkTankTopic } from './topic.ts'
import {
  thinkTankRpc,
  newThinkTankMessageId,
  newThinkTankSessionId,
  notifyThinkTank,
  type ThinkTankStance,
} from './sylo-host.ts'

type TranscriptLine = {
  cycle: number
  seatId: string
  seatLabel: string
  stance: ThinkTankStance
  summary: string
  body: string
  /** This seat's Pi thinking trace for the turn (injected into their later turns only). */
  reasoningTrace?: string
}

function formatOwnPriorReasoning(lines: TranscriptLine[]): string {
  const withReasoning = lines.filter((l) => l.reasoningTrace?.trim())
  if (withReasoning.length === 0) return '(none yet — first cycle for you, or prior turns had no thinking trace)'
  return withReasoning
    .map(
      (l) =>
        `### Cycle ${l.cycle}\n\n` +
        `${l.reasoningTrace}\n\n` +
        `**Published that cycle (${l.stance}):** ${l.summary}`,
    )
    .join('\n\n---\n\n')
}

function formatTranscript(lines: TranscriptLine[]): string {
  if (lines.length === 0) return '(no debate yet)'
  return lines
    .map(
      (l) =>
        `### Cycle ${l.cycle} — ${l.seatLabel}\n` +
        `Stance: ${l.stance}\nSummary: ${l.summary}\n\n${l.body}`,
    )
    .join('\n\n---\n\n')
}

function buildRoleInstructions(seat: ThinkTankSeatConfig, seats: ThinkTankSeatConfig[]): string {
  const debaterSeats = seats.filter((s) => !isModeratorSeat(s))
  const debaterLabels = debaterSeats.map((s) => s.label)

  if (isModeratorSeat(seat)) {
    return [
      `## Your role (${seat.label} — Moderator)`,
      `- You speak **after** ${debaterLabels.join(' and ')} each cycle.`,
      `- You are **advisory only**. The operator **cannot pick you**. Synthesize findings toward a decision brief.`,
      `- Use **sylo_think_tank_task_list** each cycle; assign with **sylo_think_tank_task_assign**; mark **complete** only with **sylo_think_tank_task_complete** after reviewing researcher submissions.`,
      `- Refer to researchers only as **${debaterLabels.join('** and **')}** (never Seat A/B/C).`,
    ].join('\n')
  }

  const debaterIndex = debaterSeats.findIndex((s) => s.id === seat.id)
  const otherDebaters = debaterSeats.filter((s) => s.id !== seat.id).map((s) => s.label)
  const moderatorLabel = seats.find(isModeratorSeat)?.label ?? 'Moderator'
  const roleOverride = debaterRoleOverrideBlock(debaterIndex, debaterSeats.length)
  const lines = [
    `## Your role (${seat.label})`,
    `- You are researcher **${debaterIndex + 1}** of **${debaterSeats.length}**. The operator may pick one researcher final report; the Moderator delivers the decision synthesis.`,
    `- **Stress-test** ${otherDebaters.join(' and ')} by label with evidence; complete Moderator assignments via **sylo_think_tank_task_list** / **sylo_think_tank_task_submit**.`,
    `- Respond to **${moderatorLabel}** when they surface gaps. Your job is to help the operator decide, not to win a debate.`,
  ]
  if (roleOverride) lines.push('', roleOverride)
  return lines.join('\n')
}

function formatOperatorUpdates(updates: readonly string[]): string {
  if (updates.length === 0) return ''
  return updates.map((u, i) => `### Update ${i + 1}\n${u}`).join('\n\n')
}

function buildOperatorUpdatesBlock(seat: ThinkTankSeatConfig, updates: readonly string[]): string {
  if (updates.length === 0) return ''
  const header =
    '## Operator updates (human — authoritative, not a debater)\n\n' +
    'The operator injected these clarifications during the live session.\n\n' +
    `${formatOperatorUpdates(updates)}\n\n`
  if (isModeratorSeat(seat)) {
    return (
      header +
      'Act on new facts: assign **sylo_think_tank_task_assign** proof tasks, demand researcher responses next cycle, ' +
      'or use stance **continue** if another full research cycle is warranted.\n\n'
    )
  }
  return header + 'Address relevant updates in this turn if you have not already.\n\n'
}

function buildDebatePrompt(args: {
  topic: string
  cycle: number
  minCycles: number
  maxCycles: number
  seat: ThinkTankSeatConfig
  seats: ThinkTankSeatConfig[]
  transcript: TranscriptLine[]
  tasksFile: string
  operatorUpdates?: readonly string[]
}): string {
  const debaterOrder = args.seats.map((s) => s.label).join(' → ')
  const priorThisCycle = args.transcript.filter(
    (l) => l.cycle === args.cycle && l.seatId !== args.seat.id,
  )
  const priorCycles = args.transcript.filter((l) => l.cycle < args.cycle)
  const ownPriorReasoning = args.transcript.filter(
    (l) => l.seatId === args.seat.id && l.cycle < args.cycle,
  )

  const debaterSeats = args.seats.filter((s) => !isModeratorSeat(s))
  const debaterCount = debaterSeats.length
  const debaterIndex = debaterSeats.findIndex((s) => s.id === args.seat.id)
  const phase = inferDebatePhase(args.cycle)
  const roleLine =
    isModeratorSeat(args.seat) ?
      `- You are: **${args.seat.label}** (Moderator — speaks last, not pickable)`
    : `- You are: **${args.seat.label}** — debater **${debaterIndex + 1}** of **${debaterCount}**`

  const loopState = [
    '## Think Tank workflow (multi-agent research — not operator chat)',
    `- Phase: **research**`,
    `- Cycle: **${args.cycle}** of max **${args.maxCycles}** (minimum **${args.minCycles}** before early exit)`,
    roleLine,
    `- Turn order each cycle: ${debaterOrder}`,
    `- Other researchers are **separate AI agents**. The human operator is **not** in this subprocess.`,
    `- Gather evidence toward a final answer to the think tank question below.`,
  ].join('\n')

  const thisCycleBlock =
    priorThisCycle.length > 0 ?
      `## Other researchers this cycle (published turns only)\n\n${formatTranscript(priorThisCycle)}`
    : '## Other researchers this cycle\n\n(none yet — you speak first this cycle)'

  const priorBlock =
    priorCycles.length > 0 ?
      `## Prior cycles (published answers — all seats)\n\n${formatTranscript(priorCycles)}`
    : ''

  const ownReasoningBlock =
    ownPriorReasoning.length > 0 ?
      `## Your prior private reasoning (earlier cycles — only you see this)\n\n` +
        `Compound and revise your line of thought. Note where you changed your mind since last cycle.\n\n` +
        `${formatOwnPriorReasoning(ownPriorReasoning)}`
    : ''

  const assignmentBlock =
    `## Moderator assignment board\n\n${formatTasksForPrompt(listTasks(args.tasksFile))}`

  const myOpenTasks =
    !isModeratorSeat(args.seat) ?
      listTasks(args.tasksFile).filter(
        (t) => t.assignee_seat_id === args.seat.id && t.status === 'open',
      )
    : []
  const myTasksBlock =
    myOpenTasks.length > 0 ?
      `\n\n## Your open assignments (${args.seat.label})\n\n` +
        myOpenTasks.map((t) => `- **${t.title}** \`${t.id}\`: ${t.description}`).join('\n') +
        `\n\nSubmit each with **sylo_think_tank_task_submit** before debating further.`
    : ''

  const phaseBlock =
    isModeratorSeat(args.seat) ?
      buildModeratorCycleInstructions({
        cycle: args.cycle,
        debaterLabels: debaterSeats.map((s) => s.label),
      })
    : buildDebaterPhaseInstructions({
        phase,
        seatLabel: args.seat.label,
        opponentLabels: debaterSeats.filter((s) => s.id !== args.seat.id).map((s) => s.label),
      })

  const operatorBlock = buildOperatorUpdatesBlock(args.seat, args.operatorUpdates ?? [])

  return (
    `${loopState}\n\n` +
    `${buildRoleInstructions(args.seat, args.seats)}\n\n` +
    `${phaseBlock}\n\n` +
    `${assignmentBlock}${myTasksBlock}\n\n` +
    (operatorBlock ? `${operatorBlock}` : '') +
    `Think tank question and operator context:\n\n${args.topic}\n\n` +
    (ownReasoningBlock ? `${ownReasoningBlock}\n\n` : '') +
    `${thisCycleBlock}\n\n` +
    (priorBlock ? `${priorBlock}\n\n` : '') +
    `## Your turn (${args.seat.label})\n\n` +
    `${STANCE_FOOTER_INSTRUCTIONS}`
  )
}

function buildFinalReportPrompt(args: {
  topic: string
  seat: ThinkTankSeatConfig
  seats: ThinkTankSeatConfig[]
  transcript: TranscriptLine[]
  tasksFile: string
}): string {
  const isModerator = isModeratorSeat(args.seat)
  const tasksBlock = formatTasksForPrompt(listTasks(args.tasksFile))
  const sectionGuide =
    isModerator ? buildModeratorFinalReportSections() : buildDebaterFinalReportSections()
  const ownAll = args.transcript.filter((l) => l.seatId === args.seat.id)
  const ownReasoningBlock =
    ownAll.some((l) => l.reasoningTrace?.trim()) ?
      `\n\n## Your private reasoning across debate cycles (only you saw these notes)\n\n${formatOwnPriorReasoning(ownAll)}`
    : ''

  return (
    `Think Tank final report for topic:\n${args.topic}\n\n` +
    `You are **${args.seat.label}**.\n\n` +
    `${sectionGuide}\n\n` +
    `Moderator assignment board (final state):\n\n${tasksBlock}\n\n` +
    `Full debate transcript (all turns):\n\n${formatTranscript(args.transcript)}` +
    ownReasoningBlock
  )
}

async function mapParallel<TIn, TOut>(
  items: TIn[],
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  return Promise.all(items.map((item, index) => fn(item, index)))
}

export type ThinkTankRunResult = {
  sessionId: string
  topic: string
  cyclesCompleted: number
  status: 'complete'
  reports: Array<{ id: string; seatId: string; seatLabel: string; preview: string; body: string }>
  transcriptPreview: string
  debug: {
    turns: Array<{
      cycle: number
      seatId: string
      seatLabel: string
      debug: ThinkTankSeatDebug
    }>
    reports: Array<{
      seatId: string
      seatLabel: string
      validation: FinalReportValidation
      debug: ThinkTankSeatDebug
    }>
  }
}

export async function runThinkTankSession(args: {
  cwd: string
  topic: string
  context?: string
  minCycles?: number
  maxCycles?: number
  seats?: ThinkTankSeatConfig[]
  sourceConversationId?: string
  sourceMessageId?: string
  signal?: AbortSignal
}): Promise<ThinkTankRunResult> {
  const baseConfig = readThinkTankConfigFromEnv()
  const { minCycles, maxCycles } = clampCycleBounds(
    args.minCycles ?? baseConfig.min_cycles,
    args.maxCycles ?? baseConfig.max_cycles,
  )
  const seats = args.seats ?? baseConfig.seats
  validateThinkTankSeats(seats)

  const agents = discoverThinkTankAgents(args.cwd)
  const sessionId = newThinkTankSessionId()
  const topic = resolveThinkTankTopic({ topic: args.topic, context: args.context })
  assertThinkTankTopicUsable(topic)
  assertThinkTankCriticalGaps({ topic: args.topic, context: args.context })

  notifyThinkTank({
    type: 'session_start',
    sessionId,
    topic,
    minCycles,
    maxCycles,
    seats: seats.map((s) => ({
      id: s.id,
      label: s.label,
      agent: s.agent,
      model: resolveSeatPiModel(s),
    })),
    sourceConversationId: args.sourceConversationId,
    sourceMessageId: args.sourceMessageId,
  })

  const moderatorSeat = seats.find(isModeratorSeat)
  if (!moderatorSeat) throw new Error('Think tank requires a Moderator seat')
  const tasksFile = path.join(os.tmpdir(), `sylo-think-tank-tasks-${sessionId}.json`)
  initTaskStoreFile({
    path: tasksFile,
    sessionId,
    moderatorSeatId: moderatorSeat.id,
  })

  const transcript: TranscriptLine[] = []
  const operatorUpdates: string[] = []
  const latestStanceBySeat = new Map<string, ThinkTankStance>()
  const turnDebugLog: ThinkTankRunResult['debug']['turns'] = []
  let cyclesCompleted = 0

  try {
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      cyclesCompleted = cycle
      for (const seat of seats) {
        if (args.signal?.aborted) throw new Error('Think tank run aborted')

        if (isModeratorSeat(seat)) {
          try {
            const fresh = await thinkTankRpc({ op: 'drain_injections', sessionId })
            const delivered =
              fresh.op === 'drain_injections' ?
                fresh.messages.filter((m) => m.trim())
              : []
            if (delivered.length > 0) {
              operatorUpdates.push(...delivered)
              notifyThinkTank({
                type: 'operator_inject_delivered',
                sessionId,
                cycle,
                messages: delivered,
              })
            }
          } catch {
            // Host RPC unavailable — continue without queued operator updates.
          }
        }

        const agent = findThinkTankAgent(agents, seat.agent)
        if (!agent) {
          throw new Error(`Unknown think tank agent "${seat.agent}" for seat ${seat.id}`)
        }

        const messageId = newThinkTankMessageId()
        const seatModel = resolveSeatPiModel(seat)

        notifyThinkTank({
          type: 'turn_start',
          sessionId,
          messageId,
          cycle,
          seatId: seat.id,
          seatLabel: seat.label,
          agent: seat.agent,
          model: seatModel,
        })

        const prompt = buildDebatePrompt({
          topic,
          cycle,
          minCycles,
          maxCycles,
          seat,
          seats,
          transcript,
          tasksFile,
          operatorUpdates,
        })

        const seatContext: ThinkTankSeatRunContext = {
          tasksFile,
          seatId: seat.id,
          seatRole: isModeratorSeat(seat) ? 'moderator' : 'debater',
          cycle,
        }

        const result = await runThinkTankSeatPrompt({
          cwd: args.cwd,
          agent,
          modelOverride: seatModel,
          personaSuffix: seat.persona,
          prompt,
          mode: 'debate',
          seatContext,
          signal: args.signal,
          onProgress: (entry) => {
            notifyThinkTank({
              type: 'turn_workflow',
              sessionId,
              messageId,
              ts: entry.ts,
              event: entry.event,
            })
          },
        })

        const parsed = parseDebateTurn(result.text)
        const reasoningTrace = capReasoningTrace(extractThinkingFromWorkflow(result.workflowJson))
        latestStanceBySeat.set(seat.id, parsed.stance)
        turnDebugLog.push({
          cycle,
          seatId: seat.id,
          seatLabel: seat.label,
          debug: result.debug,
        })
        transcript.push({
          cycle,
          seatId: seat.id,
          seatLabel: seat.label,
          stance: parsed.stance,
          summary: parsed.summary,
          body: parsed.body,
          reasoningTrace: reasoningTrace || undefined,
        })

        notifyThinkTank({
          type: 'turn',
          sessionId,
          messageId,
          cycle,
          seatId: seat.id,
          seatLabel: seat.label,
          stance: parsed.stance,
          summary: parsed.summary,
          body: parsed.body,
          bodyPreview: parsed.body.slice(0, 400),
          model: result.model ?? seat.model,
          agent: seat.agent,
          workflowJson: result.workflowJson,
          reasoningTrace: reasoningTrace || undefined,
          debugJson: JSON.stringify(result.debug),
        })
      }

      const stances = seats.map((s) => latestStanceBySeat.get(s.id) ?? 'continue')
      if (cycle >= minCycles && allSeatsReady(stances)) break
    }

    notifyThinkTank({ type: 'phase', sessionId, phase: 'final_reports' })

    const reportDebugLog: ThinkTankRunResult['debug']['reports'] = []

    const reportResults = await mapParallel(seats, async (seat) => {
      const agent = findThinkTankAgent(agents, seat.agent)
      if (!agent) throw new Error(`Unknown think tank agent "${seat.agent}"`)
      const prompt = buildFinalReportPrompt({ topic, seat, seats, transcript, tasksFile })
      const result = await runThinkTankSeatPrompt({
        cwd: args.cwd,
        agent,
        modelOverride: resolveSeatPiModel(seat),
        personaSuffix: seat.persona,
        prompt,
        mode: 'final_report',
        seatContext: {
          tasksFile,
          seatId: seat.id,
          seatRole: isModeratorSeat(seat) ? 'moderator' : 'debater',
          cycle: cyclesCompleted,
        },
        signal: args.signal,
      })
      const validation = result.debug.reportValidation ?? { ok: false, reason: 'missing_validation' }
      reportDebugLog.push({
        seatId: seat.id,
        seatLabel: seat.label,
        validation,
        debug: result.debug,
      })
      const reportId = randomUUID()
      notifyThinkTank({
        type: 'report',
        sessionId,
        reportId,
        seatId: seat.id,
        seatLabel: seat.label,
        body: result.text,
        bodyPreview: result.text.slice(0, 500),
        debugJson: JSON.stringify({ validation, seatDebug: result.debug }),
      })
      return {
        id: reportId,
        seatId: seat.id,
        seatLabel: seat.label,
        body: result.text,
        preview: result.text.slice(0, 500),
      }
    })

    // Reports are done — finalize the session. No winner pick is required from the
    // operator; the Moderator final report is the decision brief. `sylo_think_tank_pick`
    // remains callable as an optional programmatic API, but the UI does not prompt for it.
    notifyThinkTank({ type: 'complete', sessionId, selectedReportId: '' })

    return {
      sessionId,
      topic,
      cyclesCompleted,
      status: 'complete',
      reports: reportResults.map((r) => ({
        id: r.id,
        seatId: r.seatId,
        seatLabel: r.seatLabel,
        preview: r.preview,
        body: r.body,
      })),
      transcriptPreview: formatTranscript(transcript).slice(0, 4000),
      debug: { turns: turnDebugLog, reports: reportDebugLog },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    notifyThinkTank({ type: 'error', sessionId, message })
    throw err
  } finally {
    try {
      await fs.promises.unlink(tasksFile)
    } catch {
      /* best-effort — file may already be gone */
    }
  }
}

export async function getThinkTankStatus(sessionId: string): Promise<Record<string, unknown> | null> {
  const res = await thinkTankRpc({ op: 'status', sessionId })
  if (res.op !== 'status') return null
  return res.session
}

export async function pickThinkTankReport(sessionId: string, reportId: string): Promise<string> {
  const res = await thinkTankRpc({ op: 'pick', sessionId, reportId })
  if (res.op !== 'pick') throw new Error('pick RPC did not return a pick result')
  return res.selectedReportId
}
