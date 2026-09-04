import { fork, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { defaultPiBuiltinToolsPref, type PiBuiltinToolsPref } from '../shared/pi-builtin-tools.js'
import type { SystemPromptStats } from '../shared/system-prompt-stats.js'
import { withDateTimeStamp } from '../shared/message-datetime-stamp.js'
import { readSyloPrefString } from '../shared/sylo-sqlite-prefs.js'

/** Repo workspace installs `@earendil-works/*` under root `node_modules`; cwd must stay inside host package for predictable resolution when Electron forks broker.mjs. */
function resolveHostPackageRoot(supervisorDir: string): string {
  return resolve(join(supervisorDir, '..', '..'))
}

function formatBrokerLogs(stderr: string, stdout: string): string {
  const parts: string[] = []
  if (stderr.trim()) parts.push(`--- stderr ---\n${stderr.trimEnd()}`)
  if (stdout.trim()) parts.push(`--- stdout ---\n${stdout.trimEnd()}`)
  return parts.join('\n\n')
}

export type SlimBrokerEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'message_update'; assistantType?: string }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      isError: boolean
      resultSummary: unknown
    }
  | { type: string }

export type BrokerResolvedModel = {
  provider: string
  modelId: string
  displayName?: string
}

/** Pi `ImageContent` payload carried over IPC into the broker child. */
export type BrokerImageContent = {
  type: 'image'
  data: string
  mimeType: string
}

export type BrokerCapabilitiesSnapshot = {
  extensions: {
    path: string
    resolvedPath: string
    name: string
    tools: { name: string; description?: string; excludedFromAgent: boolean }[]
    commandNames: string[]
  }[]
  skills: { name: string; description: string; path: string }[]
  loadErrors: { path: string; error: string }[]
  /** Duplicate Pi tool ids across enabled broker extensions (canonical path per contributor). */
  toolNameCollisions: Record<string, string[]>
}

export type BrokerCapabilitiesResult =
  | { type: 'capabilities_list_result'; requestId: string; ok: true } & BrokerCapabilitiesSnapshot
  | { type: 'capabilities_list_result'; requestId: string; ok: false; error: string }

export type BrokerOutMessage =
  | { type: 'ready'; resolvedModel: BrokerResolvedModel | null }
  | { type: 'model_resolved'; resolvedModel: BrokerResolvedModel | null }
  | { type: 'init_error'; error: string }
  | { type: 'event'; turnId: string; event: SlimBrokerEvent }
  | { type: 'done'; turnId: string }
  | { type: 'error'; turnId?: string; error: string }
  | {
      type: 'extension_notify'
      turnId?: string
      message: string
      notifyType?: 'info' | 'warning' | 'error'
      statusKey?: string
    }
  | {
      type: 'extension_error'
      turnId?: string
      extensionPath: string
      event: string
      error: string
    }
  | {
            type: 'show_widget'
      toolCallId: string
      html?: string
      path?: string
      data: unknown
      workspaceKey?: string
    }
  | {
      type: 'show_canvas'
      toolCallId: string
      kind: 'svg' | 'mermaid' | 'markdown'
      title?: string
      content?: string
      filePath?: string
      workspaceKey?: string
    }
  | {
      type: 'sylo_subagent'
      turnId?: string
      event: Record<string, unknown>
    }
  | {
      type: 'sylo_web_access'
      turnId?: string
      event: Record<string, unknown>
    }
  | {
      type: 'sylo_think_tank'
      turnId?: string
      event: Record<string, unknown>
    }
  | {
      type: 'sylo_think_tank_rpc'
      turnId?: string
      requestId: string
      op: string
      sessionId?: string
      reportId?: string
      query?: string
      limit?: number
    }
  | {
      type: 'sylo_schedule_rpc'
      turnId?: string
      requestId: string
      op: string
      title?: string
      prompt_text?: string
      recurrence?: string
      start_at?: number
      time_local?: string
      day_of_week?: number
      day_of_month?: number
      max_runs?: number | null
      catchup_on_startup?: boolean
      id?: string
      patch?: Record<string, unknown>
    }
    | {
      type: 'sylo-tasks:changed'
      workspaceKey: string
      listId: string
      snapshot: unknown
    }
  | {
      type: 'sylo-tasks:open-on-canvas'
      workspaceKey: string
      listId: string
      snapshot: unknown
    }
    | BrokerCapabilitiesResult
  | { type: 'thinking_levels_result'; requestId: string; ok: true; levels?: string[]; resolvedModel?: { provider: string; modelId: string } | null }
  | { type: 'thinking_levels_result'; requestId: string; ok: false; error?: string }
    | { type: 'switch_session_result'; requestId: string; ok: true }
  | { type: 'switch_session_result'; requestId: string; ok: false; error: string }
  | { type: 'fork_result'; requestId: string; ok: true; sessionFileAbs: string }
  | { type: 'fork_result'; requestId: string; ok: false; error: string }
  | { type: 'system_prompt_stats'; stats: SystemPromptStats }
  | { type: 'context_window_stats'; actualMessageTokens: number }

