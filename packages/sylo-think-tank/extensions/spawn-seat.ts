import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Message } from '@earendil-works/pi-ai'
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'

import type { AgentConfig } from './agents.ts'
import {
  detectFinalReportVariant,
  isThinkTankFragmentBody,
  sanitizeThinkTankSeatOutput,
  validateFinalReportBody,
  validateModeratorDebateTurn,
  type ThinkTankSeatDebug,
} from './fragment.ts'
import { resolvePiSpawn } from './pi-cli.ts'
import { resolveSeatExtensionPaths } from './seat-extensions.ts'
import { parseDebateTurn } from './stance.ts'
import {
  mergeWorkflowEntries,
  type StampedWorkflowEntry,
  workflowEntryFromPiJsonLine,
  workflowFromMessages,
} from './seat-workflow.ts'

const DEFAULT_TIMEOUT_MS = 600_000
const MAX_SEAT_ATTEMPTS = 3

/** Minimal Pi `-p` user line — no loaded words (Write, prompt, Task, seat, etc.). */
export const THINK_TANK_SEAT_USER_DEBATE = '.'
export const THINK_TANK_SEAT_USER_FINAL = '.'

/** Seat subprocesses must not load sylo_think_tank_* tools (recursive / empty-topic confusion). */
export const SYLO_THINK_TANK_SEAT_RUN_ENV = 'SYLO_THINK_TANK_SEAT_RUN'
export const SYLO_THINK_TANK_TASKS_FILE_ENV = 'SYLO_THINK_TANK_TASKS_FILE'
export const SYLO_THINK_TANK_SEAT_ID_ENV = 'SYLO_THINK_TANK_SEAT_ID'
export const SYLO_THINK_TANK_SEAT_ROLE_ENV = 'SYLO_THINK_TANK_SEAT_ROLE'
export const SYLO_THINK_TANK_CYCLE_ENV = 'SYLO_THINK_TANK_CYCLE'
/** Settings → image model (Ollama) for vision fallback on text-only seat models. */
export const SYLO_IMAGE_MODEL_ID_ENV = 'SYLO_IMAGE_MODEL_ID'
export const SYLO_IMAGE_MODEL_PROVIDER_ENV = 'SYLO_IMAGE_MODEL_PROVIDER'
export const SYLO_OLLAMA_BASE_ORIGIN_ENV = 'SYLO_OLLAMA_BASE_ORIGIN'

export type ThinkTankSeatRunContext = {
  tasksFile: string
  seatId: string
  seatRole: 'moderator' | 'debater'
  cycle: number
}

function isModeratorSeatMode(seatContext?: ThinkTankSeatRunContext): boolean {
  return seatContext?.seatRole === 'moderator'
}

function collectAssistantTexts(messages: Message[]): string[] {
  const texts: string[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.content) {
      if (part.type === 'text' && part.text.trim()) texts.push(part.text)
    }
  }
  return texts
}

