/**
 * Sylo subagent tool — port of Pi official example without Pi TUI rendering.
 * Spawns child `pi --mode json` processes; emits lifecycle events to Sylo host via IPC.
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Message } from '@earendil-works/pi-ai'
import { StringEnum } from '@earendil-works/pi-ai'
import { type ExtensionAPI, withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { type AgentConfig, type AgentScope, discoverAgents } from './agents.ts'
import { resolvePiSpawn } from './pi-cli.ts'
import { resolveSubagentToolPolicy, toolCliArgs } from './pi-tool-policy.ts'
import { subagentModelCliArgs } from './subagent-model.ts'
import { killSubagentTree } from './subagent-kill.ts'
import { cancelSubagentRun, consumePauseRequest, consumeRunCancelled, consumeRunPaused, findActiveRunByAgent, listActiveRunSummaries, registerSubagentRun, unregisterSubagentRun } from './subagent-run-registry.ts'
import { resolveSubagentStallMs, resolveSubagentTimeoutMs } from './subagent-timeout.ts'
import { registerRunsListTool } from './sylo-runs-list.ts'
import { newSubagentRunId, notifySyloSubagent, type SyloSubagentRunMode } from './sylo-host.ts'

export { cancelAllSubagentRuns, cancelSubagentRun, pauseSubagentRun, requestSubagentPause, type PauseOutcome } from './subagent-run-registry.ts'

/**
 * Task text for a chain step that follows another agent.
 *
 * Labelling the previous step's output neutrally was not enough: handed a plan as
 * unlabelled "prior output", a worker treats it as reference material and starts
 * planning again. The handoff has to state that the earlier step is finished and
 * that this agent's job is its own role only.
 */
function chainStepTask(task: string, previous: { agent: string; output: string }): string {
  return [
    task,
    '---',
    `The \`${previous.agent}\` subagent already ran on this request and produced the output below. That step is DONE and its output is authoritative.`,
    `Do not redo, redesign, or restate it. Apply your own role to the request using it.`,
    `<${previous.agent}_output>\n${previous.output.trim()}\n</${previous.agent}_output>`,
  ].join('\n\n')
}

/**
 * Thrown by `runSingleAgent` only after it has already emitted a `cancelled`
 * lifecycle event. Shared with the callers so "the operator stopped this" can be
 * told apart from a genuine failure — `runSingleAgent` also throws for setup
 * errors (temp-file write, a synchronous spawn failure).
 */
const SUBAGENT_ABORTED_MESSAGE = 'Subagent was aborted'

const MAX_PARALLEL_TASKS = 8
const MAX_CONCURRENCY = 4
const PER_TASK_OUTPUT_CAP = 50 * 1024
/**
 * Cap on detached (background) child runs alive at once. Counts children, not tool
 * calls: a parallel dispatch of 4 needs 4 slots, a background chain needs 1 (its steps
 * are sequential). Blocking (wait:true) runs never occupy slots — the turn itself waits.
 */
const MAX_BACKGROUND_RUNS = 8
const activeBackgroundRuns = new Set<string>()
/**
 * Coalescing window for live progress.
 *
 * Every update writes the task row and makes the renderer re-query it, while the child emits
 * one delta per token. Emitting per delta would turn a five-minute run into tens of thousands
 * of SQLite writes; one update per window keeps the box moving at a fraction of that.
 */
const LIVE_UPDATE_INTERVAL_MS = 750

/** Only the tail of the stream is kept — the run box is a small scrolling preview, not a log. */
const LIVE_PREVIEW_TAIL_CHARS = 4_000

function appendPreviewTail(current: string, delta: string): string {
  const next = current + delta
  return next.length <= LIVE_PREVIEW_TAIL_CHARS ? next : next.slice(-LIVE_PREVIEW_TAIL_CHARS)
}

/** First recognizable argument of a tool call, so the progress line says what it is working on. */
function summarizeToolArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const key of ['command', 'path', 'file_path', 'pattern', 'query', 'url']) {
    const value = record[key]
    if (typeof value !== 'string' || !value.trim()) continue
    const flat = value.trim().replace(/\s+/g, ' ')
    return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat
  }
  return undefined
}

/** Minimal Pi `-p` user line — full assignment lives in --append-system-prompt (think-tank seat pattern). */
const SUBAGENT_CHILD_USER_TRIGGER = '.'

const SUBAGENT_CHILD_MODE_BLOCK = [
  '## Subagent run mode',
  'You are a **child subagent** in an isolated Pi subprocess.',
  'The user message contains your assignment from the orchestrator. Execute it immediately, then stop.',
  'Do **not** call the `subagent` tool. Do **not** simulate another turn.',
  'Do **not** greet the user or ask what they want — just execute the task and report results.',
  '',
  '### If you are blocked on a decision only the operator can make',
  'Call `await_user_input` ONCE with a crisp question (include the options you weighed and a two-sentence context recap).',
  'Never guess a business decision, a secret, or a choice the operator has not stated anywhere.',
  'The run parks and continues automatically when the answer arrives; after it does, do not re-ask.',
  'If nobody answers in time (the tool tells you), proceed with best judgment, make it reversible, and note the assumption in your final output.',
].join('\n')

function resolveDefaultAgentScope(): AgentScope {
  const raw = (process.env.SYLO_SUBAGENTS_AGENT_SCOPE ?? 'user').trim()
  if (raw === 'both' || raw === 'project') return raw
  return 'user'
}

/**
 * Persona names with a complete provider+model pin in the merged map (inherit rows are
 * never saved as pins, so a pin is always an explicit operator pick).
 *
 * For project personas (`.pi/agents/*.md`, repo-controlled) these names double as the
 * trust act: the repo file only gets its persona listed in the Subagents modal — it
 * becomes delegatable only after the operator picks a model for it there.
 */
function activeProjectAgentNames(): Set<string> {
  const raw = process.env.SYLO_SUBAGENTS_MODEL_BY_AGENT?.trim()
  if (!raw) return new Set()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Set()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set()
  const names = new Set<string>()
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as { provider?: unknown; modelId?: unknown }
    if (
      typeof entry.provider === 'string' &&
      entry.provider.trim() !== '' &&
      typeof entry.modelId === 'string' &&
      entry.modelId.trim() !== ''
    ) {
      names.add(name)
    }
  }
  return names
}

/**
 * Hide unpinned project personas from the agent's reach: repo files add candidates to
 * the Subagents modal, but only an operator pick there adds a runnable persona.
 */
function filterActiveAgents(agents: AgentConfig[]): AgentConfig[] {
  const pinned = activeProjectAgentNames()
  return agents.filter((a) => a.source !== 'project' || pinned.has(a.name))
}

const SOURCE_RELATIVE_AGENTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'agents',
)

/**
 * Directory holding the bundled personas (scout/planner/worker/reviewer).
 *
 * `import.meta.url` only points at this package when Pi loads the extension from
 * source. The host also imports this module into the broker bundle to drive
 * operator-forced runs, and there the source-relative guess lands in the build
 * output directory — so prefer the extension path the host publishes.
 */
function resolveBundledAgentsDir(): string {
  const ext = process.env.SYLO_SUBAGENTS_EXTENSION?.trim()
  if (ext) {
    const candidate = path.join(path.dirname(path.dirname(ext)), 'agents')
    if (fs.existsSync(candidate)) return candidate
  }
  return SOURCE_RELATIVE_AGENTS_DIR
}

/** Sibling parking extension loaded into every subagent child (issue #27 P3). */
function resolveAwaitInputExtensionPath(): string | null {
  const ext = process.env.SYLO_SUBAGENTS_EXTENSION?.trim()
  if (ext) {
    const candidate = path.join(path.dirname(ext), 'await-user-input.ts')
    if (fs.existsSync(candidate)) return candidate
  }
  const candidate = path.join(SOURCE_RELATIVE_AGENTS_DIR, '..', 'extensions', 'await-user-input.ts')
  return fs.existsSync(candidate) ? candidate : null
}

/**
 * Mailbox dir for the pause/resume protocol — the HOST publishes it in the broker
 * env (SYLO_AWAIT_MAILBOX); the parent passes it + per-run ids into each child.
 * Unset = the ask-back feature is off (manual pi usage, older host build).
 */
function resolveAwaitMailboxDir(): string | null {
  const dir = process.env.SYLO_AWAIT_MAILBOX?.trim()
  return dir ? dir : null
}

interface UsageStats {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  contextTokens: number
  turns: number
}

interface SingleResult {
  agent: string
  agentSource: AgentConfig['source'] | 'unknown'
  task: string
  exitCode: number
  messages: Message[]
  stderr: string
  usage: UsageStats
  model?: string
  stopReason?: string
  errorMessage?: string
  step?: number
  runId?: string
  /** Workspace files this run touched (write/edit-like tools), first-touch order. */
  touchedFiles?: string[]
}

interface SubagentDetails {
  mode: SyloSubagentRunMode
  agentScope: AgentScope
  projectAgentsDir: string | null
  results: SingleResult[]
}

