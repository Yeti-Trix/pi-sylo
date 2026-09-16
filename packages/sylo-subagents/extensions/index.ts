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
import { cancelSubagentRun, consumeRunCancelled, registerSubagentRun, unregisterSubagentRun } from './subagent-run-registry.ts'
import { resolveSubagentStallMs, resolveSubagentTimeoutMs } from './subagent-timeout.ts'
import { newSubagentRunId, notifySyloSubagent, type SyloSubagentRunMode } from './sylo-host.ts'

export { cancelAllSubagentRuns, cancelSubagentRun } from './subagent-run-registry.ts'

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
].join('\n')

function resolveDefaultAgentScope(): AgentScope {
  const raw = (process.env.SYLO_SUBAGENTS_AGENT_SCOPE ?? 'user').trim()
  if (raw === 'both' || raw === 'project') return raw
  return 'user'
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

function isFailedResult(result: SingleResult): boolean {
  return result.exitCode !== 0 || result.stopReason === 'error' || result.stopReason === 'aborted'
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
    return result.errorMessage || result.stderr || getFinalOutput(result.messages) || '(no output)'
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
): Promise<SingleResult> {
  const agent = agents.find((a) => a.name === agentName)
  const subagentModel = agent ? subagentModelCliArgs(agent.name) : { args: [] as string[] }
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
  })

  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(', ') || 'none'
    const result: SingleResult = {
      agent: agentName,
      agentSource: 'unknown',
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      step,
      runId,
    }
    notifySyloSubagent({
      type: 'subagent_run_end',
      runId,
      status: 'failed',
      error: result.stderr,
    })
    return result
  }

  // The child never loads Sylo's capability guard, so the operator's Capability
  // manager policy has to be turned into a `--tools` allowlist here or it simply
  // would not apply inside a subagent.
  const toolPolicy = resolveSubagentToolPolicy({ ...(agent.tools ? { agentTools: agent.tools } : {}) })
  if (toolPolicy.kind === 'blocked') {
    const result: SingleResult = {
      agent: agentName,
      agentSource: agent.source,
      task,
      exitCode: 1,
      messages: [],
      stderr: `Cannot run "${agentName}": ${toolPolicy.reason}`,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      step,
      runId,
    }
    notifySyloSubagent({
      type: 'subagent_run_end',
      runId,
      status: 'failed',
      error: result.stderr,
    })
    return result
  }

  const args: string[] = ['--mode', 'json', '-p', '--no-session']
  args.push(...subagentModel.args)
  args.push(...toolCliArgs(toolPolicy.tools))

  let tmpPromptDir: string | null = null
  let tmpPromptPath: string | null = null

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
    // NOTE: task is piped via stdin (not as a CLI arg) to avoid Windows shell
    // mangling multi-line arguments when shell:true is used by resolvePiSpawn fallback.
    let wasAborted = false

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = resolvePiSpawn(args)
      const proc = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        shell: invocation.shell ?? false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      // Pipe the task via stdin so it survives shell:true on Windows
      try { proc.stdin.write(task); proc.stdin.end() } catch { /* process may have exited early */ }
      registerSubagentRun(runId, proc)
      const dropRegistry = () => unregisterSubagentRun(runId)
      let buffer = ''
      let timeout: ReturnType<typeof setTimeout> | undefined
      let stallTimer: ReturnType<typeof setInterval> | undefined
      let lastActivityAt = Date.now()
      let guardKilled = false

      const finish = (code: number) => {
        if (timeout) clearTimeout(timeout)
        if (stallTimer) clearInterval(stallTimer)
        stopUpdates()
        resolve(code)
      }

      const timeoutMs = resolveSubagentTimeoutMs({
        timeoutSeconds: agent.timeoutSeconds,
        provider: subagentModel.provider,
      })
      const stallMs = resolveSubagentStallMs({ provider: subagentModel.provider })
      const killForGuard = (line: string) => {
        if (guardKilled) return
        guardKilled = true
        currentResult.stderr += `\n${line}`
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
        }, 5000)
      }
      const bumpActivity = () => {
        lastActivityAt = Date.now()
      }
      timeout = setTimeout(() => {
        killForGuard(`[timeout] Subagent exceeded time limit (${Math.round(timeoutMs / 1000)}s).`)
      }, timeoutMs)
      stallTimer = setInterval(() => {
        const idleMs = Date.now() - lastActivityAt
        if (idleMs < stallMs) return
        killForGuard(`[stall] Subagent produced no output for ${Math.round(idleMs / 1000)}s.`)
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

        if (event.type === 'tool_execution_start') {
          liveToolName = typeof event.toolName === 'string' ? event.toolName : undefined
          liveToolPreview = summarizeToolArgs(event.args)
          bumpActivity()
          scheduleUpdate()
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
        finish(code ?? 0)
      })

      proc.on('error', () => {
        dropRegistry()
        finish(1)
      })

      if (signal) {
        const killProc = () => {
          wasAborted = true
          proc.kill('SIGTERM')
          setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL')
          }, 5000)
        }
        if (signal.aborted) killProc()
        else signal.addEventListener('abort', killProc, { once: true })
      }
    })

    currentResult.exitCode = exitCode
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
    notifySyloSubagent({
      type: 'subagent_run_end',
      runId,
      status: failed ? 'failed' : 'succeeded',
      resultText,
      thinking: previewThinking() || undefined,
      model: currentResult.model,
      error: failed ? getResultOutput(currentResult) : undefined,
      usage: {
        input: currentResult.usage.input,
        output: currentResult.usage.output,
        cost: currentResult.usage.cost,
        turns: currentResult.usage.turns,
      },
    })

    return currentResult
  } finally {
    if (tmpPromptPath) {
      try {
        fs.unlinkSync(tmpPromptPath)
      } catch {
        /* ignore */
      }
    }
    if (tmpPromptDir) {
      try {
        fs.rmdirSync(tmpPromptDir)
      } catch {
        /* ignore */
      }
    }
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
export async function runForcedSubagentChain(opts: {
  cwd: string
  agentNames: string[]
  task: string
  agentScope?: AgentScope
  signal?: AbortSignal
}): Promise<ForcedSubagentOutcome[]> {
  const { cwd, agentNames, task, signal } = opts
  const agentScope = opts.agentScope ?? resolveDefaultAgentScope()
  const { agents, projectAgentsDir } = discoverAgents(cwd, agentScope, {
    bundledAgentsDir: resolveBundledAgentsDir(),
  })
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

const TaskItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task to delegate to the agent' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
})

const ChainItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task with optional {previous} placeholder for prior output' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
})

const AgentScopeSchema = StringEnum(['user', 'project', 'both'] as const, {
  description: 'Which agent directories to use. Default: "user" includes Sylo builtins.',
  default: 'user',
})

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: 'Name of the agent to invoke (for single mode)' })),
  task: Type.Optional(Type.String({ description: 'Task to delegate (for single mode)' })),
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
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process (single mode)' })),
})

export default function syloSubagentsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'subagent',
    label: 'Subagent',
    description: [
      'Delegate tasks to specialized subagents with isolated context.',
      'Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).',
      'Default agent scope is "user" (Sylo builtins + ~/.pi/agent/agents). Omit agentScope unless project .pi/agents are required.',
      'Sylo Settings → Subagents can enable project agents (agentScope "both").',
    ].join(' '),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agentScope: AgentScope = params.agentScope ?? resolveDefaultAgentScope()
      const discovery = discoverAgents(ctx.cwd, agentScope, {
        bundledAgentsDir: resolveBundledAgentsDir(),
      })
      const agents = discovery.agents
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
        const results: SingleResult[] = []
        let previousOutput = ''
        const groupRunId = newSubagentRunId()
        let parentRunId: string | undefined

        for (let i = 0; i < params.chain.length; i++) {
          const step = params.chain[i]!
          const taskWithContext = formatTaskWithContext(
            contextPacket,
            step.task.replace(/\{previous\}/g, previousOutput),
          )
          const runId = newSubagentRunId()

          const chainUpdate: OnUpdateCallback | undefined = onUpdate
            ? (partial) => {
                const currentResult = partial.details?.results[0]
                if (currentResult) {
                  onUpdate({
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
            signal,
            chainUpdate,
            makeDetails('chain'),
            'chain',
            runId,
            groupRunId,
            parentRunId,
          )
          results.push(result)

          if (isFailedResult(result)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Chain stopped at step ${i + 1} (${step.agent}): ${getResultOutput(result)}\n\n${FAILED_RESULT_NOTE}`,
                },
              ],
              details: makeDetails('chain')(results),
              isError: true,
            }
          }
          previousOutput = withTruncationNote(result, getFinalOutput(result.messages))
          parentRunId = runId
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
}