/** Prefer a substantive debate turn over a trailing fragment-refusal message. */
export function pickBestThinkTankSeatOutput(
  texts: string[],
  mode: 'debate' | 'final_report',
): { text: string; pickedFrom: ThinkTankSeatDebug['pickedFrom'] } {
  if (texts.length === 0) return { text: '', pickedFrom: 'empty' }

  if (mode === 'final_report') {
    for (let i = texts.length - 1; i >= 0; i--) {
      const candidate = texts[i]!
      if (
        (/##\s*(BOTTOM LINE|Thesis|CRUX)/i.test(candidate) &&
          !isThinkTankFragmentBody(candidate))
      ) {
        return { text: candidate, pickedFrom: 'best_score' }
      }
    }
  }

  let bestScored: { text: string; score: number } | null = null
  for (const text of texts) {
    const parsed = parseDebateTurn(text)
    const bodyLen = parsed.body.trim().length
    let score = bodyLen
    if (/"stance"\s*:/i.test(text)) score += 200
    if (bodyLen > 400) score += 150
    if (isThinkTankFragmentBody(parsed.body)) score -= 800
    if (mode === 'final_report' && /##\s*(BOTTOM LINE|Thesis|CRUX)/i.test(text)) score += 300
    if (mode === 'final_report') {
      const validation = validateFinalReportBody(text, detectFinalReportVariant(text))
      if (validation.ok) score += 400
      else score -= 300
    }
    if (!bestScored || score > bestScored.score) bestScored = { text, score }
  }

  if (bestScored && bestScored.score > 0 && !isThinkTankFragmentBody(parseDebateTurn(bestScored.text).body)) {
    return { text: bestScored.text, pickedFrom: 'best_score' }
  }

  for (let i = texts.length - 1; i >= 0; i--) {
    const parsed = parseDebateTurn(texts[i]!)
    if (!isThinkTankFragmentBody(parsed.body) && parsed.body.trim().length >= 120) {
      return { text: texts[i]!, pickedFrom: 'best_score' }
    }
  }

  return { text: texts[texts.length - 1] ?? '', pickedFrom: 'last_message' }
}

function isCompleteDebateTurn(text: string, seatContext?: ThinkTankSeatRunContext): boolean {
  if (seatContext?.seatRole === 'moderator') return false
  if (!/"stance"\s*:/i.test(text)) return false
  const parsed = parseDebateTurn(text)
  if (isThinkTankFragmentBody(parsed.body)) return false
  if (parsed.body.trim().length < 120) return false
  return true
}

function getFinalOutput(
  messages: Message[],
  mode: 'debate' | 'final_report',
  earlyExitText: string | null,
): { text: string; pickedFrom: ThinkTankSeatDebug['pickedFrom'] } {
  if (earlyExitText) return { text: earlyExitText, pickedFrom: 'early_exit' }
  return pickBestThinkTankSeatOutput(collectAssistantTexts(messages), mode)
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sylo-think-tank-'))
  const safeName = agentName.replace(/[^\w.-]+/g, '_')
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`)
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: 'utf-8', mode: 0o600 })
  })
  return { dir: tmpDir, filePath }
}

function retryPromptSuffix(
  mode: 'debate' | 'final_report',
  attempt: number,
  priorReason: string,
  seatRole?: 'moderator' | 'debater',
): string {
  const debateHint =
    seatRole === 'moderator' ?
      'Write a full Moderator turn with ## KEY FINDING, ## EVIDENCE CHECK, ## GAPS, and ## READINESS (real prose, not a status line). Assign tasks with sylo_think_tank_task_assign when needed; use the full task_id from task_list for sylo_think_tank_task_complete.'
    : 'Write substantive research findings on the operator topic. Do NOT hold, refuse, or comment on subprocess mechanics.'
  return [
    `## Retry ${attempt} (prior output rejected)`,
    `Reason: **${priorReason}**.`,
    mode === 'final_report' ?
      'Write a real FinalReport with the required ## sections from your brief. Do NOT list section names or claim they exist. Argue the operator topic.'
    : debateHint,
  ].join('\n')
}

