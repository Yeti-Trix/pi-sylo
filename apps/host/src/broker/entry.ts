/**
 * Agent broker: runs as a forked child (ELECTRON_RUN_AS_NODE) with IPC to Electron main.
 * Owns a single Pi AgentSession; streams slimmed events back to the host.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  calculateContextTokens,
  estimateTokens,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
    type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type Extension,
  type RegisteredTool,
  type ResourceLoader,
    type Skill,
  type ResourceDiagnostic,
} from '@earendil-works/pi-coding-agent'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'

import {
  applySyloActiveToolsFromBrokerPolicy,
  bindPiSessionExtensions,
} from './bind-pi-extensions.js'
import { ensureWindowsPiShellFallback } from './pi-windows-shell.js'
import { discoverBundledSkillPaths } from '../shared/bundled-skill-discovery.js'
import { SYLO_DEFAULT_MODEL_ID, SYLO_DEFAULT_MODEL_PROVIDER } from '../shared/sylo-model-defaults.js'
import { deriveExtensionDisplayName } from '../shared/capability-display-names-node.js'
import {
  normalizePiBuiltinToolsPref,
  resolvePiBuiltinToolsSessionOptions,
} from '../shared/pi-builtin-tools-broker.js'
import type { PiBuiltinToolsPref } from '../shared/pi-builtin-tools.js'
import { parsePiSlashInput } from '../shared/pi-slash-command.js'
import {
  makeSyloDisabledToolKey,
  normalizeDisabledToolsJson,
  normalizePathListForDisabledJson,
  normalizeSkillCapabilityPath,
  normalizeSkillPathListForPolicyJson,
  normalizeSyloCapabilityPath,
} from '../shared/sylo-capability-paths.js'
import { isSkillPathInOperatorScope } from '../shared/sylo-skill-scope.js'
import { readSyloPrefBool } from '../shared/sylo-sqlite-prefs.js'
import {
  cancelAllSubagentRuns,
  cancelSubagentRun,
} from '../../../../packages/sylo-subagents/extensions/subagent-run-registry.ts'

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(2))
  }
  return p
}

type BrokerInit = {
  type: 'init'
  cwd: string
  agentDir: string
  /** Absolute session JSONL path (may not exist yet). */
  sessionPath: string
  /** Pi effective cwd for session header + tools. */
  sessionCwd: string
  modelProvider: string
  modelId: string
  /** Sylo policy: omitted paths are treated as empty (nothing excluded). */
  disabledSkillPaths?: string[]
  disabledExtensionPaths?: string[]
  disabledTools?: { extensionPath: string; toolName: string }[]
  /** Sylo pref — which Pi built-in tools (read/bash/…) the session may use. */
  piBuiltinTools?: PiBuiltinToolsPref
  /** Sylo pref — include active workspace `.cursor/skills` in scope. */
  includeCursorSkills?: boolean
  /** Sylo pref — chat-only turns (no tools sent to the model). */
  chatOnly?: boolean
}

/** Pi `ImageContent` payload carried over IPC. Kept structural to avoid a transitive type import. */
type BrokerImageContent = {
  type: 'image'
  data: string
  mimeType: string
}

type BrokerPrompt = {
  type: 'prompt'
  turnId: string
  text: string
  /** Optional vision attachments forwarded to `session.prompt({ images })`. */
  images?: BrokerImageContent[]
}

type BrokerAbort = { type: 'abort' }

type BrokerDispose = { type: 'dispose' }

type BrokerCapabilitiesList = { type: 'capabilities_list'; requestId: string }

type BrokerThinkingLevels = {
  type: 'thinking_levels'
  requestId: string
  provider: string
  modelId: string
}

type BrokerBridgeFollowUp = { type: 'bridge_followup'; text: string }

type BrokerSteer = { type: 'steer'; text: string; images?: BrokerImageContent[] }

type BrokerFollowUp = { type: 'follow_up'; text: string; images?: BrokerImageContent[] }

type BrokerSwitchSession = {
  type: 'switch_session'
  requestId: string
  sessionPath: string
  sessionCwd: string
  disabledSkillPaths?: string[]
  disabledExtensionPaths?: string[]
  disabledTools?: { extensionPath: string; toolName: string }[]
  includeCursorSkills?: boolean
  /** Per-chat main model override (empty/undefined = keep current). */
  modelProvider?: string
  modelId?: string
  /** Per-chat image (fallback) model override (empty/undefined = keep current). */
    imageModelId?: string
  imageModelProvider?: string
  /** Per-chat thinking-level override (off/minimal/low/medium/high/[xhigh|max]; omitted = Pi default). */
  thinkingLevel?: string
}

type BrokerForkBeforeLastUser = { type: 'fork_before_last_user'; requestId: string }

type BrokerCancelSubagent = { type: 'cancel_subagent'; runId: string }

type BrokerMessageIn =
  | BrokerInit
  | BrokerPrompt
  | BrokerAbort
  | BrokerDispose
    | BrokerCapabilitiesList
  | BrokerThinkingLevels
  | BrokerBridgeFollowUp
  | BrokerSteer
  | BrokerFollowUp
  | BrokerSwitchSession
  | BrokerForkBeforeLastUser
  | BrokerCancelSubagent
  // Pass-through IPC messages: the broker does not consume these. Main → broker
  // IPC fans them out to every `process.on('message')` listener (e.g. the
  // sylo-tasks extension's edit listener, or think-tank/schedule RPC waiters).
  | { type: 'sylo_think_tank_rpc_result' }
  | { type: 'sylo_schedule_rpc_result' }
  | { type: 'sylo-tasks:apply-edit' }

function safeJson(x: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(x)) as unknown
  } catch {
    return String(x)
  }
}