export interface BrokerConfig {
  brokerScriptPath: string
  /** Working directory for the forked broker Node process (package root). */
  hostPackageRoot: string
    syloDbPath: string
  /** Explicit personal-bundle data-dir override (Settings pref), passed to the broker as SYLO_PERSONAL_DATA_DIR. Optional. */
  personalDataDir?: string
  /** Generic personal data root (<sylo-user>) — passed to the broker as SYLO_PERSONAL_DATA_ROOT (the personal bundle derives `<root>/health`). */
  personalDataRoot: string
  nodePath: string
  cwd: string
  agentDir: string
  /** Absolute path to Pi session JSONL (may not exist yet). */
  initialSessionPath: string
  /** Pi effective cwd for that session (folder pi_cwd or host cwd). */
  initialSessionCwd: string
  modelProvider: string
    modelId: string
  /** Sylo ~/.sylo/disabled.json — broker filters these from capability snapshots. */
  disabledSkillPaths?: string[]
  disabledExtensionPaths?: string[]
  /** Per-tool exclusions merged from global + workspace (same shape as ~/.sylo/disabled.json `disabledTools`). */
  disabledTools?: { extensionPath: string; toolName: string }[]
  /** When true, broker lists/applies skills under the session workspace `.cursor/skills`. */
  includeCursorSkills?: boolean
  /** Sylo pref — Pi built-in tools (read/bash/…) for the agent session. */
  piBuiltinTools?: PiBuiltinToolsPref
  /** Sylo pref — plain chat (no tools sent to the model). */
  chatOnly?: boolean
  /** Repo path to sylo-builtin-tools-guard (execution-time block for disabled built-ins). */
  builtinToolsGuardExtension?: string
  /** Repo path to sylo-image-fallback (vision model for tool results on text-only main model). */
  imageFallbackExtension?: string
  /** Repo path to @sylo/skill-surface-extension (show_widget → host) */
  skillSurfaceExtension?: string
  /** Repo path to @sylo/sylo-subagents (subagent tool + sylo_subagent IPC) */
  subagentsExtension?: string
  /** Repo path to @sylo/sylo-scheduler (schedule_* tools + sylo_schedule_rpc IPC) */
  schedulerExtension?: string
  /** Enabled Sylo optional package extension paths (repo-bundled Pi packages). */
  optionalExtensionPaths?: string[]
  /** Absolute path to sylo-web-access config JSON for the broker child (optional). */
  webAccessConfigPath?: string
  /** Absolute path to sylo-tts config JSON for the broker child (optional). */
  ttsConfigPath?: string
  /** Absolute path to sylo-think-tank config JSON for the broker child (optional). */
  thinkTankConfigPath?: string
  /** Settings → image model for think-tank seat vision fallback (Ollama id). */
  imageModelId?: string
  imageModelProvider?: string
  ollamaBaseOrigin?: string
  onMessage: (msg: BrokerOutMessage) => void
  /** Rolling stderr/stdout from the broker child (empty if silent child printed nothing). */
  onExit: (code: number | null, signal: NodeJS.Signals | null, capturedLogs: string) => void
}

function resolveBrokerScript(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '../broker/broker.mjs'),
    join(here, '../../out/broker/broker.mjs'),
  ]
  for (const c of candidates) {
    const r = resolve(c)
    if (existsSync(r)) return r
  }
  return resolve(candidates[0]!)
}

