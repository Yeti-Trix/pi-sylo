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
import { orchestratorModelCliArgs } from './orchestrator-model.ts'
import { cancelSubagentRun, consumeRunCancelled, registerSubagentRun, unregisterSubagentRun } from './subagent-run-registry.ts'
import { newSubagentRunId, notifySyloSubagent, type SyloSubagentRunMode } from './sylo-host.ts'

export { cancelAllSubagentRuns, cancelSubagentRun } from './subagent-run-registry.ts'

const MAX_PARALLEL_TASKS = 8
const MAX_CONCURRENCY = 4
const PER_TASK_OUTPUT_CAP = 50 * 1024
const DEFAULT_TIMEOUT_MS = 600_000

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

const BUNDLED_AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents')

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

  notifySyloSubagent({
    type: 'subagent_run_start',
    runId,
    mode,
    agent: agentName,
    task,
    groupRunId,
    parentRunId,
    stepIndex: step,
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

  const args: string[] = ['--mode', 'json', '-p', '--no-session']
  const orchestratorModel = orchestratorModelCliArgs()
  args.push(...orchestratorModel.args)
  if (agent.tools && agent.tools.length > 0) args.push('--tools', agent.tools.join(','))

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
    model:
      orchestratorModel.modelId ?
        orchestratorModel.provider ?
          `${orchestratorModel.provider}/${orchestratorModel.modelId}`
        : orchestratorModel.modelId
      : agent.model,
    step,
    runId,
  }

  const emitUpdate = () => {
    notifySyloSubagent({
      type: 'subagent_run_update',
      runId,
      partialText: getFinalOutput(currentResult.messages) || undefined,
    })
    if (onUpdate) {
      onUpdate({
        content: [{ type: 'text', text: getFinalOutput(currentResult.messages) || '(running...)' }],
        details: makeDetails([currentResult]),
      })
    }
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

      const finish = (code: number) => {
        if (timeout) clearTimeout(timeout)
        resolve(code)
      }

      timeout = setTimeout(() => {
        currentResult.stderr += '\n[timeout] Subagent exceeded time limit.'
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
        }, 5000)
      }, DEFAULT_TIMEOUT_MS)

      const processLine = (line: string) => {
        if (!line.trim()) return
        let event: { type?: string; message?: Message }
        try {
          event = JSON.parse(line) as { type?: string; message?: Message }
        } catch {
          return
        }

        if (event.type === 'message_end' && event.message) {
          const msg = event.message
          currentResult.messages.push(msg)

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
        error: 'Subagent was aborted',
      })
      throw new Error('Subagent was aborted')
    }

    const failed = isFailedResult(currentResult)
    notifySyloSubagent({
      type: 'subagent_run_end',
      runId,
      status: failed ? 'failed' : 'succeeded',
      resultText: failed ? undefined : getResultOutput(currentResult),
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
      const discovery = discoverAgents(ctx.cwd, agentScope, { bundledAgentsDir: BUNDLED_AGENTS_DIR })
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
                  text: `Chain stopped at step ${i + 1} (${step.agent}): ${getResultOutput(result)}`,
                },
              ],
              details: makeDetails('chain')(results),
              isError: true,
            }
          }
          previousOutput = getFinalOutput(result.messages)
          parentRunId = runId
        }

        return {
          content: [
            {
              type: 'text',
              text: getFinalOutput(results[results.length - 1]!.messages) || '(no output)',
            },
          ],
          details: makeDetails('chain')(results),
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

        const successCount = results.filter((r) => !isFailedResult(r)).length
        const summaries = results.map((r) => {
          const output = truncateParallelOutput(getResultOutput(r))
          const status = isFailedResult(r)
            ? `failed${r.stopReason && r.stopReason !== 'end' ? ` (${r.stopReason})` : ''}`
            : 'completed'
          return `### [${r.agent}] ${status}\n\n${output}`
        })
        return {
          content: [
            {
              type: 'text',
              text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join('\n\n---\n\n')}`,
            },
          ],
          details: makeDetails('parallel')(results),
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
            content: [{ type: 'text', text: `Agent ${result.stopReason || 'failed'}: ${getResultOutput(result)}` }],
            details: makeDetails('single')([result]),
            isError: true,
          }
        }
        return {
          content: [{ type: 'text', text: getResultOutput(result) }],
          details: makeDetails('single')([result]),
        }
      }

      return {
        content: [{ type: 'text', text: 'Invalid subagent parameters.' }],
        details: makeDetails('single')([]),
      }
    },
  })
}