function slimEvent(ev: AgentSessionEvent): Record<string, unknown> | null {
  if (!ev || typeof ev !== 'object') return null
  const t = (ev as { type?: string }).type
  switch (t) {
    case 'message_update': {
      const u = ev as {
        assistantMessageEvent: { type: string; delta?: string; contentIndex?: number }
      }
      const am = u.assistantMessageEvent
      if (am?.type === 'text_delta' && typeof am.delta === 'string') {
        return { type: 'text_delta', delta: am.delta }
      }
      // Surface reasoning channel as first-class events so the chat UI can render
      // inline "Thinking" blocks during streaming and collapse them after.
      // Pi emits these as message_update / assistantMessageEvent.type === thinking_*.
      if (am?.type === 'thinking_start') {
        return { type: 'thinking_start', contentIndex: am.contentIndex ?? null }
      }
      if (am?.type === 'thinking_delta' && typeof am.delta === 'string') {
        return {
          type: 'thinking_delta',
          contentIndex: am.contentIndex ?? null,
          delta: am.delta,
        }
      }
      if (am?.type === 'thinking_end') {
        return { type: 'thinking_end', contentIndex: am.contentIndex ?? null }
      }
      return { type: 'message_update', assistantType: am?.type }
    }
    case 'tool_execution_start':
      return {
        type: 'tool_execution_start',
        toolCallId: (ev as { toolCallId: string }).toolCallId,
        toolName: (ev as { toolName: string }).toolName,
        args: safeJson((ev as { args: unknown }).args),
      }
    case 'tool_execution_update':
      return {
        type: 'tool_execution_update',
        toolCallId: (ev as { toolCallId: string }).toolCallId,
        toolName: (ev as { toolName: string }).toolName,
      }
    case 'tool_execution_end':
      return {
        type: 'tool_execution_end',
        toolCallId: (ev as { toolCallId: string }).toolCallId,
        toolName: (ev as { toolName: string }).toolName,
        isError: (ev as { isError: boolean }).isError,
        resultSummary: summarizeResult((ev as { result: unknown }).result),
      }
    case 'queue_update': {
      const q = ev as { steering?: readonly string[]; followUp?: readonly string[] }
      return {
        type: 'queue_update',
        steering: q.steering ?? [],
        followUp: q.followUp ?? [],
      }
    }
    case 'agent_start':
    case 'agent_end':
    case 'turn_start':
    case 'turn_end':
      return { type: t }
    case 'compaction_start':
      return {
        type: 'compaction_start',
        reason: (ev as { reason?: string }).reason ?? 'threshold',
      }
    case 'compaction_end': {
      const end = ev as {
        reason?: string
        result?: { summary?: string; tokensBefore?: number }
        aborted?: boolean
        willRetry?: boolean
        errorMessage?: string
      }
      return {
        type: 'compaction_end',
        reason: end.reason ?? 'threshold',
        aborted: Boolean(end.aborted),
        willRetry: Boolean(end.willRetry),
        errorMessage: typeof end.errorMessage === 'string' ? end.errorMessage : undefined,
        tokensBefore:
          typeof end.result?.tokensBefore === 'number' ? end.result.tokensBefore : undefined,
        summary: typeof end.result?.summary === 'string' ? end.result.summary : undefined,
      }
    }
    default:
      return { type: t ?? 'unknown' }
  }
}

function summarizeResult(result: unknown): unknown {
  if (result === null || result === undefined) return result
  if (typeof result === 'string') return result.slice(0, 8000)

  const root =
    typeof result === 'object' && result !== null && !Array.isArray(result) ?
      (result as Record<string, unknown>)
    : null

  if (root && Array.isArray(root.content)) {
    const maxText = 12_000
    const content: unknown[] = []
    let imageCount = 0
    for (const block of root.content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'image' && typeof b.data === 'string' && b.data.length > 0) {
        // Keep full base64 intact (truncating corrupts the image). The host
        // persists these to disk and strips the bytes before SQLite. Extension
        // already caps each image (~900KB decoded), so this stays bounded.
        if (imageCount >= 4) continue
        imageCount++
        content.push({
          type: 'image',
          mimeType: typeof b.mimeType === 'string' ? b.mimeType : 'image/jpeg',
          data: b.data,
        })
        continue
      }
      if (b.type === 'text' && typeof b.text === 'string') {
        const text = b.text.length > maxText ? b.text.slice(0, maxText) + '…' : b.text
        content.push({ type: 'text', text })
      }
    }
    return {
      content,
      ...(root.details !== undefined ? { details: root.details } : {}),
      ...(root.isError !== undefined ? { isError: root.isError } : {}),
    }
  }

  try {
    const s = JSON.stringify(result)
    return s.length > 4000 ? s.slice(0, 4000) + '…' : (JSON.parse(s) as unknown)
  } catch {
    return String(result).slice(0, 2000)
  }
}

/** Shipped to the Electron host — what Pi actually selected (not Sylo prefs). */
export type ResolvedModelInfo = {
  provider: string
  modelId: string
  /** Friendly label when different from id */
  displayName?: string
  /** Current effective thinking level (Pi default or per-chat override). */
  thinkingLevel?: string
}

/**
 * Compute actual context-window tokens from the live Pi session (reflects compaction).
 * Uses usage data from the last assistant message for accuracy, falls back to estimateTokens.
 */