type PendingCapabilitiesRequest = {
  resolve: (value: BrokerCapabilitiesSnapshot) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type PendingSwitch = {
  resolve: () => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type PendingFork = {
  resolve: (value: { sessionFileAbs: string }) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type PendingThinkingLevels = {
  resolve: (value: { ok: true; levels?: string[]; resolvedModel: { provider: string; modelId: string } | null }) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class BrokerSupervisor {
  private child: ChildProcess | undefined
  private cfg: BrokerConfig
  /** Buffers for the active fork — swapped each spawn so late exits keep their own snapshot */
  private peekSnapshot = { stderr: '', stdout: '' }
  /** In-flight request/response pairs (currently only `capabilities_list`) keyed by requestId. */
    private pendingCapabilities = new Map<string, PendingCapabilitiesRequest>()
  private pendingSwitchSession = new Map<string, PendingSwitch>()
  private pendingFork = new Map<string, PendingFork>()
  private pendingThinkingLevels = new Map<string, PendingThinkingLevels>()

  constructor(cfg: Omit<BrokerConfig, 'brokerScriptPath'> & { brokerScriptPath?: string }) {
    const scriptPath = cfg.brokerScriptPath ?? resolveBrokerScript()
    const supervisorHere = dirname(fileURLToPath(import.meta.url))
    this.cfg = {
      brokerScriptPath: scriptPath,
      hostPackageRoot: cfg.hostPackageRoot ?? resolveHostPackageRoot(supervisorHere),
            syloDbPath: cfg.syloDbPath,
      personalDataDir: cfg.personalDataDir,
      personalDataRoot: cfg.personalDataRoot,
      nodePath: cfg.nodePath,
      cwd: cfg.cwd,
      agentDir: cfg.agentDir,
      initialSessionPath: cfg.initialSessionPath,
      initialSessionCwd: cfg.initialSessionCwd,
      modelProvider: cfg.modelProvider,
            modelId: cfg.modelId,
      disabledSkillPaths: cfg.disabledSkillPaths ?? [],
      disabledExtensionPaths: cfg.disabledExtensionPaths ?? [],
      disabledTools: cfg.disabledTools ?? [],
      includeCursorSkills: cfg.includeCursorSkills ?? false,
      piBuiltinTools: cfg.piBuiltinTools,
      builtinToolsGuardExtension: cfg.builtinToolsGuardExtension,
      imageFallbackExtension: cfg.imageFallbackExtension,
      skillSurfaceExtension: cfg.skillSurfaceExtension,
      subagentsExtension: cfg.subagentsExtension,
      schedulerExtension: cfg.schedulerExtension,
      optionalExtensionPaths: cfg.optionalExtensionPaths,
      webAccessConfigPath: cfg.webAccessConfigPath,
      ttsConfigPath: cfg.ttsConfigPath,
      thinkTankConfigPath: cfg.thinkTankConfigPath,
      imageModelId: cfg.imageModelId,
      imageModelProvider: cfg.imageModelProvider,
      ollamaBaseOrigin: cfg.ollamaBaseOrigin,
      onMessage: cfg.onMessage,
      onExit: cfg.onExit,
    }
  }

  peekLogs(): string {
    return formatBrokerLogs(this.peekSnapshot.stderr, this.peekSnapshot.stdout)
  }

  spawn(): void {
    this.disposeChild()

    const buffers = { stderr: '', stdout: '' }
    this.peekSnapshot = buffers

    const appendStderr = (chunk: Buffer) => {
      buffers.stderr = (buffers.stderr + chunk.toString('utf8')).slice(-24_000)
    }
    const appendStdout = (chunk: Buffer) => {
      buffers.stdout = (buffers.stdout + chunk.toString('utf8')).slice(-12_000)
    }

    const { brokerScriptPath } = this.cfg
    const child = fork(brokerScriptPath, [], {
      cwd: this.cfg.hostPackageRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SYLO_DB_PATH: this.cfg.syloDbPath,
        SYLO_PERSONAL_DATA_ROOT: this.cfg.personalDataRoot,
        ...(this.cfg.personalDataDir ? { SYLO_PERSONAL_DATA_DIR: this.cfg.personalDataDir } : {}),
        NODE_PATH: this.cfg.nodePath,
        SYLO_PI_CWD: this.cfg.cwd,
        SYLO_PI_AGENT_DIR: this.cfg.agentDir,
        SYLO_MODEL_PROVIDER: this.cfg.modelProvider,
                SYLO_MODEL_ID: this.cfg.modelId,
        ...(this.cfg.skillSurfaceExtension ?
          { SYLO_SKILL_SURFACE_EXTENSION: this.cfg.skillSurfaceExtension }
        : {}),
        ...(this.cfg.subagentsExtension ?
          {
            SYLO_SUBAGENTS_EXTENSION: this.cfg.subagentsExtension,
            SYLO_SUBAGENTS_AGENT_SCOPE: readSyloPrefString(
              this.cfg.syloDbPath,
              'sylo.subagents.agent_scope',
              'user',
            ),
          }
        : {}),
        ...(this.cfg.schedulerExtension ?
          { SYLO_SCHEDULER_EXTENSION: this.cfg.schedulerExtension }
        : {}),
        ...(this.cfg.optionalExtensionPaths && this.cfg.optionalExtensionPaths.length > 0 ?
          { SYLO_OPTIONAL_EXTENSION_PATHS: JSON.stringify(this.cfg.optionalExtensionPaths) }
        : {}),
        ...(this.cfg.webAccessConfigPath ?
          { SYLO_WEB_ACCESS_CONFIG: this.cfg.webAccessConfigPath }
        : {}),
        ...(this.cfg.ttsConfigPath ? { SYLO_TTS_CONFIG: this.cfg.ttsConfigPath } : {}),
        ...(this.cfg.thinkTankConfigPath ?
          { SYLO_THINK_TANK_CONFIG: this.cfg.thinkTankConfigPath }
        : {}),
        ...(this.cfg.imageModelId ? { SYLO_IMAGE_MODEL_ID: this.cfg.imageModelId } : {}),
        ...(this.cfg.imageModelProvider ?
          { SYLO_IMAGE_MODEL_PROVIDER: this.cfg.imageModelProvider }
        : {}),
        ...(this.cfg.ollamaBaseOrigin ? { SYLO_OLLAMA_BASE_ORIGIN: this.cfg.ollamaBaseOrigin } : {}),
        ...(this.cfg.builtinToolsGuardExtension ?
          { SYLO_BUILTIN_TOOLS_GUARD_EXTENSION: this.cfg.builtinToolsGuardExtension }
        : {}),
        ...(this.cfg.imageFallbackExtension ?
          { SYLO_IMAGE_FALLBACK_EXTENSION: this.cfg.imageFallbackExtension }
        : {}),
        SYLO_PI_BUILTIN_TOOLS: JSON.stringify(
          this.cfg.piBuiltinTools ?? defaultPiBuiltinToolsPref(),
        ),
        ...(this.cfg.chatOnly ? { SYLO_CHAT_ONLY: '1' } : { SYLO_CHAT_ONLY: '0' }),
        SYLO_DISABLED_TOOLS: JSON.stringify(this.cfg.disabledTools ?? []),
        SYLO_DISABLED_EXTENSION_PATHS: JSON.stringify(this.cfg.disabledExtensionPaths ?? []),
      },
      silent: true,
      execArgv: [],
    })
    this.child = child
    child.stderr?.on('data', appendStderr)
    child.stdout?.on('data', appendStdout)
    child.on('message', (msg) => {
      const m = msg as BrokerOutMessage
      if (m && typeof m === 'object' && m.type === 'capabilities_list_result') {
        this.resolveCapabilities(m)
        return
      }
      if (m && typeof m === 'object' && m.type === 'switch_session_result') {
        this.resolveSwitchSession(m)
        return
      }
            if (m && typeof m === 'object' && m.type === 'fork_result') {
        this.resolveFork(m)
        return
      }
      if (m && typeof m === 'object' && m.type === 'thinking_levels_result') {
        this.resolveThinkingLevels(m)
        return
      }
      this.cfg.onMessage(m)
    })
    child.on('exit', (code, signal) => {
      const captured = formatBrokerLogs(buffers.stderr, buffers.stdout)
      this.cfg.onExit(code, signal, captured)
      if (this.child === child) this.child = undefined
      const reason =
        typeof code === 'number' ?
          `Broker exited (code ${code}${signal ? `, signal ${signal}` : ''}).`
        : signal ?
          `Broker exited (signal ${String(signal)}).`
        : 'Broker exited.'
      this.failAllPending(reason)
    })
    const payload = {
      type: 'init' as const,
      cwd: this.cfg.cwd,
      agentDir: this.cfg.agentDir,
      sessionPath: this.cfg.initialSessionPath,
      sessionCwd: this.cfg.initialSessionCwd,
      modelProvider: this.cfg.modelProvider,
      modelId: this.cfg.modelId,
      disabledSkillPaths: this.cfg.disabledSkillPaths ?? [],
      disabledExtensionPaths: this.cfg.disabledExtensionPaths ?? [],
      disabledTools: this.cfg.disabledTools ?? [],
      includeCursorSkills: this.cfg.includeCursorSkills ?? false,
      piBuiltinTools: this.cfg.piBuiltinTools,
      chatOnly: this.cfg.chatOnly ?? false,
    }
    setImmediate(() => {
      if (!child.killed) child.send(payload)
    })
  }

  switchSession(
    sessionPath: string,
    sessionCwd: string,
    options?: {
      disabledSkillPaths?: string[]
      disabledExtensionPaths?: string[]
      disabledTools?: { extensionPath: string; toolName: string }[]
      includeCursorSkills?: boolean
      /** Per-chat main model override (empty = keep current). */
      modelProvider?: string
      modelId?: string
            /** Per-chat image (fallback) model override (empty = keep current). */
      imageModelId?: string
      imageModelProvider?: string
      /** Per-chat thinking-level override (off/minimal/low/medium/high/[xhigh|max]; omitted = Pi default). */
      thinkingLevel?: string
      timeoutMs?: number
    },
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 180_000
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error('Broker not running'))
    }
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingSwitchSession.delete(requestId)) {
          reject(new Error(`switch_session timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)
      this.pendingSwitchSession.set(requestId, {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject,
        timer,
      })
      try {
                this.child!.send({
          type: 'switch_session',
          requestId,
          sessionPath,
          sessionCwd,
          disabledSkillPaths: options?.disabledSkillPaths,
          disabledExtensionPaths: options?.disabledExtensionPaths,
          disabledTools: options?.disabledTools,
          includeCursorSkills: options?.includeCursorSkills,
          modelProvider: options?.modelProvider,
          modelId: options?.modelId,
          imageModelId: options?.imageModelId,
          imageModelProvider: options?.imageModelProvider,
          thinkingLevel: options?.thinkingLevel,
        })
      } catch (e) {
        clearTimeout(timer)
        this.pendingSwitchSession.delete(requestId)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  forkBeforeLastUser(timeoutMs = 180_000): Promise<{ sessionFileAbs: string }> {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error('Broker not running'))
    }
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingFork.delete(requestId)) {
          reject(new Error(`fork timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)
      this.pendingFork.set(requestId, {
        resolve: (v: { sessionFileAbs: string }) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject,
        timer,
      })
      try {
        this.child!.send({ type: 'fork_before_last_user', requestId })
      } catch (e) {
        clearTimeout(timer)
        this.pendingFork.delete(requestId)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

    sendPrompt(turnId: string, text: string, images?: BrokerImageContent[]): void {
    this.child?.send({
      type: 'prompt',
      turnId,
      text: withDateTimeStamp(text),
      ...(images && images.length > 0 ? { images } : {}),
    })
  }

  sendBridgeFollowUp(text: string): void {
    this.child?.send({ type: 'bridge_followup', text: withDateTimeStamp(text) })
  }

  sendSteer(text: string, images?: BrokerImageContent[]): void {
    this.child?.send({
      type: 'steer',
      text: withDateTimeStamp(text),
      ...(images && images.length > 0 ? { images } : {}),
    })
  }

  sendFollowUp(text: string, images?: BrokerImageContent[]): void {
    this.child?.send({
      type: 'follow_up',
      text: withDateTimeStamp(text),
      ...(images && images.length > 0 ? { images } : {}),
    })
  }

  abort(): void {
    this.child?.send({ type: 'abort' })
  }

  cancelSubagentRun(runId: string): void {
    const id = runId.trim()
    if (!id) return
    this.child?.send({ type: 'cancel_subagent', runId: id })
  }

  sendChildMessage(payload: Record<string, unknown>): void {
    if (!this.child || this.child.killed) return
    this.child.send(payload)
  }

  /** Ask the broker for its loaded extensions/skills snapshot. Rejects on timeout / no child / broker error. */
  requestCapabilities(timeoutMs = 4000): Promise<BrokerCapabilitiesSnapshot> {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error('Broker not running'))
    }
    const requestId = randomUUID()
    return new Promise<BrokerCapabilitiesSnapshot>((resolveFn, rejectFn) => {
      const timer = setTimeout(() => {
        if (this.pendingCapabilities.delete(requestId)) {
          rejectFn(new Error(`capabilities_list timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)
      this.pendingCapabilities.set(requestId, { resolve: resolveFn, reject: rejectFn, timer })
      try {
        this.child!.send({ type: 'capabilities_list', requestId })
      } catch (e) {
        clearTimeout(timer)
        this.pendingCapabilities.delete(requestId)
        rejectFn(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  private resolveCapabilities(msg: BrokerCapabilitiesResult): void {
    const pending = this.pendingCapabilities.get(msg.requestId)
    if (!pending) return
    this.pendingCapabilities.delete(msg.requestId)
    clearTimeout(pending.timer)
    if (msg.ok) {
      pending.resolve({
        extensions: msg.extensions,
        skills: msg.skills,
        loadErrors: msg.loadErrors,
        toolNameCollisions: msg.toolNameCollisions ?? {},
      })
    } else {
      pending.reject(new Error(msg.error))
    }
  }

  /** Ask the broker which thinking levels Pi supports for a concrete provider/model. */
  requestThinkingLevels(
    provider: string,
    modelId: string,
    timeoutMs = 6000,
  ): Promise<{ ok: true; levels?: string[]; resolvedModel: { provider: string; modelId: string } | null }> {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error('Broker not running'))
    }
    const requestId = randomUUID()
    return new Promise((resolveFn, rejectFn) => {
      const timer = setTimeout(() => {
        if (this.pendingThinkingLevels.delete(requestId)) {
          rejectFn(new Error(`thinking_levels timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)
      this.pendingThinkingLevels.set(requestId, { resolve: resolveFn, reject: rejectFn, timer })
      try {
        this.child!.send({ type: 'thinking_levels', requestId, provider, modelId })
      } catch (e) {
        clearTimeout(timer)
        this.pendingThinkingLevels.delete(requestId)
        rejectFn(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  private resolveThinkingLevels(
    msg:
      | { type: 'thinking_levels_result'; requestId: string; ok: true; levels?: string[]; resolvedModel?: { provider: string; modelId: string } | null }
      | { type: 'thinking_levels_result'; requestId: string; ok: false; error?: string },
  ): void {
    const pending = this.pendingThinkingLevels.get(msg.requestId)
    if (!pending) return
    this.pendingThinkingLevels.delete(msg.requestId)
    clearTimeout(pending.timer)
    if (msg.ok) {
      pending.resolve({ ok: true, levels: msg.levels, resolvedModel: msg.resolvedModel ?? null })
    } else {
      pending.reject(new Error(msg.error ?? 'thinking_levels failed'))
    }
  }

  private resolveSwitchSession(
    msg:
      | { type: 'switch_session_result'; requestId: string; ok: true }
      | { type: 'switch_session_result'; requestId: string; ok: false; error: string },
  ): void {
    const pending = this.pendingSwitchSession.get(msg.requestId)
    if (!pending) return
    this.pendingSwitchSession.delete(msg.requestId)
    clearTimeout(pending.timer)
    if (msg.ok) pending.resolve()
    else pending.reject(new Error(msg.error))
  }

  private resolveFork(
    msg:
      | { type: 'fork_result'; requestId: string; ok: true; sessionFileAbs: string }
      | { type: 'fork_result'; requestId: string; ok: false; error: string },
  ): void {
    const pending = this.pendingFork.get(msg.requestId)
    if (!pending) return
    this.pendingFork.delete(msg.requestId)
    clearTimeout(pending.timer)
    if (msg.ok) pending.resolve({ sessionFileAbs: msg.sessionFileAbs })
    else pending.reject(new Error(msg.error))
  }

  private failAllPending(reason: string): void {
    for (const [, p] of this.pendingCapabilities) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pendingCapabilities.clear()
    for (const [, p] of this.pendingSwitchSession) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pendingSwitchSession.clear()
    for (const [, p] of this.pendingFork) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pendingFork.clear()
  }

  private disposeChild(): void {
    if (this.child && !this.child.killed) {
      try {
        this.child.send({ type: 'dispose' })
      } catch {
        this.child.kill()
      }
    }
    this.child = undefined
  }

  restart(): void {
    this.spawn()
  }

  kill(): void {
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM')
    }
    this.child = undefined
  }
}