function thinkingFromMessage(msg: Message): string {
  const parts: string[] = []
  for (const part of msg.content) {
    if (!part || typeof part !== 'object') continue
    const rec = part as { type?: unknown; thinking?: unknown }
    if (rec.type !== 'thinking' || typeof rec.thinking !== 'string' || !rec.thinking.trim()) continue
    parts.push(rec.thinking)
  }
  return parts.join('\n\n')
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      for (const part of msg.content) {
        if (part.type === 'text') return part.text
      }
    }
  }
  return ''
}

/** Why a runaway guard ended a child. Never a success, whatever the exit code says. */
export type SubagentGuardReason = 'stalled' | 'timeout'

/** Grace period for `close` after a guard kill, before the run ends on its own clock. */
const GUARD_FINALIZE_GRACE_MS = 10_000

function isGuardKilledResult(result: SingleResult): boolean {
  return result.stopReason === 'stalled' || result.stopReason === 'timeout'
}

/**
 * Terminal event for a detached (background) run — the host's only delivery signal:
 * it persists a result card in the timeline and wakes the orchestrator.
 */
function emitSubagentRunCompleted(args: {
  runId: string
  mode: SyloSubagentRunMode
  agent: string
  task: string
  result: SingleResult
  groupRunId?: string
  files?: string[]
}): void {
  const result = args.result
  const failed = isFailedResult(result)
  notifySyloSubagent({
    type: 'subagent_run_completed',
    runId: args.runId,
    mode: args.mode,
    agent: args.agent,
    task: args.task,
    status: failed ? 'failed' : 'succeeded',
    resultText: failed ? undefined : getResultOutput(result),
    ...(failed ? { error: getResultOutput(result) } : {}),
    ...(result.model ? { model: result.model } : {}),
    ...(args.groupRunId ? { groupRunId: args.groupRunId } : {}),
    ...(args.files && args.files.length > 0 ? { files: args.files } : {}),
    usage: {
      input: result.usage.input,
      output: result.usage.output,
      cost: result.usage.cost,
      turns: result.usage.turns,
    },
  })
}

// ── notify:"all" — hold a background dispatch group's completions until every run is
// terminal, then deliver them back-to-back (the host batches them into ONE wake + cards).
// Unregistered groups (notify:"each", single runs) deliver immediately.
type SubagentCompletedEvent = Extract<
  Parameters<typeof notifySyloSubagent>[0],
  { type: 'subagent_run_completed' }
>

type SubagentCompletedArgs = Parameters<typeof emitSubagentRunCompleted>[0]
type GroupNotifyState = { total: number; done: number; events: SubagentCompletedEvent[] }
const groupNotifyAll = new Map()

/** Shape the wire event from the emit args (shared by the hold path). */
function makeCompletedEvent(args: SubagentCompletedArgs): SubagentCompletedEvent {
  const result = args.result
  const failed = isFailedResult(result)
  return {
    type: 'subagent_run_completed',
    runId: args.runId,
    mode: args.mode,
    agent: args.agent,
    task: args.task,
    status: failed ? 'failed' : 'succeeded',
    resultText: failed ? undefined : getResultOutput(result),
    ...(failed ? { error: getResultOutput(result) } : {}),
    ...(result.model ? { model: result.model } : {}),
    ...(args.groupRunId ? { groupRunId: args.groupRunId } : {}),
    ...(args.files && args.files.length > 0 ? { files: args.files } : {}),
    usage: {
      input: result.usage.input,
      output: result.usage.output,
      cost: result.usage.cost,
      turns: result.usage.turns,
    },
  }
}

/** Deliver one shaped completed event; holds it when its group runs under notify:"all". */
function deliverSubagentEvent(event: SubagentCompletedEvent): void {
  const g = event.groupRunId ? groupNotifyAll.get(event.groupRunId) : undefined
  if (!g) {
    notifySyloSubagent(event)
    return
  }
  g.done++
  g.events.push(event)
  if (g.done >= g.total && g.total > 0) {
    groupNotifyAll.delete(event.groupRunId!)
    for (const e of g.events) notifySyloSubagent(e)
  }
}

/** Route ONE background completion. With notify:"all", buffer until the group's count
 *  reaches its (reconciled) total; at that point flush every buffered event in order. */
function deliverBackgroundCompleted(args: SubagentCompletedArgs): void {
  deliverSubagentEvent(makeCompletedEvent(args))
}

function isFailedResult(result: SingleResult): boolean {
  // A paused run is parked, not failed — its exit code is the pause kill's.
  if (result.stopReason === 'paused') return false
  return (
    result.exitCode !== 0 ||
    result.stopReason === 'error' ||
    result.stopReason === 'aborted' ||
    // A killed child can still report exit code 0, so the reason has to be checked
    // too — otherwise a stalled run is handed to the parent as finished work.
    isGuardKilledResult(result)
  )
}

/**
 * A child the provider cut off at its per-reply token cap. The process exited 0, so
 * without this check its partial text is handed to the parent as a finished result and
 * the step is silently half-done. The parent has to be told to re-run it.
 */
function isTruncatedResult(result: SingleResult): boolean {
  return result.stopReason === 'length'
}

const TRUNCATED_RESULT_NOTE =
  '[INCOMPLETE: this subagent hit its per-reply token cap, so the text above stops mid-answer and the step is NOT finished. Re-run the same agent to finish it (narrower task, or tell it to continue), or raise Max tokens in Sylo Settings → Model. Do not treat this as done and do not finish the work yourself in the parent.]'

function withTruncationNote(result: SingleResult, text: string): string {
  return isTruncatedResult(result) ? `${text}\n\n${TRUNCATED_RESULT_NOTE}` : text
}

/** Retry guidance for a child that failed outright, so the parent acts instead of stalling. */
const FAILED_RESULT_NOTE =
  '[This step did NOT run to completion. Retry it once with the same agent (tighten the task or shorten the context if it looks like a limit), and if it fails again report the failure plainly. Do not silently do the work in the parent and do not skip to a later step.]'

function getResultOutput(result: SingleResult): string {
  if (isFailedResult(result)) {
    const reason = result.errorMessage || result.stderr || ''
    if (isGuardKilledResult(result)) {
      // A stalled child often did real work before it went quiet. Keep that text and
      // say plainly that it was killed, so the parent resumes instead of restarting.
      const partial = getFinalOutput(result.messages)
      return partial ? `${partial}\n\n${reason}`.trim() : reason || '(no output)'
    }
    return reason || getFinalOutput(result.messages) || '(no output)'
  }
  return getFinalOutput(result.messages) || '(no output)'
}

function truncateParallelOutput(output: string): string {
  const byteLength = Buffer.byteLength(output, 'utf8')
  if (byteLength <= PER_TASK_OUTPUT_CAP) return output

  let truncated = output.slice(0, PER_TASK_OUTPUT_CAP)
  while (Buffer.byteLength(truncated, 'utf8') > PER_TASK_OUTPUT_CAP) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}\n\n[Output truncated for parent context. Full output is in tool details.]`
}

function formatTaskWithContext(context: string | undefined, task: string): string {
  const ctx = context?.trim()
  const body = task.replace(/^Task:\s*/i, '').trim()
  if (!ctx) return body
  return `${ctx}\n\n---\n\n${body}`
}

async function writePromptToTempFile(
  agentName: string,
  prompt: string,
): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sylo-subagent-'))
  const safeName = agentName.replace(/[^\w.-]+/g, '_')
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`)
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: 'utf-8', mode: 0o600 })
  })
  return { dir: tmpDir, filePath }
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results: TOut[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = nextIndex++
      if (current >= items.length) return
      results[current] = await fn(items[current], current)
    }
  })
  await Promise.all(workers)
  return results
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void

/**
 * Standard failed result for a run that never spawned (unknown persona, blocked
 * tool policy). No lifecycle events are emitted for these (the host records no
 * row — a “FAILED 0s” entry would be noise in the runs board), and they surface
 * through the tool result text instead.
 */
function resultForRefusedStart(
  agentName: string,
  task: string,
  step: number | undefined,
  runId: string,
  reason: string,
): SingleResult {
  return {
    agent: agentName,
    agentSource: 'unknown',
    task,
    exitCode: 1,
    messages: [],
    stderr: reason,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    step,
    runId,
  }
}