function sendContextWindowStats(): void {
  if (!session) return
  try {
    const messages = session.messages
    let actualMessageTokens = 0
    let lastUsageTokens = 0
    let lastUsageIndex = -1
    // Find last assistant message with valid usage for an accurate baseline
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as unknown as Record<string, unknown>
      if (m.role === 'assistant' && m.usage && m.stopReason !== 'aborted' && m.stopReason !== 'error') {
        const usage = m.usage as Record<string, number>
        const total = usage.totalTokens || (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
        if (total > 0) {
          lastUsageTokens = total
          lastUsageIndex = i
          break
        }
      }
    }
    if (lastUsageIndex >= 0) {
      // Add estimated tokens for messages after the last usage
      for (let i = lastUsageIndex + 1; i < messages.length; i++) {
        actualMessageTokens += estimateTokens(messages[i])
      }
      actualMessageTokens += lastUsageTokens
    } else {
      // No usage data — estimate all messages
      for (const m of messages) actualMessageTokens += estimateTokens(m)
    }
        process.send?.({ type: 'context_window_stats', actualMessageTokens })
  } catch (e) {
    console.error('[broker] sendContextWindowStats failed:', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Compute system-prompt section breakdown and send to the host for the
 * context-window dashboard. Called on init and on every session switch so
 * the footer reflects the current workspace's prompt, not a stale snapshot.
 */
async function sendSystemPromptStats(): Promise<void> {
  if (!session) return
  try {
    const { parseSystemPromptStats } = await import('../shared/system-prompt-stats.js')
    const stats = parseSystemPromptStats(session.systemPrompt ?? '')
    process.send?.({ type: 'system_prompt_stats', stats })
  } catch {
    // Non-fatal — dashboard just won't populate
  }
}

function readPiSettingsDefaults(agentDir: string): { provider: string; modelId: string } | null {
  const p = join(agentDir, 'settings.json')
  if (!existsSync(p)) return null
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    const modelId = typeof j.defaultModel === 'string' ? j.defaultModel.trim() : ''
    const provider = typeof j.defaultProvider === 'string' ? j.defaultProvider.trim() : ''
    if (!modelId) return null
    return { provider: provider || 'unknown', modelId }
  } catch {
    return null
  }
}

/** Actual model bound to the AgentSession, or Pi settings.json defaults if `session.model` is unset. */
function serializeResolvedModel(sess: AgentSession, agentDir: string): ResolvedModelInfo | null {
    const m = sess.model
  if (m) {
    return {
      provider: String(m.provider),
      modelId: m.id,
      displayName: m.name && m.name !== m.id ? m.name : undefined,
      thinkingLevel: currentThinkingLevel(sess) ?? undefined,
    }
  }
  const d = readPiSettingsDefaults(agentDir)
  if (d) return { provider: d.provider, modelId: d.modelId, thinkingLevel: currentThinkingLevel(sess) ?? undefined }
  return null
}

/** Current effective thinking level of the bound session (Pi clamps to model support). */
function currentThinkingLevel(sess: AgentSession): string | null {
  try {
    const lvl = (sess as unknown as { thinkingLevel?: unknown }).thinkingLevel
    return typeof lvl === 'string' && lvl !== '' ? lvl : null
  } catch {
    return null
  }
}

/**
 * List Pi thought-supported thinking levels for a specific provider/model.
 * Resolves through Pi's model registry (built-ins + ~/.pi/agent/models.json)
 * so the UI dropdown never advertises levels the model can't take.
 * Unknown / unresolvable model → `ok: false` (UI falls back to the default set).
 */
function handleThinkingLevels(msg: BrokerThinkingLevels): void {
  const reply = (
    levels: string[] | undefined,
    resolved: { provider: string; modelId: string } | null,
    ok: boolean,
    error?: string,
  ) => {
    process.send?.({
      type: 'thinking_levels_result' as const,
      requestId: msg.requestId,
      ...(ok ? { ok: true as const } : { ok: false as const, ...(error ? { error } : {}) }),
      levels,
      resolvedModel: resolved,
    })
  }
  void (async () => {
    const provider = (msg.provider || '').trim()
    const modelId = (msg.modelId || '').trim()
    if (!provider || !modelId) {
      reply(undefined, null, false, 'no_target')
      return
    }
    try {
      const authDir = brokerAgentDir || join(homedir(), '.pi', 'agent')
      const mr = await ModelRuntime.create({
        authPath: join(authDir, 'auth.json'),
        modelsPath: join(authDir, 'models.json'),
      })
      const model =
        mr.getModel(provider, modelId) ??
        mr.getModel(provider.toLowerCase(), modelId) ??
        mr
          .getModels()
          .find(
            (x) =>
              x.id === modelId &&
              (x.provider === provider || x.provider.toLowerCase() === provider.toLowerCase()),
          )
      if (!model) {
        reply(undefined, null, false, 'model_not_found')
        return
      }
      const levels = getSupportedThinkingLevels(model as Parameters<typeof getSupportedThinkingLevels>[0])
      reply(
        levels && levels.length > 0 ? levels : undefined,
        { provider: String(model.provider), modelId: model.id },
        true,
      )
    } catch (e) {
      reply(
        undefined,
        null,
        false,
        e instanceof Error ? e.message : String(e),
      )
    }
  })()
}

/** Resolve model via Pi registry (built-ins + ~/.pi/agent/models.json). Empty modelId → Pi default from settings. */
function resolveModel(registry: ModelRegistry, providerRaw: string, modelIdRaw: string) {
  const modelId = modelIdRaw.trim()
  if (!modelId) return undefined

  const provIn = providerRaw.trim()
  if (provIn) {
    return (
      registry.find(provIn, modelId) ??
      registry.find(provIn.toLowerCase(), modelId) ??
      undefined
    )
  }

    for (const p of ['ollama', 'openai', 'anthropic', 'groq', 'openrouter']) {
    const m = registry.find(p, modelId)
    if (m) return m
  }
  return undefined
}

/** Pi agent session startup — bail out so the shell never sits on “Starting…” forever. */
const INIT_TIMEOUT_MS = 45_000

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${label} timed out after ${Math.round(ms / 1000)}s. Install Pi from https://pi.dev and ensure ~/.pi/agent can be created; then use Developer → Restart broker. (npm run bootstrap-pi only copies Sylo skills/extensions — it does not install Pi.)`,
            ),
          )
        }, ms)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

let runtime: AgentSessionRuntime | undefined
/** Convenient alias — same object as `runtime?.session` after init. */
let session: AgentSession | undefined
/** Pi built-in tool policy from the last broker init (re-applied after extension reload). */
let brokerPiBuiltinPref: PiBuiltinToolsPref = normalizePiBuiltinToolsPref(null)
/** When true, Pi runs with no tools (plain chat — for models that reject tool payloads). */
let brokerChatOnly = false
/** Routes extension notify/error IPC to the active chat turn. */
let activePromptTurnId: string | undefined
/**
 * Effective main model for the active session. Promoted to module scope (not a
 * `handleInit` closure capture) so `handleSwitchSession` can update them before
 * `runtime.switchSession` re-invokes the `createRuntime` factory — Pi re-resolves
 * the model from these on every session switch, so per-chat model changes apply
 * without a full broker restart.
 */
let brokerModelProvider = ''
let brokerModelId = ''

function installSubagentTurnIdBridge(): void {
  if (!process.send) return
  const nativeSend = process.send.bind(process)
  process.send = ((msg: unknown) => {
        const msgType = (msg as { type?: string })?.type
    if (
      msg &&
      typeof msg === 'object' &&
      (msgType === 'sylo_subagent' ||
        msgType === 'sylo_web_access' ||
        msgType === 'sylo_think_tank' ||
        msgType === 'sylo_think_tank_rpc' ||
        msgType === 'sylo_schedule_rpc') &&
      activePromptTurnId &&
      !(msg as { turnId?: string }).turnId
    ) {
      return nativeSend({ ...(msg as Record<string, unknown>), turnId: activePromptTurnId })
    }
    // Inject workspaceKey for show_canvas / show_widget so the renderer can
    // gate by workspace — same pattern as sylo-tasks:open-on-canvas. Without
    // this, a background workspace's show_canvas overwrites the foreground
    // workspace's docked canvas panel.
    if (
      msg &&
      typeof msg === 'object' &&
      (msgType === 'show_canvas' || msgType === 'show_widget') &&
      brokerSessionCwd &&
      !(msg as { workspaceKey?: string }).workspaceKey
    ) {
      return nativeSend({ ...(msg as Record<string, unknown>), workspaceKey: brokerSessionCwd })
    }
    return nativeSend(msg)
  }) as typeof process.send
}

installSubagentTurnIdBridge()

let unsubscribe: (() => void) | undefined
/** Pi resource loader; published to main on request so the Capability Manager sees Pi's loaded view. */
let resourceLoader: ResourceLoader | undefined
/** Sylo ~/.sylo/disabled.json — filtered out of capability snapshots only (Pi may still load resources internally). */
let disabledSkillPathsSet = new Set<string>()
let disabledExtensionPathsSet = new Set<string>()
/** Broker session cwd/agent dir — used to block skills outside operator scope (e.g. other repos' .cursor/skills). */
let brokerAgentDir = ''
let brokerSessionCwd = ''
let brokerIncludeCursorSkills = false
/** Normalized `extensionPath\0toolName` keys — excluded tools stay in the list with `excludedFromAgent` for host UI. */
let disabledToolKeysSet = new Set<string>()