async function runThinkTankSeatPromptOnce(args: {
  cwd: string
  agent: AgentConfig
  modelOverride?: string
  personaSuffix?: string
  prompt: string
  mode: 'debate' | 'final_report'
  userMessage: string
  seatContext?: ThinkTankSeatRunContext
  signal?: AbortSignal
  onProgress?: (entry: StampedWorkflowEntry) => void
}): Promise<{
  text: string
  model?: string
  error?: string
  workflowJson?: string
  assistantMessageCount: number
  pickedFrom: ThinkTankSeatDebug['pickedFrom']
}> {
  const piArgs: string[] = ['--mode', 'json', '-p', '--no-session']
  const model = args.modelOverride?.trim() || args.agent.model
  if (model) piArgs.push('--model', model)
  // No `--tools` allowlist: seats inherit every tool from enabled extensions + Pi builtins
  // (same Capability manager set as the broker, via `--extension` below).
  for (const extPath of resolveSeatExtensionPaths()) {
    piArgs.push('--extension', extPath)
  }

  let tmpPromptDir: string | null = null
  try {
    const mode = args.mode
    const seatModeBlock =
      mode === 'final_report' ?
        [
          '## Think Tank final report mode',
          'The structured research pass is **finished**. Write a **FinalReport** for the operator topic in the brief below.',
          'Use the required markdown sections with real prose. This is **not** a research turn and **not** operator chat.',
          'Do **not** introduce new web research or file reads here unless you already cited them in research turns.',
          'The subprocess user line is only a start trigger — not operator input.',
          'Do **not** call sylo_think_tank_run.',
        ].join('\n')
      : isModeratorSeatMode(args.seatContext) ?
        [
          '## Think tank Moderator mode',
          'You are the **Moderator** (advisory only — not pickable). Speak after all researchers each cycle.',
          'Follow KEY FINDING → EVIDENCE CHECK → GAPS → READINESS each turn.',
          'When live evidence is needed, use enabled Sylo tools and **cite in this turn**.',
          'The subprocess user line is a **start trigger only** (usually `.`) — not operator input.',
          'Write **one** markdown answer, append the JSON stance footer, then **stop**.',
          'Do **not** call sylo_think_tank_run.',
        ].join('\n')
      : [
          '## Think tank researcher mode',
          'You are **one researcher** in an automated **multi-agent Sylo think tank** (separate AI agents, not the human operator).',
          'Other researchers are **other AI models** — stress-test their claims in the transcript by **seat label**, not Seat A/B/C and not as if they were the operator.',
          'When live evidence is needed, use **any enabled Sylo tools** (e.g. sylo_web_search, sylo_web_fetch, read, grep). **Cite findings in this same turn.** Do not save research for the final report only.',
          'The subprocess user line is a **start trigger only** (usually `.`) — **not** operator input. Ignore it completely.',
          'Write **one** markdown answer for this cycle, append the JSON stance footer on its own line, then **stop**. Do not simulate another turn.',
          'Do **not** comment on invocations, cycles, or subprocess mechanics. Do **not** call sylo_think_tank_run.',
        ].join('\n')

    const fullSystem = [
      args.agent.systemPrompt.trim(),
      args.personaSuffix?.trim(),
      seatModeBlock,
      mode === 'final_report' ? '## Final report brief' : '## Debate brief',
      args.prompt.trim(),
    ]
      .filter(Boolean)
      .join('\n\n')

    const tmp = await writePromptToTempFile(args.agent.name, fullSystem)
    tmpPromptDir = tmp.dir
    piArgs.push('--append-system-prompt', tmp.filePath)
    piArgs.push(args.userMessage)

    const messages: Message[] = []
    const streamedWorkflow: StampedWorkflowEntry[] = []
    const runStartedAt = Date.now()
    let stderr = ''
    let resolvedModel: string | undefined = model
    let earlyExitText: string | null = null
    let child: ChildProcess | null = null

    const extractAssistantText = (msg: Message): string => {
      if (msg.role !== 'assistant') return ''
      const parts: string[] = []
      for (const part of msg.content) {
        if (part.type === 'text' && part.text.trim()) parts.push(part.text)
      }
      return parts.join('\n\n')
    }

    const processJsonLine = (line: string) => {
      if (!line.trim()) return
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        return
      }

      const wf = workflowEntryFromPiJsonLine(parsed, Date.now())
      if (wf) {
        streamedWorkflow.push(wf)
        args.onProgress?.(wf)
      }

      if (parsed.type === 'message_end' && parsed.message) {
        const msg = parsed.message as Message
        messages.push(msg)
        if (msg.role === 'assistant' && msg.model) {
          resolvedModel = msg.model
        }
        if (msg.role === 'assistant' && mode === 'debate' && !earlyExitText) {
          const text = extractAssistantText(msg)
          if (isCompleteDebateTurn(text, args.seatContext)) {
            earlyExitText = text
            child?.kill('SIGTERM')
          }
        }
      }
      if (parsed.type === 'tool_result_end' && parsed.message) {
        messages.push(parsed.message as Message)
      }
    }

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = resolvePiSpawn(piArgs)
      const seatEnv: NodeJS.ProcessEnv = {
        ...process.env,
        [SYLO_THINK_TANK_SEAT_RUN_ENV]: '1',
      }
      if (process.env.SYLO_PI_AGENT_DIR?.trim()) {
        seatEnv.SYLO_PI_AGENT_DIR = process.env.SYLO_PI_AGENT_DIR.trim()
      }
      if (args.seatContext) {
        seatEnv[SYLO_THINK_TANK_TASKS_FILE_ENV] = args.seatContext.tasksFile
        seatEnv[SYLO_THINK_TANK_SEAT_ID_ENV] = args.seatContext.seatId
        seatEnv[SYLO_THINK_TANK_SEAT_ROLE_ENV] = args.seatContext.seatRole
        seatEnv[SYLO_THINK_TANK_CYCLE_ENV] = String(args.seatContext.cycle)
      }
      child = spawn(invocation.command, invocation.args, {
        cwd: args.cwd,
        shell: invocation.shell ?? false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: seatEnv,
      })

      let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        stderr += '\n[timeout] Think tank seat exceeded time limit.'
        child?.kill('SIGTERM')
        setTimeout(() => {
          if (child && !child.killed) child.kill('SIGKILL')
        }, 5000)
      }, DEFAULT_TIMEOUT_MS)

      const finish = (code: number) => {
        if (timeout) clearTimeout(timeout)
        resolve(code)
      }

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })

      let buffer = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) processJsonLine(line)
      })

      child.on('close', (code) => {
        if (buffer.trim()) processJsonLine(buffer)
        finish(code ?? 1)
      })
      child.on('error', (err) => {
        stderr += `\n${err.message}`
        finish(1)
      })

      if (args.signal) {
        if (args.signal.aborted) {
          child.kill('SIGTERM')
        } else {
          args.signal.addEventListener('abort', () => child?.kill('SIGTERM'), { once: true })
        }
      }
    })

    const picked = getFinalOutput(messages, mode, earlyExitText)
    const text = sanitizeThinkTankSeatOutput(picked.text, mode)
    const workflow = mergeWorkflowEntries(streamedWorkflow, workflowFromMessages(messages, runStartedAt))
    const workflowJson = workflow.length > 0 ? JSON.stringify(workflow) : undefined
    if (exitCode !== 0 || !text.trim()) {
      return {
        text: text || stderr || '(no output)',
        model: resolvedModel,
        error: exitCode !== 0 ? `Seat exited with code ${exitCode}` : 'Empty seat output',
        workflowJson,
        assistantMessageCount: collectAssistantTexts(messages).length,
        pickedFrom: picked.pickedFrom,
      }
    }
    return {
      text,
      model: resolvedModel,
      workflowJson,
      assistantMessageCount: collectAssistantTexts(messages).length,
      pickedFrom: picked.pickedFrom,
    }
  } finally {
    if (tmpPromptDir) {
      fs.promises.rm(tmpPromptDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export async function runThinkTankSeatPrompt(args: {
  cwd: string
  agent: AgentConfig
  modelOverride?: string
  personaSuffix?: string
  prompt: string
  mode?: 'debate' | 'final_report'
  seatContext?: ThinkTankSeatRunContext
  signal?: AbortSignal
  onProgress?: (entry: StampedWorkflowEntry) => void
}): Promise<{
  text: string
  model?: string
  error?: string
  workflowJson?: string
  debug: ThinkTankSeatDebug
}> {
  const mode = args.mode ?? 'debate'
  const userMessage = mode === 'final_report' ? THINK_TANK_SEAT_USER_FINAL : THINK_TANK_SEAT_USER_DEBATE
  let prompt = args.prompt
  let lastReason = 'unknown'

  for (let attempt = 1; attempt <= MAX_SEAT_ATTEMPTS; attempt++) {
    const result = await runThinkTankSeatPromptOnce({
      ...args,
      mode,
      userMessage,
      prompt,
    })

    const parsed = parseDebateTurn(result.text)
    const fragmentDetected = isThinkTankFragmentBody(parsed.body)
    const moderatorDebateValidation =
      mode === 'debate' && args.seatContext?.seatRole === 'moderator' ?
        validateModeratorDebateTurn(parsed.body)
      : undefined
    const reportValidation =
      mode === 'final_report' ?
        validateFinalReportBody(
          result.text,
          args.seatContext?.seatRole === 'moderator' ? 'moderator' : 'debater',
        )
      : undefined
    const needsRetry =
      mode === 'debate' ?
        fragmentDetected || (moderatorDebateValidation ? !moderatorDebateValidation.ok : false)
      : reportValidation ? !reportValidation.ok
      : false

    lastReason =
      mode === 'final_report' && reportValidation ? reportValidation.reason
      : mode === 'debate' && moderatorDebateValidation && !moderatorDebateValidation.ok ?
        moderatorDebateValidation.reason
      : fragmentDetected ? 'fragment_or_refusal'
      : 'ok'

    const debug: ThinkTankSeatDebug = {
      mode,
      userMessage,
      attempt,
      maxAttempts: MAX_SEAT_ATTEMPTS,
      assistantMessageCount: result.assistantMessageCount,
      pickedFrom: result.pickedFrom,
      bodyChars: parsed.body.length,
      fragmentDetected,
      reportValidation,
      retryReason: needsRetry && attempt < MAX_SEAT_ATTEMPTS ? lastReason : undefined,
    }

    if (!needsRetry || attempt >= MAX_SEAT_ATTEMPTS) {
      return { ...result, debug }
    }

    prompt = `${args.prompt.trim()}\n\n${retryPromptSuffix(mode, attempt + 1, lastReason, args.seatContext?.seatRole)}`
  }

  return {
    text: '(no output)',
    debug: {
      mode,
      userMessage,
      attempt: MAX_SEAT_ATTEMPTS,
      maxAttempts: MAX_SEAT_ATTEMPTS,
      assistantMessageCount: 0,
      pickedFrom: 'empty',
      bodyChars: 0,
      fragmentDetected: true,
      retryReason: lastReason,
    },
  }
}