async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
  mode: SyloSubagentRunMode,
  runId: string,
  groupRunId: string,
  parentRunId?: string,
  goal?: string,
  /** Detached: tool returns at once; a detached tail drives end/completed events async. */
  background?: boolean,
): Promise<SingleResult> {
    const agent = agents.find((a) => a.name === agentName)
  if (!agent) {
    // Pre-spawn refusal: resolve BEFORE any lifecycle event so the host records no
    // phantom "FAILED 0s" run (B3) — the tool result alone tells the orchestrator.
    const unpinnedProject = discoverAgents(defaultCwd, resolveDefaultAgentScope(), {
      bundledAgentsDir: resolveBundledAgentsDir(),
    }).agents.some((a) => a.name === agentName && a.source === 'project')
    if (unpinnedProject) {
      return resultForRefusedStart(
        agentName,
        task,
        step,
        runId,
        `Unknown agent "${agentName}" — it is a project persona (.pi/agents) the operator has not activated. ` +
          'Open the Subagents modal (chat model bar) and pick a model for it to enable, or dispatch one of the activated personas.',
      )
    }
    const available = agents.map((a) => a.name).join(', ') || 'none'
    return resultForRefusedStart(
      agentName,
      task,
      step,
      runId,
      `Unknown agent "${agentName}". Available: ${available}.`,
    )
  }
  const subagentModel = subagentModelCliArgs(agent.name)
  const modelLabel =
    subagentModel.modelId ?
      subagentModel.provider ?
        `${subagentModel.provider}/${subagentModel.modelId}`
      : subagentModel.modelId
    : agent?.model

    notifySyloSubagent({
    type: 'subagent_run_start',
    runId,
    mode,
    agent: agentName,
    task,
    groupRunId,
    parentRunId,
    stepIndex: step,
    model: modelLabel,
    ...(goal?.trim() ? { goal: goal.trim() } : {}),
    ...(background ? { background: true } : {}),
  })

  // The child never loads Sylo's capability guard, so the operator's Capability
  // manager policy has to be turned into a `--tools` allowlist here or it simply
  // would not apply inside a subagent.
  const toolPolicy = resolveSubagentToolPolicy({ ...(agent.tools ? { agentTools: agent.tools } : {}) })
  if (toolPolicy.kind === 'blocked') {
    // Same pre-spawn rule: refuse with a message, record no run (B3).
    return resultForRefusedStart(
      agentName,
      task,
      step,
      runId,
      `Cannot run "${agentName}": ${toolPolicy.reason}`,
    )
  }

  const args: string[] = ['--mode', 'json', '-p', '--no-session']
  args.push(...subagentModel.args)
  args.push(...toolCliArgs(toolPolicy.tools))

  let tmpPromptDir: string | null = null
  let tmpPromptPath: string | null = null

  /** Unlink the appended-system-prompt temp files once the child no longer needs them. */
  const cleanupPromptFiles = () => {
    if (tmpPromptPath) {
      try {
        fs.unlinkSync(tmpPromptPath)
      } catch {
        /* ignore */
      }
      tmpPromptPath = null
    }
    if (tmpPromptDir) {
      try {
        fs.rmdirSync(tmpPromptDir)
      } catch {
        /* ignore */
      }
      tmpPromptDir = null
    }
    const mailboxDir = resolveAwaitMailboxDir()
    if (mailboxDir) {
      // Pause/resume mailbox for THIS run — nothing left to answer after the end.
      try {
        fs.rmSync(path.join(mailboxDir, `${runId}.answer.json`), { force: true })
      } catch {
        /* ignore */
      }
    }
  }

  const currentResult: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: '',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    model: modelLabel,
    step,
    runId,
  }

    // Tails of the message currently streaming, before it lands in `currentResult.messages`.
  let liveText = ''
  let liveThinking = ''
  // Kept after the reasoning channel closes so the box can collapse instead of vanish.
  let completedThinking = ''
  let liveToolName: string | undefined
  let liveToolPreview: string | undefined
  let updateTimer: ReturnType<typeof setTimeout> | undefined
  let updateQueued = false

  /**
   * Workspace files this run touches (write/edit-like tools) — first-touch order,
   * surfaced on the runs board / sylo_runs_list so a chat in another window can see
   * (and avoid) what this run is working on (F2: multi-session file collisions).
   */
  const touchedFiles: string[] = []
  const touchedSeen = new Set<string>()
  const noteFileTouch = (toolName: unknown, args: unknown): void => {
    if (typeof toolName !== 'string' || !toolName.trim()) return
    const name = toolName.trim().toLowerCase()
    if (!/^(write|edit|multiedit|notebook)/.test(name)) return
    if (!args || typeof args !== 'object') return
    const record = args as Record<string, unknown>
    for (const key of ['path', 'file_path', 'filepath', 'filename']) {
      const value = record[key]
      if (typeof value !== 'string' || !value.trim()) continue
      const file = value.trim()
      if (!touchedSeen.has(file)) {
        touchedSeen.add(file)
        touchedFiles.push(file)
        if (touchedFiles.length > 50) touchedSeen.clear() // stay bounded; newest wins
      }
      break
    }
  }

  const previewText = () => liveText.trim() || getFinalOutput(currentResult.messages)
  const previewThinking = () => liveThinking.trim() || completedThinking

    const emitUpdate = () => {
    notifySyloSubagent({
      type: 'subagent_run_update',
      runId,
      partialText: previewText() || undefined,
      // Always a string, never undefined: the store treats undefined as "leave alone".
      partialThinking: previewThinking(),
      thinkingLive: liveThinking.trim().length > 0 && !liveText.trim(),
      toolName: liveToolName,
      toolPreview: liveToolPreview ?? '',
      model: currentResult.model,
      files: touchedFiles.length > 0 ? touchedFiles.slice() : undefined,
    })
    if (onUpdate) {
      onUpdate({
        content: [{ type: 'text', text: previewText() || '(running...)' }],
        details: makeDetails([currentResult]),
      })
    }
  }

  /** Emit right away when idle, otherwise coalesce into one trailing emit per window. */
  const scheduleUpdate = () => {
    if (updateTimer) {
      updateQueued = true
      return
    }
    emitUpdate()
    updateTimer = setTimeout(() => {
      updateTimer = undefined
      if (!updateQueued) return
      updateQueued = false
      scheduleUpdate()
    }, LIVE_UPDATE_INTERVAL_MS)
  }

  const stopUpdates = () => {
    if (updateTimer) clearTimeout(updateTimer)
    updateTimer = undefined
    updateQueued = false
  }

  try {
    const fullSystem = [
      agent.systemPrompt.trim(),
      SUBAGENT_CHILD_MODE_BLOCK,
    ]
      .filter(Boolean)
      .join('\n\n')

    const tmp = await writePromptToTempFile(agent.name, fullSystem)
    tmpPromptDir = tmp.dir
    tmpPromptPath = tmp.filePath
    args.push('--append-system-prompt', tmpPromptPath)
    const childEnv: Record<string, string | undefined> = {}
    const awaitExtPath = resolveAwaitInputExtensionPath()
    const mailboxDir = resolveAwaitMailboxDir()
    if (awaitExtPath && mailboxDir) {
      // Pause/resume protocol (issue #27 P3): the child parks on await_user_input
      // and polls <mailbox>/<runId>.answer.json, which subagent_answer writes.
      args.push('-e', awaitExtPath)
      childEnv.SYLO_AWAIT_RUN_ID = runId
      childEnv.SYLO_AWAIT_MAILBOX = mailboxDir
      // Park ceiling: after this long without an answer, the child's tool returns
      // "proceed with best judgment" so nothing hangs forever.
      childEnv.SYLO_AWAIT_CEILING_SECONDS = '600'
    }
    // NOTE: task is piped via stdin (not as a CLI arg) to avoid Windows shell
    // mangling multi-line arguments when shell:true is used by resolvePiSpawn fallback.
    let wasAborted = false

    /**
     * Post-exit parse + end notifications + (background) run_completed — shared by the
     * blocking path and by the detached tail that continues after the tool resolved.
     */
        const finalize = async (exitCode: number): Promise<SingleResult> => {
      try {
        currentResult.exitCode = exitCode
        if (consumeRunPaused(runId)) {
          // Operator pause (runs board ⏸): the child is killed mid-turn, but the run
          // parks as `paused` — NOT cancelled, and no run_completed/chat result card:
          // pause is not a result. The partial preview is the resume point.
          currentResult.stopReason = 'paused'
          notifySyloSubagent({
            type: 'subagent_run_end',
            runId,
            status: 'paused',
            resultText: previewText() || undefined,
            thinking: previewThinking() || undefined,
            model: currentResult.model,
            files: touchedFiles.length > 0 ? touchedFiles.slice() : undefined,
            usage: {
              input: currentResult.usage.input,
              output: currentResult.usage.output,
              cost: currentResult.usage.cost,
              turns: currentResult.usage.turns,
            },
          })
          if (background) activeBackgroundRuns.delete(runId)
          return currentResult
        }
        if (wasAborted || consumeRunCancelled(runId)) {
          notifySyloSubagent({
            type: 'subagent_run_end',
            runId,
            status: 'cancelled',
            error: SUBAGENT_ABORTED_MESSAGE,
          })
          throw new Error(SUBAGENT_ABORTED_MESSAGE)
        }

                const failed = isFailedResult(currentResult)
        const resultText = failed ? undefined : getResultOutput(currentResult)
        currentResult.touchedFiles = touchedFiles.slice()
        notifySyloSubagent({
          type: 'subagent_run_end',
          runId,
          status: failed ? 'failed' : 'succeeded',
          resultText,
          thinking: previewThinking() || undefined,
          model: currentResult.model,
          error: failed ? getResultOutput(currentResult) : undefined,
          files: touchedFiles.length > 0 ? touchedFiles.slice() : undefined,
          usage: {
            input: currentResult.usage.input,
            output: currentResult.usage.output,
            cost: currentResult.usage.cost,
            turns: currentResult.usage.turns,
          },
        })
                if (background) {
          deliverBackgroundCompleted({
            runId,
            mode,
            agent: agentName,
            task,
            result: currentResult,
            groupRunId,
            files: touchedFiles.slice(),
          })
          activeBackgroundRuns.delete(runId)
        }
        return currentResult
        return currentResult
      } finally {
        cleanupPromptFiles()
      }
    }

    const spawned = new Promise<number>((resolve) => {
      const invocation = resolvePiSpawn(args)
      const proc = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        shell: invocation.shell ?? false,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(Object.keys(childEnv).length > 0 ? { env: { ...process.env, ...childEnv } } : {}),
      })
      // Pipe the task via stdin so it survives shell:true on Windows
      try { proc.stdin.write(task); proc.stdin.end() } catch { /* process may have exited early */ }
      registerSubagentRun(runId, proc, { agent: agentName, task, mode, groupRunId })
      if (background) activeBackgroundRuns.add(runId)
      const dropRegistry = () => unregisterSubagentRun(runId)
      let buffer = ''
      let timeout: ReturnType<typeof setTimeout> | undefined
      let stallTimer: ReturnType<typeof setInterval> | undefined
      let forcedFinish: ReturnType<typeof setTimeout> | undefined
      let lastActivityAt = Date.now()
      let guardKilled = false
      let settled = false

      const finish = (code: number) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        if (stallTimer) clearInterval(stallTimer)
        if (forcedFinish) clearTimeout(forcedFinish)
        stopUpdates()
        resolve(code)
      }

      const timeoutMs = resolveSubagentTimeoutMs({
        timeoutSeconds: agent.timeoutSeconds,
        provider: subagentModel.provider,
      })
      const stallMs = resolveSubagentStallMs({ provider: subagentModel.provider })
      /**
       * The guard's own kill is not allowed to be the thing that hangs. A killed shell
       * can leave the real child holding the stdio pipes, and `close` waits for those,
       * so the run has to be able to end on the guard's clock instead.
       */
      const killForGuard = (reason: SubagentGuardReason, line: string) => {
        if (guardKilled) return
        guardKilled = true
        currentResult.stderr += `\n${line}`
        // Recorded on the result too: a guard kill that arrives as exit code 0 (or as a
        // null code, which `close` reports for a signalled child) must not read as success.
        currentResult.stopReason = reason
        currentResult.errorMessage = line.trim()
        killSubagentTree(proc)
        forcedFinish = setTimeout(() => finish(1), GUARD_FINALIZE_GRACE_MS)
        forcedFinish.unref()
      }
      const bumpActivity = () => {
        lastActivityAt = Date.now()
      }
      timeout = setTimeout(() => {
        killForGuard(
          'timeout',
          `[timeout] Subagent exceeded time limit (${Math.round(timeoutMs / 1000)}s).`,
        )
      }, timeoutMs)
      stallTimer = setInterval(() => {
        const idleMs = Date.now() - lastActivityAt
        if (idleMs < stallMs) return
        killForGuard(
          'stalled',
          `[stall] Subagent produced no output for ${Math.round(idleMs / 1000)}s. Its last tool call never returned.`,
        )
      }, 5_000)

      type ChildEvent = {
        type?: string
        message?: Message
        assistantMessageEvent?: { type?: string; delta?: string }
        toolName?: string
        args?: unknown
      }

      const processLine = (line: string) => {
        if (!line.trim()) return
        let event: ChildEvent
        try {
          event = JSON.parse(line) as ChildEvent
        } catch {
          return
        }

        // Pi wraps streaming deltas in message_update. Without these the box shows nothing
        // until a whole message completes, which on a reasoning model is minutes of silence.
        if (event.type === 'message_update') {
          const am = event.assistantMessageEvent
          if (typeof am?.delta !== 'string' || am.delta === '') return
          if (am.type === 'text_delta') liveText = appendPreviewTail(liveText, am.delta)
          else if (am.type === 'thinking_delta') liveThinking = appendPreviewTail(liveThinking, am.delta)
          else return
          bumpActivity()
          scheduleUpdate()
          return
        }

        if (event.type === 'tool_execution_update') {
          // Parked-run heartbeat (await_user_input) or a long tool — keeps the stall
          // guard from killing a healthy quiet child.
          if (typeof event.toolName === 'string' && event.toolName) liveToolName = event.toolName
          bumpActivity()
          scheduleUpdate()
          return
        }

                if (event.type === 'tool_execution_start') {
          liveToolName = typeof event.toolName === 'string' ? event.toolName : undefined
          liveToolPreview = summarizeToolArgs(event.args)
          noteFileTouch(liveToolName, event.args)
          bumpActivity()
          scheduleUpdate()
          // Pause/resume protocol (issue #27 P3): the child just parked on
          // await_user_input — relay the question to the host/operator.
          if (liveToolName === 'await_user_input') {
            const q = event.args as
              | { question?: unknown; what_i_tried?: unknown; context_digest?: unknown }
              | undefined
            notifySyloSubagent({
              type: 'subagent_run_awaiting_input',
              runId,
              mode,
              agent: agentName,
              task,
              question:
                typeof q?.question === 'string' && q.question.trim() ?
                  q.question
                : '(the agent did not phrase its question — ask it to clarify)',
              ...(typeof q?.what_i_tried === 'string' && q.what_i_tried ? { what_i_tried: q.what_i_tried } : {}),
              ...(typeof q?.context_digest === 'string' && q.context_digest ? { context_digest: q.context_digest } : {}),
              ...(currentResult.model ? { model: currentResult.model } : {}),
            })
          }
          return
        }

        if (event.type === 'message_end' && event.message) {
          const msg = event.message
          currentResult.messages.push(msg)
          const fromMsg = thinkingFromMessage(msg)
          if (fromMsg || liveThinking.trim()) {
            completedThinking = fromMsg || liveThinking.trim()
          }
          // The finished message is the source of truth now; drop the streaming tail so the
          // preview does not show it twice. Keep completedThinking for the collapsed box.
          liveText = ''
          liveThinking = ''

          bumpActivity()
          if (msg.role === 'assistant') {
            currentResult.usage.turns++
            const usage = msg.usage
            if (usage) {
              currentResult.usage.input += usage.input || 0
              currentResult.usage.output += usage.output || 0
              currentResult.usage.cacheRead += usage.cacheRead || 0
              currentResult.usage.cacheWrite += usage.cacheWrite || 0
              currentResult.usage.cost += usage.cost?.total || 0
              currentResult.usage.contextTokens = usage.totalTokens || 0
            }
            if (!currentResult.model && msg.model) currentResult.model = msg.model
            if (msg.stopReason) currentResult.stopReason = msg.stopReason
            if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage
          }
          emitUpdate()
        }

        if (event.type === 'tool_result_end' && event.message) {
          currentResult.messages.push(event.message)
          bumpActivity()
          emitUpdate()
        }
      }

      proc.stdout.on('data', (data) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) processLine(line)
      })

      proc.stderr.on('data', (data) => {
        currentResult.stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (buffer.trim()) processLine(buffer)
        dropRegistry()
        // A null code means the child died on a signal, never that it succeeded.
        finish(code ?? 1)
      })

      proc.on('error', () => {
        dropRegistry()
        finish(1)
      })

      if (signal) {
        const killProc = () => {
          wasAborted = true
          killSubagentTree(proc)
        }
        if (signal.aborted) killProc()
        else signal.addEventListener('abort', killProc, { once: true })
      }
    })

    if (background) {
      // Detached: the tool call already resolved with its "started" result. Everything
      // after spawn — parse, run_end, run_completed, temp-file cleanup — drives itself.
      void spawned
        .then((code) => finalize(code))
        .then(() => undefined)
                .catch((error: unknown) => {
          // finalize threw after it had already notified run_end (cancelled/abort path,
          // or an unexpected throw). The completed event is the host's only delivery
          // signal for detached runs, so it must still land.
          activeBackgroundRuns.delete(runId)
          deliverSubagentEvent({
            type: 'subagent_run_completed',
            runId,
            mode,
            agent: agentName,
            task,
            status: 'cancelled',
            error: error instanceof Error ? error.message : String(error),
            ...(groupRunId ? { groupRunId } : {}),
          })
        })
      return currentResult
    }

    return await finalize(await spawned)
  } catch (error) {
    // Setup failure before/without a spawn (temp-file write, synchronous spawn throw):
    // free the slot and clean the prompt files here — finalize never ran.
    activeBackgroundRuns.delete(runId)
    cleanupPromptFiles()
    tmpPromptPath = null
    tmpPromptDir = null
    throw error
  }
}