function ingestDisabledTools(list: unknown): void {
  disabledToolKeysSet = new Set<string>()
  for (const t of normalizeDisabledToolsJson(list)) {
    disabledToolKeysSet.add(makeSyloDisabledToolKey(t.extensionPath, t.toolName))
  }
}

function applyImplicitOutOfScopeSkillBlocks(): void {
  if (!resourceLoader || !brokerAgentDir.trim() || !brokerSessionCwd.trim()) return
  const skillResult = resourceLoader.getSkills()
  for (const skill of skillResult.skills) {
    const norm = normalizeSkillCapabilityPath(skill.filePath)
    if (!norm) continue
    if (
      !isSkillPathInOperatorScope(skill.filePath, brokerAgentDir, brokerSessionCwd, {
        includeCursorSkills: brokerIncludeCursorSkills,
      })
    ) {
      disabledSkillPathsSet.add(norm)
    }
  }
}

function skillScopeOptions() {
  return { includeCursorSkills: brokerIncludeCursorSkills }
}

function skillPathDisabledForAgent(path: string): boolean {
  const p = normalizeSkillCapabilityPath(path)
  if (!p) return false
  if (!isSkillPathInOperatorScope(path, brokerAgentDir, brokerSessionCwd, skillScopeOptions())) return true
  return disabledSkillPathsSet.has(p)
}

function extensionBrokerPolicy() {
  return {
    piBuiltinPref: brokerPiBuiltinPref,
    disabledExtensionPaths: disabledExtensionPathsSet,
    disabledToolKeys: disabledToolKeysSet,
    chatOnly: brokerChatOnly,
  }
}

function assistantTurnErrorFromSession(sess: AgentSession): string | null {
  for (let i = sess.messages.length - 1; i >= 0; i--) {
    const msg = sess.messages[i]!
    if (msg.role !== 'assistant') continue
    const a = msg as {
      stopReason?: string
      errorMessage?: string
      content?: unknown
    }
    if (a.stopReason === 'error' && typeof a.errorMessage === 'string' && a.errorMessage.trim()) {
      return a.errorMessage.trim()
    }
    const text = assistantMessageText(a.content)
    if (!text.trim() && a.stopReason === 'error') {
      return 'Model returned an error with no details.'
    }
    return null
  }
  return null
}

function assistantMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: string; text?: string }
    if (b.type === 'text' && typeof b.text === 'string') out += b.text
  }
  return out
}

/** Extract the text content of the last assistant message in the session. */
function lastAssistantText(sess: AgentSession): string {
  for (let i = sess.messages.length - 1; i >= 0; i--) {
    const msg = sess.messages[i]!
    if (msg.role !== 'assistant') continue
    const a = msg as { content?: unknown }
    return assistantMessageText(a.content)
  }
  return ''
}

function assistantEmptyReplyHint(sess: AgentSession): string | null {
  for (let i = sess.messages.length - 1; i >= 0; i--) {
    const msg = sess.messages[i]!
    if (msg.role !== 'assistant') continue
    const a = msg as { stopReason?: string; content?: unknown }
    const text = assistantMessageText(a.content)
    if (text.trim()) return null
    // An aborted/interrupted turn (user steer, push, or Stop) is expected to
    // have little or no text — don't report it as a "Model returned no text"
    // error. Only flag genuinely empty model responses (stopReason !== aborted).
    if (a.stopReason === 'aborted') return null
    return 'Model returned no text. If you enabled chat-only for a local model, start a new chat and restart the broker after saving Settings.'
  }
  return null
}

function emitExtensionBroker(payload: Record<string, unknown>): void {
  process.send?.(payload)
}

async function setupPiExtensionHost(rt: AgentSessionRuntime): Promise<void> {
  const bindCurrent = async () => {
    await bindPiSessionExtensions({
      session: rt.session,
      runtime: rt,
      emit: emitExtensionBroker,
      getActiveTurnId: () => activePromptTurnId,
      ...extensionBrokerPolicy(),
    })
    session = rt.session
    resourceLoader = rt.services.resourceLoader
  }
  rt.setRebindSession(async () => {
    await bindCurrent()
  })
  await bindCurrent()
}