export type ForcedSubagentOutcome = {
  agent: string
  model?: string
  status: 'succeeded' | 'failed' | 'cancelled'
  output: string
}

/**
 * Run agents without going through the `subagent` tool.
 *
 * The tool path is the orchestrator delegating by its own judgment, which it is
 * free to skip. This is the operator forcing the delegation with an `@mention`:
 * the host drives the run itself so a pinned persona model is guaranteed to do
 * the work. Lifecycle events are identical, so the runs strip, the Tasks
 * dashboard, and per-run cancel all keep working.
 */
/**
 * Operator pause of a background chain — the unit's remaining steps, keyed by group
 * run id. Host rows only carry per-step specs; the unit's future lives only here,
 * consumed by `resumeSubagentRun` (lost on broker exit — the board says so).
 */
type ChainResumeState = {
  cwd: string
  groupRunId: string
  chainSteps: Array<{ agent: string; task: string; cwd?: string; goal?: string }>
  chainTask: string
  descriptor: string
  nextIndex: number
  previousOutput: string
  anchorRunId: string
  parentOfNext?: string
  contextPacket?: string
  agentScope: AgentScope
  projectAgentsDir: string | null
}
const chainResumeState = new Map<string, ChainResumeState>()

export async function runForcedSubagentChain(opts: {
  cwd: string
  agentNames: string[]
  task: string
  agentScope?: AgentScope
  signal?: AbortSignal
}): Promise<ForcedSubagentOutcome[]> {
  const { cwd, agentNames, task, signal } = opts
  const agentScope = opts.agentScope ?? resolveDefaultAgentScope()
  const discovery = discoverAgents(cwd, agentScope, {
    bundledAgentsDir: resolveBundledAgentsDir(),
  })
  const agents = filterActiveAgents(discovery.agents)
  const projectAgentsDir = discovery.projectAgentsDir

  // An @mention naming an unactivated project persona deserves a real reason, not
  // "unknown agent" — the file exists, the operator just hasn't picked a model for it.
  const unpinned = agentNames.filter((n) => {
    const found = discovery.agents.find((a) => a.name === n)
    return found && found.source === 'project' && !activeProjectAgentNames().has(n)
  })
  if (unpinned.length > 0) {
    return [
      {
        agent: unpinned[0]!,
        status: 'failed',
        output:
          `Not active: "${unpinned[0]}" comes from this repo's .pi/agents — ` +
          'open the Subagents modal (chat model bar) and pick a model for it to enable. ' +
          'Repo files list personas there; they only run after you pick one.',
      },
    ]
  }

  const mode: SyloSubagentRunMode = agentNames.length > 1 ? 'chain' : 'single'
  const makeDetails = (results: SingleResult[]): SubagentDetails => ({
    mode,
    agentScope,
    projectAgentsDir,
    results,
  })

  const outcomes: ForcedSubagentOutcome[] = []
  const groupRunId = newSubagentRunId()
  let parentRunId: string | undefined
  let previous: { agent: string; output: string } | undefined

  for (let i = 0; i < agentNames.length; i++) {
    const agentName = agentNames[i]!
    const stepTask = previous ? chainStepTask(task, previous) : task
    const runId = newSubagentRunId()

    let result: SingleResult
    try {
      result = await runSingleAgent(
        cwd,
        agents,
        agentName,
        stepTask,
        undefined,
        agentNames.length > 1 ? i + 1 : undefined,
        signal,
        undefined,
        makeDetails,
        mode,
        runId,
        groupRunId,
        parentRunId,
      )
    } catch (e) {
      // Only an abort has already reported itself as `cancelled`; anything else
      // is a real failure, and calling it "cancelled" told the operator they
      // had stopped the run while hiding the actual error.
      const detail = e instanceof Error ? e.message : String(e)
      const stopped = signal?.aborted === true || detail === SUBAGENT_ABORTED_MESSAGE
      outcomes.push(
        stopped ?
          { agent: agentName, status: 'cancelled', output: 'Run was cancelled.' }
        : { agent: agentName, status: 'failed', output: `Subagent failed to start: ${detail}` },
      )
      return outcomes
    }

    const output = getResultOutput(result)
    if (isFailedResult(result)) {
      outcomes.push({ agent: agentName, model: result.model, status: 'failed', output })
      // Later steps consume earlier output, so a failed step makes the rest meaningless.
      return outcomes
    }

    outcomes.push({ agent: agentName, model: result.model, status: 'succeeded', output })
    parentRunId = runId
    previous = { agent: agentName, output }
  }

  return outcomes
}

/**
 * Runs-board ▶ for a PAUSED background chain: re-drive the unit's remaining steps.
 * The anchor row (paused pending/step row) is reused — runSingleAgent emits run_start
 * for it and the host upserts the row back to `running` in place. Pause handling
 * mirrors the tool's driveChain so a resumed chain can be paused again.
 */
async function resumeChainForGroup(state: ChainResumeState): Promise<void> {
  const discovery = discoverAgents(state.cwd, state.agentScope, {
    bundledAgentsDir: resolveBundledAgentsDir(),
  })
  const agents = filterActiveAgents(discovery.agents)
  const makeDetails = (results: SingleResult[]): SubagentDetails => ({
    mode: 'chain',
    agentScope: state.agentScope,
    projectAgentsDir: state.projectAgentsDir,
    results,
  })
  const results: SingleResult[] = []
  let previousOutput = state.previousOutput
  let parentRunId: string | undefined = state.parentOfNext

  for (let i = state.nextIndex; i < state.chainSteps.length; i++) {
    const step = state.chainSteps[i]!
    if (consumePauseRequest(state.groupRunId)) {
      // Paused again while still alive: the anchor stays where it is (already
      // `paused` or running→paused via its own child) — park the unit and stop.
      chainResumeState.set(state.groupRunId, { ...state, nextIndex: i, previousOutput })
      return
    }
    const taskWithContext = formatTaskWithContext(
      state.contextPacket,
      step.task.replace(/\{previous\}/g, previousOutput),
    )
    const runId = i === state.nextIndex ? state.anchorRunId : newSubagentRunId()
    const result = await runSingleAgent(
      state.cwd,
      agents,
      step.agent,
      taskWithContext,
      step.cwd,
      i + 1,
      undefined,
      undefined,
      makeDetails,
      'chain',
      runId,
      state.groupRunId,
      parentRunId,
      step.goal,
      // Sequential steps block each other — the UNIT detaches, not each step.
      false,
    )
    results.push(result)
    if (result.stopReason === 'paused') {
      consumePauseRequest(state.groupRunId)
      chainResumeState.set(state.groupRunId, {
        ...state,
        nextIndex: i,
        previousOutput,
        anchorRunId: runId,
        parentOfNext: parentRunId,
      })
      return
    }
    if (isFailedResult(result)) {
      chainResumeState.delete(state.groupRunId)
      emitSubagentRunCompleted({
        runId,
        mode: 'chain',
        agent: state.descriptor,
        task: state.chainTask,
        result,
        groupRunId: state.groupRunId,
      })
      return
    }
    previousOutput = withTruncationNote(result, getFinalOutput(result.messages))
    parentRunId = runId
  }

  chainResumeState.delete(state.groupRunId)
  const last =
    results[results.length - 1] ??
    resultForRefusedStart(state.descriptor, state.chainTask, undefined, newSubagentRunId(), 'Resumed chain produced no output')
    emitSubagentRunCompleted({
    runId: last.runId ?? newSubagentRunId(),
    mode: 'chain',
    agent: state.descriptor,
    task: state.chainTask,
    result: last,
    groupRunId: state.groupRunId,
  })
}

/**
 * Runs-board ⏸→▶ resume: re-dispatch a paused run, reusing its agent_tasks row.
 * - single: continuation prompt primes from the stored partial output; the row is
 *   reset to `running` when the child's run_start arrives (upsert).
 * - chain: driven from the in-memory ChainResumeState — unavailable after a broker
 *   exit, which is reported instead of guessed at.
 */
export function resumeSubagentRun(opts: {
  cwd: string
  runId: string
  mode: 'single' | 'chain'
  agentName?: string
  task?: string
  lastPartialText?: string
  groupRunId?: string | null
}): { ok: true } | { ok: false; error: string } {
  if (opts.mode === 'chain') {
    const state = opts.groupRunId ? chainResumeState.get(opts.groupRunId) : undefined
    if (!state) {
      return {
        ok: false,
        error: 'Chain context lost (broker restarted) — re-dispatch the remaining steps from chat.',
      }
    }
    chainResumeState.delete(state.groupRunId)
    void resumeChainForGroup(state).catch((error) => {
      chainResumeState.set(state.groupRunId, state)
      emitSubagentRunCompleted({
        runId: state.anchorRunId,
        mode: 'chain',
        agent: state.descriptor,
        task: state.chainTask,
        groupRunId: state.groupRunId,
        result: {
          agent: state.descriptor,
          agentSource: 'unknown',
          task: state.chainTask,
          exitCode: 1,
          messages: [],
          stderr: error instanceof Error ? error.message : String(error),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        },
      })
    })
    return { ok: true }
  }

  const agentName = opts.agentName?.trim() || ''
  const task = opts.task?.trim() || ''
  if (!agentName || !task) return { ok: false, error: 'bad_spec' }
  const discovery = discoverAgents(opts.cwd, resolveDefaultAgentScope(), {
    bundledAgentsDir: resolveBundledAgentsDir(),
  })
  const agents = filterActiveAgents(discovery.agents)
  if (!agents.some((a) => a.name === agentName)) {
    return { ok: false, error: `Unknown agent "${agentName}" — it may have changed since the run started; re-dispatch from chat.` }
  }
  const makeDetails = (results: SingleResult[]): SubagentDetails => ({
    mode: 'single',
    agentScope: resolveDefaultAgentScope(),
    projectAgentsDir: discovery.projectAgentsDir,
    results,
  })
  const partial = opts.lastPartialText?.trim()
  const CONTINUATION_MARK = '---PAUSED-RUN-CONTINUATION---'
  const resumeTask = partial
    ? `${task}\n\n${CONTINUATION_MARK}\nThe operator PAUSED this run mid-work; the attempt was stopped. Your last visible output (verbatim tail):\n${partial.slice(-6000)}\n---END---\nPick up where that left off: re-verify any file edits the run already made, then finish the task.`
    : `${task}\n\n${CONTINUATION_MARK}\nThe operator paused this run before any visible progress. Run the task from the start.`
  void runSingleAgent(
    opts.cwd,
    agents,
    agentName,
    resumeTask,
    undefined,
    undefined,
    undefined,
    undefined,
    makeDetails,
    'single',
    opts.runId,
    opts.runId,
    undefined,
    undefined,
    true,
  ).catch((error) => {
    console.error('[subagent resume] run failed:', error)
  })
  return { ok: true }
}