async function handleInit(msg: BrokerInit): Promise<void> {
  try {
    const agentDir = expandHome(msg.agentDir)
    const sessionCwd = expandHome(msg.sessionCwd)
    const sessionPath = expandHome(msg.sessionPath)
    brokerAgentDir = agentDir
        brokerSessionCwd = sessionCwd
    // Keep SYLO_PI_CWD in sync with the active session's workspace so per-workspace
    // Sylo extensions (sylo-tasks, sylo-workflows) follow the
    // conversation. The fork-time env may differ if the broker was spawned before
    // the focused conversation's workspace was known.
    process.env.SYLO_PI_CWD = sessionCwd
    brokerIncludeCursorSkills = msg.includeCursorSkills === true
    brokerChatOnly =
      process.env.SYLO_CHAT_ONLY === '1' ||
      msg.chatOnly === true ||
      readSyloPrefBool(process.env.SYLO_DB_PATH, 'sylo.chat_only', false)
    disabledSkillPathsSet = new Set(normalizeSkillPathListForPolicyJson(msg.disabledSkillPaths ?? []))
    disabledExtensionPathsSet = new Set(
      normalizePathListForDisabledJson(msg.disabledExtensionPaths ?? []),
    )
    ingestDisabledTools(msg.disabledTools)
    mkdirSync(agentDir, { recursive: true })

    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
    })
    const modelRegistry = new ModelRegistry(modelRuntime)
    const model = resolveModel(modelRegistry, msg.modelProvider, msg.modelId)
    const askedId = msg.modelId.trim()
    if (askedId && !model) {
      console.warn(
        `[sylo broker] Model "${askedId}" is not in Pi's ModelRegistry (~/.pi/agent/models.json). ` +
          `Pi will fall back to its default (often settings.json / built-ins). ` +
          `After saving in Sylo Settings, the host merges this id into models.json — retry Restart broker if needed.`,
      )
    }

    const extraExtensionPaths: string[] = []
    const skillSurfacePath = process.env.SYLO_SKILL_SURFACE_EXTENSION
    if (skillSurfacePath && existsSync(skillSurfacePath)) {
      const norm = normalizeSyloCapabilityPath(skillSurfacePath)
      if (!norm || !disabledExtensionPathsSet.has(norm)) {
        extraExtensionPaths.push(skillSurfacePath)
      }
    }
    const subagentsPath = process.env.SYLO_SUBAGENTS_EXTENSION
    if (subagentsPath && existsSync(subagentsPath)) {
      const norm = normalizeSyloCapabilityPath(subagentsPath)
      if (!norm || !disabledExtensionPathsSet.has(norm)) {
        extraExtensionPaths.push(subagentsPath)
      }
    }
    const schedulerPath = process.env.SYLO_SCHEDULER_EXTENSION
    if (schedulerPath && existsSync(schedulerPath)) {
      const norm = normalizeSyloCapabilityPath(schedulerPath)
      if (!norm || !disabledExtensionPathsSet.has(norm)) {
        extraExtensionPaths.push(schedulerPath)
      }
    }
    try {
      const optionalRaw = process.env.SYLO_OPTIONAL_EXTENSION_PATHS
      if (optionalRaw) {
        const optionalPaths = JSON.parse(optionalRaw) as unknown
        if (Array.isArray(optionalPaths)) {
          for (const p of optionalPaths) {
            if (typeof p !== 'string' || !p.trim()) continue
            if (!existsSync(p)) continue
            const norm = normalizeSyloCapabilityPath(p)
            if (!norm || disabledExtensionPathsSet.has(norm)) continue
            extraExtensionPaths.push(p)
          }
        }
      }
    } catch {
      /* ignore malformed optional extension list */
    }
    const builtinGuardPath = process.env.SYLO_BUILTIN_TOOLS_GUARD_EXTENSION
    if (builtinGuardPath && existsSync(builtinGuardPath)) {
      const norm = normalizeSyloCapabilityPath(builtinGuardPath)
      if (!norm || !disabledExtensionPathsSet.has(norm)) {
        extraExtensionPaths.push(builtinGuardPath)
      }
    }
    const imageFallbackPath = process.env.SYLO_IMAGE_FALLBACK_EXTENSION
    if (imageFallbackPath && existsSync(imageFallbackPath)) {
      const norm = normalizeSyloCapabilityPath(imageFallbackPath)
      if (!norm || !disabledExtensionPathsSet.has(norm)) {
        extraExtensionPaths.push(imageFallbackPath)
      }
    }

    const sessionDir = dirname(sessionPath)
    const sessionManager = SessionManager.open(sessionPath, sessionDir, sessionCwd)

    // Module-level so handleSwitchSession can update them before re-invoking
    // the createRuntime factory (Pi re-resolves the model on session switch).
    brokerModelProvider = msg.modelProvider
    brokerModelId = msg.modelId
    const modelCapture = model
    const extPaths = extraExtensionPaths

    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd: effCwd,
      agentDir: effAgentDir,
      sessionManager: sm,
      sessionStartEvent,
    }) => {
      const mr = await ModelRuntime.create({
        authPath: join(effAgentDir, 'auth.json'),
        modelsPath: join(effAgentDir, 'models.json'),
      })
      const reg = new ModelRegistry(mr)
      const settingsManager = SettingsManager.create(effCwd, effAgentDir)
      ensureWindowsPiShellFallback(settingsManager, effCwd)

      // Pi resolves package-bundled skills automatically when packages are listed in settings.json,
      // but only by their resolved on-disk paths (e.g. ~/.pi/agent/npm/node_modules/<pkg>/skills/…).
      // Sylo additionally walks any operator-mirrored install (npm-global, .pi/npm) so skills shipped
      // alongside an installed Pi package surface dynamically — added when the package is installed,
      // dropped when uninstalled. We never hard-code skill names or tool names in the prompt; the
      // package author owns both via SKILL.md frontmatter and pi.registerTool({ promptSnippet }).
      const bundledSkillPaths = discoverBundledSkillPaths(extPaths, effAgentDir, effCwd).filter((p) => {
        const norm = normalizeSkillCapabilityPath(p)
        if (!norm) return true
        if (!isSkillPathInOperatorScope(p, effAgentDir, effCwd, skillScopeOptions())) return false
        return !skillPathDisabledForAgent(p)
      })
      const additionalSkillPaths = bundledSkillPaths
                  const resourceLoaderOptions: {
        additionalExtensionPaths?: string[]
        additionalSkillPaths?: string[]
        agentsFilesOverride?: (current: { agentsFiles: { path: string; content: string }[] }) => { agentsFiles: { path: string; content: string }[] }
        skillsOverride?: (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => { skills: Skill[]; diagnostics: ResourceDiagnostic[] }
      } = {}
      if (extPaths.length > 0) resourceLoaderOptions.additionalExtensionPaths = extPaths
      if (additionalSkillPaths.length > 0) {
        resourceLoaderOptions.additionalSkillPaths = additionalSkillPaths
      }
      // Keep only the web-access skill inline (it's the most frequently used
      // research skill). Everything else is referenced by a one-line pointer in
      // the system prompt; the model can load specific SKILL.md files via the
      // read tool when a task matches. This cuts the skills block from ~2,100
      // tokens down to ~140 tokens.
      resourceLoaderOptions.skillsOverride = (current) => {
        const inline = current.skills.filter((s) => s.name === 'web-access')
        return { ...current, skills: inline }
      }
      // Reorder context files: put the global AGENTS.md (operator principles /
      // Veritas Standard) last so it lands in the recency zone of the system
      // prompt where model attention is strongest (Lost in the Middle, Liu et
      // al. 2023). Combined with the patch-package swap (skills before context),
      // this moves operator principles to ~82% of the prompt length.
      resourceLoaderOptions.agentsFilesOverride = (current) => {
        const files = current.agentsFiles
        if (files.length <= 1) return current
        // Global context file is the one from agentDir (typically ~/.pi/agent/AGENTS.md).
        // loadProjectContextFiles puts it first; move it to the end.
        const agentDirNormalized = effAgentDir.replace(/\\/g, '/').toLowerCase()
        const globalIdx = files.findIndex(
          (f) => f.path.replace(/\\/g, '/').toLowerCase().startsWith(agentDirNormalized),
        )
        if (globalIdx <= 0) return current
        const reordered = [...files]
        const [globalFile] = reordered.splice(globalIdx, 1)
        reordered.push(globalFile)
        return { agentsFiles: reordered }
      }

      const services = await createAgentSessionServices({
        cwd: effCwd,
        agentDir: effAgentDir,
        modelRuntime: mr,
        settingsManager,
        ...(Object.keys(resourceLoaderOptions).length > 0 ? { resourceLoaderOptions } : {}),
      })

      const resolvedModel =
        resolveModel(reg, brokerModelProvider, brokerModelId) ?? modelCapture

      brokerPiBuiltinPref = normalizePiBuiltinToolsPref(msg.piBuiltinTools)
      const piToolOpts = resolvePiBuiltinToolsSessionOptions(brokerPiBuiltinPref, brokerChatOnly)
      const result = await createAgentSessionFromServices({
        services,
        sessionManager: sm,
        sessionStartEvent,
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...piToolOpts,
      })

      return {
        ...result,
        services,
        diagnostics: services.diagnostics,
      }
    }

    const rt = await withTimeout(
      createAgentSessionRuntime(createRuntime, {
        cwd: sessionCwd,
        agentDir,
        sessionManager,
      }),
      INIT_TIMEOUT_MS,
      'Agent session',
    )
    runtime = rt
    await setupPiExtensionHost(rt)
    applyImplicitOutOfScopeSkillBlocks()
        const resolvedModel = serializeResolvedModel(rt.session, agentDir)
    process.send?.({ type: 'ready', resolvedModel })
        // Compute and send system prompt stats for the context-window dashboard
    await sendSystemPromptStats()
    sendContextWindowStats()
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    process.send?.({ type: 'init_error', error: err })
    process.exit(1)
  }
}

async function handleSwitchSession(msg: BrokerSwitchSession): Promise<void> {
  if (!runtime) {
    process.send?.({
      type: 'switch_session_result',
      requestId: msg.requestId,
      ok: false,
      error: 'Runtime not initialized',
    })
    return
  }
  try {
    const p = expandHome(msg.sessionPath)
    if (msg.disabledSkillPaths !== undefined) {
      disabledSkillPathsSet = new Set(normalizeSkillPathListForPolicyJson(msg.disabledSkillPaths))
    }
    if (msg.disabledExtensionPaths !== undefined) {
      disabledExtensionPathsSet = new Set(normalizePathListForDisabledJson(msg.disabledExtensionPaths))
    }
    if (msg.disabledTools !== undefined) {
      ingestDisabledTools(msg.disabledTools)
    }
    if (msg.includeCursorSkills !== undefined) {
      brokerIncludeCursorSkills = msg.includeCursorSkills === true
    }
    // Per-chat model override: update the module-level vars before
    // `runtime.switchSession` re-invokes the createRuntime factory, so Pi
    // re-resolves and re-binds the new model on the switched session. Empty /
    // undefined keeps the current model (no change).
    if (typeof msg.modelProvider === 'string') brokerModelProvider = msg.modelProvider
    if (typeof msg.modelId === 'string') brokerModelId = msg.modelId
    // Image (fallback) model: the sylo-image-fallback extension reads these env
    // vars at tool-execution time, so updating them here takes effect on the
    // next analyze_image call without a broker restart.
    if (typeof msg.imageModelId === 'string') {
      process.env.SYLO_IMAGE_MODEL_ID = msg.imageModelId.trim()
    }
    if (typeof msg.imageModelProvider === 'string') {
      process.env.SYLO_IMAGE_MODEL_PROVIDER = msg.imageModelProvider.trim()
    }
        brokerSessionCwd = expandHome(msg.sessionCwd)
    // Propagate the new workspace cwd to SYLO_PI_CWD so per-workspace Sylo
    // extensions follow the switched conversation (env vars are frozen at fork,
    // so switch_session must re-publish it in-process).
    process.env.SYLO_PI_CWD = brokerSessionCwd
    await runtime.switchSession(p, { cwdOverride: brokerSessionCwd })
    session = runtime.session
    applyImplicitOutOfScopeSkillBlocks()
    applySyloActiveToolsFromBrokerPolicy(session, extensionBrokerPolicy())
        // Apply the per-chat thinking-level override after the session exists so the
    // next provider request carries it (Pi clamps to the model's supported set).
    if (typeof msg.thinkingLevel === 'string' && msg.thinkingLevel.trim() !== '') {
      try {
        session.setThinkingLevel(msg.thinkingLevel as Parameters<typeof session.setThinkingLevel>[0])
      } catch {
        /* level unsupported by this model — keep Pi default */
      }
    }
    // Report the newly bound model so the host caption updates after a
    // model-changing switch (Pi re-resolves the model on switchSession).
        process.send?.({ type: 'model_resolved', resolvedModel: serializeResolvedModel(session, brokerAgentDir) })
    // Re-send system prompt stats and context window stats so the footer
    // dashboard reflects the new workspace's prompt, not the init-time snapshot.
    await sendSystemPromptStats()
    sendContextWindowStats()
    process.send?.({ type: 'switch_session_result', requestId: msg.requestId, ok: true })
  } catch (e) {
    process.send?.({
      type: 'switch_session_result',
      requestId: msg.requestId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

async function handleForkBeforeLastUser(msg: BrokerForkBeforeLastUser): Promise<void> {
  if (!runtime || !session) {
    process.send?.({
      type: 'fork_result',
      requestId: msg.requestId,
      ok: false,
      error: 'Runtime not initialized',
    })
    return
  }
  try {
    const entries = session.sessionManager.getEntries()
    let lastUserId: string | undefined
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!
      if (e.type === 'message' && e.message.role === 'user') {
        lastUserId = e.id
        break
      }
    }
    if (!lastUserId) {
      process.send?.({
        type: 'fork_result',
        requestId: msg.requestId,
        ok: false,
        error: 'No user message to fork before',
      })
      return
    }
    await runtime.fork(lastUserId, { position: 'before' })
    session = runtime.session
    const file = session.sessionFile
    if (!file) {
      process.send?.({
        type: 'fork_result',
        requestId: msg.requestId,
        ok: false,
        error: 'Fork succeeded but session file path missing',
      })
      return
    }
    process.send?.({
      type: 'fork_result',
      requestId: msg.requestId,
      ok: true,
      sessionFileAbs: file,
    })
  } catch (e) {
    process.send?.({
      type: 'fork_result',
      requestId: msg.requestId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

type SerializedTool = {
  name: string
  description?: string
  /** Sylo ~/.sylo/disabled.json — snapshot still lists the tool so the host can toggle it. */
  excludedFromAgent: boolean
}

type SerializedExtension = {
  /** Pi-reported source path; may be the .ts file or a packaged folder root */
  path: string
  resolvedPath: string
  /** Friendly display name derived from the path */
  name: string
  tools: SerializedTool[]
  commandNames: string[]
}

type SerializedSkill = {
  name: string
  description: string
  path: string
}

function describeTool(extensionContributorPathNorm: string, tool: RegisteredTool): SerializedTool {
  const def = tool.definition as { name?: string; description?: string }
  const name = typeof def?.name === 'string' ? def.name : '(unknown)'
  const trimmed = name.trim()
  const excludedFromAgent =
    extensionContributorPathNorm !== '' &&
    trimmed !== '' &&
    trimmed !== '(unknown)' &&
    disabledToolKeysSet.has(makeSyloDisabledToolKey(extensionContributorPathNorm, trimmed))
  return {
    name,
    description: typeof def?.description === 'string' ? def.description : undefined,
    excludedFromAgent,
  }
}

function serializeExtension(ext: Extension): SerializedExtension {
  const path = ext.path ?? ext.resolvedPath ?? ''
  const resolvedPath = ext.resolvedPath ?? path
  const ser: SerializedExtension = {
    path,
    resolvedPath,
    name: deriveExtensionDisplayName(path),
    tools: [],
    commandNames: Array.from(ext.commands.keys()),
  }
  const contribPath = extensionContributorPath(ser)
  ser.tools = Array.from(ext.tools.values()).map((t) => describeTool(contribPath, t))
  return ser
}

/** Canonical filesystem path identifying which extension contributes a tool (matches main-process disable keys). */
function extensionContributorPath(ext: SerializedExtension): string {
  const raw = (ext.resolvedPath || ext.path || '').trim()
  return raw ? normalizeSyloCapabilityPath(raw) : ''
}

/**
 * When two or more enabled extensions register the same Pi tool id, map that name to sorted canonical
 * contributor paths. Used by Sylo UX only; Pi load order decides the effective handler.
 */
function computeToolNameCollisions(extensions: SerializedExtension[]): Record<string, string[]> {
  const byName = new Map<string, Set<string>>()
  for (const ext of extensions) {
    const contrib = extensionContributorPath(ext)
    if (!contrib) continue
    for (const t of ext.tools) {
      if (t.excludedFromAgent) continue
      const n = typeof t.name === 'string' ? t.name.trim() : ''
      if (!n || n === '(unknown)') continue
      let set = byName.get(n)
      if (!set) {
        set = new Set<string>()
        byName.set(n, set)
      }
      set.add(contrib)
    }
  }
  const out: Record<string, string[]> = {}
  for (const [name, set] of byName) {
    if (set.size > 1) out[name] = Array.from(set).sort((a, b) => a.localeCompare(b))
  }
  return out
}

function serializeSkill(skill: Skill): SerializedSkill {
  const filePath =
    typeof skill.filePath === 'string' && skill.filePath.trim() ?
      skill.filePath.trim()
    : ''
  const legacy = skill as unknown as { path?: string; sourcePath?: string }
  const path =
    filePath ||
    (typeof legacy.path === 'string' ? legacy.path.trim() : '') ||
    (typeof legacy.sourcePath === 'string' ? legacy.sourcePath.trim() : '')
  return {
    name: typeof skill.name === 'string' ? skill.name : '(unknown)',
    description: typeof skill.description === 'string' ? skill.description : '',
    path,
  }
}

function serializedExtensionDisabled(e: SerializedExtension): boolean {
  const p = normalizeSyloCapabilityPath(e.path)
  const r = normalizeSyloCapabilityPath(e.resolvedPath)
  return (
    (p ? disabledExtensionPathsSet.has(p) : false) ||
    (r ? disabledExtensionPathsSet.has(r) : false)
  )
}

function serializedSkillDisabled(s: SerializedSkill): boolean {
  return skillPathDisabledForAgent(s.path)
}

function dedupeSerializedSkills(skills: SerializedSkill[]): SerializedSkill[] {
  const byDir = new Map<string, SerializedSkill>()
  for (const skill of skills) {
    const key = normalizeSkillCapabilityPath(skill.path)
    if (!key) continue
    const existing = byDir.get(key)
    if (!existing) {
      byDir.set(key, skill)
      continue
    }
    const pathNorm = skill.path.replace(/\\/g, '/')
    const existingNorm = existing.path.replace(/\\/g, '/')
    if (existingNorm.endsWith('SKILL.md') && !pathNorm.endsWith('SKILL.md')) {
      byDir.set(key, skill)
    }
  }
  return Array.from(byDir.values())
}

function buildCapabilitiesSnapshot(): {
  extensions: SerializedExtension[]
  skills: SerializedSkill[]
  loadErrors: { path: string; error: string }[]
  toolNameCollisions: Record<string, string[]>
} {
  if (!resourceLoader) {
    return { extensions: [], skills: [], loadErrors: [], toolNameCollisions: {} }
  }
  applyImplicitOutOfScopeSkillBlocks()
  const extResult = resourceLoader.getExtensions()
  const skillResult = resourceLoader.getSkills()
  const extensions = extResult.extensions
    .map(serializeExtension)
    .filter((e) => !serializedExtensionDisabled(e))
  // MVP: Pi's DefaultResourceLoader may still load disabled skills/extensions internally; Sylo only
  // guarantees the forwarded capability snapshot matches ~/.sylo/disabled.json for agent-facing UX.
  return {
    extensions,
    skills: dedupeSerializedSkills(
      skillResult.skills.map(serializeSkill).filter((s) => !serializedSkillDisabled(s)),
    ),
    loadErrors: extResult.errors.map((e) => ({ path: e.path, error: e.error })),
    toolNameCollisions: computeToolNameCollisions(extensions),
  }
}

function handleCapabilitiesList(requestId: string): void {
  try {
    const snap = buildCapabilitiesSnapshot()
    process.send?.({
      type: 'capabilities_list_result',
      requestId,
      ok: true,
      ...snap,
    })
  } catch (e) {
    process.send?.({
      type: 'capabilities_list_result',
      requestId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

async function handlePrompt(msg: BrokerPrompt): Promise<void> {
  if (!session) {
    process.send?.({ type: 'error', turnId: msg.turnId, error: 'Session not initialized' })
    return
  }
  activePromptTurnId = msg.turnId
  unsubscribe?.()
  const currentSession = session
  let textForwarded = false
  unsubscribe = currentSession.subscribe((ev) => {
    const slim = slimEvent(ev)
    if (slim) {
      if (slim.type === 'text_delta') textForwarded = true
      // Pi's compaction_end carries `tokensBefore` but no after-count. Estimate
      // the post-compaction context size from the live session messages so the
      // host can show a before/after pair. Uses the same chars/4 heuristic as
      // Pi's `estimateTokens` (the fallback path of `estimateContextTokens`).
      if (
        slim.type === 'compaction_end' &&
        !slim.aborted &&
        !slim.errorMessage
      ) {
        let tokensAfter: number | undefined
        try {
          let sum = 0
          for (const m of currentSession.messages) sum += estimateTokens(m)
          tokensAfter = sum > 0 ? sum : undefined
        } catch {
          tokensAfter = undefined
        }
        ;(slim as { tokensAfter?: number }).tokensAfter = tokensAfter
      }
      process.send?.({ type: 'event', turnId: msg.turnId, event: slim })
    }
  })
  try {
    const slash = parsePiSlashInput(msg.text)
    if (slash?.name === 'reload') {
      await session.reload()
      applySyloActiveToolsFromBrokerPolicy(session, extensionBrokerPolicy())
      emitExtensionBroker({
        type: 'extension_notify',
        turnId: msg.turnId,
        message: 'Reloaded extensions, skills, and MCP configuration.',
        notifyType: 'info',
      })
      process.send?.({ type: 'done', turnId: msg.turnId })
      sendContextWindowStats()
      return
    }

    const promptOptions =
      msg.images && msg.images.length > 0 ? { images: msg.images } : undefined
    await session.prompt(msg.text, promptOptions)
    const turnErr = assistantTurnErrorFromSession(session)
    const emptyHint = turnErr ? null : assistantEmptyReplyHint(session)
    if (turnErr || emptyHint) {
      process.send?.({ type: 'error', turnId: msg.turnId, error: turnErr ?? emptyHint! })
      return
    }
    // Fallback: if the session has assistant text but no text_delta events were
    // forwarded during the turn (e.g. non-streamed response, API returned text
    // via message_start/message_end only, or auto-retry after error produced
    // text that wasn't streamed), forward the text now so the host's
    // pending.chunks is populated before `done` arrives. Without this, the host
    // sees an empty response and marks the message as failed even though the
    // model produced output.
    if (!textForwarded) {
      const text = lastAssistantText(currentSession)
      if (text) {
        process.send?.({ type: 'event', turnId: msg.turnId, event: { type: 'text_delta', delta: text } })
      }
    }
    process.send?.({ type: 'done', turnId: msg.turnId })
    sendContextWindowStats()
  } catch (e) {
    process.send?.({
      type: 'error',
      turnId: msg.turnId,
      error: e instanceof Error ? e.message : String(e),
    })
  } finally {
    activePromptTurnId = undefined
    unsubscribe?.()
    unsubscribe = undefined
  }
}

async function deliverSteerText(text: string, images?: BrokerImageContent[]): Promise<void> {
  if (!session) return
  const hasImages = images && images.length > 0
  if (session.isStreaming) {
    await session.steer(text, hasImages ? images : undefined)
  } else {
    await session.prompt(text, hasImages ? { images } : undefined)
  }
}

async function handleBridgeFollowUp(msg: BrokerBridgeFollowUp): Promise<void> {
  if (!session) return
  try {
    await deliverSteerText(msg.text)
  } catch (e) {
    console.error('[sylo-broker] bridge_followup failed:', e)
  }
}

async function deliverFollowUpText(text: string, images?: BrokerImageContent[]): Promise<void> {
  if (!session) return
  const hasImages = images && images.length > 0
  if (session.isStreaming) {
    await session.followUp(text, hasImages ? images : undefined)
  } else {
    await session.prompt(text, hasImages ? { images } : undefined)
  }
}

async function handleFollowUp(msg: BrokerFollowUp): Promise<void> {
  if (!session) return
  try {
    await deliverFollowUpText(msg.text, msg.images)
  } catch (e) {
    console.error('[sylo-broker] follow_up failed:', e)
  }
}

async function handleSteer(msg: BrokerSteer): Promise<void> {
  if (!session) return
  try {
    await deliverSteerText(msg.text, msg.images)
  } catch (e) {
    console.error('[sylo-broker] steer failed:', e)
  }
}

function handleMessage(msg: unknown): void {
  const m = msg as BrokerMessageIn
  if (!m || typeof m !== 'object' || !('type' in m)) return
  if (m.type === 'init') {
    void handleInit(m)
    return
  }
  if (m.type === 'prompt') {
    void handlePrompt(m)
    return
  }
    if (m.type === 'capabilities_list') {
    handleCapabilitiesList(m.requestId)
    return
  }
  if (m.type === 'thinking_levels') {
    handleThinkingLevels(m)
    return
  }
  if (m.type === 'bridge_followup') {
    void handleBridgeFollowUp(m)
    return
  }
  if (m.type === 'steer') {
    void handleSteer(m)
    return
  }
  if (m.type === 'follow_up') {
    void handleFollowUp(m)
    return
  }
  if (m.type === 'switch_session') {
    void handleSwitchSession(m)
    return
  }
  if (m.type === 'fork_before_last_user') {
    void handleForkBeforeLastUser(m)
    return
  }
  if (m.type === 'abort' && session) {
    cancelAllSubagentRuns()
    void session.abort()
    return
  }
  if (m.type === 'cancel_subagent') {
    const runId = typeof m.runId === 'string' ? m.runId.trim() : ''
    if (runId) cancelSubagentRun(runId)
    return
  }
  if (m.type === 'sylo_think_tank_rpc_result') {
    // Main → broker IPC already fans out to all process 'message' listeners
    // (e.g. thinkTankRpc waiters in sylo-host). Do not re-emit here — that
    // re-enters handleMessage and blows the stack.
    return
  }
  if (m.type === 'sylo_schedule_rpc_result') {
    return
  }
  if (m.type === 'sylo-tasks:apply-edit') {
    // Main → broker IPC for operator-initiated task edits (Phase 4). The
    // sylo-tasks extension registers its own `process.on('message')` listener
    // and applies the edit to the store (which then emits `sylo-tasks:changed`).
    // Do not consume it here — returning lets Node fan the message to all
    // process 'message' listeners, same pass-through pattern as `_rpc_result`.
    return
  }
  if (m.type === 'dispose' && runtime) {
    void runtime.dispose().finally(() => {
      runtime = undefined
      session = undefined
      process.exit(0)
    })
    return
  }
}

console.error(
  `[sylo-broker] boot pid=${process.pid} electron_run_as_node=${process.env.ELECTRON_RUN_AS_NODE ?? '(unset)'} cwd=${process.cwd()}`,
)

process.on('uncaughtException', (err) => {
  console.error('sylo broker uncaughtException:', err)
  try {
    process.send?.({
      type: 'init_error',
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    })
  } catch {
    /* */
  }
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  console.error('sylo broker unhandledRejection:', detail)
  try {
    process.send?.({
      type: 'init_error',
      error: `Unhandled rejection: ${detail}`,
    })
  } catch {
    /* */
  }
  process.exit(1)
})

process.on('message', handleMessage)

if (process.env.SYLO_BROKER_SELF_TEST === '1') {
  const cwd = process.cwd()
  const agentDir = process.env.SYLO_PI_AGENT_DIR ?? `${process.env.HOME ?? process.env.USERPROFILE}/.pi/agent`
  const sessionPath = join(agentDir, 'sessions', 'sylo', '_inbox', 'self-test.jsonl')
  void handleInit({
    type: 'init',
    cwd,
    agentDir,
    sessionPath,
    sessionCwd: cwd,
    modelProvider: process.env.SYLO_MODEL_PROVIDER ?? SYLO_DEFAULT_MODEL_PROVIDER,
    modelId: process.env.SYLO_MODEL_ID ?? SYLO_DEFAULT_MODEL_ID,
  })
}