const GOAL_DESCRIPTION =
  'Exact plan goal heading this step works, copied from the plan file without the `## [ ]` marker. Sylo ticks that goal when a reviewer passes it.'

const TaskItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task to delegate to the agent' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
  goal: Type.Optional(Type.String({ description: GOAL_DESCRIPTION })),
})

const ChainItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task with optional {previous} placeholder for prior output' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
  goal: Type.Optional(Type.String({ description: GOAL_DESCRIPTION })),
})

const AgentScopeSchema = StringEnum(['user', 'project', 'both'] as const, {
  description: 'Which agent directories to use. Default: "user" includes Sylo builtins.',
  default: 'user',
})

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: 'Name of the agent to invoke (for single mode)' })),
  task: Type.Optional(Type.String({ description: 'Task to delegate (for single mode)' })),
  goal: Type.Optional(Type.String({ description: `${GOAL_DESCRIPTION} (single mode)` })),
  tasks: Type.Optional(
    Type.Array(TaskItem, { description: 'Array of {agent, task} for parallel execution' }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, { description: 'Array of {agent, task} for sequential execution' }),
  ),
  context: Type.Optional(
    Type.String({
      description:
        'Curated context packet for the subagent (not parent chat history). Prepended to each task.',
    }),
  ),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({
      description: 'Prompt before running project-local agents. Default: true when Pi UI is available.',
      default: true,
    }),
  ),
  /**
   * Block until the run(s) finish and return results here. Default (false): run in the
   * background — the tool returns at once with run ids, and every finished run posts its
   * full result as a message you can act on. Chain/parallel: the whole unit detaches.
   */
    wait: Type.Optional(Type.Boolean({ default: false })),
  /** Background parallel/chain dispatches: "each" (default) posts one wake + chat card per
   *  finished run; "all" holds every result and delivers one combined wake once every run
   *  of the dispatch group is terminal. Ignored with wait:true. */
  notify: Type.Optional(
    Type.Union([Type.Literal('each'), Type.Literal('all')], {
      description:
        'With wait:false and multiple tasks: "all" = ONE notification after every run of this dispatch is done; "each" (default) = a message per finished run, as it finishes.',
    }),
  ),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process (single mode)' })),
})

export default function syloSubagentsExtension(pi: ExtensionAPI): void {
  registerRunsListTool(pi)
  pi.registerTool({
    name: 'subagent',
    label: 'Subagent',
    description: [
      'Delegate tasks to specialized subagents with isolated context.',
      'Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).',
      'Runs are BACKGROUND by default: the tool returns at once with run ids, and each finished run posts its full result as a message you can act on. Dispatch what the goal needs, then END YOUR TURN — completions wake you. Do not wait, poll, or re-dispatch while a run is in flight.',
            'notify:"all" batches delivery: one combined notification after every run of the dispatch finished (vs the default per-run wake).',
      'Pass wait:true only when this turn cannot proceed without the result in hand (e.g. the next step consumes it).',
      'Project personas (.pi/agents, repo-controlled) are listed in the Subagents modal but only run after the operator picked a model for them there — if a persona from that dir is missing here, it is not activated.',
    ].join(' '),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agentScope: AgentScope = params.agentScope ?? resolveDefaultAgentScope()
      const discovery = discoverAgents(ctx.cwd, agentScope, {
        bundledAgentsDir: resolveBundledAgentsDir(),
      })
      const agents = filterActiveAgents(discovery.agents)
      const confirmProjectAgents = params.confirmProjectAgents ?? true
      const contextPacket = params.context

      const hasChain = (params.chain?.length ?? 0) > 0
      const hasTasks = (params.tasks?.length ?? 0) > 0
      const hasSingle = Boolean(params.agent && params.task)
      const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle)

      const makeDetails =
        (mode: SyloSubagentRunMode) =>
        (results: SingleResult[]): SubagentDetails => ({
          mode,
          agentScope,
          projectAgentsDir: discovery.projectAgentsDir,
          results,
        })

      if (modeCount !== 1) {
        const available = agents.map((a) => `${a.name} (${a.source})`).join(', ') || 'none'
        return {
          content: [
            {
              type: 'text',
              text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
            },
          ],
          details: makeDetails('single')([]),
        }
      }

      if (
        (agentScope === 'project' || agentScope === 'both') &&
        confirmProjectAgents &&
        ctx.hasUI
      ) {
        const requestedAgentNames = new Set<string>()
        if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent)
        if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent)
        if (params.agent) requestedAgentNames.add(params.agent)

        const projectAgentsRequested = Array.from(requestedAgentNames)
          .map((name) => agents.find((a) => a.name === name))
          .filter((a): a is AgentConfig => a?.source === 'project')

        if (projectAgentsRequested.length > 0) {
          const names = projectAgentsRequested.map((a) => a.name).join(', ')
          const dir = discovery.projectAgentsDir ?? '(unknown)'
          const ok = await ctx.ui.confirm(
            'Run project-local agents?',
            `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
          )
          if (!ok) {
            return {
              content: [{ type: 'text', text: 'Canceled: project-local agents not approved.' }],
              details: makeDetails(hasChain ? 'chain' : hasTasks ? 'parallel' : 'single')([]),
            }
          }
        }
      }

      if (params.chain && params.chain.length > 0) {
        const chainSteps = params.chain
        const chainTask = chainSteps[0]?.task ?? params.task ?? ''
        /**
         * Drive the whole chain. Blocking mode awaits it here; background mode detaches
         * it and reports one terminal run_completed for the unit (per-step run_end rows
         * still stream either way).
         */
                                const driveChain = async (): Promise<{
          results: SingleResult[]
          stopped: { step: number; agent: string; output: string } | null
          groupRunId: string
          paused?: { nextIndex: number; previousOutput: string; anchorRunId: string; parentOfNext?: string }
        }> => {
          const results: SingleResult[] = []
          let previousOutput = ''
          const groupRunId = newSubagentRunId()
          let parentRunId: string | undefined

          for (let i = 0; i < chainSteps.length; i++) {
            if (i > 0 && consumePauseRequest(groupRunId)) {
              // Operator pause landed between steps: the next prompt is NOT fed back in.
              // Emit a paused anchor row for the pending step — the board's ▶ button
              // resumes the unit from it (run_start upsert flips the row back to running).
              const anchorRunId = newSubagentRunId()
              const nextStep = chainSteps[i]!
              const pendingTask = formatTaskWithContext(
                contextPacket,
                nextStep.task.replace(/\{previous\}/g, previousOutput),
              )
              notifySyloSubagent({
                type: 'subagent_run_start',
                runId: anchorRunId,
                mode: 'chain',
                agent: nextStep.agent,
                task: pendingTask,
                groupRunId,
                parentRunId,
                stepIndex: i + 1,
                background: true,
              })
              notifySyloSubagent({
                type: 'subagent_run_end',
                runId: anchorRunId,
                status: 'paused',
                resultText: `Chain paused before step ${i + 1} of ${chainSteps.length} — ${chainSteps.length - i} step${chainSteps.length - i === 1 ? '' : 's'} pending.`,
              })
              return { results, stopped: null, groupRunId, paused: { nextIndex: i, previousOutput, anchorRunId, parentOfNext: parentRunId } }
            }
            const step = chainSteps[i]!
            const taskWithContext = formatTaskWithContext(
              contextPacket,
              step.task.replace(/\{previous\}/g, previousOutput),
            )
            const runId = newSubagentRunId()

            const chainUpdate: OnUpdateCallback | undefined =
              params.wait && onUpdate
                ? (partial) => {
                    const currentResult = partial.details?.results[0]
                    if (currentResult) {
                      onUpdate!({
                        content: partial.content,
                        details: makeDetails('chain')([...results, currentResult]),
                      })
                    }
                  }
                : undefined

            const result = await runSingleAgent(
              ctx.cwd,
              agents,
              step.agent,
              taskWithContext,
              step.cwd,
              i + 1,
              // A detached chain outlives the tool call — the per-call signal must not
              // kill it, and a parked/running child is stopped via the run registry.
              params.wait ? signal : undefined,
              chainUpdate,
              makeDetails('chain'),
              'chain',
              runId,
              groupRunId,
              parentRunId,
              step.goal,
              // Sequential steps block each other — the UNIT detaches, not each step.
              false,
            )
                        results.push(result)

            if (result.stopReason === 'paused') {
              // A ⏸ with the step child mid-flight: its own finalize already flipped its
              // row to `paused`. This step is INCOMPLETE — resume redoes it, reusing the
              // same anchor row. Consume the unit flag so nothing double-consumes it.
              consumePauseRequest(groupRunId)
              return { results, stopped: null, groupRunId, paused: { nextIndex: i, previousOutput, anchorRunId: runId, parentOfNext: parentRunId } }
            }

                        if (isFailedResult(result)) {
              return {
                results,
                stopped: { step: i + 1, agent: step.agent, output: getResultOutput(result) },
                groupRunId,
              }
            }
            previousOutput = withTruncationNote(result, getFinalOutput(result.messages))
            parentRunId = runId
          }

                    return { results, stopped: null, groupRunId }
        }

        if (!params.wait) {
          if (activeBackgroundRuns.size >= MAX_BACKGROUND_RUNS) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Cannot start: ${activeBackgroundRuns.size} background runs are already in flight (max ${MAX_BACKGROUND_RUNS}). Wait for a completion message, or have a running task stopped first.`,
                },
              ],
              details: makeDetails('chain')([]),
              isError: true,
            }
          }
          const chainSlot = newSubagentRunId()
          activeBackgroundRuns.add(chainSlot)
          const chainDescriptor = chainSteps.map((step) => step.agent).join(' → ')
          void (async () => {
                        try {
              const { results, stopped, groupRunId, paused } = await driveChain()
              if (paused) {
                // Unit parked — NOT terminal, nothing delivered to chat. Keep the
                // remaining steps for the board's ▶ (resume); the paused anchor row
                // is the resume button's row.
                chainResumeState.set(groupRunId, {
                  cwd: ctx.cwd,
                  groupRunId,
                  chainSteps,
                  chainTask,
                  descriptor: chainDescriptor,
                  nextIndex: paused.nextIndex,
                  previousOutput: paused.previousOutput,
                  anchorRunId: paused.anchorRunId,
                  parentOfNext: paused.parentOfNext,
                  contextPacket,
                  agentScope,
                  projectAgentsDir: discovery.projectAgentsDir,
                })
                return
              }
              const last = results[results.length - 1]
              const failed = stopped !== null || !last || isFailedResult(last)
              const deliverable =
                stopped !== null
                  ? stopped.output
                  : last ? getResultOutput(last) : 'Chain produced no output.'
              // Files the unit touched, union across steps (board presence, F2).
              const filesUnion: string[] = []
              const seenFiles = new Set<string>()
              for (const step of results) {
                for (const file of step.touchedFiles ?? []) {
                  if (seenFiles.has(file)) continue
                  seenFiles.add(file)
                  filesUnion.push(file)
                }
              }
              notifySyloSubagent({
                type: 'subagent_run_completed',
                // Delivery attribution resolves via an existing agent_tasks row — use
                // the final step's runId (rows are per step; the group id has no row).
                runId: last?.runId ?? newSubagentRunId(),
                mode: 'chain',
                agent: chainDescriptor,
                task: chainTask,
                status: failed ? 'failed' : 'succeeded',
                ...(failed ? { error: deliverable } : { resultText: deliverable }),
                ...(last?.model ? { model: last.model } : {}),
                ...(groupRunId ? { groupRunId } : {}),
                ...(filesUnion.length > 0 ? { files: filesUnion.slice(0, 50) } : {}),
              })
            } catch (error) {
              notifySyloSubagent({
                type: 'subagent_run_completed',
                runId: newSubagentRunId(),
                mode: 'chain',
                agent: chainDescriptor,
                task: chainTask,
                status: 'cancelled',
                error: error instanceof Error ? error.message : String(error),
              })
            } finally {
              activeBackgroundRuns.delete(chainSlot)
            }
          })()
          return {
            content: [
              {
                type: 'text',
                text: `Started background chain of ${chainSteps.length} step${chainSteps.length === 1 ? '' : 's'}: ${chainDescriptor}.\nPer-step runs are tracked as usual; the final result arrives as a message when the chain ends. End your turn now — do not wait or poll. To block instead, re-dispatch with wait:true.`,
              },
            ],
            details: makeDetails('chain')([]),
          }
        }

        const { results, stopped } = await driveChain()
        if (stopped) {
          return {
            content: [
              {
                type: 'text',
                text: `Chain stopped at step ${stopped.step} (${stopped.agent}): ${stopped.output}\n\n${FAILED_RESULT_NOTE}`,
              },
            ],
            details: makeDetails('chain')(results),
            isError: true,
          }
        }
        const lastStep = results[results.length - 1]!
        return {
          content: [
            {
              type: 'text',
              text: withTruncationNote(
                lastStep,
                getFinalOutput(lastStep.messages) || '(no output)',
              ),
            },
          ],
          details: makeDetails('chain')(results),
          ...(results.some(isTruncatedResult) ? { isError: true as const } : {}),
        }
      }

      if (params.tasks && params.tasks.length > 0) {
        if (params.tasks.length > MAX_PARALLEL_TASKS) {
          return {
            content: [
              {
                type: 'text',
                text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
              },
            ],
            details: makeDetails('parallel')([]),
          }
        }

        const allResults: SingleResult[] = new Array(params.tasks.length)
        for (let i = 0; i < params.tasks.length; i++) {
          allResults[i] = {
            agent: params.tasks[i]!.agent,
            agentSource: 'unknown',
            task: params.tasks[i]!.task,
            exitCode: -1,
            messages: [],
            stderr: '',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
          }
        }

        const emitParallelUpdate = () => {
          if (onUpdate) {
            const running = allResults.filter((r) => r.exitCode === -1).length
            const done = allResults.filter((r) => r.exitCode !== -1).length
            onUpdate({
              content: [
                {
                  type: 'text',
                  text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
                },
              ],
              details: makeDetails('parallel')([...allResults]),
            })
          }
        }

                const groupRunId = newSubagentRunId()

        if (!params.wait) {
          if (activeBackgroundRuns.size + params.tasks.length > MAX_BACKGROUND_RUNS) {
            const free = Math.max(0, MAX_BACKGROUND_RUNS - activeBackgroundRuns.size)
            return {
              content: [
                {
                  type: 'text',
                  text: `Cannot start ${params.tasks.length} background runs: ${activeBackgroundRuns.size} already in flight (max ${MAX_BACKGROUND_RUNS}, ${free} free). Dispatch fewer at a time, or wait for a completion message.`,
                },
              ],
              details: makeDetails('parallel')([]),
              isError: true,
            }
          }
          // notify:"all": register expectations BEFORE any child can spawn so an early
          // completion is held rather than delivered; reconciled to the actually-started
          // count after the dispatch pass (pre-spawn refusals never emit a completion).
          if (params.notify === 'all') {
            groupNotifyAll.set(groupRunId, { total: params.tasks.length, done: 0, events: [] })
          }
          const startedList: Array<{ agent: string; runId: string; taskLine: string }> = []
          const failedNowList: Array<{ agent: string; reason: string }> = []
          await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t) => {
            const runId = newSubagentRunId()
            const taskWithContext = formatTaskWithContext(contextPacket, t.task)
            const result = await runSingleAgent(
              ctx.cwd,
              agents,
              t.agent,
              taskWithContext,
              t.cwd,
              undefined,
              // Detached runs outlive the tool call — no per-call signal.
              undefined,
              undefined,
              makeDetails('parallel'),
              'parallel',
              runId,
              groupRunId,
              undefined,
              t.goal,
              true,
            )
            if (result.exitCode === 1 && result.messages.length === 0) {
              // pre-spawn rejection (unknown agent / policy / project not activated)
              failedNowList.push({ agent: t.agent, reason: getResultOutput(result) })
            } else {
              const firstLine = taskWithContext.split('\n', 1)[0] ?? taskWithContext
              startedList.push({ agent: t.agent, runId, taskLine: firstLine })
            }
            return result
          })
          const startedLines = startedList.map(
            (s) => `- <${s.agent}> (run ${s.runId.slice(0, 8)}): ${s.taskLine.length > 120 ? `${s.taskLine.slice(0, 120)}…` : s.taskLine}`,
          )
                    const failedLines = failedNowList.map((f) => `- <${f.agent}>: ${f.reason}`)
          // Reconcile the notify:"all" group: only actually-started runs emit completions.
          const notifyState = groupNotifyAll.get(groupRunId)
          if (notifyState) {
            notifyState.total = startedList.length
            if (notifyState.done >= notifyState.total && notifyState.total > 0) {
              groupNotifyAll.delete(groupRunId)
              for (const e of notifyState.events) notifySyloSubagent(e)
            }
          }
          return {
            content: [
              {
                type: 'text',
                text: [
                  `Started ${startedList.length} background subagent${startedList.length === 1 ? '' : 's'}:`,
                  ...startedLines,
                                    ...(failedNowList.length > 0 ? ['', 'Failed to start:', ...failedLines] : []),
                  '',
                  params.notify === 'all' ?
                    `ONE combined notification arrives when all ${startedList.length} finished (notify: "all"). End your turn now — do not wait, poll, or re-dispatch.`
                  : 'Each finished run posts its full result as a message you can act on. End your turn now — do not wait, poll, or re-dispatch. To block instead, re-dispatch with wait:true.',
                ].join('\n'),
              },
            ],
            details: makeDetails('parallel')([]),
            ...(startedList.length === 0 ? { isError: true as const } : {}),
          }
        }

        const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
          const runId = newSubagentRunId()
          const taskWithContext = formatTaskWithContext(contextPacket, t.task)
          const result = await runSingleAgent(
            ctx.cwd,
            agents,
            t.agent,
            taskWithContext,
            t.cwd,
            undefined,
            signal,
            (partial) => {
              if (partial.details?.results[0]) {
                allResults[index] = partial.details.results[0]
                emitParallelUpdate()
              }
            },
            makeDetails('parallel'),
            'parallel',
            runId,
            groupRunId,
            undefined,
            t.goal,
          )
          allResults[index] = result
          emitParallelUpdate()
          return result
        })

        const successCount = results.filter(
          (r) => !isFailedResult(r) && !isTruncatedResult(r),
        ).length
        const summaries = results.map((r) => {
          const output = withTruncationNote(r, truncateParallelOutput(getResultOutput(r)))
          const status =
            isFailedResult(r) ?
              `failed${r.stopReason && r.stopReason !== 'end' ? ` (${r.stopReason})` : ''}`
            : isTruncatedResult(r) ? 'incomplete (token cap)'
            : 'completed'
          return `### [${r.agent}] ${status}\n\n${output}`
        })
        const parallelTail =
          successCount < results.length ? `\n\n---\n\n${FAILED_RESULT_NOTE}` : ''
        return {
          content: [
            {
              type: 'text',
              text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join('\n\n---\n\n')}${parallelTail}`,
            },
          ],
          details: makeDetails('parallel')(results),
          ...(successCount < results.length ? { isError: true as const } : {}),
        }
      }

      if (params.agent && params.task) {
        const runId = newSubagentRunId()
        const taskWithContext = formatTaskWithContext(contextPacket, params.task)

        if (!params.wait) {
          if (activeBackgroundRuns.size >= MAX_BACKGROUND_RUNS) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Cannot start: ${activeBackgroundRuns.size} background runs are already in flight (max ${MAX_BACKGROUND_RUNS}). Wait for a completion message, or have a running task stopped first.`,
                },
              ],
              details: makeDetails('single')([]),
              isError: true,
            }
          }
          const result = await runSingleAgent(
            ctx.cwd,
            agents,
            params.agent,
            taskWithContext,
            params.cwd,
            undefined,
            // Detached runs outlive the tool call — no per-call signal, no live box:
            // progress streams to the runs store/board, and completions arrive as messages.
            undefined,
            undefined,
            makeDetails('single'),
            'single',
            runId,
            runId,
            undefined,
            params.goal,
            true,
          )
          if (result.exitCode === 1 && result.messages.length === 0) {
            // pre-spawn rejection (unknown agent / tool policy / project not activated)
            // — resolve synchronously so the model can correct course this turn.
            return {
              content: [
                {
                  type: 'text',
                  text: `Agent failed to start: ${getResultOutput(result)}\n\n${FAILED_RESULT_NOTE}`,
                },
              ],
              details: makeDetails('single')([result]),
              isError: true,
            }
          }
          const firstLine = taskWithContext.split('\n', 1)[0] ?? taskWithContext
          const taskShown = firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine
          return {
            content: [
              {
                type: 'text',
                text: `Started background subagent <${params.agent}> (run ${runId.slice(0, 8)}): ${taskShown}\nLive progress flows to the Subagents runs board; the full result arrives here as a message when it finishes. End your turn now — do not wait, poll, or re-dispatch this task. To block instead, re-dispatch with wait:true.`,
              },
            ],
            details: makeDetails('single')([]),
          }
        }

        const result = await runSingleAgent(
          ctx.cwd,
          agents,
          params.agent,
          taskWithContext,
          params.cwd,
          undefined,
          signal,
          onUpdate,
          makeDetails('single'),
          'single',
          runId,
          runId,
          undefined,
          params.goal,
        )
        const isError = isFailedResult(result)
        if (isError) {
          return {
            content: [
              {
                type: 'text',
                text: `Agent ${result.stopReason || 'failed'}: ${getResultOutput(result)}\n\n${FAILED_RESULT_NOTE}`,
              },
            ],
            details: makeDetails('single')([result]),
            isError: true,
          }
        }
        return {
          content: [{ type: 'text', text: withTruncationNote(result, getResultOutput(result)) }],
          details: makeDetails('single')([result]),
          ...(isTruncatedResult(result) ? { isError: true as const } : {}),
        }
      }

      return {
        content: [{ type: 'text', text: 'Invalid subagent parameters.' }],
        details: makeDetails('single')([]),
      }
    },
  })

  pi.registerTool({
    name: 'subagent_cancel',
    label: 'Subagent cancel',
    description:
      'Stop one background subagent run by run id (or by persona name — resolves the most recent live run for that persona), or with no args, the newest live run at all. The stopped run reports cancelled; results it did not produce are lost. Use when the operator asks to stop/wait or when the run\u2019s goal has been overtaken by events.',
    parameters: Type.Object({
      runId: Type.Optional(
        Type.String({ description: 'Run id from the dispatch result (full or first 8 chars).' }),
      ),
      agent: Type.Optional(Type.String({ description: 'Persona name, e.g. "scout" — newest live run for it.' })),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const params = _params
      const summaries = listActiveRunSummaries()
      let target: string | undefined
      if (params.runId?.trim()) {
        const id = params.runId.trim().toLowerCase()
        target =
          summaries.find((s) => s.runId === id)?.runId ??
          summaries.find((s) => s.runId.startsWith(id))?.runId
      }
      if (!target && params.agent?.trim()) {
        target = findActiveRunByAgent(params.agent.trim()) ?? undefined
      }
      if (!target && !params.runId && !params.agent && summaries.length > 0) {
        target = summaries[summaries.length - 1]?.runId
      }
      if (!target) {
        const available =
          summaries
            .map((s) => `${s.agent ?? '?'} (${s.runId.slice(0, 8)})`)
            .join(', ') || 'none'
        return {
          content: [
            {
              type: 'text',
              text: `No live run matched${params.agent ? ` "${params.agent}"` : ''}. Live runs now: ${available}.`,
            },
          ],
          details: undefined,
        }
      }
      const meta = summaries.find((s) => s.runId === target)
      const ok = cancelSubagentRun(target)
      return {
        content: [
          {
            type: 'text',
            text: ok ?
              `Stopped run ${target.slice(0, 8)}${meta?.agent ? ` (<${meta.agent}>)` : ''}. It reports cancelled — results it did not produce are lost.`
            : 'Run had already ended.',
          },
        ],
        details: undefined,
      }
    },
  })

  pi.registerTool({
    name: 'subagent_answer',
    label: 'Subagent answer',
    description:
      'Deliver the operator\u2019s answer to a PAUSED background subagent — one whose dispatch reported "awaiting input" after calling await_user_input. Relay the decision faithfully (quote it rather than reinterpret). The agent unparks in the same session it parked and continues in the background; its final result arrives as a message later, so END YOUR TURN after delivering.',
    parameters: Type.Object({
      runId: Type.Optional(
        Type.String({ description: 'Run id of the parked run (full or first 8 chars).' }),
      ),
      agent: Type.Optional(
        Type.String({ description: 'Persona name of the parked run — resolves the newest live run for it.' }),
      ),
      answer: Type.String({
        description:
          'The operator\u2019s decision/answer, relayed verbatim (you may tidy obvious grammar, never the meaning). This text is written into the parked agent\u2019s mailbox.',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const answer = (params.answer ?? '').trim()
      if (!answer) {
        return { content: [{ type: 'text', text: 'Refused: empty answer.' }], details: undefined }
      }
      const summaries = listActiveRunSummaries()
      let target: string | undefined
      if (params.runId?.trim()) {
        const id = params.runId.trim().toLowerCase()
        target =
          summaries.find((s) => s.runId === id)?.runId ??
          summaries.find((s) => s.runId.startsWith(id))?.runId
      }
      if (!target && params.agent?.trim()) {
        target = findActiveRunByAgent(params.agent.trim()) ?? undefined
      }
      if (!target) {
        const available =
          summaries.map((s) => `${s.agent ?? '?'} (${s.runId.slice(0, 8)})`).join(', ') || 'none'
        return {
          content: [
            {
              type: 'text',
              text: `No live run to answer. Live runs now: ${available}. (The run may have already finished or been stopped.)`,
            },
          ],
          details: undefined,
        }
      }
      const mailboxDir = resolveAwaitMailboxDir()
      if (!mailboxDir) {
        return {
          content: [{ type: 'text', text: 'Refused: the mailbox dir is not configured (older host?).' }],
          details: undefined,
        }
      }
      try {
        fs.mkdirSync(mailboxDir, { recursive: true })
        const answerPath = path.join(mailboxDir, `${target}.answer.json`)
        const tmpPath = `${answerPath}.tmp`
        fs.writeFileSync(tmpPath, JSON.stringify({ answer, answered_by: 'operator', at: Date.now() }))
        fs.rmSync(answerPath, { force: true })
        fs.renameSync(tmpPath, answerPath)
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to deliver the answer: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          details: undefined,
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: `Answer delivered to run ${target.slice(0, 8)}${target ? '' : ''}. The agent unparks in its parked session and continues — its result arrives later as a message. End your turn now.`,
          },
        ],
        details: undefined,
      }
    },
  })
}
