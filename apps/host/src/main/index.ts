import {
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  copyFileSync,
  renameSync,
  rmdirSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  net,
  protocol,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron'
import { BUILD_INFO } from '../generated/build-info.js'

import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent'

import { appIconWindowOptions } from './app-icon.js'
import {
  deployGlobalAgents,
  readGlobalAgentsStatus,
  writeGlobalAgentsSource,
  type GlobalAgentsDeployResult,
  type GlobalAgentsStatus,
} from './global-agents.js'
import {
  normalizeCanvasPopoutSnapshot,
  peekCanvasPopout,
  stashCanvasPopout,
} from './canvas-popout.js'
import {
  broadcastLiveUpdate,
  createLiveSubscription,
  disposeLive,
  getLiveSubscription,
  subscribeLive,
  unsubscribeLive,
} from './canvas-live.js'
import {
  getBoardByLiveId,
  getBoardForWorkspace,
  removeBoardByLiveId,
  setActiveTaskBoard,
  fanTasksChanged,
  persistBoardBinding,
  loadPersistedBoardForWorkspace,
  clearPersistedBoardBinding,
} from './tasks-live.js'
import { readSkillMd, writeSkillMd } from './skill-md-io.js'

const CANVAS_MAX_BYTES = 262144

/** Resolve a markdown `filePath` to `content` and emit `canvas:show` to the renderer.
 *  Shared by the broker `show_canvas` tool path and the `canvas:show-file` IPC
 *  (chat file-path chip View button) so the docked canvas opens identically. */
function emitCanvasShow(args: {
  toolCallId: string
  kind: 'svg' | 'mermaid' | 'markdown'
  title?: string
  content?: string
  filePath?: string
  sourcePath?: string
  workspaceKey?: string
}): void {
  const { toolCallId, kind, title, content, filePath, sourcePath, workspaceKey } = args
  let resolvedContent = content
  let resolvedFilePath = filePath
  let resolvedSourcePath = sourcePath
  if (kind === 'markdown' && typeof filePath === 'string' && filePath.trim().length > 0) {
    const p = filePath.trim()
    resolvedSourcePath = p
    try {
      if (existsSync(p)) {
        const buf = readFileSync(p, 'utf8')
        resolvedContent =
          buf.length > CANVAS_MAX_BYTES
            ? `${buf.slice(0, CANVAS_MAX_BYTES)}\n\n<!-- truncated -->`
            : buf
      } else {
        resolvedContent = `**Could not open file:** \`${p}\` does not exist.`
      }
    } catch (e) {
      resolvedContent = `**Could not read file:** \`${p}\` — ${e instanceof Error ? e.message : String(e)}`
    }
    resolvedFilePath = undefined
  }
    mainWindow?.webContents.send('canvas:show', {
    toolCallId,
    kind,
    title,
    content: resolvedContent,
    filePath: resolvedFilePath,
    ...(resolvedSourcePath ? { sourcePath: resolvedSourcePath } : {}),
    ...(workspaceKey ? { workspaceKey } : {}),
  })
}
import {
  turnBrokerPool,
  type OverflowBrokerSlot,
} from './concurrent-broker-pool.js'
import { BrokerSupervisor, type BrokerImageContent, type BrokerOutMessage, type BrokerResolvedModel } from './broker-supervisor.js'
import type { SystemPromptStats } from '../shared/system-prompt-stats.js'
import { encodeImageAttachmentsForPi } from './image-attachments.js'
import {
  USER_ATTACHMENT_HINT,
  IMAGE_TOOL_HINT_TEXTONLY,
} from '../shared/chat-user-attachment-prompt.js'
import {
  appendImageDeliveryMetadata,
  type ImageDeliverySummary,
} from '../shared/chat-image-delivery.js'
import { readModelInputConfig, resolveModelInputTypes, writeModelInputTypes } from './model-input.js'
import { probeOllamaVision } from './ollama-vision.js'
import {
  patchSyloDisabledCapability,
  readSyloDisabledCapabilities,
  writeSyloDisabledCapabilities,
  type SyloDisabledCapabilities,
} from './disabled-capabilities-store.js'
import * as db from './database.js'
import { publishNtfyNotification, isNtfyConfigured } from './ntfy/service.js'
import {
  linkWorkspaceGitRepo,
  pullWorkspaceGitRepo,
  pushWorkspaceGitRepo,
  readWorkspaceGitStatus,
  cloneWorkspaceRepo,
  publishWorkspaceRepo,
} from './workspace-git-sync.js'
import { applyProposal, listProposals, rejectProposal } from './proposals.js'
import {
  getSweepConfig,
  initSweepService,
  runSweep,
  setSweepConfig,
  shutdownSweepService,
} from './sweep.js'
import {
  bindGithubPrefStore,
  clearGithubAuth,
  clearPendingDeviceFlow,
  createGithubRepo,
  defaultGithubCloneDir,
  ensureDefaultCloneDir,
  githubStatus,
  listGithubOrgs,
  listGithubRepos,
  pollGithubDeviceFlow,
  readGithubToken,
  saveGithubAuth,
  setDefaultGithubCloneDir,
  startGithubDeviceFlow,
} from './github-auth.js'
import { deriveChatTitleFromUserText, isAutoTitleEligible } from './chat-title.js'
import { formatCompactionNoticeContent, type CompactionReason } from '../shared/compaction-notice.js'
import {
  CONVERSATION_RETENTION_MS,
  deleteWorkspaceFully,
  fullyRemoveConversation,
  purgeStaleConversations,
} from './conversation-lifecycle.js'
import {
  ensurePasteImagesDir,
  pruneOrphanChatAttachments,
} from './chat-owned-attachments.js'
import { pruneStaleWebAccessRuns } from './web-access-db.js'
import { pruneStalePdfCacheDir } from './pdf-cache-prune.js'
import { absoluteSessionPathForConversation, relativeSessionPathFromAbsolute } from './sylo-session-paths.js'
import { resolveLocalPathOnDisk } from './resolve-local-path.js'
import { fetchPiDevCatalog, type PiDevCatalogQuery } from './pi-dev-catalog.js'
import { discoverSkillRoutes, filterSkillRoutesForSidebar } from './skill-routes.js'
import { readSkillDataJson, writeSkillDataJson, SKILL_DATA_QUOTA_BYTES } from './skill-data-store.js'
import { lintSkillSurfacesBatch } from './skill-surface-lint.js'
import { removeStandaloneSkillFolder } from './standalone-skill-removal.js'
import {
  handleSubagentHostEvent,
  initSubagentTaskHostSession,
  onBrokerExitOrphanTasks,
  shutdownSubagentTaskHostSession,
  subagentTaskStore,
} from './subagent-tasks-service.js'
import type { SyloSubagentHostEvent } from '../shared/subagent-tasks-types.js'
import type { SyloWebAccessEvent } from '../shared/web-access-events.js'
import {
  tasksDbListCreate,
  tasksDbListDelete,
  tasksDbListGet,
  tasksDbSnapshotGet,
  tasksDbTaskAdd,
  tasksDbTaskDelete,
  tasksDbTaskUpdate,
} from './tasks-db.js'
import {
  logicforgeIoReviewApproveBuild,
  logicforgeIoReviewGet,
  logicforgeIoReviewReseed,
  logicforgeIoReviewSave,
} from './logicforge-io-review.js'
import {
  logicforgeDownloadAllowlistGet,
  logicforgeDownloadAllowlistSave,
  logicforgeDownloadPlcStatus,
} from './logicforge-download-settings.js'
import { logicforgeTemplates } from './logicforge-templates.js'
import {
  logicforgeParseRulesGet,
  logicforgeParseRulesReset,
  logicforgeParseRulesSave,
} from './logicforge-parse-rules.js'
import {
  syloWorkflowDelete,
  syloWorkflowRead,
  syloWorkflowSave,
  syloWorkflowsList,
} from './sylo-workflows-host.js'
import {
  copyPgvectorFilesWindowsElevated,
  fieldbrainDatabaseConfigPath,
  getGuidedSetupSteps,
  readFieldBrainConfig,
  runFieldBrainBootstrapScript,
  runFieldBrainScript,
  writeFieldBrainConfig,
  type FieldBrainConfig,
} from './fieldbrain-config.js'
import {
  onenoteConfigDir,
  runOneNoteScript,
  runOneNoteSettingsSave,
} from './onenote-config.js'
import { handleWebAccessHostEvent, webAccessStore } from './web-access-service.js'
import { handleThinkTankHostEvent, handleThinkTankRpc, thinkTankStore, cancelThinkTankSession, queueThinkTankInjection } from './think-tank-service.js'
import {
  thinkTankConfigEnvPath,
  readThinkTankConfig,
  writeThinkTankConfig,
} from './think-tank-config.js'
import type { SyloThinkTankEvent } from '../shared/think-tank-events.js'
import {
  persistToolResultImages,
} from './web-access-images.js'
import {
  persistToolResultAudio,
  deleteTtsRouteClip,
  pruneStaleTtsRouteClips,
  ttsRouteClipsDir,
} from './tts-audio.js'
import {
  ensureTtsConfigSchema,
  readTtsConfig,
  ttsConfigEnvPath,
  writeTtsConfig,
} from './tts-config.js'
import { generateTtsWav, listTtsVoices, synthOptionsFromRecords } from './tts-engine.js'
import { readUserPackages } from './user-packages.js'
import { loadEvalDashboard, runEvalBaseline } from './eval-dashboard.js'
import {
  ensureWebAccessConfigSchema,
  readWebAccessBraveQuota,
  readWebAccessConfig,
  webAccessConfigEnvPath,
  writeWebAccessConfig,
} from './web-access-config.js'
import { findSyloOptionalPackage } from '../shared/sylo-optional-packages.js'
import {
  extensionConfigMeta,
  readExtensionConfig,
  readSkillParams,
  resolveSkillParamsMeta,
  saveExtensionConfig,
  saveSkillParams,
} from './capability-config.js'
import {
  mergeDisabledToolsLists,
  normalizeDisabledToolsJson,
  normalizePathListForDisabledJson,
  normalizeSkillCapabilityPath,
  normalizeSyloCapabilityPath,
  skillDirFromReportedPath,
} from '../shared/sylo-capability-paths.js'
import { normalizePiBuiltinToolsPref, type PiBuiltinToolsPref } from '../shared/pi-builtin-tools.js'
import { isPiUserSlashCommand } from '../shared/pi-slash-command.js'
import {
  classifySyloBuiltinExtension,
} from '../shared/sylo-builtin-extensions.js'
import {
  classifySyloOptionalPackageId,
  normalizeSyloOptionalPackagesPref,
  syloExtensionHintForPath,
} from '../shared/sylo-optional-packages.js'
import { enabledOptionalExtensionPaths, getPythonReadiness, installOptionalPackagePythonDeps } from './sylo-optional-packages-host.js'
import { SYLO_DEFAULT_MODEL_ID, SYLO_DEFAULT_MODEL_PROVIDER } from '../shared/sylo-model-defaults.js'
import { isSkillPathInOperatorScope } from '../shared/sylo-skill-scope.js'
import { SYLO_INCLUDE_CURSOR_SKILLS_PREF } from '../shared/sylo-capability-prefs.js'
import { emitCompanionEvent } from './companion/events.js'
import {
  emitCompanionBrokerError,
  emitCompanionBrokerStatus,
} from './companion/server.js'
import { setCompanionHostApi } from './companion/host-api.js'
import { setPersonalAppRoot } from './companion/manager.js'
import {
  applyCompanionConfig,
  getCompanionStatus,
  openCompanionCertsFolder,
  restartCompanionServer,
  saveCompanionCredentials,
  stopCompanionServer,
} from './companion/manager.js'
import {
  createScheduledPrompt,
  deleteScheduledPrompt,
  getScheduledPrompt,
  listScheduledPrompts,
  normalizeRecurrenceValue,
  updateScheduledPrompt,
} from './scheduled-prompts-db.js'
import type { ScheduledPromptInput, ScheduledPromptPatch } from '../shared/scheduled-prompts-types.js'
import type { ScheduledPromptRow } from '../shared/scheduled-prompts-types.js'
import { handleScheduleRpc, type ScheduleRpcRequest } from './scheduled-prompts-rpc.js'
import {
  fireScheduledPromptNow,
  initScheduledPromptsService,
  notifyBrokerReadyForSchedules,
  shutdownScheduledPromptsService,
} from './scheduled-prompts-service.js'
import { closeAllWorkspaceScheduleDbs } from './workspace-db.js'

// Dev + Windows: some GPU/driver stacks composite a blank view while loading http://127.0.0.1 (Vite).
// ELECTRON_RENDERER_URL is set by electron-vite on the child process before spawn.
if (process.platform === 'win32' && process.env.ELECTRON_RENDERER_URL) {
  app.disableHardwareAcceleration()
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_NODE_MODULES = join(__dirname, '../../../..', 'node_modules')
const SYLO_REPO_ROOT = join(__dirname, '../../../..')
const SYLO_SKILL_SURFACE_EXTENSION = join(SYLO_REPO_ROOT, 'packages/skill-surface-extension/src/index.ts')
const SYLO_SUBAGENTS_EXTENSION = join(SYLO_REPO_ROOT, 'packages/sylo-subagents/extensions/index.ts')
const SYLO_SCHEDULER_EXTENSION = join(SYLO_REPO_ROOT, 'packages/sylo-scheduler/extensions/index.ts')
const SYLO_BUILTIN_TOOLS_GUARD_EXTENSION = join(
  SYLO_REPO_ROOT,
  'apps/host/src/broker/sylo-builtin-tools-guard.ts',
)
const SYLO_IMAGE_FALLBACK_EXTENSION = join(
  SYLO_REPO_ROOT,
  'apps/host/src/broker/sylo-image-fallback.ts',
)

function resolvePreloadPath(): string {
  const cjs = join(__dirname, '../preload/index.cjs')
  const js = join(__dirname, '../preload/index.js')
  const mjs = join(__dirname, '../preload/index.mjs')
  if (existsSync(cjs)) return cjs
  if (existsSync(js)) return js
  if (existsSync(mjs)) return mjs
  return cjs
}

function resolveSplashHtmlPath(): string {
  return join(__dirname, '../../resources/splash.html')
}

function expandPiPath(p: string): string {
  const t = typeof p === 'string' ? p.trim() : ''
  if (!t) return p
  if (t === '~') return homedir()
  if (t.startsWith('~/') || t.startsWith('~\\')) {
    return join(homedir(), t.slice(2))
  }
  return t
}

async function openDirectoryInShell(
  rawDir: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const dir = resolve(expandPiPath(rawDir.trim()))
  if (!dir) return { ok: false, error: 'empty_path' }
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!existsSync(dir)) {
    return { ok: false, error: `Folder not found after create: ${dir}` }
  }

  let openErr = await shell.openPath(dir)
  if (openErr && process.platform === 'win32') {
    openErr = await new Promise<string>((resolveOpenErr) => {
      execFile('explorer.exe', [dir], { windowsHide: true }, (err) => {
        resolveOpenErr(err ? (err instanceof Error ? err.message : String(err)) : '')
      })
    })
  }
  return openErr ? { ok: false, error: openErr } : { ok: true, path: dir }
}

type PiProjectDirEnsureResult =
  | { ok: true }
  | { ok: false; error: 'pi_project_dir_not_found'; path: string }
  | { ok: false; error: 'mkdir_failed'; path: string; detail: string }

function ensurePiProjectDirOnDisk(rawPath: string, createIfMissing: boolean): PiProjectDirEnsureResult {
  const cwd = rawPath.trim()
  if (!cwd) return { ok: true }
  const expanded = expandPiPath(cwd)
  if (existsSync(expanded)) return { ok: true }
  if (!createIfMissing) {
    return { ok: false, error: 'pi_project_dir_not_found', path: cwd }
  }
  try {
    mkdirSync(expanded, { recursive: true })
    return { ok: true }
  } catch (e) {
        return {
      ok: false,
      error: 'mkdir_failed',
      path: cwd,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

const pathsEqualIgnoreCase = (a: string, b: string): boolean =>
  resolve(a).replace(/\\/g, '/').toLowerCase() === resolve(b).replace(/\\/g, '/').toLowerCase()

/**
 * Rename the universal workspace's folder on disk to `<parent>/<safe(newName)>`.
 * Git history, seed files, and workspace state travel with the folder; the
 * workspace row is repointed by the caller. A leftover EMPTY target folder is
 * removed first; a populated target is refused (never clobber). When the
 * current folder is missing (deleted externally), the target is created fresh.
 */
function renameUniversalWorkspaceFolder(
  currentDir: string,
  newName: string,
): { ok: true; dir: string } | { ok: false; error: 'rename_failed'; detail: string } {
  const segment = safeChatFolderDirSegment(newName)
  if (!segment) return { ok: false, error: 'rename_failed', detail: 'invalid workspace name' }
  const target = join(dirname(currentDir), segment)
  if (pathsEqualIgnoreCase(currentDir, target)) return { ok: true, dir: currentDir }
  try {
    if (existsSync(target)) {
      if (readdirSync(target).length > 0) {
        return {
          ok: false,
          error: 'rename_failed',
          detail: `target folder already exists and is not empty: ${target}`,
        }
      }
      rmdirSync(target)
    }
    if (existsSync(currentDir)) {
      renameSync(currentDir, target)
    } else {
      mkdirSync(target, { recursive: true })
    }
    return { ok: true, dir: target }
  } catch (e) {
    return { ok: false, error: 'rename_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Remove the canonical `sylo-user` folder when it is an empty leftover (e.g. it
 * was auto-created by fallback resolution while the real folder was missing and
 * the operator then provisioned/restored the workspace under a different name).
 * Never touches a folder with content, and never removes `exceptDir` itself.
 */
function pruneEmptyStrayCanonical(exceptDir: string): void {
  try {
    const canon = db.canonicalDefaultWorkspacePiProjectPath()
    if (pathsEqualIgnoreCase(exceptDir, canon)) return
    if (!existsSync(canon)) return
    if (readdirSync(canon).length === 0) rmdirSync(canon)
  } catch {
    /* best-effort cleanup */
  }
}

function listSkillDirs(skillsDir: string): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = []
  if (!existsSync(skillsDir)) return out
  for (const name of readdirSync(skillsDir)) {
    const p = join(skillsDir, name)
    try {
      if (statSync(p).isDirectory()) out.push({ name, path: p })
    } catch {
      /* */
    }
  }
  return out
}

function listExtensionFiles(extDir: string): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = []
  if (!existsSync(extDir)) return out
  for (const name of readdirSync(extDir)) {
    if (!name.endsWith('.ts') && !name.endsWith('.js')) continue
    const full = join(extDir, name)
    try {
      if (statSync(full).isFile()) {
        out.push({ name: basename(name, extname(name)), path: full })
      }
    } catch {
      /* */
    }
  }
  return out
}

/** Dedupe by resolved path; preserves first-seen order. Empty paths fall back to skill name. */
function mergeByPath<T extends { path: string; name?: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const it of items) {
    const trimmed = it.path.trim()
    let key: string
    try {
      key = trimmed ? resolve(trimmed) : `name:${it.name ?? merged.length}`
    } catch {
      key = trimmed || `name:${it.name ?? merged.length}`
    }
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(it)
  }
  return merged
}

function skillPathIsSkillMd(path: string): boolean {
  return path.replace(/\\/g, '/').endsWith('SKILL.md')
}

/** Pi may report both `skill-dir` and `skill-dir/SKILL.md` — merge on folder identity. */
function mergeSkills(items: SkillEntry[]): SkillEntry[] {
  const byDir = new Map<string, SkillEntry>()
  for (const it of items) {
    const key = normalizeSkillCapabilityPath(it.path)
    if (!key) continue
    const canonicalPath = skillDirFromReportedPath(it.path)
    const next: SkillEntry = { ...it, path: canonicalPath }
    const existing = byDir.get(key)
    if (!existing) {
      byDir.set(key, next)
      continue
    }
    if (skillPathIsSkillMd(existing.path) && !skillPathIsSkillMd(next.path)) {
      byDir.set(key, next)
    }
  }
  return Array.from(byDir.values())
}

function skillCapabilityExcluded(path: string, disabled: Set<string>): boolean {
  const key = normalizeSkillCapabilityPath(path)
  if (!key) return false
  for (const entry of disabled) {
    if (normalizeSkillCapabilityPath(entry) === key) return true
  }
  return false
}

function capabilityPathExcluded(path: string, disabled: Set<string>): boolean {
  const n = normalizeSyloCapabilityPath(path)
  return n ? disabled.has(n) : false
}

function withExcludedSkillRows<T extends { path: string }>(
  rows: T[],
  disabledSkills: Set<string>,
): (T & { excludedFromAgent: boolean })[] {
  return rows.map((row) => ({
    ...row,
    excludedFromAgent: skillCapabilityExcluded(row.path, disabledSkills),
  }))
}

function withExcludedExtensionRows<T extends { path: string }>(
  rows: T[],
  disabledExtensions: Set<string>,
): (T & { excludedFromAgent: boolean })[] {
  return rows.map((row) => ({
    ...row,
    excludedFromAgent: capabilityPathExcluded(row.path, disabledExtensions),
  }))
}

/** Stable origin labels surfaced to the renderer so badges stay consistent. */
type OriginTag =
  | 'pi-agent'
  | 'pi-cwd'
  | 'cursor-skills'
  | 'sylo-repo'
  | 'npm-package'
  | 'git-package'
  | 'sylo-builtin'
  | 'sylo-optional'

type SkillEntry = {
  name: string
  path: string
  origin: OriginTag
  excludedFromAgent: boolean
}
type ExtensionEntry = { name: string; path: string; origin: OriginTag; excludedFromAgent: boolean }
type ExtensionUI = ExtensionEntry & {
  tools: {
    name: string
    description?: string
    nameConflictPeers?: string[]
    excludedFromAgent?: boolean
  }[]
  commandNames: string[]
  builtinHint?: string
  /** Broker absolute path — matches `toolNameCollisions` contributor keys. */
  resolvedPath?: string
}

type PackageInventoryMemoryEntry = { source: string; scope: 'user' | 'project' }

function packageInventoryMemoryPath(): string {
  return join(app.getPath('userData'), 'package-inventory-memory.json')
}

function readPackageInventoryMemory(): PackageInventoryMemoryEntry[] {
  const p = packageInventoryMemoryPath()
  if (!existsSync(p)) return []
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as { entries?: unknown }
    if (!Array.isArray(j.entries)) return []
    return j.entries.filter(
      (e): e is PackageInventoryMemoryEntry =>
        Boolean(e) &&
        typeof e === 'object' &&
        typeof (e as PackageInventoryMemoryEntry).source === 'string' &&
        ((e as PackageInventoryMemoryEntry).scope === 'user' ||
          (e as PackageInventoryMemoryEntry).scope === 'project'),
    )
  } catch {
    return []
  }
}

function writePackageInventoryMemory(entries: PackageInventoryMemoryEntry[]): void {
  try {
    const p = packageInventoryMemoryPath()
    const map = new Map<string, PackageInventoryMemoryEntry>()
    for (const e of entries) {
      map.set(`${e.scope}:${e.source}`, e)
    }
    const deduped = Array.from(map.values()).sort(
      (a, b) => a.source.localeCompare(b.source) || a.scope.localeCompare(b.scope),
    )
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify({ entries: deduped }, null, 2), 'utf8')
  } catch (e) {
    console.warn('[sylo] package inventory memory:', e)
  }
}

/** Pi-resolved package rows (from settings + on-disk install locations); does not require the broker. */
function listPiPackageInventory(piCwd: string, agentDir: string) {
  try {
    const settingsManager = SettingsManager.create(piCwd, agentDir)
    const pm = new DefaultPackageManager({ cwd: piCwd, agentDir, settingsManager })
    const finalList = pm
      .listConfiguredPackages()
      .filter((r) => r.installedPath?.trim())
      .sort((a, b) => a.source.localeCompare(b.source) || a.scope.localeCompare(b.scope))

    writePackageInventoryMemory(
      finalList.map((r) => ({ source: r.source, scope: r.scope })),
    )

    return finalList.map((c) => ({
      source: c.source,
      scope: c.scope,
      filtered: c.filtered,
      installedPath: c.installedPath,
    }))
  } catch (e) {
    console.warn('[sylo] package inventory:', e)
    return []
  }
}

function purgePackageInventoryMemoryForSpec(spec: string): void {
  const needle = spec.trim().toLowerCase()
  if (!needle) return
  writePackageInventoryMemory(
    readPackageInventoryMemory().filter((e) => e.source.trim().toLowerCase() !== needle),
  )
}


function mergeExtensionsByPath(items: ExtensionUI[]): ExtensionUI[] {
  const seen = new Map<string, ExtensionUI>()
  for (const it of items) {
    const raw = (it.resolvedPath ?? it.path ?? '').trim()
    let key: string
    if (raw) {
      try {
        key = normalizeSyloCapabilityPath(resolve(raw))
      } catch {
        key = normalizeSyloCapabilityPath(raw)
      }
    } else if (it.path?.trim()) {
      try {
        key = normalizeSyloCapabilityPath(resolve(it.path.trim()))
      } catch {
        key = normalizeSyloCapabilityPath(it.path.trim())
      }
    } else {
      continue
    }
    if (!key) continue

    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, it)
      continue
    }
    const nTools = it.tools?.length ?? 0
    const eTools = existing.tools?.length ?? 0
    const nCmds = it.commandNames?.length ?? 0
    const eCmds = existing.commandNames?.length ?? 0
    /** Prefer broker snapshot (tools) over filesystem stubs with the same install. */
    if (nTools > eTools || (nTools === eTools && nCmds > eCmds)) {
      seen.set(key, it)
    }
  }
  return Array.from(seen.values())
}

/** Annotate tools with peers that register the same Pi tool id under different extension paths. */
function annotateExtensionToolsWithCollisions(
  extensions: ExtensionUI[],
  toolNameCollisions: Record<string, string[]>,
): ExtensionUI[] {
  if (!toolNameCollisions || Object.keys(toolNameCollisions).length === 0) return extensions
  return extensions.map((ext) => {
    const raw = (ext.resolvedPath ?? ext.path ?? '').trim()
    const extKey = raw ? normalizeSyloCapabilityPath(raw) : ''
    return {
      ...ext,
      tools: ext.tools.map((t) => {
        const contribs = toolNameCollisions[t.name]
        if (!contribs || contribs.length < 2 || !extKey) return t
        const peers = contribs.filter((p) => p !== extKey)
        if (peers.length === 0) return t
        return { ...t, nameConflictPeers: peers }
      }),
    }
  })
}

function tagSkills(items: { name: string; path: string }[], origin: OriginTag): SkillEntry[] {
  return items.map((s) => ({ ...s, origin, excludedFromAgent: false }))
}

function readIncludeCursorSkillsPref(): boolean {
  return db.getPref<boolean>(SYLO_INCLUDE_CURSOR_SKILLS_PREF, false)
}

function filterSkillsToOperatorScope<T extends { path: string }>(
  skills: T[],
  agentDir: string,
  piCwd: string,
  includeCursorSkills: boolean,
): T[] {
  return skills.filter((s) =>
    isSkillPathInOperatorScope(s.path, agentDir, piCwd, { includeCursorSkills }),
  )
}

function classifySkillPath(
  path: string,
  agentDir: string,
  piCwd: string,
  includeCursorSkills: boolean,
): OriginTag {
  const norm = path.replace(/\\/g, '/').toLowerCase()
  if (norm.includes('/git/')) return 'git-package'
  if (norm.includes('/node_modules/') || norm.includes('/npm/')) return 'npm-package'
  const agentSkills = join(agentDir, 'skills').replace(/\\/g, '/').toLowerCase()
  const cwdSkills = join(piCwd, '.pi', 'skills').replace(/\\/g, '/').toLowerCase()
  const cursorSkills = join(piCwd, '.cursor', 'skills').replace(/\\/g, '/').toLowerCase()
  if (agentSkills && (norm === agentSkills || norm.startsWith(`${agentSkills}/`))) return 'pi-agent'
  if (cwdSkills && (norm === cwdSkills || norm.startsWith(`${cwdSkills}/`))) return 'pi-cwd'
  if (
    includeCursorSkills &&
    cursorSkills &&
    (norm === cursorSkills || norm.startsWith(`${cursorSkills}/`))
  ) {
    return 'cursor-skills'
  }
  return 'npm-package'
}

function tagExtensions(
  items: { name: string; path: string }[],
  origin: OriginTag,
): ExtensionEntry[] {
  return items.map((e) => ({ ...e, origin, excludedFromAgent: false }))
}

function discoverFilesystemCapabilities(
  agentDir: string,
  piCwd: string,
  includeCursorSkills: boolean,
): {
  skills: SkillEntry[]
  extensions: ExtensionEntry[]
} {
  const skillBuckets: SkillEntry[] = [
    ...tagSkills(listSkillDirs(join(agentDir, 'skills')), 'pi-agent'),
    ...tagSkills(listSkillDirs(join(piCwd, '.pi', 'skills')), 'pi-cwd'),
    ...(includeCursorSkills ?
      tagSkills(listSkillDirs(join(piCwd, '.cursor', 'skills')), 'cursor-skills')
    : []),
  ]
  const skills = filterSkillsToOperatorScope(
    mergeSkills(skillBuckets).sort((a, b) => a.name.localeCompare(b.name)),
    agentDir,
    piCwd,
    includeCursorSkills,
  )

  const extBuckets: ExtensionEntry[] = [
    ...tagExtensions(listExtensionFiles(join(agentDir, 'extensions')), 'pi-agent'),
    ...tagExtensions(listExtensionFiles(join(piCwd, '.pi', 'extensions')), 'pi-cwd'),
  ]
  if (existsSync(SYLO_SKILL_SURFACE_EXTENSION)) {
    extBuckets.push(
      ...tagExtensions(
        [{ name: 'sylo-skill-surface', path: SYLO_SKILL_SURFACE_EXTENSION }],
        'sylo-builtin',
      ),
    )
  }
  if (existsSync(SYLO_SUBAGENTS_EXTENSION)) {
    extBuckets.push(
      ...tagExtensions(
        [{ name: 'sylo-subagents', path: SYLO_SUBAGENTS_EXTENSION }],
        'sylo-builtin',
      ),
    )
  }
  if (existsSync(SYLO_SCHEDULER_EXTENSION)) {
    extBuckets.push(
      ...tagExtensions(
        [{ name: 'sylo-scheduler', path: SYLO_SCHEDULER_EXTENSION }],
        'sylo-builtin',
      ),
    )
  }
  if (existsSync(SYLO_BUILTIN_TOOLS_GUARD_EXTENSION)) {
    extBuckets.push(
      ...tagExtensions(
        [{ name: 'sylo-builtin-tools-guard', path: SYLO_BUILTIN_TOOLS_GUARD_EXTENSION }],
        'sylo-builtin',
      ),
    )
  }
  if (existsSync(SYLO_IMAGE_FALLBACK_EXTENSION)) {
    extBuckets.push(
      ...tagExtensions(
        [{ name: 'sylo-image-fallback', path: SYLO_IMAGE_FALLBACK_EXTENSION }],
        'sylo-builtin',
      ),
    )
  }
  const extensions = mergeByPath(extBuckets).sort((a, b) => a.name.localeCompare(b.name))
  return { skills, extensions }
}

/** Identify packaged sources from the path Pi reports for a loaded extension. */
function classifyExtensionPath(path: string, agentDir: string, piCwd: string): OriginTag {
  if (!path) return 'pi-agent'
  if (classifySyloBuiltinExtension(path)) return 'sylo-builtin'
  if (classifySyloOptionalPackageId(path)) return 'sylo-optional'
  const norm = path.replace(/\\/g, '/').toLowerCase()
  const a = agentDir.replace(/\\/g, '/').toLowerCase()
  const c = piCwd.replace(/\\/g, '/').toLowerCase()
  if (norm.includes('/node_modules/') || norm.includes('/npm/')) return 'npm-package'
  if (norm.includes('/git/')) return 'git-package'
  if (a && norm.startsWith(a)) return 'pi-agent'
  if (c && norm.startsWith(c)) return 'pi-cwd'
  return 'pi-agent'
}

const SYLO_FILE_SCHEME = 'sylo-file'

const LOCAL_MEDIA_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.wav',
  '.mp3',
  '.ogg',
  '.m4a',
  '.aac',
  '.flac',
])

function isLocalMediaFilePath(filePath: string): boolean {
  return LOCAL_MEDIA_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function registerLocalImageProtocol(): void {
  protocol.handle(SYLO_FILE_SCHEME, (request) => {
    let filePath = ''
    try {
      const url = new URL(request.url)
      const raw = url.searchParams.get('path')
      if (typeof raw !== 'string' || !raw.trim()) {
        return new Response(null, { status: 400 })
      }
      filePath = resolve(raw.trim())
    } catch {
      return new Response(null, { status: 400 })
    }
    try {
      if (!existsSync(filePath) || !statSync(filePath).isFile() || !isLocalMediaFilePath(filePath)) {
        return new Response(null, { status: 404 })
      }
    } catch {
      return new Response(null, { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).href)
  })
}

/** http(s)/mailto links open in the OS default browser, not inside Electron. */
function isExternalLink(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^mailto:/i.test(url)
}

/**
 * Route in-chat / in-app links to the OS default browser and block any attempt
 * to navigate a Sylo window away from the renderer. Applied to every window
 * (main + pop-outs) via a single `web-contents-created` hook.
 */
function registerExternalLinkRouting(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalLink(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const current = contents.getURL()
      // Allow the renderer's own (re)loads — file://, dev server, hash routes.
      if (url.startsWith('file://') || (current && url.split('#')[0] === current.split('#')[0])) {
        return
      }
      const devRendererUrl = process.env.ELECTRON_RENDERER_URL
      if (devRendererUrl && url.startsWith(devRendererUrl)) return
      event.preventDefault()
      if (isExternalLink(url)) void shell.openExternal(url)
    })
  })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SYLO_FILE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

let mainWindow: BrowserWindow | undefined
let splashWindow: BrowserWindow | undefined
let broker: BrokerSupervisor | undefined

/** Public repo URL shown in Help ▸ GitHub Repository and the About dialog. */
const SYLO_REPO_URL = 'https://github.com/Yeti-Trix/pi-sylo'

/** About dialog: app version (package.json via app.getVersion) + generated
 *  build metadata (commit/tag/date from scripts/gen-build-info.mjs). */
async function showAboutDialog(): Promise<void> {
  const lines = [
    `Version: ${app.getVersion()}`,
  ]
  if (BUILD_INFO.tag) lines.push(`Release: ${BUILD_INFO.tag}`)
  if (BUILD_INFO.commit) {
    lines.push(`Commit: ${BUILD_INFO.commit}${BUILD_INFO.committedAt ? ` (${BUILD_INFO.committedAt})` : ''}`)
  }
  lines.push(`Built: ${BUILD_INFO.builtAt}`)
  lines.push('', 'Local-first agent host.', SYLO_REPO_URL)

  const hasParent = !!mainWindow && !mainWindow.isDestroyed()
  const opts: Electron.MessageBoxOptions = {
    type: 'info',
    title: 'About Sylo',
    message: `Sylo ${app.getVersion()}`,
    detail: lines.join('\n'),
    buttons: ['OK', 'Open GitHub Repository'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const { response } = hasParent
    ? await dialog.showMessageBox(mainWindow as BrowserWindow, opts)
    : await dialog.showMessageBox(opts)
  if (response === 1) {
    void shell.openExternal(SYLO_REPO_URL)
  }
}

/** Mirrors the renderer's `canvasOpen` state so the native Window-menu item can
 *  show "Show Canvas" / "Hide Canvas" and toggle the docked canvas. Seeded from
 *  the saved pref at startup, then kept in sync via the `canvas:set-open-state`
 *  IPC whenever the renderer's canvas open state changes. */
let canvasOpenState = false

/** Build the application menu. Preserves Electron's default File/Edit/View
 *  menus (via role menus, so undo/redo, copy/paste, reload, devtools, zoom and
 *  fullscreen all keep working) and replaces the Window menu with a hand-built
 *  submenu that adds a "Show/Hide Canvas" toggle for the docked canvas panel. */
function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const canvasItem: MenuItemConstructorOptions = {
    label: canvasOpenState ? 'Hide Canvas' : 'Show Canvas',
    click: () => {
      const mw = mainWindow
      if (mw && !mw.isDestroyed()) mw.webContents.send('canvas:toggle')
    },
  }
  const windowSubmenu: MenuItemConstructorOptions[] = [
    { role: 'minimize' },
    { role: 'zoom' },
    { type: 'separator' },
    { role: 'close' },
  ]
  if (isMac) {
    windowSubmenu.push({ type: 'separator' }, { role: 'front' })
  }
  windowSubmenu.push({ type: 'separator' }, canvasItem)

  const helpSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'About Sylo',
      click: () => {
        void showAboutDialog()
      },
    },
    { type: 'separator' },
    {
      label: 'GitHub Repository',
      click: () => {
        void shell.openExternal(SYLO_REPO_URL)
      },
    },
  ]

  const template: MenuItemConstructorOptions[] = []
  if (isMac) template.push({ role: 'appMenu' })
  template.push(
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { label: 'Window', submenu: windowSubmenu },
    { label: 'Help', submenu: helpSubmenu },
  )
  return Menu.buildFromTemplate(template)
}
/** True only while the current broker child has completed Pi session init (createAgentSession succeeded). */
let brokerAgentReady = false
/** Active Pi model after broker init — from `session.model`, not Sylo prefs. */
let brokerResolvedModel: BrokerResolvedModel | null = null
/** System prompt section breakdown from broker for the context-window dashboard. */
let brokerSystemPromptStats: SystemPromptStats | null = null
/** Actual context-window message tokens from broker (reflects Pi compaction). */
let brokerActualMessageTokens: number | null = null
/** Surfaces broker failures when IPC fired before the renderer subscribed to broker:status */
let brokerLastSurfaceError: string | undefined
/** Last stderr/stdout from broker child — banner appendix */
let brokerLastCapturedLogs = ''
/** Ignore stale broker exits/messages after a newer spawn superseded this generation */
let brokerSpawnGeneration = 0

function formatExtensionCommandLine(
  message: string,
  notifyType?: 'info' | 'warning' | 'error',
): string {
  if (notifyType === 'error') return `**Error:** ${message}`
  if (notifyType === 'warning') return `**Warning:** ${message}`
  return message
}

/** pi-observational-memory status spam via ui.notify — keep memory working, hide from chat. */
function extensionNotifyVisibleInChat(
  message: string,
  notifyType: 'info' | 'warning' | 'error' | undefined,
  slashCommand: boolean,
): boolean {
  if (slashCommand) return true
  if (notifyType === 'warning' || notifyType === 'error') {
    // Sylo session switching mid-turn can stale extension ctx; don't surface in chat.
    if (message.includes('extension ctx is stale after session replacement')) return false
  }
  if (notifyType === 'warning' || notifyType === 'error') return true
  if (message.startsWith('Observational memory:')) return false
  return true
}

function appendExtensionCommandOutput(
  pending: PendingTurn,
  line: string,
): void {
  if (pending.slashCommand) {
    pending.commandLines.push(line)
    pending.chunks = pending.commandLines.join('\n\n')
  } else {
    pending.chunks =
      pending.chunks.trim().length > 0 ? `${pending.chunks}\n\n${line}` : line
  }
  // Cancel any pending throttled content write — this explicit write is
  // immediate (emitChatRefresh('messages') triggers a renderer DB read).
  if (pending.contentFlushTimer) {
    clearTimeout(pending.contentFlushTimer)
    pending.contentFlushTimer = null
  }
  pending.contentDirty = false
  db.updateMessageContent(pending.assistantId, pending.chunks, 'streaming')
  emitChatRefresh(pending.convId, 'messages')
}

/**
 * Max ms to wait before flushing buffered streaming content to SQLite.
 *
 * Without this, every text_delta (LLMs emit 100–200+/s) triggers a synchronous
 * full-text UPDATE — the main process event loop blocks, IPC messages queue up,
 * and the renderer falls behind. On long agent runs the accumulated text can be
 * hundreds of KB, making each write proportionally slower (a positive feedback
 * loop). Throttling to 500 ms reduces write throughput by ~99 % while losing at
 * most ~500 ms of text on a crash (same as today if the process crashes between
 * deltas). The renderer already has the live delta for display; the DB write is
 * purely for persistence/recovery.
 */
const CONTENT_FLUSH_MS = 500

/**
 * Max ms to wait before flushing buffered tool telemetry to SQLite.
 *
 * appendToolCallsJson is O(n²): each call SELECTs, JSON.parses, JSON.stringifies,
 * and UPDATEs the entire tool_calls_json blob. On a 20+ tool-call run the blob
 * can be multiple MB; each append re-serializes the whole thing. Batching to
 * 1 s collapses many appends into one SELECT + parse + stringify + UPDATE.
 */
const TOOL_FLUSH_MS = 1000

type PendingTurn = {
  convId: string
  assistantId: string
  chunks: string
  /**
   * True once a tool_execution_* event arrives mid-turn while assistant text exists.
   * The next text_delta inserts a paragraph break so preamble ("Let me check…") and
   * post-tool reply don't render as one run-on sentence ("environment.Based on…").
   */
  pendingParagraphBreak: boolean
  /** Set when operator hits Stop — ignore late broker `done` for this turn. */
  aborted?: boolean
  /** Pi slash command turn — fill assistant row from extension notify output when empty. */
  slashCommand?: boolean
  commandLines: string[]
  /** True when chunks has been updated but not yet written to SQLite (throttled flush). */
  contentDirty: boolean
  /** Debounced timer ID for the next content flush (null = no flush scheduled). */
  contentFlushTimer: ReturnType<typeof setTimeout> | null
  /** Buffered tool telemetry events waiting for a batch flush to SQLite. */
  toolEventsBuffer: Array<{ ts: number; event: Record<string, unknown> }>
  /** Debounced timer ID for the next tool telemetry batch flush (null = none). */
  toolFlushTimer: ReturnType<typeof setTimeout> | null
}

const pendingTurns = new Map<string, PendingTurn>()

/** Schedule a debounced content flush (at most one per CONTENT_FLUSH_MS). */
function scheduleContentFlush(pending: PendingTurn): void {
  if (pending.contentFlushTimer) return
  pending.contentFlushTimer = setTimeout(() => {
    pending.contentFlushTimer = null
    if (pending.contentDirty) {
      db.updateMessageContent(pending.assistantId, pending.chunks, 'streaming')
      pending.contentDirty = false
    }
  }, CONTENT_FLUSH_MS)
}

/** Schedule a debounced tool telemetry batch flush (at most one per TOOL_FLUSH_MS). */
function scheduleToolFlush(pending: PendingTurn): void {
  if (pending.toolFlushTimer) return
  pending.toolFlushTimer = setTimeout(() => {
    pending.toolFlushTimer = null
    if (pending.toolEventsBuffer.length > 0) {
      db.appendToolCallsJsonBatch(pending.assistantId, pending.toolEventsBuffer)
      pending.toolEventsBuffer = []
    }
  }, TOOL_FLUSH_MS)
}

/**
 * Flush all buffered state for a pending turn to SQLite and cancel pending timers.
 * Call before any finalization (done/error/abort/split) to ensure no data is lost.
 *
 * Tool telemetry is flushed to the DB here (no explicit write in finalization paths).
 * Content is NOT flushed — callers always write content explicitly with the final
 * status; we only cancel the timer so a stale 'streaming' write doesn't overwrite.
 */
function flushPendingTurnBuffers(pending: PendingTurn): void {
  // Tool events: batch-write to DB
  if (pending.toolFlushTimer) {
    clearTimeout(pending.toolFlushTimer)
    pending.toolFlushTimer = null
  }
  if (pending.toolEventsBuffer.length > 0) {
    db.appendToolCallsJsonBatch(pending.assistantId, pending.toolEventsBuffer)
    pending.toolEventsBuffer = []
  }
  // Content: cancel timer; caller writes explicitly with final status
  if (pending.contentFlushTimer) {
    clearTimeout(pending.contentFlushTimer)
    pending.contentFlushTimer = null
  }
  pending.contentDirty = false
}

/** Conversations fired by a scheduled prompt that should notify the phone on turn-done. */
const notifyOnDoneByConv = new Map<string, { workspaceId: string | null; title: string }>()

function findPendingTurnForConversation(
  conversationId: string,
): [string, NonNullable<ReturnType<typeof pendingTurns.get>>] | undefined {
  for (const [turnId, pending] of pendingTurns) {
    if (pending.convId === conversationId) return [turnId, pending]
  }
  return undefined
}

function findPendingTurnForOtherConversation(
  conversationId: string,
): [string, NonNullable<ReturnType<typeof pendingTurns.get>>] | undefined {
  for (const [turnId, pending] of pendingTurns) {
    if (pending.convId !== conversationId) return [turnId, pending]
  }
  return undefined
}

/** Close an in-flight turn in Sylo DB and notify the renderer (partial content kept). */
function finalizePendingTurn(
  turnId: string,
  pending: PendingTurn,
  status: 'complete' | 'cancelled' = 'complete',
): void {
  // Flush buffered tool telemetry + cancel pending timers before final write.
  flushPendingTurnBuffers(pending)

  const content = pending.chunks.trim()
  if (status === 'cancelled') {
    db.updateMessageContent(
      pending.assistantId,
      content ? `${content}\n\n_(Stopped)_` : '_(Stopped)_',
      'cancelled',
    )
  } else if (!pending.aborted) {
    db.updateMessageContent(pending.assistantId, pending.chunks || '', 'complete')
  }
  pendingTurns.delete(turnId)
  turnBrokerPool.releaseTurn(turnId, broker)
  emitChatRefresh(pending.convId, 'turnFinished')
}

type PreparedUserMessage = {
  /** Persisted user row (includes delivery metadata block). */
  text: string
  /** Text sent to Pi (includes fallback descriptions; excludes delivery metadata). */
  promptText: string
  images: BrokerImageContent[]
}

type DeferredChatTurn = {
  conversationId: string
  prepared: PreparedUserMessage
}

/** Turns waiting for a free broker slot while at max concurrency. */
const deferredChatTurns: DeferredChatTurn[] = []

function concurrentTurnsEnabled(): boolean {
  return db.getPref<boolean>('sylo.chat.concurrent_turns', false)
}

function maxConcurrentTurns(): number {
  return turnBrokerPool.maxConcurrent(concurrentTurnsEnabled())
}

function hasPendingTurn(turnId: string): boolean {
  return pendingTurns.has(turnId)
}

function shouldDeferCrossConversationTurn(conversationId: string): boolean {
  if (!findPendingTurnForOtherConversation(conversationId)) return false
  if (!concurrentTurnsEnabled()) return true
  return pendingTurns.size >= maxConcurrentTurns()
}

function isSupervisorReady(supervisor: BrokerSupervisor): boolean {
  if (supervisor === broker) return brokerAgentReady
  const slot = turnBrokerPool.overflowBrokers.find((s) => s.supervisor === supervisor)
  return slot?.ready ?? false
}

function brokerForConversationActiveTurn(conversationId: string): BrokerSupervisor | undefined {
  const active = findPendingTurnForConversation(conversationId)
  if (!active) return broker
  return turnBrokerPool.supervisorForTurn(active[0]) ?? broker
}

function primaryBrokerBusyWithOtherConversation(conversationId: string): boolean {
  const other = findPendingTurnForOtherConversation(conversationId)
  if (!other) return false
  const [otherTurnId] = other
  const assigned = turnBrokerPool.supervisorForTurn(otherTurnId)
  return assigned === broker || (!assigned && broker !== undefined)
}

function supervisorHasInFlightTurn(supervisor: BrokerSupervisor): boolean {
  for (const [turnId] of pendingTurns) {
    const assigned = turnBrokerPool.supervisorForTurn(turnId) ?? broker
    if (assigned === supervisor) return true
  }
  return false
}

type EnsureBrokerSessionPhase = 'turn-start' | 'ui-focus'

function deferChatTurn(
  conversationId: string,
  text: string,
  attachments: readonly RawAttachment[] | undefined,
): Promise<{ ok: true; assistantMessageId: string; deferred: true }> {
  return (async () => {
    const prepared = await prepareUserMessageWithImages(text, attachments)
    db.insertMessage(conversationId, 'user', prepared.text, 'complete')
    maybeAutoTitleFromFirstUserMessage(conversationId, text)
    emitChatRefresh(conversationId, 'messages')
    deferredChatTurns.push({
      conversationId,
      prepared,
    })
    return { ok: true as const, assistantMessageId: '', deferred: true as const }
  })()
}

async function flushDeferredTurns(): Promise<void> {
  if (deferredChatTurns.length === 0) return
  if (pendingTurns.size >= maxConcurrentTurns()) return
  const next = deferredChatTurns.shift()
  if (!next) return
  const result = await startChatTurn(next.conversationId, '', undefined, {
    skipUserInsert: true,
    prepared: next.prepared,
  })
  if (result.ok && result.deferred) {
    deferredChatTurns.unshift(next)
  }
}

/** After steer/follow-up: close the in-flight assistant row and stream the continuation into a new one. */
function splitPendingTurnAfterUserInterrupt(
  conversationId: string,
  pending: PendingTurn,
): void {
  // Flush buffered tool telemetry to the old assistant row before splitting.
  // Content is written explicitly below as 'complete'; we only cancel the timer.
  flushPendingTurnBuffers(pending)

  db.updateMessageContent(pending.assistantId, pending.chunks, 'complete')
  const nextAssistant = db.insertMessage(conversationId, 'assistant', '', 'streaming')
  pending.assistantId = nextAssistant.id
  pending.chunks = ''
  pending.pendingParagraphBreak = false
  pending.commandLines = []
}

/** Close assistant rows left in `streaming` without a live pending turn (crash, broker restart, double-send). */
function finalizeOrphanStreamingAssistants(conversationId: string): void {
  const liveAssistantIds = new Set<string>()
  for (const pending of pendingTurns.values()) {
    if (pending.convId === conversationId) liveAssistantIds.add(pending.assistantId)
  }
  for (const row of db.listMessages(conversationId)) {
    if (row.role !== 'assistant' || row.status !== 'streaming') continue
    if (liveAssistantIds.has(row.id)) continue
    const content = row.content.trim()
    db.updateMessageContent(
      row.id,
      content ? `${content}\n\n_(Interrupted)_` : '_(Interrupted)_',
      'complete',
    )
  }
}

const conversationChatOpTails = new Map<string, Promise<unknown>>()

/** Serialize chat mutations per conversation so double-send cannot spawn twin assistant rows. */
function chainConversationChatOp<T>(conversationId: string, op: () => Promise<T>): Promise<T> {
  const prev = conversationChatOpTails.get(conversationId) ?? Promise.resolve()
  const run = prev.catch(() => undefined).then(op)
  conversationChatOpTails.set(conversationId, run)
  void run.finally(() => {
    if (conversationChatOpTails.get(conversationId) === run) {
      conversationChatOpTails.delete(conversationId)
    }
  })
  return run
}

async function followUpActiveTurn(
  conversationId: string,
  text: string,
  attachments: readonly RawAttachment[] | undefined,
  options?: { steer?: boolean; skipUserInsert?: boolean },
): Promise<
  | { ok: true; assistantMessageId: string }
  | { ok: false; error: string }
> {
  const active = findPendingTurnForConversation(conversationId)
  if (!active) return { ok: false, error: 'no_active_turn' }

  const [turnId, pending] = active
  const assigned = turnBrokerPool.supervisorForTurn(turnId) ?? broker
  if (!assigned) return { ok: false, error: 'broker_not_ready' }

  const prepared = await prepareUserMessageWithImages(text, attachments)
  if (!options?.skipUserInsert) {
    db.insertMessage(conversationId, 'user', prepared.text, 'complete')
    maybeAutoTitleFromFirstUserMessage(conversationId, text)
  }
  splitPendingTurnAfterUserInterrupt(conversationId, pending)
  emitChatRefresh(conversationId, 'messages')
  try {
    await ensureBrokerSessionForConversation(conversationId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const images = prepared.images
  if (options?.steer) {
    assigned.sendSteer(prepared.promptText, images.length > 0 ? images : undefined)
  } else {
    assigned.sendFollowUp(prepared.promptText, images.length > 0 ? images : undefined)
  }
  return { ok: true, assistantMessageId: pending.assistantId }
}

type ChatRefreshKind = 'messages' | 'turnFinished' | 'turnStarted' | 'conversationRenamed' | 'conversationDeleted'

function emitChatRefresh(conversationId: string, kind: ChatRefreshKind): void {
  const payload = { conversationId, kind }
  mainWindow?.webContents.send('chat:refresh', payload)
  emitCompanionEvent({ channel: 'chat:refresh', payload })
}

/**
 * Derive and persist a title from the operator's first user message.
 *
 * Called from every site that inserts a `'user'` row, so deferred turns and
 * the safe-mode/broker-down path also get auto-titled. No-op when the title
 * is operator-set (manual rename, branch chat) or when this is not the first
 * user message in the conversation.
 *
 * Pass the raw composer text — never `prepared.text`, which carries the
 * appended image-delivery metadata that would leak into the sidebar label.
 */
function maybeAutoTitleFromFirstUserMessage(conversationId: string, rawUserText: string): void {
  try {
    if (db.countUserMessages(conversationId) !== 1) return
    const conv = db.getConversation(conversationId)
    if (!conv) return
    if (!isAutoTitleEligible(conv.title)) return
    const title = deriveChatTitleFromUserText(rawUserText)
    if (!title) return
    db.updateConversationTitle(conversationId, title)
  } catch (e) {
    // Auto-title is a UX nicety; never let it break a send.
    console.warn('[sylo] auto-title failed:', e instanceof Error ? e.message : e)
  }
}

/** Broker Pi session alignment — updated on spawn, switch, and fork. */
let brokerFocusedConversationId: string | undefined
let brokerLastSessionAbs: string | undefined
let brokerLastSessionCwd: string | undefined
let brokerLastDisabledFp: string | undefined
/** Fingerprint of the last model applied to the primary broker (provider\0id\0imageId\0imageProvider). */
let brokerLastModelFp: string | undefined

function defaultAgentDir(): string {
  return join(homedir(), '.pi', 'agent')
}

/**
 * Stored pref may be empty string; blank means "fall back to default" so resetting prefs is sane.
 */
function readSyloPiPathPref(key: 'sylo.pi_agent_dir', fallback: string): string {
  const raw = db.getPref(key, '') as unknown
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return expandPiPath(fallback)
  return expandPiPath(s)
}

function hostAgentDir(): string {
  return readSyloPiPathPref('sylo.pi_agent_dir', defaultAgentDir())
}

/** Sentinel markers wrap the Sylo-managed pointer block so it can be found,
 * refreshed, or removed without touching the rest of an operator's AGENTS.md. */
const AGENTS_MD_BLOCK_BEGIN = '<!-- BEGIN sylo:operator-profile-pointer -->'
const AGENTS_MD_BLOCK_END = '<!-- END sylo:operator-profile-pointer -->'

function syloAgentsMdBlock(): string {
  // Resolve the LIVE primary workspace dir (follows operator renames) with the
  // canonical path as fallback — never hardcode the install default here, or a
  // renamed universal workspace (e.g. sylo-user-work) advertises a stale path.
  const folderPath = db.resolveSyloUserDir()
  const folderRef = folderPath.split(/[\\/]/).join('/')
  return [
    AGENTS_MD_BLOCK_BEGIN,
    '# Sylo user-data workspace (global context)',
    '',
    "The operator's cross-workspace **user-data** lives in a tracked folder inside",
    'the GitHub folder, so it is backed up and travels between computers:',
    '',
    '```',
    folderRef,
    '```',
    '',
    'This folder holds user-specific information for this operator — the personal',
    'profile (`profile/user_profile.md`), notes, plans, and references. **Look at',
    '`INDEX.md` in that folder for the current file inventory**; do not assume the',
    'list — read the index there.',
    '',
    'Guidance for the assistant:',
    '',
    '- Read `profile/user_profile.md` there when you need to know about the operator',
    '  (name, work, vehicle, preferences, etc.). It is available in every workspace.',
    '- Update the profile ONLY when the operator explicitly asks you to remember a',
    '  fact about themselves. Do not write to it speculatively or store profile facts',
    '  anywhere else.',
    '- This pointer block is managed by Sylo; edit or remove it freely.',
    AGENTS_MD_BLOCK_END,
  ].join('\n')
}

/**
 * Seed the global Pi context file `~/.pi/agent/AGENTS.md` so the operator's
 * profile (kept in the Default workspace folder) is loaded for every workspace.
 *
 * Idempotent and non-destructive: this file is shared with all of the user's Pi
 * usage, not just Sylo. If the file is absent it is created. If it exists, only
 * the sentinel-wrapped Sylo pointer block is inserted (or refreshed with the
 * current machine's path); everything outside the markers is preserved.
 */
function ensureGlobalAgentsMd(): void {
  const agentDir = hostAgentDir()
  const agentsMdPath = join(agentDir, 'AGENTS.md')
  const block = syloAgentsMdBlock()
  mkdirSync(agentDir, { recursive: true })
  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, `${block}\n`, 'utf8')
    return
  }
  const existing = readFileSync(agentsMdPath, 'utf8')
  const beginIdx = existing.indexOf(AGENTS_MD_BLOCK_BEGIN)
  const endIdx = existing.indexOf(AGENTS_MD_BLOCK_END)
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    // No managed block yet — append it, separated from existing content.
    const sep = existing.endsWith('\n') ? (existing.endsWith('\n\n') ? '' : '\n') : '\n\n'
    writeFileSync(agentsMdPath, `${existing}${sep}${block}\n`, 'utf8')
    return
  }
  // Replace the existing managed block in place (keeps path fresh per machine).
  const before = existing.slice(0, beginIdx)
  const after = existing.slice(endIdx + AGENTS_MD_BLOCK_END.length)
  writeFileSync(agentsMdPath, `${before}${block}${after}`, 'utf8')
}

/**
 * Deploy the universal workspace's `agent/AGENTS.md` (global AI instructions)
 * to the global Pi directory. Runs at startup and on save/deploy via IPC.
 * Source of truth lives in the universal workspace (git-synced, rename-safe —
 * resolved via the primary workspace row, so `sylo-work` works too).
 * The machine-managed pointer block is refreshed afterwards by
 * `ensureGlobalAgentsMd()` so the deployed copy always carries this machine's
 * user-data workspace path.
 */
function deployGlobalAgentsFromWorkspace(): GlobalAgentsDeployResult {
  const r = deployGlobalAgents({
    primaryDir: db.resolveSyloUserDir(),
    agentDir: hostAgentDir(),
  })
  if (r.action === 'deployed' || r.action === 'adopted' || r.action === 'seeded') {
    db.setPref('sylo.global_agents.last_deployed_at', new Date().toISOString())
  }
  return r
}

function globalAgentsStatusPayload(): GlobalAgentsStatus {
  return readGlobalAgentsStatus({
    primaryDir: db.resolveSyloUserDir(),
    agentDir: hostAgentDir(),
    lastDeployedAt: db.getPref<string | null>('sylo.global_agents.last_deployed_at', null),
  })
}

function globalAgentsSaveAndDeploy(
  content: unknown,
): GlobalAgentsStatus & { ok: boolean; error?: string } {
  const body = typeof content === 'string' ? content : ''
  const w = writeGlobalAgentsSource(db.resolveSyloUserDir(), body)
  if (!w.ok) {
    return { ...globalAgentsStatusPayload(), ok: false, error: w.error }
  }
  const d = deployGlobalAgentsFromWorkspace()
  ensureGlobalAgentsMd()
  if (d.action === 'error') {
    return { ...globalAgentsStatusPayload(), ok: false, error: d.error }
  }
  return { ...globalAgentsStatusPayload(), ok: true }
}

function globalAgentsRedeploy(): GlobalAgentsStatus & { ok: boolean; error?: string } {
  const d = deployGlobalAgentsFromWorkspace()
  ensureGlobalAgentsMd()
  if (d.action === 'error') {
    return { ...globalAgentsStatusPayload(), ok: false, error: d.error }
  }
  return { ...globalAgentsStatusPayload(), ok: true }
}

/** Resolved Pi project directory for a workspace (primary row is the global default; others inherit it when unset or invalid). */
function effectivePiCwdForWorkspace(workspaceId: string): string {
  const userData = app.getPath('userData')
  const primaryId = db.defaultWorkspaceId()
  const ws = db.getWorkspace(workspaceId)
  const raw = ws?.pi_cwd?.trim() ?? ''

  if (workspaceId === primaryId) {
    if (raw && existsSync(raw)) return raw
    const canon = db.canonicalDefaultWorkspacePiProjectPath()
    mkdirSync(canon, { recursive: true })
    return canon
  }

  if (raw && existsSync(raw)) return raw
  return effectivePiCwdForWorkspace(primaryId)
}

function resolvePiPackageContext(workspaceId?: unknown): { piCwd: string; agentDir: string } {
  const wid =
    typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : db.defaultWorkspaceId()
  return { piCwd: effectivePiCwdForWorkspace(wid), agentDir: hostAgentDir() }
}

function activeWorkspaceId(): string {
  const pref = String(db.getPref('sylo.ui.active_workspace_id', '') || '').trim()
  const workspaces = db.listWorkspaces()
  if (pref && workspaces.some((w) => w.id === pref)) return pref
  return workspaces[0]?.id ?? db.defaultWorkspaceId()
}

/** Resolve a local file path from an absolute path, relative path, or `sylo-file://` preview URL. */
function resolveSourcePathForSave(raw: string, piCwd: string): { ok: true; path: string } | { ok: false; error: string } {
  let candidate = raw.trim()
  if (!candidate) return { ok: false, error: 'empty_source' }
  if (candidate.startsWith('sylo-file://')) {
    try {
      const u = new URL(candidate)
      const p = u.searchParams.get('path')
      if (p) candidate = decodeURIComponent(p)
    } catch {
      return { ok: false, error: 'bad_sylo_file_url' }
    }
  }
  const hit = resolveLocalPathOnDisk(candidate, piCwd)
  if (hit.ok) return { ok: true, path: hit.path }
  const abs = resolve(candidate)
  if (existsSync(abs)) return { ok: true, path: abs }
  return { ok: false, error: 'source_not_found' }
}

/**
 * Normalize a package spec for Pi's DefaultPackageManager. Pi resolves
 * relative-path specs against the install cwd (the active workspace), but
 * `pi install <path>` persists them into settings.json relative to the agent
 * dir — so re-running install/update/remove on a stored spec with a different
 * workspace active points at the wrong folder (e.g. Documents\Documents\…).
 * Prefer the agent-dir-relative resolution when it exists on disk.
 */
function normalizePackageSpecForPiContext(spec: string, piCwd: string, agentDir: string): string {
  const t = spec.trim()
  if (!t) return t
  if (/^(npm:|git:|https?:|ssh:)/i.test(t) || isAbsolute(t)) return t
  const viaAgent = resolve(agentDir, t)
  if (existsSync(viaAgent)) return viaAgent
  const viaCwd = resolve(piCwd, t)
  if (existsSync(viaCwd)) return viaCwd
  return t
}

async function installPackageInPiContext(
  spec: string,
  piCwd: string,
  agentDir: string,
): Promise<{ ok: boolean; detail?: string }> {
  const trimmed = normalizePackageSpecForPiContext(spec, piCwd, agentDir)
  if (!trimmed) return { ok: false, detail: 'Missing install spec' }
  try {
    const settingsManager = SettingsManager.create(piCwd, agentDir)
    const pm = new DefaultPackageManager({ cwd: piCwd, agentDir, settingsManager })
    await pm.installAndPersist(trimmed, { local: false })
    return { ok: true, detail: `Installed ${trimmed}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

async function removePackageInPiContext(
  spec: string,
  piCwd: string,
  agentDir: string,
): Promise<{ ok: boolean; detail?: string }> {
  const trimmed = normalizePackageSpecForPiContext(spec, piCwd, agentDir)
  if (!trimmed) return { ok: false, detail: 'Missing uninstall spec' }
  try {
    const settingsManager = SettingsManager.create(piCwd, agentDir)
    const pm = new DefaultPackageManager({ cwd: piCwd, agentDir, settingsManager })
    if (await pm.removeAndPersist(trimmed, { local: false })) {
      purgePackageInventoryMemoryForSpec(trimmed)
      return { ok: true, detail: `Removed ${trimmed}` }
    }
    if (await pm.removeAndPersist(trimmed, { local: true })) {
      purgePackageInventoryMemoryForSpec(trimmed)
      return { ok: true, detail: `Removed ${trimmed} (project scope)` }
    }
    return { ok: false, detail: `No matching package found for ${trimmed}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

async function updatePackageInPiContext(
  spec: string,
  piCwd: string,
  agentDir: string,
): Promise<{ ok: boolean; detail?: string }> {
  const trimmed = normalizePackageSpecForPiContext(spec, piCwd, agentDir)
  if (!trimmed) return { ok: false, detail: 'Missing update spec' }
  try {
    const settingsManager = SettingsManager.create(piCwd, agentDir)
    const pm = new DefaultPackageManager({ cwd: piCwd, agentDir, settingsManager })
    await pm.update(trimmed)
    return { ok: true, detail: `Updated ${trimmed}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

function mergeDisabledCapabilities(
  global: SyloDisabledCapabilities,
  extra: SyloDisabledCapabilities,
): SyloDisabledCapabilities {
  const mergeLists = (a: string[], b: string[]) => {
    const s = new Set([
      ...normalizePathListForDisabledJson(a),
      ...normalizePathListForDisabledJson(b),
    ])
    return Array.from(s).sort((x, y) => x.localeCompare(y))
  }
  return {
    skillPaths: mergeLists(global.skillPaths, extra.skillPaths),
    extensionPaths: mergeLists(global.extensionPaths, extra.extensionPaths),
    disabledTools: mergeDisabledToolsLists(global.disabledTools ?? [], extra.disabledTools ?? []),
  }
}

function mergedDisabledForWorkspace(workspaceId: string | null | undefined): SyloDisabledCapabilities {
  const g = readSyloDisabledCapabilities()
  const wid = typeof workspaceId === 'string' ? workspaceId.trim() : ''
  if (!wid) return g
  const ws = db.getWorkspace(wid)
  if (!ws) return g
  return mergeDisabledCapabilities(g, db.workspaceDisabledDecoded(ws))
}

function mergedDisabledForConversation(convId: string): SyloDisabledCapabilities {
  const conv = db.getConversation(convId)
  return mergedDisabledForWorkspace(conv?.workspace_id)
}

function disabledFingerprint(disabled: SyloDisabledCapabilities): string {
  const s = (x: string[]) => x.join('\0')
  const tools = (disabled.disabledTools ?? [])
    .map((t) => `${t.extensionPath}\t${t.toolName}`)
    .sort()
    .join('\0')
  const cursor = readIncludeCursorSkillsPref() ? '1' : '0'
  return `${s(disabled.skillPaths)}__||__${s(disabled.extensionPaths)}__||__${tools}__||__cursor:${cursor}`
}

function sessionBindingForConversation(convId: string): {
  sessionAbs: string
  sessionCwd: string
  mergedDisabled: SyloDisabledCapabilities
} {
  const row = db.getConversation(convId)
  if (!row) throw new Error(`conversation not found: ${convId}`)
  const agentDir = hostAgentDir()
  const wid = row.workspace_id?.trim() || db.defaultWorkspaceId()
  const ws = db.getWorkspace(wid)
  const segment = ws?.path_segment?.trim() || ws?.id || '_inbox'
  const sessionCwd = effectivePiCwdForWorkspace(wid)
  const sessionAbs = absoluteSessionPathForConversation(agentDir, row, segment)
  const mergedDisabled = mergedDisabledForConversation(convId)
  return { sessionAbs, sessionCwd, mergedDisabled }
}

function getInitialBrokerConversationId(): string {
  const prefRaw = db.getPref('sylo.ui.active_conversation_id', '') as string
  const pref = typeof prefRaw === 'string' ? prefRaw.trim() : ''
  if (pref) {
    const row = db.getConversation(pref)
    if (row) return row.id
  }
  const all = db.listConversations()
  if (all.length) return all[0]!.id
  return db.createConversation('Chat').id
}

/**
 * Effective model for a conversation: per-chat override ?? global prefs. Null
 * fields on the override fall through to the global default. Image model
 * follows the same rule. Returned provider/modelId are never empty when global
 * defaults are set (they fall back to SYLO_DEFAULT_*).
 */
function effectiveModelForConversation(convId: string): {
  provider: string
  modelId: string
  imageModelId: string
  imageModelProvider: string
  /** null = Pi default thinking level for the resolved model. */
  thinkingLevel: string | null
} {
  const conv = db.getConversation(convId)
  const gProvider = (db.getPref('sylo.model_provider', SYLO_DEFAULT_MODEL_PROVIDER) as string).trim()
  const gModelId = (db.getPref('sylo.model_id', SYLO_DEFAULT_MODEL_ID) as string).trim()
  const gImageId = (db.getPref('sylo.image_model_id', '') as string).trim()
  const gImageProvider = (db.getPref('sylo.image_model_provider', 'ollama') as string).trim()
  const provider =
    conv?.model_provider != null && conv.model_provider.trim() !== '' ?
      conv.model_provider.trim()
    : gProvider
  const modelId =
    conv?.model_id != null && conv.model_id.trim() !== '' ? conv.model_id.trim() : gModelId
  const imageModelId =
    conv?.image_model_id != null && conv.image_model_id.trim() !== '' ?
      conv.image_model_id.trim()
    : gImageId
    const imageModelProvider =
    conv?.image_model_provider != null && conv.image_model_provider.trim() !== '' ?
      conv.image_model_provider.trim()
    : gImageProvider
  const thinkingLevel =
    conv?.thinking_level != null && conv.thinking_level.trim() !== '' ?
      conv.thinking_level.trim()
    : null
  return { provider, modelId, imageModelId, imageModelProvider, thinkingLevel }
}

/** Fingerprint so a model change forces a broker switchSession even if the session path is unchanged. */
function modelFingerprint(m: {
  provider: string
  modelId: string
  imageModelId: string
  imageModelProvider: string
  thinkingLevel: string | null
}): string {
  return `${m.provider}\0${m.modelId}\0${m.imageModelId}\0${m.imageModelProvider}\0${m.thinkingLevel ?? ''}`
}

async function ensureBrokerSessionForConversation(
  convId: string,
  options?: { phase?: EnsureBrokerSessionPhase },
): Promise<void> {
  const phase = options?.phase ?? 'turn-start'
  const supervisor = brokerForConversationActiveTurn(convId) ?? broker
  if (!supervisor || !isSupervisorReady(supervisor)) {
    if (phase === 'turn-start') {
      throw new Error('Broker is not ready yet. Wait a moment or use Developer → Restart broker.')
    }
    return
  }
  // UI-driven focus changes must not switchSession on a broker mid-turn — Pi extensions
  // (e.g. observational-memory) capture ctx that goes stale after session replacement.
  if (phase === 'ui-focus' && supervisorHasInFlightTurn(supervisor)) return
  if (primaryBrokerBusyWithOtherConversation(convId) && supervisor === broker) return
  const { sessionAbs, sessionCwd, mergedDisabled } = sessionBindingForConversation(convId)
  const dfp = disabledFingerprint(mergedDisabled)
  const eff = effectiveModelForConversation(convId)
  const mfp = modelFingerprint(eff)
  if (
    supervisor === broker &&
    brokerFocusedConversationId === convId &&
    brokerLastSessionAbs === sessionAbs &&
    brokerLastSessionCwd === sessionCwd &&
    brokerLastDisabledFp === dfp &&
    brokerLastModelFp === mfp
  ) {
    return
  }
  await supervisor.switchSession(sessionAbs, sessionCwd, {
    disabledSkillPaths: mergedDisabled.skillPaths,
    disabledExtensionPaths: mergedDisabled.extensionPaths,
    disabledTools: mergedDisabled.disabledTools,
    includeCursorSkills: readIncludeCursorSkillsPref(),
        modelProvider: eff.provider,
    modelId: eff.modelId,
    imageModelId: eff.imageModelId,
    imageModelProvider: eff.imageModelProvider,
    thinkingLevel: eff.thinkingLevel ?? undefined,
  })
  if (supervisor === broker) {
    brokerFocusedConversationId = convId
    brokerLastSessionAbs = sessionAbs
    brokerLastSessionCwd = sessionCwd
    brokerLastDisabledFp = dfp
    brokerLastModelFp = mfp
  }
}

/** Renderer-supplied attachment descriptor (mirrors chip list). */
type RawAttachment = { path: string; name?: string }

/** Trim and drop empty-path entries from an IPC-supplied attachment list. */
function normalizeAttachments(raw: readonly RawAttachment[] | undefined): RawAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: RawAttachment[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const path = typeof a.path === 'string' ? a.path.trim() : ''
    if (!path) continue
    const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined
    out.push(name ? { path, name } : { path })
  }
  return out
}

/** Ollama API origin from Sylo prefs / models.json (not …/v1). */
function resolveOllamaBaseOriginForPrefs(): string {
  const pref = (db.getPref('sylo.ollama_base_url', '') as string).trim()
  if (pref) return normalizeOllamaOrigin(pref)
  const fromJson = inferOllamaBaseOriginFromModelsJson(hostAgentDir())
  if (fromJson) return fromJson
  return 'http://127.0.0.1:11434'
}

/**
 * Encode image attachments and build persisted delivery metadata for export/debug.
 * When the main model is text-only and an image fallback model is configured, describes
 * pixels via Ollama and injects prose instead of sending images to Pi.
 */
async function prepareUserMessageWithImages(
  text: string,
  attachments: readonly RawAttachment[] | undefined,
): Promise<PreparedUserMessage> {
  const norm = normalizeAttachments(attachments)
  if (norm.length === 0) return { text, promptText: text, images: [] }

  const { images, delivered, skipped } = encodeImageAttachmentsForPi(norm)
  for (const s of skipped) {
    console.warn('[sylo] skipped image attachment for Pi:', s.path, s.reason)
  }
  const modelInput =
    brokerResolvedModel ?
      resolveModelInputTypes(
        hostAgentDir(),
        brokerResolvedModel.provider,
        brokerResolvedModel.modelId,
      )
    : (['text'] as ('text' | 'image')[])
  const modelVisionCapable = modelInput.includes('image')
  // Deliver pixels to Pi only when the main model can see them. When text-only, leave pixels
  // out (Pi would strip them anyway) and hand the model the paths so it can call `analyze_image`
  // with its own prompt — see IMAGE_TOOL_HINT_TEXTONLY.
  let piImagesAttached = modelVisionCapable ? images.length : 0
  let messageText = text

  if (!modelVisionCapable && images.length > 0) {
    const hint = IMAGE_TOOL_HINT_TEXTONLY
    if (messageText.includes(USER_ATTACHMENT_HINT)) {
      messageText = messageText.replace(USER_ATTACHMENT_HINT, `${USER_ATTACHMENT_HINT}\n${hint}`)
    } else {
      messageText = `${hint}\n\n${messageText}`
    }
  }

  const summary: ImageDeliverySummary = {
    modelVisionCapable,
    modelInput,
    piImagesAttached,
    encoded: delivered,
    skipped,
  }

  if (images.length === 0 && skipped.length === 0) {
    return { text, promptText: text, images: [] }
  }

  return {
    text: appendImageDeliveryMetadata(messageText, summary),
    promptText: messageText,
    images: piImagesAttached > 0 ? images : [],
  }
}

async function startChatTurn(
  conversationId: string,
  text: string,
  attachments?: readonly RawAttachment[],
  options?: { skipUserInsert?: boolean; prepared?: PreparedUserMessage },
): Promise<
  | { ok: true; assistantMessageId: string; deferred?: false }
  | { ok: true; assistantMessageId: string; deferred: true }
  | { ok: false; assistantMessageId: string; error: string }
> {
  if (!brokerAgentReady || !broker || db.getPref('sylo.safe_mode', false)) {
    if (!options?.skipUserInsert) {
      db.insertMessage(conversationId, 'user', text, 'complete')
      maybeAutoTitleFromFirstUserMessage(conversationId, text)
    }
    const msg =
      db.getPref('sylo.safe_mode', false) ?
        'Safe mode is on. Clear it from the banner or use Developer → Restart broker.'
      : 'Agent is not connected. Finish Pi setup (optional), pick provider/model in Settings or leave both empty for Pi defaults, then use Developer → Restart broker.'
    const assistant = db.insertMessage(conversationId, 'assistant', msg, 'failed')
    emitChatRefresh(conversationId, 'turnFinished')
    return { ok: false, assistantMessageId: assistant.id, error: 'broker_not_ready' }
  }

  if (!options?.skipUserInsert && shouldDeferCrossConversationTurn(conversationId)) {
    return await deferChatTurn(conversationId, text, attachments)
  }

  const existingActive = findPendingTurnForConversation(conversationId)
  if (existingActive) {
    const followUp = await followUpActiveTurn(conversationId, text, attachments, {
      skipUserInsert: options?.skipUserInsert,
    })
    if (!followUp.ok) {
      return { ok: false, assistantMessageId: '', error: followUp.error }
    }
    return { ok: true, assistantMessageId: followUp.assistantMessageId }
  }

  finalizeOrphanStreamingAssistants(conversationId)

  const prepared = options?.prepared ?? (await prepareUserMessageWithImages(text, attachments))
  if (!options?.skipUserInsert) {
    db.insertMessage(conversationId, 'user', prepared.text, 'complete')
    maybeAutoTitleFromFirstUserMessage(conversationId, text)
  }
  const assistant = db.insertMessage(conversationId, 'assistant', '', 'streaming')
  const turnId = randomUUID()
  pendingTurns.set(turnId, {
    convId: conversationId,
    assistantId: assistant.id,
    chunks: '',
    pendingParagraphBreak: false,
    slashCommand: isPiUserSlashCommand(text || prepared.promptText),
    commandLines: [],
    contentDirty: false,
    contentFlushTimer: null,
    toolEventsBuffer: [],
    toolFlushTimer: null,
  })
  const assignedBroker = await acquireBrokerForTurn(conversationId)
  if (!assignedBroker) {
    flushPendingTurnBuffers(pendingTurns.get(turnId)!)
    pendingTurns.delete(turnId)
    const msg = 'All broker slots are busy. Try again shortly.'
    db.updateMessageContent(assistant.id, `(error) ${msg}`, 'failed')
    emitChatRefresh(conversationId, 'turnFinished')
    return { ok: false, assistantMessageId: assistant.id, error: 'broker_busy' }
  }
  turnBrokerPool.assignTurn(turnId, assignedBroker)
  try {
    await ensureBrokerSessionForConversation(conversationId)
  } catch (e) {
    flushPendingTurnBuffers(pendingTurns.get(turnId)!)
    pendingTurns.delete(turnId)
    turnBrokerPool.releaseTurn(turnId, broker)
    const msg = e instanceof Error ? e.message : String(e)
    db.updateMessageContent(assistant.id, `(error) ${msg}`, 'failed')
    emitChatRefresh(conversationId, 'turnFinished')
    return { ok: false, assistantMessageId: assistant.id, error: 'broker_not_ready' }
  }
  const images = prepared.images
  emitChatRefresh(conversationId, 'turnStarted')
  assignedBroker.sendPrompt(turnId, prepared.promptText, images.length > 0 ? images : undefined)
  return { ok: true, assistantMessageId: assistant.id }
}

/** Queue for later (Pi followUp) while a turn is active, or start a new turn when idle. */
async function deliverQueuedMessage(
  conversationId: string,
  text: string,
  attachments?: readonly RawAttachment[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!brokerAgentReady || !broker || db.getPref('sylo.safe_mode', false)) {
    return { ok: false, error: 'broker_not_ready' }
  }

  const active = findPendingTurnForConversation(conversationId)
  if (active) {
    const followUp = await followUpActiveTurn(conversationId, text, attachments)
    return followUp.ok ? { ok: true } : { ok: false, error: followUp.error }
  }

  finalizeOrphanStreamingAssistants(conversationId)
  const started = await startChatTurn(conversationId, text, attachments)
  if (!started.ok) return { ok: false, error: started.error }
  return { ok: true }
}

function dismissSplash(): void {
  const sw = splashWindow
  splashWindow = undefined
  if (sw && !sw.isDestroyed()) {
    sw.close()
  }
}

function createSplashWindow(): void {
  const splashHtml = resolveSplashHtmlPath()
  if (!existsSync(splashHtml)) {
    return
  }
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    backgroundColor: '#0f1115',
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...appIconWindowOptions(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  void splashWindow.loadFile(splashHtml)
}

function sessionActivePath(): string {
  return join(app.getPath('userData'), '.session-active')
}

function clearSafeModePrefs(): void {
  db.setPref('sylo.safe_mode', false)
  db.setPref('sylo.boot_strikes', 0)
  try {
    unlinkSync(sessionActivePath())
  } catch {
    /* */
  }
}

function evaluateBootStrikes(): number {
  let strikes = db.getPref<number>('sylo.boot_strikes', 0)
  if (existsSync(sessionActivePath())) {
    strikes += 1
    db.setPref('sylo.boot_strikes', strikes)
    try {
      unlinkSync(sessionActivePath())
    } catch {
      /* */
    }
  }
  return strikes
}

function markWindowSessionActive(): void {
  writeFileSync(sessionActivePath(), '1', 'utf8')
}

function readSettingsJson(): Record<string, unknown> {
  const p = join(hostAgentDir(), 'settings.json')
  if (!existsSync(p)) return { packages: [] }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
  } catch {
    return { packages: [] }
  }
}

function writeSettingsJson(next: Record<string, unknown>): void {
  const dir = hostAgentDir()
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'settings.json')
  writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
}

function extForClipboardImageMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]?.trim() ?? ''
  if (m === 'image/png') return 'png'
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/bmp' || m === 'image/x-ms-bmp') return 'bmp'
  return 'bin'
}

function clipboardImagePayloadToBuffer(data: unknown): Buffer | null {
  if (data == null) return null
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data))
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  }
  return null
}

/** Normalize user input to an origin without trailing slash (e.g. http://host:11434). */
function normalizeOllamaOrigin(raw: string): string {
  const t = raw.trim()
  if (!t) return 'http://127.0.0.1:11434'
  if (/^https?:\/\//i.test(t)) return t.replace(/\/$/, '')
  return `http://${t.replace(/^\/*/, '')}`.replace(/\/$/, '')
}

/** Read models.json and return Ollama API origin (strip …/v1) if present. */
function inferOllamaBaseOriginFromModelsJson(agentDir: string): string | null {
  const p = join(agentDir, 'models.json')
  if (!existsSync(p)) return null
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    const prov = j.providers as Record<string, unknown> | undefined
    const ollama = prov?.ollama as Record<string, unknown> | undefined
    const bu = ollama?.baseUrl
    if (typeof bu !== 'string' || !bu.trim()) return null
    const s = bu.trim().replace(/\/$/, '')
    if (/\/v1$/i.test(s)) return s.slice(0, -3) || null
    return s
  } catch {
    return null
  }
}

async function fetchOllamaTagNames(baseOrigin: string): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  let tagsUrl: URL
  try {
    tagsUrl = new URL('/api/tags', `${normalizeOllamaOrigin(baseOrigin)}/`)
  } catch {
    return { ok: false, error: 'Invalid Ollama server URL' }
  }
  if (tagsUrl.protocol !== 'http:' && tagsUrl.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs are allowed' }
  }
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 10_000)
  try {
    const res = await fetch(tagsUrl, { signal: ac.signal })
    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status}` }
    }
    const j = (await res.json()) as { models?: { name?: string }[] }
    const names = (j.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name : ''))
      .filter(Boolean)
    names.sort((a, b) => a.localeCompare(b))
    return { ok: true, models: names }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof Error && e.name === 'AbortError') return { ok: false, error: 'Request timed out' }
    return { ok: false, error: msg }
  } finally {
    clearTimeout(t)
  }
}

/** Merge Pi Ollama provider baseUrl as {origin}/v1 without clobbering models[] / auth. */
function patchOllamaBaseUrlInModelsJson(
  agentDir: string,
  originRaw: string,
  ensureModelId?: string,
): { ok: true } | { ok: false; error: string } {
  const modelsPath = join(agentDir, 'models.json')
  const normalized = normalizeOllamaOrigin(originRaw)
  const baseUrl = `${normalized}/v1`

  let root: Record<string, unknown> = {}
  if (existsSync(modelsPath)) {
    try {
      root = JSON.parse(readFileSync(modelsPath, 'utf8')) as Record<string, unknown>
    } catch {
      return { ok: false, error: 'Could not parse ~/.pi/agent/models.json' }
    }
  }
  const providers = { ...((root.providers as Record<string, unknown>) ?? {}) }
  const prevOllama = (providers.ollama as Record<string, unknown>) ?? {}
  const ollama: Record<string, unknown> = {
    ...prevOllama,
    baseUrl,
  }
  if (ollama.api === undefined) ollama.api = 'openai-completions'
  if (ollama.apiKey === undefined) ollama.apiKey = 'ollama'

  const wantId = typeof ensureModelId === 'string' ? ensureModelId.trim() : ''
  if (wantId) {
    const rawList = ollama.models
    const existing: unknown[] = Array.isArray(rawList) ? [...rawList] : []
    const has = existing.some((entry) => {
      if (typeof entry === 'string') return entry.trim() === wantId
      if (entry && typeof entry === 'object' && typeof (entry as { id?: string }).id === 'string') {
        return (entry as { id: string }).id.trim() === wantId
      }
      return false
    })
    if (!has) existing.push({ id: wantId })
    ollama.models = existing
  }

  providers.ollama = ollama
  root.providers = providers
  try {
    mkdirSync(dirname(modelsPath), { recursive: true })
    writeFileSync(modelsPath, JSON.stringify(root, null, 2), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Read a provider's saved API key status from `~/.pi/agent/auth.json` (mask only — never return the raw key). */
function readProviderAuthInfo(
  agentDir: string,
  provider: string,
): { ok: true; hasKey: boolean; keyPreview: string | null } | { ok: false; error: string } {
  const authPath = join(agentDir, 'auth.json')
  if (!existsSync(authPath)) return { ok: true, hasKey: false, keyPreview: null }
  let root: Record<string, unknown>
  try {
    root = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
  } catch {
    return { ok: false, error: 'Could not parse auth.json in the Pi agent directory' }
  }
  const entry = root[provider]
  if (!entry || typeof entry !== 'object') return { ok: true, hasKey: false, keyPreview: null }
  const key = (entry as { key?: unknown }).key
  if (typeof key !== 'string' || key.trim() === '') return { ok: true, hasKey: false, keyPreview: null }
  const trimmed = key.trim()
  const tail = trimmed.length > 12 ? '…' + trimmed.slice(-8) : '…' + trimmed.slice(-4)
  return { ok: true, hasKey: true, keyPreview: tail }
}

/**
 * Store or remove a provider API key in `~/.pi/agent/auth.json` — Pi's native
 * auth store (same file `/login` writes). Pi's ModelRuntime reads it at session
 * creation, so switching providers back and forth never loses the key.
 * Empty key removes the provider entry (fall back to env / other auth).
 */
function writeProviderAuthKey(
  agentDir: string,
  provider: string,
  keyRaw: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  const authPath = join(agentDir, 'auth.json')
  let root: Record<string, unknown> = {}
  if (existsSync(authPath)) {
    try {
      root = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
    } catch {
      return { ok: false, error: 'Could not parse auth.json in the Pi agent directory' }
    }
  }
  const key = typeof keyRaw === 'string' ? keyRaw.trim() : ''
  if (key === '') {
    delete root[provider]
  } else {
    root[provider] = { type: 'api_key', key }
  }
  try {
    mkdirSync(dirname(authPath), { recursive: true })
    writeFileSync(authPath, JSON.stringify(root, null, 2), { encoding: 'utf8', mode: 0o600 })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface OpenRouterModelLite {
  id: string
  name: string
  contextLength: number | null
}

/**
 * Free OpenRouter models via the public models endpoint (no auth required).
 * Fallback: a small seeded list (incl. nemotron-3-ultra) when offline, so the
 * dropdown is never empty.
 */
const OPENROUTER_FALLBACK_MODELS: OpenRouterModelLite[] = [
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA: Nemotron 3 Ultra 550B (free)',
    contextLength: null,
  },
]

async function fetchOpenRouterFreeModels(): Promise<{
  models: OpenRouterModelLite[]
  source: 'live' | 'fallback'
} | { error: string }> {
  const url = 'https://openrouter.ai/api/v1/models'
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return { models: OPENROUTER_FALLBACK_MODELS, source: 'fallback' }
    const body = (await res.json()) as { data?: unknown[] }
    const rows = Array.isArray(body.data) ? body.data : []
    const models: OpenRouterModelLite[] = []
    for (const row of rows) {
      const m = row as {
        id?: unknown
        name?: unknown
        context_length?: unknown
        pricing?: { prompt?: unknown; completion?: unknown }
      }
      if (typeof m.id !== 'string' || m.id.trim() === '') continue
      const isFree =
        (typeof m.pricing?.prompt === 'string' && m.pricing.prompt === '0') ||
        (typeof m.pricing?.completion === 'string' && m.pricing.completion === '0')
      if (!isFree) continue
      models.push({
        id: m.id.trim(),
        name: typeof m.name === 'string' && m.name.trim() !== '' ? m.name : m.id.trim(),
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
      })
    }
    if (models.length === 0) return { models: OPENROUTER_FALLBACK_MODELS, source: 'fallback' }
    models.sort((a, b) => a.name.localeCompare(b.name))
    return { models, source: 'live' }
  } catch (e) {
    return { models: OPENROUTER_FALLBACK_MODELS, source: 'fallback' }
  } finally {
    clearTimeout(t)
  }
}

function readPiBuiltinToolsPref(): PiBuiltinToolsPref {
  return normalizePiBuiltinToolsPref(db.getPref('sylo.pi_builtin_tools', null))
}

function readSyloOptionalPackagesPref(): Record<string, boolean> {
  return normalizeSyloOptionalPackagesPref(db.getPref('sylo.optional_packages', null))
}

type BrokerMessageContext = {
  spawnGeneration: number
  isPrimary: boolean
  overflowSlot?: OverflowBrokerSlot
  isStale: () => boolean
}

function persistCompactionChatNotice(
  convId: string,
  ev: Record<string, unknown>,
): void {
  const reason = ev.reason
  const compactionReason: CompactionReason =
    reason === 'manual' || reason === 'overflow' || reason === 'threshold' ? reason : 'threshold'
  const aborted = ev.aborted === true
  const errorMessage = typeof ev.errorMessage === 'string' ? ev.errorMessage : undefined
  const summary = typeof ev.summary === 'string' ? ev.summary : undefined
  const tokensBefore = typeof ev.tokensBefore === 'number' ? ev.tokensBefore : undefined
  const tokensAfter = typeof ev.tokensAfter === 'number' ? ev.tokensAfter : undefined
  const hasResult = !aborted && !errorMessage && (summary != null || tokensBefore != null)
  if (!hasResult && !aborted && !errorMessage) return

  const content = formatCompactionNoticeContent({
    kind: 'compaction',
    reason: compactionReason,
    tokensBefore,
    tokensAfter,
    summary,
    aborted: aborted || undefined,
    errorMessage,
  })
  db.insertMessage(convId, 'system', content, 'complete')
  emitChatRefresh(convId, 'messages')
}

function handleBrokerOutMessage(msg: BrokerOutMessage, ctx: BrokerMessageContext): void {
  if (ctx.isStale()) return
    if (msg.type === 'show_widget') {
    mainWindow?.webContents.send('skill-surface:show-widget', {
      toolCallId: msg.toolCallId,
      html: msg.html,
      path: msg.path,
      data: msg.data,
      ...(msg.workspaceKey ? { workspaceKey: msg.workspaceKey } : {}),
    })
    return
  }
  if (msg.type === 'show_canvas') {
    emitCanvasShow({
      toolCallId: msg.toolCallId,
      kind: msg.kind,
      title: msg.title,
      content: msg.content,
      filePath: msg.filePath,
      ...(msg.workspaceKey ? { workspaceKey: msg.workspaceKey } : {}),
    })
    return
  }
    if (msg.type === 'sylo-tasks:changed') {
    // Broker (agent tool) mutated the per-workspace tasks store. Fan the new
    // snapshot to any board bound to this (workspace, list) — docked + popout.
    // A null snapshot means the list was deleted, so `fanTasksChanged` disposes
    // the bound board instead of freezing at a stale last value. Shared with the
    // Phase 3 dashboard write path (main/tasks-db.ts).
    fanTasksChanged({
      workspaceKey: String(msg.workspaceKey ?? '').trim(),
      listId: String(msg.listId ?? '').trim(),
      snapshot: msg.snapshot,
    })
    return
  }
    if (msg.type === 'sylo-tasks:open-on-canvas') {
    // Agent asked to surface `listId` on the live Canvas. Per-workspace model:
    // dispose only THIS workspace's previous board (other workspaces' boards
    // stay alive for restore-on-return), create a new `task-board` live
    // subscription seeded with the snapshot, bind it under this workspace, and
    // tell the docked canvas to show it. The show carries `workspaceKey` so the
    // renderer can ignore it if the operator has switched away to a different
    // workspace (the board stays registered and is picked up on return).
    const wk = String(msg.workspaceKey ?? '').trim()
    const lid = String(msg.listId ?? '').trim()
    const snapshot = msg.snapshot
    if (!wk || !lid || snapshot == null) return
    const prev = getBoardForWorkspace(wk)
    if (prev) {
      disposeLive(prev.liveId)
      removeBoardByLiveId(prev.liveId)
    }
    const snap = snapshot as { list?: { title?: string } }
    const title = snap?.list?.title
    const sub = createLiveSubscription({
      kind: 'task-board',
      title,
      data: snapshot,
    })
    setActiveTaskBoard(sub.liveId, wk, lid)
    persistBoardBinding(wk, lid, title)
    mainWindow?.webContents.send('canvas:live-show', {
      liveId: sub.liveId,
      kind: sub.kind,
      title: sub.title,
      data: sub.data,
      workspaceKey: wk,
    })
    return
  }
  if (msg.type === 'sylo_subagent') {
    const convId = msg.turnId ? pendingTurns.get(msg.turnId)?.convId : undefined
    if (convId) {
      handleSubagentHostEvent(convId, msg.event as SyloSubagentHostEvent)
    }
    mainWindow?.webContents.send('subagents:lifecycle', {
      conversationId: convId ?? null,
      turnId: msg.turnId,
      ...(msg.event as Record<string, unknown>),
    })
    return
  }
  if (msg.type === 'sylo_web_access') {
    const convId = msg.turnId ? pendingTurns.get(msg.turnId)?.convId : undefined
    handleWebAccessHostEvent(
      convId ?? null,
      msg.turnId ?? null,
      msg.event as SyloWebAccessEvent,
      app.getPath('userData'),
    )
    mainWindow?.webContents.send('webaccess:lifecycle', {
      conversationId: convId ?? null,
      turnId: msg.turnId,
      ...(msg.event as Record<string, unknown>),
    })
    return
  }
  if (msg.type === 'sylo_think_tank') {
    const pending = msg.turnId ? pendingTurns.get(msg.turnId) : undefined
    const convId = pending?.convId
    const rawEvent = msg.event as SyloThinkTankEvent
    const event: SyloThinkTankEvent =
      rawEvent.type === 'session_start' ?
        {
          ...rawEvent,
          sourceConversationId: rawEvent.sourceConversationId ?? convId,
          sourceMessageId: rawEvent.sourceMessageId ?? pending?.assistantId,
        }
      : rawEvent
    handleThinkTankHostEvent(convId ?? null, event)
    mainWindow?.webContents.send('thinkTank:lifecycle', {
      conversationId: convId ?? null,
      turnId: msg.turnId,
      ...(event as Record<string, unknown>),
    })
    return
  }
  if (msg.type === 'sylo_think_tank_rpc') {
    const convId = msg.turnId ? pendingTurns.get(msg.turnId)?.convId : undefined
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : ''
    const replyBroker = ctx.isPrimary ? broker : ctx.overflowSlot?.supervisor
    void (async () => {
      try {
        const result = await handleThinkTankRpc(msg as Record<string, unknown>, app.getPath('userData'))
        if (msg.op === 'pick' && typeof msg.sessionId === 'string' && typeof msg.reportId === 'string') {
          mainWindow?.webContents.send('thinkTank:lifecycle', {
            conversationId: convId ?? null,
            turnId: msg.turnId,
            type: 'complete',
            sessionId: msg.sessionId,
            selectedReportId: msg.reportId,
          })
        }
        replyBroker?.sendChildMessage({
          type: 'sylo_think_tank_rpc_result',
          requestId,
          ok: true,
          result,
        })
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        replyBroker?.sendChildMessage({
          type: 'sylo_think_tank_rpc_result',
          requestId,
          ok: false,
          error,
        })
      }
    })()
    return
  }
  if (msg.type === 'sylo_schedule_rpc') {
    const convId = msg.turnId ? pendingTurns.get(msg.turnId)?.convId : undefined
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : ''
    const replyBroker = ctx.isPrimary ? broker : ctx.overflowSlot?.supervisor
    void (async () => {
      try {
        if (!convId) throw new Error('no_active_conversation')
        const op = typeof msg.op === 'string' ? msg.op : ''
        let rpcReq: ScheduleRpcRequest
        if (op === 'list') {
          rpcReq = { op: 'list', conversationId: convId }
        } else if (op === 'create') {
          rpcReq = {
            op: 'create',
            conversationId: convId,
            title: typeof msg.title === 'string' ? msg.title : undefined,
            prompt_text: typeof msg.prompt_text === 'string' ? msg.prompt_text : '',
            recurrence: typeof msg.recurrence === 'string' ? msg.recurrence : 'once',
            start_at: typeof msg.start_at === 'number' ? msg.start_at : Date.now(),
            time_local: typeof msg.time_local === 'string' ? msg.time_local : undefined,
            day_of_week: typeof msg.day_of_week === 'number' ? msg.day_of_week : undefined,
            day_of_month: typeof msg.day_of_month === 'number' ? msg.day_of_month : undefined,
            max_runs: msg.max_runs === null ? null : typeof msg.max_runs === 'number' ? msg.max_runs : undefined,
            catchup_on_startup:
              typeof msg.catchup_on_startup === 'boolean' ? msg.catchup_on_startup : undefined,
          }
        } else if (op === 'update') {
          rpcReq = {
            op: 'update',
            conversationId: convId,
            id: typeof msg.id === 'string' ? msg.id : '',
            patch: msg.patch && typeof msg.patch === 'object' ? (msg.patch as Record<string, unknown>) : {},
          }
        } else if (op === 'delete') {
          rpcReq = {
            op: 'delete',
            conversationId: convId,
            id: typeof msg.id === 'string' ? msg.id : '',
          }
        } else {
          throw new Error('unknown_schedule_op')
        }
        const result = handleScheduleRpc(rpcReq)
        replyBroker?.sendChildMessage({
          type: 'sylo_schedule_rpc_result',
          requestId,
          ok: true,
          result,
        })
        const workspaceId = db.getConversation(convId)?.workspace_id
        if (workspaceId) {
          mainWindow?.webContents.send('schedules:changed', { workspaceId })
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        replyBroker?.sendChildMessage({
          type: 'sylo_schedule_rpc_result',
          requestId,
          ok: false,
          error,
        })
      }
    })()
    return
  }
  if (msg.type === 'init_error') {
    if (ctx.isPrimary) {
      brokerAgentReady = false
      brokerResolvedModel = null
      const logs = broker?.peekLogs().trimEnd() ?? ''
      brokerLastCapturedLogs = logs || brokerLastCapturedLogs
      brokerLastSurfaceError =
        logs.length > 0 ?
          `${msg.error}\n\n--- broker output ---\n${logs.slice(-6000)}`
        : msg.error
      console.error('[sylo broker] init_error:', msg.error)
      if (logs) console.error('[sylo broker] output:\n', logs)
      const initErrorPayload = {
        status: 'init_error',
        error: msg.error,
        resolvedModel: null,
      }
      mainWindow?.webContents.send('broker:status', initErrorPayload)
      emitCompanionBrokerStatus(initErrorPayload)
    } else if (ctx.overflowSlot) {
      turnBrokerPool.markOverflowFailed(ctx.overflowSlot)
      console.error('[sylo overflow broker] init_error:', msg.error)
    }
    return
  }
  if (msg.type === 'ready') {
    if (ctx.isPrimary) {
      brokerAgentReady = true
      brokerLastSurfaceError = undefined
      brokerResolvedModel = msg.resolvedModel ?? null
      const readyPayload = {
        status: 'ready',
        resolvedModel: brokerResolvedModel,
      }
      mainWindow?.webContents.send('broker:status', readyPayload)
      emitCompanionBrokerStatus(readyPayload)
      notifyBrokerReadyForSchedules()
    } else if (ctx.overflowSlot) {
      turnBrokerPool.markOverflowReady(ctx.overflowSlot)
    }
    return
  }
    if (msg.type === 'model_resolved') {
    if (ctx.isPrimary) {
      brokerResolvedModel = msg.resolvedModel ?? null
      const payload = { status: 'ready', resolvedModel: brokerResolvedModel }
      mainWindow?.webContents.send('broker:status', payload)
      emitCompanionBrokerStatus(payload)
    }
    return
  }
  if (msg.type === 'system_prompt_stats') {
    if (ctx.isPrimary) {
      brokerSystemPromptStats = msg.stats
      mainWindow?.webContents.send('broker:system-prompt-stats', msg.stats)
    }
    return
  }
  if (msg.type === 'context_window_stats') {
    if (ctx.isPrimary) {
      brokerActualMessageTokens = msg.actualMessageTokens
      mainWindow?.webContents.send('broker:context-window-stats', msg.actualMessageTokens)
    }
    return
  }
  if (msg.type === 'extension_notify') {
    const pending = msg.turnId ? pendingTurns.get(msg.turnId) : undefined
    if (pending) {
      const notifyType = msg.notifyType ?? 'info'
      if (
        extensionNotifyVisibleInChat(
          msg.message,
          notifyType,
          pending.slashCommand === true,
        )
      ) {
        appendExtensionCommandOutput(
          pending,
          formatExtensionCommandLine(msg.message, notifyType),
        )
      }
    }
    return
  }
  if (msg.type === 'extension_error') {
    const pending = msg.turnId ? pendingTurns.get(msg.turnId) : undefined
    if (pending) {
      const detail = msg.event ? `${msg.extensionPath} (${msg.event}): ${msg.error}` : `${msg.extensionPath}: ${msg.error}`
      appendExtensionCommandOutput(pending, formatExtensionCommandLine(detail, 'error'))
    } else {
      console.error('[sylo broker] extension_error:', msg.extensionPath, msg.error)
    }
    return
  }
  if (msg.type === 'error') {
    mainWindow?.webContents.send('broker:error', msg)
    emitCompanionBrokerError({ ...msg })
    const pending = msg.turnId ? pendingTurns.get(msg.turnId) : undefined
    if (pending && msg.turnId) {
      // Flush buffered tool telemetry + cancel pending timers before final write.
      flushPendingTurnBuffers(pending)
      db.updateMessageContent(
        pending.assistantId,
        pending.chunks || `(error) ${msg.error}`,
        'failed',
      )
      pendingTurns.delete(msg.turnId)
      turnBrokerPool.releaseTurn(msg.turnId, broker)
      emitChatRefresh(pending.convId, 'turnFinished')
      void flushDeferredTurns()
    }
    return
  }
  if (msg.type === 'done' && msg.turnId) {
    const pending = pendingTurns.get(msg.turnId)
    if (pending) {
      // Flush buffered tool telemetry + cancel pending timers before final write.
      // Content is written explicitly below with the final status.
      flushPendingTurnBuffers(pending)
      if (!pending.aborted) {
        if (pending.slashCommand && !pending.chunks.trim()) {
          pending.chunks =
            pending.commandLines.length > 0
              ? pending.commandLines.join('\n\n')
              : '_Command completed with no output._'
        }
        const finalText = pending.chunks.trim()
        if (!finalText) {
          db.updateMessageContent(
            pending.assistantId,
            '_(The model completed without producing any text output. This can happen with non-streamed responses or after an auto-retry. Try sending the message again, or use Developer → Restart broker if it persists.)_',
            'failed',
          )
        } else {
          db.updateMessageContent(pending.assistantId, pending.chunks, 'complete')
        }
      }
      const notify = notifyOnDoneByConv.get(pending.convId)
      if (notify) {
        notifyOnDoneByConv.delete(pending.convId)
        if (!pending.aborted) void publishScheduledTurnNotification(notify, pending.chunks)
      }
      pendingTurns.delete(msg.turnId)
      turnBrokerPool.releaseTurn(msg.turnId, broker)
      emitChatRefresh(pending.convId, 'turnFinished')
      void flushDeferredTurns()
    }
    return
  }
  if (msg.type === 'event' && msg.turnId) {
    const pending = pendingTurns.get(msg.turnId)
    if (!pending) return
    const ev = msg.event
    if (ev.type === 'text_delta' && 'delta' in ev) {
      let delta = ev.delta
      if (pending.pendingParagraphBreak && pending.chunks.length > 0) {
        const tail = pending.chunks
        if (!tail.endsWith('\n\n')) {
          delta = (tail.endsWith('\n') ? '\n' : '\n\n') + delta
        }
      }
      pending.pendingParagraphBreak = false
      pending.chunks += delta
      // Throttled SQLite write: buffer the content and flush at most every
      // CONTENT_FLUSH_MS. Without this, every text_delta (100–200+/s) writes
      // the full accumulated text synchronously, blocking the event loop and
      // causing IPC backlog → UI lag + "flood" on interrupt.
      pending.contentDirty = true
      scheduleContentFlush(pending)
      const streamPayload = {
        conversationId: pending.convId,
        messageId: pending.assistantId,
        delta,
      }
      mainWindow?.webContents.send('chat:stream', streamPayload)
      emitCompanionEvent({ channel: 'chat:stream', payload: streamPayload })
    } else {
      const ts = Date.now()
      const evWithImages = persistToolResultImages(
        app.getPath('userData'),
        pending.convId,
        {
          ...(ev as Record<string, unknown>),
          _textOffset: pending.chunks.length,
        },
      )
      const evWithOffset = persistToolResultAudio(
        app.getPath('userData'),
        pending.convId,
        evWithImages,
      ) as Record<string, unknown>
      // Buffered tool telemetry: push to in-memory buffer and batch-flush at
      // most every TOOL_FLUSH_MS. appendToolCallsJson is O(n²) (SELECT + parse +
      // stringify + UPDATE of the entire growing blob); batching collapses many
      // appends into one.
      pending.toolEventsBuffer.push({ ts, event: evWithOffset })
      scheduleToolFlush(pending)
      if (ev.type === 'tool_execution_start' || ev.type === 'tool_execution_end') {
        pending.pendingParagraphBreak = true
      }
      const toolPayload = {
        conversationId: pending.convId,
        messageId: pending.assistantId,
        event: evWithOffset,
        ts,
      }
      mainWindow?.webContents.send('chat:tool', toolPayload)
      emitCompanionEvent({ channel: 'chat:tool', payload: toolPayload })
      if (ev.type === 'compaction_end') {
        persistCompactionChatNotice(pending.convId, ev as Record<string, unknown>)
      }
    }
  }
}

function buildBrokerSupervisorOptions(
  initialBind: ReturnType<typeof sessionBindingForConversation>,
  cwd: string,
  handlers: {
    onMessage: (msg: BrokerOutMessage) => void
    onExit: (code: number | null, signal: NodeJS.Signals | null, capturedLogs: string) => void
  },
  /** Conversation id to resolve the effective (per-chat ?? global) model. */
  convId?: string,
): ConstructorParameters<typeof BrokerSupervisor>[0] {
  const agentDir = hostAgentDir()
    const eff = convId ? effectiveModelForConversation(convId) : {
    provider: (db.getPref('sylo.model_provider', SYLO_DEFAULT_MODEL_PROVIDER) as string).trim(),
    modelId: (db.getPref('sylo.model_id', SYLO_DEFAULT_MODEL_ID) as string).trim(),
    imageModelId: (db.getPref('sylo.image_model_id', '') as string).trim(),
    imageModelProvider: (db.getPref('sylo.image_model_provider', 'ollama') as string).trim(),
    thinkingLevel: null,
  }
  const modelId = eff.modelId
  const modelProvider = eff.provider
  return {
    hostPackageRoot: join(__dirname, '../..'),
    syloDbPath: db.dbPath(app.getPath('userData')),
    personalDataDir: db.personalDataDirOverride() ?? undefined,
    personalDataRoot: db.personalDataRoot(),
    nodePath: WORKSPACE_NODE_MODULES,
    cwd,
    agentDir,
    initialSessionPath: initialBind.sessionAbs,
    initialSessionCwd: initialBind.sessionCwd,
        modelProvider,
    modelId,
    disabledSkillPaths: initialBind.mergedDisabled.skillPaths,
    disabledExtensionPaths: initialBind.mergedDisabled.extensionPaths,
    disabledTools: initialBind.mergedDisabled.disabledTools,
    includeCursorSkills: readIncludeCursorSkillsPref(),
    piBuiltinTools: readPiBuiltinToolsPref(),
    chatOnly: db.getPref('sylo.chat_only', false) as boolean,
    builtinToolsGuardExtension:
      existsSync(SYLO_BUILTIN_TOOLS_GUARD_EXTENSION) ? SYLO_BUILTIN_TOOLS_GUARD_EXTENSION : undefined,
    imageFallbackExtension:
      existsSync(SYLO_IMAGE_FALLBACK_EXTENSION) ? SYLO_IMAGE_FALLBACK_EXTENSION : undefined,
    skillSurfaceExtension: existsSync(SYLO_SKILL_SURFACE_EXTENSION) ? SYLO_SKILL_SURFACE_EXTENSION : undefined,
    subagentsExtension: existsSync(SYLO_SUBAGENTS_EXTENSION) ? SYLO_SUBAGENTS_EXTENSION : undefined,
    schedulerExtension: existsSync(SYLO_SCHEDULER_EXTENSION) ? SYLO_SCHEDULER_EXTENSION : undefined,
    optionalExtensionPaths: enabledOptionalExtensionPaths(
      SYLO_REPO_ROOT,
      readSyloOptionalPackagesPref(),
    ),
    webAccessConfigPath: webAccessConfigEnvPath(
      app.getPath('userData'),
      readSyloOptionalPackagesPref(),
      findSyloOptionalPackage('sylo-web-access'),
    ),
    ttsConfigPath: ttsConfigEnvPath(
      app.getPath('userData'),
      readSyloOptionalPackagesPref(),
      findSyloOptionalPackage('sylo-tts'),
    ),
    thinkTankConfigPath: thinkTankConfigEnvPath(
      app.getPath('userData'),
      readSyloOptionalPackagesPref(),
      findSyloOptionalPackage('sylo-think-tank'),
    ),
    imageModelId: eff.imageModelId || undefined,
    imageModelProvider: eff.imageModelProvider || undefined,
    ollamaBaseOrigin: resolveOllamaBaseOriginForPrefs(),
    onMessage: handlers.onMessage,
    onExit: handlers.onExit,
  }
}

let overflowBrokerSpawnGeneration = 0

async function spawnOverflowBroker(
  conversationId: string,
): Promise<BrokerSupervisor | null> {
  const bind = sessionBindingForConversation(conversationId)
  overflowBrokerSpawnGeneration++
  const spawnGen = overflowBrokerSpawnGeneration
  const slot: OverflowBrokerSlot = {
    supervisor: undefined as unknown as BrokerSupervisor,
    ready: false,
    spawnGeneration: spawnGen,
    readyWaiters: [],
  }
  const supervisor = new BrokerSupervisor(
    buildBrokerSupervisorOptions(bind, bind.sessionCwd, {
      onMessage: (msg) =>
        handleBrokerOutMessage(msg, {
          spawnGeneration: spawnGen,
          isPrimary: false,
          overflowSlot: slot,
          isStale: () => spawnGen !== slot.spawnGeneration,
        }),
      onExit: (code, signal, capturedLogs) => {
        if (spawnGen !== slot.spawnGeneration) return
        turnBrokerPool.markOverflowFailed(slot)
        if (typeof code === 'number' && code !== 0 && capturedLogs.trim()) {
          console.error('[sylo overflow broker] exit', code, signal, '\n', capturedLogs)
        }
      },
    }, conversationId),
  )
  slot.supervisor = supervisor
  turnBrokerPool.overflowBrokers.push(slot)
  supervisor.spawn()
  const ready = await turnBrokerPool.waitOverflowReady(slot)
  if (!ready) {
    supervisor.kill()
    const idx = turnBrokerPool.overflowBrokers.indexOf(slot)
    if (idx >= 0) turnBrokerPool.overflowBrokers.splice(idx, 1)
    return null
  }
  return supervisor
}

async function acquireBrokerForTurn(conversationId: string): Promise<BrokerSupervisor | null> {
  if (broker && brokerAgentReady && !turnBrokerPool.isSupervisorBusy(broker, hasPendingTurn)) {
    return broker
  }
  if (!concurrentTurnsEnabled()) {
    return null
  }
  const idleOverflow = turnBrokerPool.findIdleOverflow(hasPendingTurn)
  if (idleOverflow) return idleOverflow
  if (pendingTurns.size >= maxConcurrentTurns()) {
    return null
  }
  return spawnOverflowBroker(conversationId)
}

function registerBroker(): void {
  turnBrokerPool.killAllOverflow()
  broker?.kill()
  brokerSpawnGeneration++
  const spawnGen = brokerSpawnGeneration
  brokerAgentReady = false
  brokerLastSurfaceError = undefined
  brokerLastCapturedLogs = ''
  brokerResolvedModel = null
  brokerLastDisabledFp = undefined
  const startingPayload = { status: 'starting', resolvedModel: null }
  mainWindow?.webContents.send('broker:status', startingPayload)
  emitCompanionBrokerStatus(startingPayload)

    const initialConvId = getInitialBrokerConversationId()
  let focusConvId = initialConvId
  let initialBind: ReturnType<typeof sessionBindingForConversation>
  try {
    initialBind = sessionBindingForConversation(focusConvId)
  } catch {
    focusConvId = db.createConversation('Chat').id
    initialBind = sessionBindingForConversation(focusConvId)
  }
  // Primary broker's SYLO_PI_CWD must follow the initially-focused conversation's
  // workspace, not always the Default workspace. Otherwise per-workspace Sylo
  // extensions (sylo-tasks, sylo-workflows) pin to Default for
  // every primary-broker conversation. Matches the overflow-broker spawn
  // (buildBrokerSupervisorOptions(bind, bind.sessionCwd, …)).
  const piCwd = initialBind.sessionCwd
  brokerFocusedConversationId = focusConvId
  brokerLastSessionAbs = initialBind.sessionAbs
  brokerLastSessionCwd = initialBind.sessionCwd
  brokerLastDisabledFp = disabledFingerprint(initialBind.mergedDisabled)
  brokerLastModelFp = modelFingerprint(effectiveModelForConversation(focusConvId))

  broker = new BrokerSupervisor(
    buildBrokerSupervisorOptions(initialBind, piCwd, {
      onMessage: (msg) =>
        handleBrokerOutMessage(msg, {
          spawnGeneration: spawnGen,
          isPrimary: true,
          isStale: () => spawnGen !== brokerSpawnGeneration,
        }),
      onExit: (code, signal, capturedLogs) => {
        if (spawnGen !== brokerSpawnGeneration) return
        onBrokerExitOrphanTasks()
        const wasReady = brokerAgentReady
        brokerAgentReady = false
        brokerResolvedModel = null
        brokerLastCapturedLogs = capturedLogs
        if (!wasReady && brokerLastSurfaceError === undefined) {
          const tail = capturedLogs.trimEnd().slice(-6000)
          const exitHint =
            typeof code === 'number' && signal ?
              `Broker exited before ready (code ${code}, signal ${signal}).`
            : typeof code === 'number' ?
              `Broker exited before ready (code ${code}).`
            : signal ?
              `Broker exited before ready (signal ${signal}).`
            : 'Broker exited before ready.'
          brokerLastSurfaceError =
            tail.length > 0 ? `${exitHint}\n\n--- broker output ---\n${tail}` : `${exitHint} Look below if stderr captured nothing yet — use Developer → Restart broker after rebuilding (\`broker.mjs\`).`
        }
        if (typeof code === 'number' && code !== 0 && capturedLogs.trim()) {
          console.error('[sylo broker] exit', code, signal, '\n', capturedLogs)
        }
        const exitPayload = {
          status: 'exit',
          code,
          signal,
          resolvedModel: null,
        }
        mainWindow?.webContents.send('broker:status', exitPayload)
        emitCompanionBrokerStatus(exitPayload)
        setTimeout(() => {
          if (db.getPref('sylo.safe_mode', false)) return
          if (!wasReady) return
          registerBroker()
        }, 1500)
      },
    }, focusConvId),
  )
  broker.spawn()
}

/** One filesystem segment under Sylo Pi cwd for a new chat folder (display name may differ). */
function safeChatFolderDirSegment(name: string): string {
  let s = name
    .trim()
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || s === '.' || s === '..') s = 'folder'
  return s.slice(0, 120)
}

/** Truncate final assistant text to a couple sentences for the phone notification body. */
function summarizeForNotify(text: string, maxChars = 280): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (!clean) return ''
  if (clean.length <= maxChars) return clean
  const slice = clean.slice(0, maxChars)
  const lastStop = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  )
  const cut = lastStop > maxChars * 0.5 ? slice.slice(0, lastStop + 1) : slice.replace(/\s+\S*$/, '')
  return `${cut}…`
}

/** Publish a compact turn-done notification to the phone (sylo-notify). Fire-and-forget. */
async function publishScheduledTurnNotification(
  notify: { workspaceId: string | null; title: string },
  finalText: string,
): Promise<void> {
  if (!isNtfyConfigured()) return
  const workspaceName =
    (notify.workspaceId ? db.getWorkspace(notify.workspaceId)?.name : undefined) ?? 'Sylo'
  const summary = summarizeForNotify(finalText)
  const body = summary
    ? `Workspace: ${workspaceName}\n${summary}`
    : `Workspace: ${workspaceName}\n_(finished with no output)_`
  await publishNtfyNotification(notify.title, body)
}

async function fireScheduledPromptFromHost(
  schedule: ScheduledPromptRow,
): Promise<{ conversationId: string; status: 'started' | 'failed' | 'broker_unavailable' }> {
  const title = schedule.title.trim() || 'Scheduled prompt'
  const conv = db.createConversation(title, schedule.workspace_id)
  const markNotify = () =>
    notifyOnDoneByConv.set(conv.id, { workspaceId: schedule.workspace_id ?? null, title })
  if (!brokerAgentReady || !broker || db.getPref('sylo.safe_mode', false)) {
    const started = await startChatTurn(conv.id, schedule.prompt_text)
    if (started.ok) markNotify()
    return { conversationId: conv.id, status: 'broker_unavailable' }
  }
  const started = await startChatTurn(conv.id, schedule.prompt_text)
  if (started.ok) markNotify()
  return {
    conversationId: conv.id,
    status: started.ok ? 'started' : 'failed',
  }
}

function readScheduledPromptInput(raw: unknown): ScheduledPromptInput {
  if (!raw || typeof raw !== 'object') throw new Error('invalid_input')
  const o = raw as Record<string, unknown>
  if (typeof o.prompt_text !== 'string' || !o.prompt_text.trim()) throw new Error('missing_prompt_text')
  if (typeof o.recurrence !== 'string') throw new Error('invalid_recurrence')
  if (typeof o.start_at !== 'number' || !Number.isFinite(o.start_at)) throw new Error('invalid_start_at')
  return {
    title: typeof o.title === 'string' ? o.title : undefined,
    prompt_text: o.prompt_text,
    recurrence: normalizeRecurrenceValue(o.recurrence),
    start_at: o.start_at,
    time_local: typeof o.time_local === 'string' ? o.time_local : undefined,
    day_of_week: typeof o.day_of_week === 'number' ? o.day_of_week : undefined,
    day_of_month: typeof o.day_of_month === 'number' ? o.day_of_month : undefined,
    max_runs: o.max_runs === null ? null : typeof o.max_runs === 'number' ? o.max_runs : undefined,
    catchup_on_startup: typeof o.catchup_on_startup === 'boolean' ? o.catchup_on_startup : undefined,
    enabled: typeof o.enabled === 'boolean' ? o.enabled : undefined,
  }
}

function readScheduledPromptPatch(raw: unknown): ScheduledPromptPatch {
  if (!raw || typeof raw !== 'object') throw new Error('invalid_patch')
  const o = raw as Record<string, unknown>
  const patch: ScheduledPromptPatch = {}
  if (typeof o.title === 'string') patch.title = o.title
  if (typeof o.prompt_text === 'string') patch.prompt_text = o.prompt_text
  if (typeof o.recurrence === 'string') patch.recurrence = normalizeRecurrenceValue(o.recurrence)
  if (typeof o.start_at === 'number') patch.start_at = o.start_at
  if (typeof o.time_local === 'string') patch.time_local = o.time_local
  if (typeof o.day_of_week === 'number') patch.day_of_week = o.day_of_week
  if (typeof o.day_of_month === 'number') patch.day_of_month = o.day_of_month
  if (o.max_runs === null) patch.max_runs = null
  else if (typeof o.max_runs === 'number') patch.max_runs = o.max_runs
  if (typeof o.catchup_on_startup === 'boolean') patch.catchup_on_startup = o.catchup_on_startup
  if (typeof o.enabled === 'boolean') patch.enabled = o.enabled
  return patch
}

function registerIpc(): void {
  setCompanionHostApi({
    listWorkspaces: () => db.listWorkspaces(),
    getActiveWorkspaceId: () => {
      const pref = String(db.getPref('sylo.ui.active_workspace_id', '') || '').trim()
      const workspaces = db.listWorkspaces()
      if (pref && workspaces.some((w) => w.id === pref)) return pref
      return workspaces[0]?.id ?? db.defaultWorkspaceId()
    },
    setActiveWorkspaceId: (workspaceId: string) => {
      const wid = workspaceId.trim()
      if (!wid) throw new Error('missing_workspace_id')
      if (!db.listWorkspaces().some((w) => w.id === wid)) throw new Error('workspace_not_found')
      db.setPref('sylo.ui.active_workspace_id', wid)
    },
    listConversations: (workspaceId: string) => db.listConversations(workspaceId),
    findLatestEmptyConversation: (workspaceId: string) =>
      db.findLatestEmptyConversationId(workspaceId),
    createConversation: (title?: string, workspaceId?: string) =>
      db.createConversation(title ?? '', workspaceId),
    listMessages: (conversationId: string) => db.listMessages(conversationId),
    setConversationTitle: (id, title) => {
      const cid = id.trim()
      const t = title.trim()
      if (!cid) return
      db.updateConversationTitle(cid, t)
      emitChatRefresh(cid, 'conversationRenamed')
    },
    setConversationModel: (id, model) => {
      const cid = id.trim()
      if (!cid) return { ok: false as const, error: 'missing_conversation_id' }
      const norm = (v: unknown): string | null => {
        if (v === null || v === undefined) return null
        const s = typeof v === 'string' ? v.trim() : ''
        return s === '' ? null : s
      }
            db.setConversationModel(cid, {
        model_provider: norm(model.model_provider),
        model_id: norm(model.model_id),
        image_model_id: norm(model.image_model_id),
        image_model_provider: norm(model.image_model_provider),
        thinking_level: norm(model.thinking_level),
      })
      // Apply to the broker now if this is the focused conversation and it's idle.
      void ensureBrokerSessionForConversation(cid, { phase: 'ui-focus' }).catch(() => {
        /* broker not ready — persisted; applies on next focus/turn */
      })
      return { ok: true as const }
    },
    listModels: async () => {
      const agentDir = hostAgentDir()
      const origin = resolveOllamaBaseOriginForPrefs()
      const tags = await fetchOllamaTagNames(origin)
      const ollamaModels = (tags.ok ? tags.models : []).map((id) => ({
        id,
        visionCapable: readModelInputConfig(agentDir, 'ollama', id).input.includes('image'),
      }))
      return {
        global: {
          provider: (db.getPref('sylo.model_provider', SYLO_DEFAULT_MODEL_PROVIDER) as string).trim(),
          modelId: (db.getPref('sylo.model_id', SYLO_DEFAULT_MODEL_ID) as string).trim(),
          imageModelId: (db.getPref('sylo.image_model_id', '') as string).trim(),
          imageModelProvider: (db.getPref('sylo.image_model_provider', 'ollama') as string).trim(),
        },
        ollamaOrigin: origin,
        providers: ['ollama', 'openai', 'anthropic', 'groq', 'openrouter'],
        ollamaModels,
      }
    },
    deleteConversation: (id) => {
      const cid = id.trim()
      if (!cid) return false
      // Abort any in-flight turn for this conversation before removing it.
      const active = findPendingTurnForConversation(cid)
      if (active) {
        const [turnId, pending] = active
        pending.aborted = true
        const assigned = turnBrokerPool.supervisorForTurn(turnId) ?? broker
        finalizePendingTurn(turnId, pending, 'cancelled')
                assigned?.abort()
        void flushDeferredTurns()
      }
      const removed = fullyRemoveConversation(app.getPath('userData'), hostAgentDir(), cid)
      if (removed) emitChatRefresh(cid, 'conversationDeleted')
      return removed
    },
    listRunningConversationIds: () => {
      const ids = new Set<string>()
      for (const pending of pendingTurns.values()) ids.add(pending.convId)
      return [...ids]
    },
    sendChat: async (conversationId, text, attachments) => {
      const id = conversationId.trim()
      const body = text.trim()
      const norm = normalizeAttachments(attachments)
      if (!id) return { assistantMessageId: '', error: 'missing_conversation_id' }
      if (!body && norm.length === 0) return { assistantMessageId: '', error: 'empty_message' }
      return chainConversationChatOp(id, async () => {
        const started = await startChatTurn(id, body, norm.length > 0 ? norm : undefined)
        if (!started.ok) {
          return { assistantMessageId: started.assistantMessageId, error: started.error }
        }
        if (started.deferred) {
          return { assistantMessageId: started.assistantMessageId, deferred: true }
        }
        return { assistantMessageId: started.assistantMessageId }
      })
    },
    abortChat: async (conversationId) => {
      const id = conversationId.trim()
      if (!id) return { ok: false, error: 'missing_conversation_id' }
      if (!brokerAgentReady || !broker) return { ok: false, error: 'broker_not_ready' }
      const active = findPendingTurnForConversation(id)
      if (!active) return { ok: false, error: 'no_active_turn' }
      const [turnId, pending] = active
      pending.aborted = true
      const assigned = turnBrokerPool.supervisorForTurn(turnId) ?? broker
      finalizePendingTurn(turnId, pending, 'cancelled')
      assigned?.abort()
      void flushDeferredTurns()
      return { ok: true }
    },
    steerChat: async (conversationId, text, attachments) => {
      const id = conversationId.trim()
      const body = text.trim()
      if (!id) return { ok: false, error: 'missing_conversation_id' }
      if (!body) return { ok: false, error: 'empty_message' }
      if (!brokerAgentReady || !broker || db.getPref('sylo.safe_mode', false)) {
        return { ok: false, error: 'broker_not_ready' }
      }
      const normAttachments = normalizeAttachments(attachments)
      return chainConversationChatOp(id, async () => {
        const active = findPendingTurnForConversation(id)
        if (!active) {
          finalizeOrphanStreamingAssistants(id)
          const started = await startChatTurn(id, body, normAttachments)
          return started.ok ? { ok: true } : { ok: false, error: started.error }
        }
        const followUp = await followUpActiveTurn(id, body, normAttachments, { steer: true })
        return followUp.ok ? { ok: true } : { ok: false, error: followUp.error }
      })
    },
    deliverQueuedChat: async (conversationId, text, attachments) => {
      const id = conversationId.trim()
      const body = text.trim()
      if (!id) return { ok: false, error: 'missing_conversation_id' }
      if (!body) return { ok: false, error: 'empty_message' }
      return chainConversationChatOp(id, () =>
        deliverQueuedMessage(id, body, normalizeAttachments(attachments)),
      )
    },
    getBrokerStatus: () => ({
      ready: brokerAgentReady,
      safeMode: Boolean(db.getPref('sylo.safe_mode', false)),
      initError: brokerLastSurfaceError ?? null,
    }),
    defaultWorkspaceId: () => db.defaultWorkspaceId(),
    personalRpc: async (op: string, payload: unknown) => {
      // Personal bundle (sylo-tools-personal) dispatch — absent bundle →
      // 'personal_plugin_unavailable' (companion maps that to HTTP 501).
      const { personalPluginRpc } = await import('./personal-plugin.js')
      return personalPluginRpc(op, payload)
    },
    personalManifest: async () => {
      const { personalPluginCompanionManifest } = await import('./personal-plugin.js')
      return personalPluginCompanionManifest()
    },
  })

  // Phone personal-app root is registered by the personal bundle itself
  // (createPersonalPlugin → di.setPersonalAppRoot) — no domain path here.

  ipcMain.handle(
    'conversations:list',
    (_e, workspaceId?: string) =>
      workspaceId === undefined ? db.listConversations() : db.listConversations(workspaceId),
  )
  ipcMain.handle('conversations:create', (_e, title?: string, workspaceId?: string) =>
    db.createConversation(title ?? '', workspaceId),
  )
  ipcMain.handle('conversations:findLatestEmpty', (_e, workspaceId: unknown) => {
    const wid = typeof workspaceId === 'string' ? workspaceId : ''
    const id = db.findLatestEmptyConversationId(wid)
    return Promise.resolve(id ?? null)
  })
  ipcMain.handle('conversations:setWorkspace', (_e, id: string, workspaceId: string) =>
    db.setConversationWorkspace(id, workspaceId),
  )
  ipcMain.handle('conversations:setModel', async (_e, id: unknown, model: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false as const, error: 'missing_id' }
    if (!model || typeof model !== 'object') return { ok: false as const, error: 'bad_model' }
    const m = model as Record<string, unknown>
    const norm = (v: unknown): string | null => {
      if (v === null || v === undefined) return null
      const s = typeof v === 'string' ? v.trim() : ''
      return s === '' ? null : s
    }
        const override: db.ConversationModelOverride = {
      model_provider: norm(m.model_provider),
      model_id: norm(m.model_id),
      image_model_id: norm(m.image_model_id),
      image_model_provider: norm(m.image_model_provider),
      thinking_level: norm(m.thinking_level),
    }
    db.setConversationModel(id, override)
    // Apply to the broker now if this is the focused conversation and it's idle.
    // Mid-turn switches are skipped (Pi extensions capture stale ctx); the next
    // turn picks up the new model via the model fingerprint.
    try {
      await ensureBrokerSessionForConversation(id, { phase: 'ui-focus' })
    } catch {
      /* broker not ready — persisted; applies on next focus/turn */
    }
    return { ok: true as const }
  })
    ipcMain.handle('conversations:getModel', async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return null
    const conv = db.getConversation(id)
    if (!conv) return null
    return {
      // Per-chat override (null = inherit global).
      model_provider: conv.model_provider,
      model_id: conv.model_id,
      image_model_id: conv.image_model_id,
      image_model_provider: conv.image_model_provider,
      thinking_level: conv.thinking_level,
      // Resolved effective model (per-chat ?? global prefs).
      effective: effectiveModelForConversation(id),
    }
  })

  /** Thinking levels Pi supports for a concrete provider/model (empty target → fallback list flag). */
  ipcMain.handle(
    'thinking:levels',
    async (_e, provider: unknown, modelId: unknown) => {
      if (typeof provider !== 'string' || typeof modelId !== 'string') {
        return { ok: false as const, error: 'bad_args' }
      }
      const sup = broker
      if (!sup) return { ok: false as const, error: 'broker_not_running' }
      try {
        const r = await sup.requestThinkingLevels(provider.trim(), modelId.trim())
        return { ok: true as const, levels: r.levels ?? [], resolvedModel: r.resolvedModel }
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )
    ipcMain.handle('workspaces:list', () =>
    db.listWorkspaces().map((w) => ({
      ...w,
      // Boot-time snapshot: true when the folder the primary row points at was
      // missing at startup (renderer shows the create-or-clone prompt). Computed
      // before the resolving call, whose fallback mkdir would mask absence.
      folder_missing: w.id === db.defaultWorkspaceId() ? primaryWorkspaceFolderMissing : false,
      resolved_pi_cwd: effectivePiCwdForWorkspace(w.id),
    })),
  )
  ipcMain.handle('workspaces:devWorkspaceId', () => {
    const row = db.ensureDevWorkspace(SYLO_REPO_ROOT)
    return row?.id ?? null
  })
  ipcMain.handle('workspaces:defaultPathForName', (_e, raw: string) => {
    const nm = typeof raw === 'string' ? raw.trim() : ''
    if (!nm) return ''
    // Prefill as a sibling of the built-in Default workspace, under the shared
    // `<Documents>/GitHub` clone root — flat, siblings of the built-in sylo-user workspace.
    return join(defaultGithubCloneDir(), safeChatFolderDirSegment(nm))
  })
  ipcMain.handle(
    'workspaces:create',
    (_e, name: string, piCwd?: string, opts?: { createPiProjectDir?: boolean }) => {
      const n = typeof name === 'string' ? name.trim() : ''
      if (!n) throw new Error('Workspace name is required')
      const cwd = typeof piCwd === 'string' ? piCwd.trim() : ''
      const ensured = ensurePiProjectDirOnDisk(cwd, opts?.createPiProjectDir ?? false)
      if (!ensured.ok) return ensured
      return { ok: true as const, workspace: db.createWorkspace(n, cwd) }
    },
  )
    ipcMain.handle(
    'workspaces:update',
    (_e, id: string, patch: { name?: string; pi_cwd?: string }, opts?: { createPiProjectDir?: boolean }) => {
      // Universal (primary) workspace: a name change also renames its folder on
      // disk so the user-data workspace (git repo, seeds, AGENTS.md pointer)
      // stays wired to one folder. Only when the path field still points at the
      // current folder (or is empty = inherit) — a hand-edited path wins.
      if (patch.name !== undefined && patch.pi_cwd !== undefined && id === db.defaultWorkspaceId()) {
        const cur = db.resolveSyloUserDir()
        const cwdReq = patch.pi_cwd.trim()
        const pathPointsAtCurrent =
          cwdReq === '' || pathsEqualIgnoreCase(expandPiPath(cwdReq), cur)
        const wantsMove = pathPointsAtCurrent && safeChatFolderDirSegment(patch.name) !== basename(cur)
        if (wantsMove) {
          const moved = renameUniversalWorkspaceFolder(cur, patch.name)
          if (!moved.ok) return moved
          patch = { ...patch, pi_cwd: moved.dir }
          // A move that recreated a missing current folder starts empty: add the
          // seed files (idempotent — a populated folder is untouched), refresh
          // the operator env, and clear the missing-folder prompt state.
          db.ensureDefaultWorkspaceSeedFiles(moved.dir)
          primaryWorkspaceFolderMissing = false
          db.refreshOperatorEnv()
          pruneEmptyStrayCanonical(moved.dir)
        }
      }
      if (patch.pi_cwd !== undefined) {
        const ensured = ensurePiProjectDirOnDisk(patch.pi_cwd, opts?.createPiProjectDir ?? false)
        if (!ensured.ok) return ensured
      }
      db.updateWorkspace(id, patch)
      // Keep the machine pointer block (~/.pi/agent/AGENTS.md) on the live path.
      if (id === db.defaultWorkspaceId() && (patch.name !== undefined || patch.pi_cwd !== undefined)) {
        ensureGlobalAgentsMd()
      }
      return { ok: true as const }
    },
  )
  ipcMain.handle(
    'workspaces:primaryProvision',
    (_e, args?: { name?: unknown }) => {
      const name = typeof args?.name === 'string' ? args.name.trim() : ''
      if (!name) return { ok: false as const, error: 'bad_name', detail: 'Workspace name is required.' }
      const seg = safeChatFolderDirSegment(name)
      if (!seg) return { ok: false as const, error: 'bad_name', detail: 'Invalid workspace name.' }
      const row = db.listWorkspaces()[0]
      if (!row) return { ok: false as const, error: 'bad_workspace', detail: 'No primary workspace row.' }
      const raw = row.pi_cwd?.trim() ?? ''
      if (raw && existsSync(raw)) {
        return {
          ok: false as const,
          error: 'folder_exists',
          detail: 'The workspace folder already exists — reload to use it.',
        }
      }
      // Create fresh at the default clone root under the chosen name (flat,
      // sibling of the other GitHub workspaces).
      const dest = join(defaultGithubCloneDir(), seg)
      if (existsSync(dest) && readdirSync(dest).length > 0) {
        return {
          ok: false as const,
          error: 'dest_not_empty',
          detail: `Target folder already exists and is not empty: ${dest}`,
        }
      }
      try {
        db.ensureDefaultWorkspaceSeedFiles(dest)
      } catch (e) {
        return {
          ok: false as const,
          error: 'mkdir_failed',
          detail: e instanceof Error ? e.message : String(e),
        }
      }
      db.updateWorkspace(row.id, { pi_cwd: dest })
      primaryWorkspaceFolderMissing = false
      pruneEmptyStrayCanonical(dest)
      db.refreshOperatorEnv()
      deployGlobalAgentsFromWorkspace()
      ensureGlobalAgentsMd()
      return { ok: true as const, workspace: db.getWorkspace(row.id) ?? row }
    },
  )
  ipcMain.handle(
    'workspaces:primaryRestoreFromGithub',
    async (_e, args?: { cloneUrl?: unknown }) => {
      const cloneUrl = typeof args?.cloneUrl === 'string' ? args.cloneUrl.trim() : ''
      if (!cloneUrl) return { ok: false as const, error: 'bad_clone_url', detail: 'Clone URL is required.' }
      const row = db.listWorkspaces()[0]
      if (!row) return { ok: false as const, error: 'bad_workspace', detail: 'No primary workspace row.' }
      const raw = row.pi_cwd?.trim() ?? ''
      if (raw && existsSync(raw)) {
        return {
          ok: false as const,
          error: 'folder_exists',
          detail: 'The workspace folder already exists — reload to use it.',
        }
      }
      // Restore in place: clone into the folder the workspace row expects
      // (whatever it was named), falling back to the canonical path.
      const dest = raw || db.canonicalDefaultWorkspacePiProjectPath()
      const token = readGithubToken()
      const cloned = await cloneWorkspaceRepo(cloneUrl, dest, {
        token: token ?? undefined,
        privateRepo: Boolean(token),
      })
      if (!cloned.ok) {
        return { ok: false as const, error: cloned.error, detail: 'detail' in cloned ? cloned.detail : undefined }
      }
      db.updateWorkspace(row.id, { pi_cwd: dest })
      db.updateWorkspaceGithubBackup(row.id, {
        github_remote_url: cloneUrl,
        github_backup_enabled: true,
      })
      const linked = await linkWorkspaceGitRepo(dest, cloneUrl)
      if (linked.ok) db.touchWorkspaceGithubSync(row.id, Date.now())
      // Fill any seed files the repo predates (idempotent, never overwrites).
      db.ensureDefaultWorkspaceSeedFiles(dest)
      primaryWorkspaceFolderMissing = false
      pruneEmptyStrayCanonical(dest)
      db.refreshOperatorEnv()
      deployGlobalAgentsFromWorkspace()
      ensureGlobalAgentsMd()
      return { ok: true as const, workspace: db.getWorkspace(row.id) ?? row }
    },
  )
  ipcMain.handle('workspaces:delete', (_e, id: string) =>
    deleteWorkspaceFully(app.getPath('userData'), hostAgentDir(), id),
  )
  ipcMain.handle(
    'workspaces:disabled:patch',
    (
      _e,
      patch: {
        workspaceId?: unknown
        kind?: unknown
        path?: unknown
        extensionPath?: unknown
        toolName?: unknown
        excluded?: unknown
      },
    ) => {
      const workspaceId = typeof patch?.workspaceId === 'string' ? patch.workspaceId.trim() : ''
      const kind = patch?.kind
      const excluded = patch?.excluded
      if (!workspaceId) return { ok: false as const, error: 'bad_workspace' }
      if (typeof excluded !== 'boolean') {
        return { ok: false as const, error: 'bad_excluded' }
      }
      if (kind === 'tool') {
        const extensionPath = patch?.extensionPath
        const toolName = patch?.toolName
        if (typeof extensionPath !== 'string' || !extensionPath.trim()) {
          return { ok: false as const, error: 'bad_extensionPath' }
        }
        if (typeof toolName !== 'string' || !toolName.trim()) {
          return { ok: false as const, error: 'bad_toolName' }
        }
        const res = db.patchWorkspaceDisabledCapability({
          workspaceId,
          kind: 'tool',
          extensionPath,
          toolName,
          excluded,
        })
        if (!res) return { ok: false as const, error: 'unknown_workspace' }
        return { ok: true as const, disabled: res }
      }
      if (kind !== 'skill' && kind !== 'extension') {
        return { ok: false as const, error: 'bad_kind' }
      }
      const pathRaw = patch?.path
      if (typeof pathRaw !== 'string' || !pathRaw.trim()) {
        return { ok: false as const, error: 'bad_path' }
      }
      const res = db.patchWorkspaceDisabledCapability({
        workspaceId,
        kind,
        path: pathRaw,
        excluded,
      })
      if (!res) return { ok: false as const, error: 'unknown_workspace' }
      return { ok: true as const, disabled: res }
    },
  )

  ipcMain.handle('workspaces:backup:status', async (_e, workspaceId: unknown) => {
    const id = typeof workspaceId === 'string' ? workspaceId.trim() : ''
    if (!id) return { ok: false as const, error: 'bad_workspace' }
    const ws = db.getWorkspace(id)
    if (!ws) return { ok: false as const, error: 'unknown_workspace' }
    const cwd = effectivePiCwdForWorkspace(id)
    const git = await readWorkspaceGitStatus(cwd)
    return {
      ok: true as const,
      cwd,
      github_remote_url: ws.github_remote_url,
      github_backup_enabled: ws.github_backup_enabled === 1,
      github_last_sync_at: ws.github_last_sync_at,
      git,
    }
  })

  ipcMain.handle(
    'workspaces:backup:save',
    async (
      _e,
      workspaceId: unknown,
      patch: { github_remote_url?: unknown; github_backup_enabled?: unknown },
    ) => {
      const id = typeof workspaceId === 'string' ? workspaceId.trim() : ''
      if (!id) return { ok: false as const, error: 'bad_workspace' }
      const ws = db.getWorkspace(id)
      if (!ws) return { ok: false as const, error: 'unknown_workspace' }

      const url = typeof patch?.github_remote_url === 'string' ? patch.github_remote_url.trim() : undefined
      const enabled =
        typeof patch?.github_backup_enabled === 'boolean' ? patch.github_backup_enabled : undefined

      if (enabled && url !== undefined && !url) {
        return { ok: false as const, error: 'url_required', detail: 'GitHub URL is required when backup is enabled.' }
      }

      db.updateWorkspaceGithubBackup(id, {
        github_remote_url: url,
        github_backup_enabled: enabled,
      })

      const next = db.getWorkspace(id)!
      if (next.github_backup_enabled === 1 && next.github_remote_url.trim()) {
        const cwd = effectivePiCwdForWorkspace(id)
        const linked = await linkWorkspaceGitRepo(cwd, next.github_remote_url)
        if (!linked.ok) return linked
        db.touchWorkspaceGithubSync(id, Date.now())
        return { ok: true as const, linked: true as const, detail: linked.detail }
      }
      return { ok: true as const, linked: false as const }
    },
  )

  ipcMain.handle('workspaces:backup:pull', async (_e, workspaceId: unknown) => {
    const id = typeof workspaceId === 'string' ? workspaceId.trim() : ''
    if (!id) return { ok: false as const, error: 'bad_workspace' }
    const ws = db.getWorkspace(id)
    if (!ws?.github_remote_url.trim()) {
      return { ok: false as const, error: 'not_linked' }
    }
        const cwd = effectivePiCwdForWorkspace(id)
    const linked = await linkWorkspaceGitRepo(cwd, ws.github_remote_url)
    if (!linked.ok) return linked
    const pulled = await pullWorkspaceGitRepo(cwd, { token: readGithubToken() ?? undefined })
    if (pulled.ok) db.touchWorkspaceGithubSync(id, Date.now())
    return pulled
  })

  ipcMain.handle('workspaces:backup:push', async (_e, workspaceId: unknown) => {
    const id = typeof workspaceId === 'string' ? workspaceId.trim() : ''
    if (!id) return { ok: false as const, error: 'bad_workspace' }
    const ws = db.getWorkspace(id)
    if (!ws?.github_remote_url.trim()) {
      return { ok: false as const, error: 'not_linked' }
    }
        const cwd = effectivePiCwdForWorkspace(id)
    const linked = await linkWorkspaceGitRepo(cwd, ws.github_remote_url)
    if (!linked.ok) return linked
    const pushed = await pushWorkspaceGitRepo(cwd, { token: readGithubToken() ?? undefined })
    if (pushed.ok) db.touchWorkspaceGithubSync(id, Date.now())
    return pushed
  })

    ipcMain.handle('workspaces:backup:pushAll', async () => pushAllGithubBackupWorkspaces())

    ipcMain.handle('conversations:setTitle', (_e, id: string, title: string) => {
    db.updateConversationTitle(id, title)
    emitChatRefresh(id, 'conversationRenamed')
  })
  ipcMain.handle('conversations:delete', (_e, id: string) => {
    fullyRemoveConversation(app.getPath('userData'), hostAgentDir(), id)
    emitChatRefresh(id, 'conversationDeleted')
  })
  ipcMain.handle('messages:list', (_e, conversationId: string) => db.listMessages(conversationId))
  ipcMain.handle('prefs:get', (_e, key: string, fallback: unknown) => db.getPref(key, fallback))
  ipcMain.handle('prefs:set', (_e, key: string, value: unknown) => db.setPref(key, value))
  ipcMain.handle('proposals:list', () => listProposals())
  ipcMain.handle('proposals:apply', (_e, root: string, relPath: string, editedBody?: string) =>
    applyProposal(root, relPath, editedBody),
  )
  ipcMain.handle('proposals:reject', (_e, root: string, relPath: string, reason: string) =>
    rejectProposal(root, relPath, reason),
  )
  ipcMain.handle('sweep:getConfig', () => getSweepConfig())
  ipcMain.handle('sweep:setConfig', (_e, patch: Record<string, unknown>) => setSweepConfig(patch))
  ipcMain.handle('sweep:runNow', () => runSweep(true))
  ipcMain.handle('paths:userData', () => app.getPath('userData'))
  ipcMain.handle('paths:db', () => db.dbPath(app.getPath('userData')))
  ipcMain.handle('paths:hostPiCwd', () => effectivePiCwdForWorkspace(db.defaultWorkspaceId()))
  ipcMain.handle('paths:piAgentDir', () => hostAgentDir())
  ipcMain.handle('paths:canonicalWorkspaceProject', () => db.canonicalDefaultWorkspacePiProjectPath())
  ipcMain.handle('globalAgents:status', () => globalAgentsStatusPayload())
  ipcMain.handle('globalAgents:save', (_e, content: unknown) => globalAgentsSaveAndDeploy(content))
  ipcMain.handle('globalAgents:deploy', () => globalAgentsRedeploy())
  ipcMain.handle('paths:exists', (_e, p: unknown) => {
    const s = typeof p === 'string' ? p.trim() : ''
    if (!s) return false
    try {
      return existsSync(s)
    } catch {
      return false
    }
  })
  ipcMain.handle('paths:openGlobalSkillsFolder', async () =>
    openDirectoryInShell(join(hostAgentDir(), 'skills')),
  )
  ipcMain.handle('paths:openProjectSkillsFolder', async (_e, workspaceId?: unknown) => {
    const wid =
      typeof workspaceId === 'string' && workspaceId.trim() ?
        workspaceId.trim()
      : db.defaultWorkspaceId()
    return openDirectoryInShell(join(effectivePiCwdForWorkspace(wid), '.pi', 'skills'))
  })
    ipcMain.handle('github:status', () => githubStatus())
  ipcMain.handle('github:deviceFlow:start', async () => startGithubDeviceFlow())
  ipcMain.handle('github:deviceFlow:poll', async () => pollGithubDeviceFlow())
  ipcMain.handle('github:deviceFlow:cancel', () => {
    clearPendingDeviceFlow()
    return { ok: true as const }
  })
  ipcMain.handle('github:connect', async (_e, rawToken: unknown) => {
    const token = typeof rawToken === 'string' ? rawToken : ''
    return saveGithubAuth(token)
  })
  ipcMain.handle('github:disconnect', () => {
    clearGithubAuth()
    return { ok: true as const }
  })
  ipcMain.handle('github:defaultCloneDir', () => defaultGithubCloneDir())
  ipcMain.handle('github:setDefaultCloneDir', (_e, dir: unknown) => {
    if (typeof dir === 'string') setDefaultGithubCloneDir(dir)
    return defaultGithubCloneDir()
  })
  ipcMain.handle('github:repos', async (_e, opts?: { page?: unknown; perPage?: unknown }) => {
    const page = typeof opts?.page === 'number' ? opts.page : 1
    const perPage = typeof opts?.perPage === 'number' ? opts.perPage : 100
    return listGithubRepos({ page, perPage })
  })

  ipcMain.handle(
    'workspaces:github:clone',
    async (
      _e,
      args: {
        cloneUrl?: unknown
        destDir?: unknown
        name?: unknown
        privateRepo?: unknown
        enableBackup?: unknown
      },
    ) => {
      const cloneUrl = typeof args?.cloneUrl === 'string' ? args.cloneUrl.trim() : ''
      const destDir = typeof args?.destDir === 'string' ? args.destDir.trim() : ''
      const name = typeof args?.name === 'string' ? args.name.trim() : ''
      const privateRepo = args?.privateRepo === true
      const enableBackup = args?.enableBackup !== false // default true
      if (!cloneUrl) return { ok: false as const, error: 'bad_clone_url', detail: 'Clone URL is required.' }
      if (!destDir) return { ok: false as const, error: 'bad_dest', detail: 'Destination directory is required.' }
      if (!name) return { ok: false as const, error: 'bad_name', detail: 'Workspace name is required.' }

      // If a workspace already points at this path, surface it instead of cloning.
      const existing = db.findWorkspaceByPiCwd(destDir)
      if (existing) {
        return { ok: false as const, error: 'workspace_exists', detail: 'A workspace already points at this folder.' }
      }

      const token = readGithubToken()
      const cloned = await cloneWorkspaceRepo(cloneUrl, destDir, { token: token ?? undefined, privateRepo })
      if (!cloned.ok) {
        return { ok: false as const, error: cloned.error, detail: 'detail' in cloned ? cloned.detail : undefined }
      }

      // Auto-add the cloned folder as a workspace and wire backup so push/pull/sync work immediately.
      const ws = db.createWorkspace(name, destDir)
      db.updateWorkspaceGithubBackup(ws.id, {
        github_remote_url: cloneUrl,
        github_backup_enabled: enableBackup,
      })
      // Ensure origin matches the clean URL (no-op if clone already set it) and stamp sync time.
      const linked = await linkWorkspaceGitRepo(destDir, cloneUrl)
      if (linked.ok) db.touchWorkspaceGithubSync(ws.id, Date.now())
      const fresh = db.getWorkspace(ws.id) ?? ws
      return { ok: true as const, workspace: fresh }
    },
  )

  ipcMain.handle('github:orgs', async () => listGithubOrgs())

  ipcMain.handle(
    'workspaces:github:publish',
    async (
      _e,
      args: {
        workspaceId?: unknown
        name?: unknown
        owner?: unknown
        privateRepo?: unknown
        description?: unknown
      },
    ) => {
      const workspaceId = typeof args?.workspaceId === 'string' ? args.workspaceId.trim() : ''
      const name = typeof args?.name === 'string' ? args.name.trim() : ''
      const owner = typeof args?.owner === 'string' ? args.owner.trim() : ''
      const privateRepo = args?.privateRepo !== false // default private
      const description = typeof args?.description === 'string' ? args.description.trim() : ''
      if (!workspaceId) return { ok: false as const, error: 'bad_workspace', detail: 'Workspace is required.' }
      if (!name) return { ok: false as const, error: 'bad_name', detail: 'Repository name is required.' }

      const ws = db.getWorkspace(workspaceId)
      if (!ws) return { ok: false as const, error: 'bad_workspace', detail: 'Workspace not found.' }
      const cwd = effectivePiCwdForWorkspace(workspaceId)
      if (!cwd) return { ok: false as const, error: 'bad_workspace', detail: 'Could not resolve workspace folder.' }

      const created = await createGithubRepo({ name, owner: owner || undefined, private: privateRepo, description })
      if (!created.ok) {
        return { ok: false as const, error: 'create_failed', detail: 'error' in created ? created.error : undefined }
      }

      const token = readGithubToken()
      const published = await publishWorkspaceRepo(cwd, created.repo.clone_url, {
        token: token ?? undefined,
        defaultBranch: created.repo.default_branch,
      })
      if (!published.ok) {
        return {
          ok: false as const,
          error: published.error,
          detail: 'detail' in published ? published.detail : undefined,
        }
      }

      // Wire backup to the new remote so future Push/Pull/sync reuse it.
      db.updateWorkspaceGithubBackup(workspaceId, {
        github_remote_url: created.repo.clone_url,
        github_backup_enabled: true,
      })
      db.touchWorkspaceGithubSync(workspaceId, Date.now())
      const fresh = db.getWorkspace(workspaceId) ?? ws
      return {
        ok: true as const,
        workspace: fresh,
        repo: {
          html_url: created.repo.html_url,
          full_name: created.repo.full_name,
          default_branch: created.repo.default_branch,
          private: created.repo.private,
        },
      }
    },
  )

  ipcMain.handle('workspaces:resetPrimaryPiProject', () => db.resetPrimaryWorkspacePiProjectDir())
  ipcMain.handle('skill-routes:list', (_e, workspaceId?: unknown) => {
    const agentDir = hostAgentDir()
    const all = discoverSkillRoutes(agentDir)
    const wid =
      typeof workspaceId === 'string' && workspaceId.trim() ?
        workspaceId.trim()
      : db.defaultWorkspaceId()
    const disabled = mergedDisabledForWorkspace(wid)
    return filterSkillRoutesForSidebar(all, {
      optionalPackagesPref: readSyloOptionalPackagesPref(),
      disabledSkillPaths: disabled.skillPaths,
    })
  })
  ipcMain.handle('skill-route:open-popout', (_event, routeKey: string) => {
    const key = typeof routeKey === 'string' ? routeKey.trim() : ''
    if (!key) return { ok: false as const, error: 'empty_route_key' }
    const devRendererUrl = process.env.ELECTRON_RENDERER_URL
    const hash = `#popout-route=${encodeURIComponent(key)}`

    const w = new BrowserWindow({
      width: 960,
      height: 720,
      title: `Sylo — route`,
      backgroundColor: '#0f1115',
      ...appIconWindowOptions(),
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    void (async () => {
      try {
        if (devRendererUrl) {
          await w.loadURL(`${devRendererUrl}${hash}`)
        } else {
          await w.loadURL(`${pathToFileURL(join(__dirname, '../renderer/index.html')).href}${hash}`)
        }
      } catch (e) {
        console.warn('[sylo] route pop-out load:', e)
      }
    })()
    return { ok: true as const }
  })
  ipcMain.handle('canvas:show-file', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'invalid_payload' }
    }
    const o = payload as { kind?: string; filePath?: string; title?: string }
    const kind = o.kind
    const filePath = typeof o.filePath === 'string' ? o.filePath.trim() : ''
    if (kind !== 'svg' && kind !== 'markdown') {
      return { ok: false as const, error: 'invalid_kind' }
    }
    if (!filePath) return { ok: false as const, error: 'no_file_path' }
    emitCanvasShow({
      toolCallId: `show-file-${Date.now()}`,
      kind,
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : undefined,
      filePath,
      sourcePath: filePath,
    })
    return { ok: true as const }
  })
  ipcMain.handle('canvas:open-popout', (_event, payload: unknown) => {
    const snap = normalizeCanvasPopoutSnapshot(payload)
    if (!snap) return { ok: false as const, error: 'invalid_payload' }
    const id = stashCanvasPopout(snap)
    const devRendererUrl = process.env.ELECTRON_RENDERER_URL
    const hash = `#popout-canvas=${encodeURIComponent(id)}`
    const title = snap.title?.trim()
    const w = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 420,
      minHeight: 320,
      title: title ? `Sylo — ${title}` : 'Sylo — Canvas',
      backgroundColor: '#0f1115',
      ...appIconWindowOptions(),
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    void (async () => {
      try {
        if (devRendererUrl) {
          await w.loadURL(`${devRendererUrl}${hash}`)
        } else {
          await w.loadURL(`${pathToFileURL(join(__dirname, '../renderer/index.html')).href}${hash}`)
        }
      } catch (e) {
        console.warn('[sylo] canvas pop-out load:', e)
      }
    })()
    return { ok: true as const, id }
  })
  ipcMain.handle('canvas:open-live-popout', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'invalid_payload' as const }
    }
    const o = payload as { liveId?: string; title?: string }
    const liveId = typeof o.liveId === 'string' ? o.liveId.trim() : ''
    if (!liveId) return { ok: false as const, error: 'no_live_id' as const }
    const sub = getLiveSubscription(liveId)
    if (!sub) return { ok: false as const, error: 'not_found' as const }
    const hash = `#popout-canvas-live=${encodeURIComponent(liveId)}`
    const title = (typeof o.title === 'string' ? o.title.trim() : '') || sub.title?.trim()
    const devRendererUrl = process.env.ELECTRON_RENDERER_URL
    const w = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 420,
      minHeight: 320,
      title: title ? `Sylo — ${title}` : 'Sylo — Canvas',
      backgroundColor: '#0f1115',
      ...appIconWindowOptions(),
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    void (async () => {
      try {
        if (devRendererUrl) {
          await w.loadURL(`${devRendererUrl}${hash}`)
        } else {
          await w.loadURL(`${pathToFileURL(join(__dirname, '../renderer/index.html')).href}${hash}`)
        }
      } catch (e) {
        console.warn('[sylo] canvas live pop-out load:', e)
      }
    })()
    return { ok: true as const, id: liveId }
  })
  ipcMain.handle('canvas:get-popout', (_event, popoutId: unknown) => {
    const id = typeof popoutId === 'string' ? popoutId.trim() : ''
    if (!id) return null
    return peekCanvasPopout(id)
  })

  // ── Live (subscribed) canvas IPC ─────────────────────────────────────────
  // Snapshot canvas is emitted once (`canvas:show`) and static. Live canvas
  // registers a `liveId`; the main process fans `canvas:live-update` patches to
  // every subscribed webContents (docked canvas + any popped-out windows).
  // Snapshot kinds are untouched — this is an additive, parallel path.
  ipcMain.handle('canvas:live-subscribe', (event, liveId: unknown) => {
    const id = typeof liveId === 'string' ? liveId.trim() : ''
    if (!id) return false
    return subscribeLive(id, event.sender)
  })
  ipcMain.handle('canvas:live-unsubscribe', (event, liveId: unknown) => {
    const id = typeof liveId === 'string' ? liveId.trim() : ''
    if (!id) return
    unsubscribeLive(id, event.sender)
  })
  ipcMain.handle('canvas:get-live-popout', (_event, liveId: unknown) => {
    const id = typeof liveId === 'string' ? liveId.trim() : ''
    if (!id) return null
    return getLiveSubscription(id)
  })
  // Renderer → main: report the docked canvas' open state so the native
  // Window-menu item label stays in sync ("Show Canvas" / "Hide Canvas").
  // Rebuilding the menu is infrequent (only on open/close transitions).
  ipcMain.handle('canvas:set-open-state', (_event, open: unknown) => {
    const next = open === true
    if (next !== canvasOpenState) {
      canvasOpenState = next
      Menu.setApplicationMenu(buildAppMenu())
    }
    return true
  })
  // Stop any live canvas view (originally the Phase 0 live-demo spike; now
  // also used by the task-board Stop button). disposeLive fans
  // `canvas:live-clear` to every subscriber so they blank cleanly.
  ipcMain.handle('canvas:live-demo-stop', (_event, liveId: unknown) => {
    const id = typeof liveId === 'string' ? liveId.trim() : ''
    if (!id) return { ok: false as const, error: 'bad_id' as const }
    const sub = getLiveSubscription(id)
    if (!sub) return { ok: false as const, error: 'not_found' as const }
    // disposeLive fans `canvas:live-clear` to every subscriber (docked + all
    // popouts) so they blank cleanly instead of freezing at a stale value.
        disposeLive(id)
    // If the disposed liveId was a registered task-board, drop its binding too
    // (the canvas Stop button uses this same IPC for any live kind).
    removeBoardByLiveId(id)
    return { ok: true as const }
  })
  // Phase 4: operator clicked a checkbox / edited a note on the task-board.
  // Forward to the primary broker (broker-agnostic — the edit carries the
  // board's bound `workspaceCwd`, so any broker writes to the right file).
    // The broker's sylo-tasks extension applies it to the store, which emits
  // `sylo-tasks:changed`; the existing fan updates the board (eventual
  // consistency). Fire-and-forget — `ok: true` means "sent", not "applied".
  // The edit carries the board's `liveId` (both the docked canvas and any
  // popout send it), so main routes to the right workspace's store regardless
  // of which workspace is currently active — no cross-workspace edits.
  ipcMain.handle('canvas:task-apply-edit', (_e, payload: unknown) => {
    const p = (payload ?? {}) as {
      taskId?: string
      liveId?: string
      status?: string
      notes?: string | null
    }
    const taskId = typeof p.taskId === 'string' ? p.taskId.trim() : ''
    if (!taskId) return { ok: false as const, error: 'bad_task_id' as const }
    const liveId = typeof p.liveId === 'string' ? p.liveId.trim() : ''
    const board = liveId ? getBoardByLiveId(liveId) : null
    if (!board) return { ok: false as const, error: 'no_active_board' as const }
    const msg: Record<string, unknown> = {
      type: 'sylo-tasks:apply-edit',
      workspaceCwd: board.workspaceKey,
      list_id: board.listId,
      task_id: taskId,
    }
    if (p.status != null) msg.status = p.status
    if (p.notes !== undefined) msg.notes = p.notes
    broker?.sendChildMessage(msg)
    return { ok: true as const }
  })
  // Per-workspace canvas restore: the renderer asks for the board currently
  // bound to a workspace (by its cwd) when switching TO that workspace, so it
  // can re-show it with fresh data (main kept the subscription alive + the
  // `sylo-tasks:changed` fan kept `sub.data` current while the operator was
  // away). Returns null if the workspace has no board (or it was disposed).
  ipcMain.handle('canvas:get-active-board-for-workspace', (_e, workspaceKey: unknown) => {
    const wk = typeof workspaceKey === 'string' ? workspaceKey.trim() : ''
    if (!wk) return null
    let board = getBoardForWorkspace(wk)
    // Restart / fresh-process restore: no in-memory board for this workspace,
    // but a persisted binding exists — re-create the live subscription from a
    // fresh store read, bind it, and return it. The renderer drives the show
    // (it subscribes + sets canvasLive from this return value), so we do NOT
    // emit `canvas:live-show` here. If the list was deleted while away, drop the
    // stale persisted binding and return null (board won't re-appear).
    if (!board) {
      const persisted = loadPersistedBoardForWorkspace(wk)
      if (!persisted) return null
      const res = tasksDbListGet(wk, persisted.listId)
      if (!res.ok || !res.result) {
        clearPersistedBoardBinding(wk)
        return null
      }
      const sub = createLiveSubscription({
        kind: 'task-board',
        title: persisted.title ?? res.result.list?.title,
        data: res.result,
      })
      setActiveTaskBoard(sub.liveId, wk, persisted.listId)
      board = { liveId: sub.liveId, listId: persisted.listId }
    }
    const sub = getLiveSubscription(board.liveId)
    if (!sub) {
      // The liveId was disposed out-of-band — clean the stale binding.
      removeBoardByLiveId(board.liveId)
      return null
    }
    return { liveId: sub.liveId, kind: sub.kind, title: sub.title, data: sub.data }
  })
  ipcMain.handle('skill-data:read', (_e, skillKey: string, key: string) =>
    readSkillDataJson(app.getPath('userData'), skillKey, key),
  )
  ipcMain.handle('skill-data:write', (_e, skillKey: string, key: string, value: unknown) =>
    writeSkillDataJson(app.getPath('userData'), skillKey, key, value, SKILL_DATA_QUOTA_BYTES),
  )

  ipcMain.handle('tasks:list', (_e, conversationId: unknown) => {
    const id = typeof conversationId === 'string' ? conversationId.trim() : ''
    if (!id) return []
    return subagentTaskStore.listAgentTasksForConversation(id)
  })
  ipcMain.handle('tasks:get', (_e, taskId: unknown) => {
    const id = typeof taskId === 'string' ? taskId.trim() : ''
    if (!id) return null
    return subagentTaskStore.getAgentTask(id) ?? null
  })
  ipcMain.handle('tasks:cancel', (_e, taskId: unknown) => {
    const id = typeof taskId === 'string' ? taskId.trim() : ''
    if (!id) return { ok: false as const, error: 'bad_id' as const }
    const row = subagentTaskStore.getAgentTask(id)
    if (!row) return { ok: false as const, error: 'not_found' as const }
    if (row.status !== 'running') return { ok: false as const, error: 'not_running' as const }

    let killed = false
    if (broker && isSupervisorReady(broker)) {
      broker.cancelSubagentRun(id)
      killed = true
    }

    subagentTaskStore.finalizeAgentTask(id, {
      status: 'cancelled',
      statusReason: killed ? 'operator_cancel' : 'operator_cancel_stale',
      resultSummary: 'Cancelled from Tasks panel',
    })
    mainWindow?.webContents.send('subagents:lifecycle', {
      conversationId: row.conversation_id,
      type: 'subagent_run_end',
      runId: id,
      status: 'cancelled',
    })
    return { ok: true as const, killed }
  })
  ipcMain.handle('tasks:retry', (_e, taskId: unknown) => {
    const id = typeof taskId === 'string' ? taskId.trim() : ''
    const row = id ? subagentTaskStore.getAgentTask(id) : undefined
    if (!row) return { ok: false as const, error: 'not_found' as const }
    try {
      const spec = JSON.parse(row.spec_json) as { task?: string }
      return {
        ok: true as const,
        agent: row.agent_name,
        mode: row.mode,
        task: typeof spec.task === 'string' ? spec.task : row.title,
        groupRunId: row.group_run_id,
        stepIndex: row.step_index ?? undefined,
      }
    } catch {
      return { ok: false as const, error: 'bad_spec' as const }
    }
  })
  ipcMain.handle('tasks:orphanedCount', () => subagentTaskStore.countOrphanedAgentTasks())
  ipcMain.handle('tasks:clearOrphaned', () => ({
    ok: true as const,
    deleted: subagentTaskStore.deleteOrphanedAgentTasks(),
  }))
  ipcMain.handle('tasks:diagnostics', () => {
    const subagentsKey = normalizeSyloCapabilityPath(SYLO_SUBAGENTS_EXTENSION)
    const disabled = readSyloDisabledCapabilities()
    const extensionEnabled =
      Boolean(subagentsKey) &&
      existsSync(SYLO_SUBAGENTS_EXTENSION) &&
      !disabled.extensionPaths.includes(subagentsKey)
    return {
      runningCount: subagentTaskStore.countRunningAgentTasks(),
      orphanedCount: subagentTaskStore.countOrphanedAgentTasks(),
      extensionEnabled,
    }
  })

  ipcMain.handle('schedules:list', (_e, workspaceId: unknown) => {
    const wid = typeof workspaceId === 'string' ? workspaceId.trim() : activeWorkspaceId()
    return listScheduledPrompts(wid)
  })
  ipcMain.handle('schedules:get', (_e, id: unknown) => {
    const row = typeof id === 'string' ? getScheduledPrompt(id.trim()) : undefined
    return row ?? null
  })
  ipcMain.handle('schedules:create', (_e, workspaceId: unknown, input: unknown) => {
    const wid = typeof workspaceId === 'string' ? workspaceId.trim() : activeWorkspaceId()
    return createScheduledPrompt(wid, readScheduledPromptInput(input))
  })
  ipcMain.handle('schedules:update', (_e, id: unknown, patch: unknown) => {
    const rowId = typeof id === 'string' ? id.trim() : ''
    if (!rowId) return null
    return updateScheduledPrompt(rowId, readScheduledPromptPatch(patch))
  })
  ipcMain.handle('schedules:delete', (_e, id: unknown) => {
    const rowId = typeof id === 'string' ? id.trim() : ''
    if (!rowId) return { ok: false as const }
    return { ok: deleteScheduledPrompt(rowId) as boolean }
  })
  ipcMain.handle('schedules:fireNow', async (_e, id: unknown) => {
    const rowId = typeof id === 'string' ? id.trim() : ''
    if (!rowId) return { ok: false as const, error: 'missing_id' as const }
    return fireScheduledPromptNow(rowId)
  })

  ipcMain.handle('evals:loadDashboard', () => loadEvalDashboard(SYLO_REPO_ROOT))
  ipcMain.handle('evals:runBaseline', (_e, note: unknown, since: unknown) =>
    runEvalBaseline(
      SYLO_REPO_ROOT,
      typeof note === 'string' ? note : undefined,
      typeof since === 'string' ? since : undefined,
    ),
  )

  ipcMain.handle('webaccess:listRuns', (_e, limit: unknown) => {
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.min(500, Math.max(1, limit)) : 100
    return webAccessStore.listWebAccessRuns(n)
  })
  ipcMain.handle('webaccess:stats', () => webAccessStore.getWebAccessStats())
  ipcMain.handle('webaccess:configGet', () => {
    ensureWebAccessConfigSchema(hostAgentDir())
    return readWebAccessConfig(app.getPath('userData'))
  })
    ipcMain.handle('webaccess:configSave', (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const wrote = writeWebAccessConfig(app.getPath('userData'), values as Record<string, unknown>)
    if (!wrote.ok) return { ok: false as const, error: wrote.error }
    ensureWebAccessConfigSchema(hostAgentDir())
    return { ok: true as const, restartNote: 'Restart broker for config changes to apply to web tools.' }
  })
  ipcMain.handle('webaccess:braveQuota', () => readWebAccessBraveQuota(app.getPath('userData')))

  ipcMain.handle('thinkTank:sessionGet', (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return null
    return thinkTankStore.getThinkTankSessionDetail(sessionId.trim())
  })
  ipcMain.handle('thinkTank:listForConversation', (_e, conversationId: unknown) => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) return []
    return thinkTankStore.listThinkTankSessionsForConversation(conversationId.trim())
  })
  ipcMain.handle('thinkTank:configGet', () => readThinkTankConfig(app.getPath('userData')))
  ipcMain.handle('thinkTank:configSave', (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const wrote = writeThinkTankConfig(app.getPath('userData'), values as Record<string, unknown>)
    if (!wrote.ok) return { ok: false as const, error: wrote.error }
    return { ok: true as const }
  })
  ipcMain.handle('thinkTank:pickReport', (_e, sessionId: unknown, reportId: unknown) => {
    if (typeof sessionId !== 'string' || typeof reportId !== 'string') {
      return { ok: false as const, error: 'bad_args' }
    }
    try {
      thinkTankStore.pickThinkTankReport(sessionId, reportId)
      const conversationId = thinkTankStore.getThinkTankSessionConversationId(sessionId)
      mainWindow?.webContents.send('thinkTank:lifecycle', {
        conversationId,
        type: 'complete',
        sessionId,
        selectedReportId: reportId,
      })
      return { ok: true as const, selectedReportId: reportId }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('thinkTank:inject', (_e, sessionId: unknown, text: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return { ok: false as const, error: 'bad_session_id' }
    }
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) return { ok: false as const, error: 'empty_message' }
    const sid = sessionId.trim()
    const pendingCount = queueThinkTankInjection(sid, body)
    const conversationId = thinkTankStore.getThinkTankSessionConversationId(sid)
    mainWindow?.webContents.send('thinkTank:lifecycle', {
      conversationId,
      type: 'operator_inject_queued',
      sessionId: sid,
      text: body,
      pendingCount,
    })
    return { ok: true as const, pendingCount }
  })

  ipcMain.handle('thinkTank:abort', async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return { ok: false as const, error: 'bad_session_id' }
    }
    const sid = sessionId.trim()
    const conversationId = thinkTankStore.getThinkTankSessionConversationId(sid)
    cancelThinkTankSession(sid, 'Stopped by operator')
    if (conversationId && brokerAgentReady && broker) {
      const active = findPendingTurnForConversation(conversationId)
      if (active) {
        const [turnId, pending] = active
        pending.aborted = true
        const assigned = turnBrokerPool.supervisorForTurn(turnId) ?? broker
        finalizePendingTurn(turnId, pending, 'cancelled')
        assigned?.abort()
        void flushDeferredTurns()
      }
    }
    mainWindow?.webContents.send('thinkTank:lifecycle', {
      conversationId: conversationId ?? null,
      type: 'error',
      sessionId: sid,
      message: 'Think tank stopped by operator',
    })
    return { ok: true as const }
  })

  ipcMain.handle('tts:listVoices', () => listTtsVoices(SYLO_REPO_ROOT))
  ipcMain.handle('tts:configGet', () => {
    ensureTtsConfigSchema(hostAgentDir())
    return readTtsConfig(app.getPath('userData'))
  })
  ipcMain.handle('tts:configSave', (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const wrote = writeTtsConfig(app.getPath('userData'), values as Record<string, unknown>)
    if (!wrote.ok) return { ok: false as const, error: wrote.error }
    ensureTtsConfigSchema(hostAgentDir())
    return { ok: true as const, restartNote: 'Restart broker for default voice changes to apply to TTS tools.' }
  })
  ipcMain.handle('tts:generate', async (_e, args: unknown) => {
    const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
    const text = typeof a.text === 'string' ? a.text : ''
    const userData = app.getPath('userData')
    const cfg = readTtsConfig(userData)
    const defaultVoice =
      typeof cfg.default_voice_id === 'string' ? cfg.default_voice_id : 'kokoro-am_michael'
    const voiceId = typeof a.voice_id === 'string' && a.voice_id.trim() ? a.voice_id.trim() : defaultVoice
    const pythonPath = typeof cfg.python_path === 'string' ? cfg.python_path : ''
    const synth = synthOptionsFromRecords(cfg, {
      kokoroSpeed: typeof a.kokoro_speed === 'number' ? a.kokoro_speed : undefined,
      orpheusTemperature:
        typeof a.orpheus_temperature === 'number' ? a.orpheus_temperature : undefined,
      orpheusTopP: typeof a.orpheus_top_p === 'number' ? a.orpheus_top_p : undefined,
    })
    const routeClipsDir = ttsRouteClipsDir(userData)
    mkdirSync(routeClipsDir, { recursive: true })
    const result = await generateTtsWav(SYLO_REPO_ROOT, {
      text,
      voiceId,
      pythonPath,
      outputDir: routeClipsDir,
      ...synth,
    })
    if (!result.ok) return { ok: false as const, error: result.error }
    return { ...result }
  })
  ipcMain.handle('tts:deleteRouteClip', (_e, wavPath: unknown) => {
    const path = typeof wavPath === 'string' ? wavPath : ''
    const r = deleteTtsRouteClip(app.getPath('userData'), path)
    if (!r.ok) return { ok: false as const, error: r.error }
    return { ok: true as const }
  })

  // Personal bundle (app-level user package) — resolved at runtime from the
  // installed sylo-tools-personal bundle; inert when absent. The plugin itself
  // registers the companion personal-app static root.
  void import('./personal-plugin.js').then((m) =>
    m.loadPersonalPlugin({
      dataDirOverride: () => db.personalDataDirOverride(),
      dataRoot: () => db.personalDataRoot(),
      hostAgentDir,
      setPersonalAppRoot,
    }),
  )

  // Generic personal-plugin IPC — the ONLY surface the renderer/companion use
  // for personal-domain ops. No domain names live in the host.
  ipcMain.handle('personal:ops', async () => {
    const { personalPluginOps } = await import('./personal-plugin.js')
    return personalPluginOps()
  })
  ipcMain.handle('personal:rpc', (_e, op: unknown, payload: unknown) =>
    import('./personal-plugin.js').then((m) =>
      m.personalPluginRpc(typeof op === 'string' ? op : '', payload),
    ),
  )
  ipcMain.handle('personal:settingsCard', async () => {
    const { personalPluginSettingsCard } = await import('./personal-plugin.js')
    return personalPluginSettingsCard()
  })

  // User-installed Pi packages (~/.pi/agent/settings.json packages[]) — generic
  // Capability-manager card surface. Host owns no names; anything installed via
  // `pi install` shows here as always-on.
  ipcMain.handle('user-packages:list', () => readUserPackages(hostAgentDir()))

  // ── sylo-tasks sidebar dashboard (Phase 3) ────────────────────────────
  // The dashboard iframe talks to the host via the skill-route bridge; the
  // renderer dispatches `tasks:*` ops to `window.sylo.tasksDb.*` (preload) →
  // these handlers → `tasks-db.ts` → the shared store (same code the broker
  // extension uses) + `fanTasksChanged` so a Canvas board for the edited list
  // updates live. The active workspace cwd is passed in every call (main has
  // no `SYLO_PI_CWD`).
  ipcMain.handle('tasks:db-snapshot-get', (_e, cwd: unknown) =>
    tasksDbSnapshotGet(typeof cwd === 'string' ? cwd : ''))
  ipcMain.handle('tasks:db-list-get', (_e, args: unknown) =>
    tasksDbListGet(
      (args as { workspaceCwd?: string } | undefined)?.workspaceCwd ?? '',
      (args as { listId?: string } | undefined)?.listId ?? '',
    ))
  ipcMain.handle('tasks:db-list-create', (_e, args: unknown) =>
    tasksDbListCreate(
      (args as { workspaceCwd?: string } | undefined)?.workspaceCwd ?? '',
      (args as { title?: string; mode?: string; description?: string } | undefined) ?? {},
    ))
  ipcMain.handle('tasks:db-list-delete', (_e, args: unknown) =>
    tasksDbListDelete(
      (args as { workspaceCwd?: string } | undefined)?.workspaceCwd ?? '',
      (args as { listId?: string } | undefined)?.listId ?? '',
    ))
  ipcMain.handle('tasks:db-task-add', (_e, args: unknown) =>
    tasksDbTaskAdd(
      (args as { workspaceCwd?: string } | undefined)?.workspaceCwd ?? '',
      (args as {
        list_id?: string
        title?: string
        status?: string
        notes?: string
        due?: string
        blocked_by?: string[]
      } | undefined) ?? {},
    ))
  ipcMain.handle('tasks:db-task-update', (_e, args: unknown) =>
    tasksDbTaskUpdate(
      (args as { workspaceCwd?: string } | undefined)?.workspaceCwd ?? '',
      (args as {
        id?: string
        title?: string
        status?: string
        notes?: string | null
        due?: string | null
        blocked_by?: string[]
      } | undefined) ?? {},
    ))
  ipcMain.handle('tasks:db-task-delete', (_e, args: unknown) =>
    tasksDbTaskDelete(
      (args as { workspaceCwd?: string } | undefined)?.workspaceCwd ?? '',
      (args as { taskId?: string } | undefined)?.taskId ?? '',
    ))

  ipcMain.handle('logicforge:parseRulesGet', () => logicforgeParseRulesGet())
  ipcMain.handle('logicforge:parseRulesSave', (_e, payload: unknown) =>
    logicforgeParseRulesSave(payload as import('./logicforge-parse-rules.js').LogicForgeParseRulesPayload),
  )
  ipcMain.handle('logicforge:parseRulesReset', () => logicforgeParseRulesReset())
  ipcMain.handle('logicforge:ioReviewGet', (_e, payload: unknown) =>
    logicforgeIoReviewGet(payload as import('./logicforge-io-review.js').LogicForgeIoReviewPayload),
  )
  ipcMain.handle('logicforge:ioReviewReseed', (_e, payload: unknown) =>
    logicforgeIoReviewReseed(payload as import('./logicforge-io-review.js').LogicForgeIoReviewPayload),
  )
  ipcMain.handle('logicforge:ioReviewSave', (_e, payload: unknown) =>
    logicforgeIoReviewSave(payload as import('./logicforge-io-review.js').LogicForgeIoReviewPayload),
  )
    ipcMain.handle('logicforge:ioReviewApproveBuild', (_e, payload: unknown) =>
    logicforgeIoReviewApproveBuild(payload as import('./logicforge-io-review.js').LogicForgeIoReviewPayload),
  )
  ipcMain.handle('logicforge:downloadAllowlistGet', () => logicforgeDownloadAllowlistGet())
  ipcMain.handle('logicforge:downloadAllowlistSave', (_e, payload: unknown) =>
    logicforgeDownloadAllowlistSave(
      payload as import('./logicforge-download-settings.js').LogicForgeDownloadAllowlistPayload,
    ),
  )
  ipcMain.handle('logicforge:downloadPlcStatus', (_e, ip: unknown) =>
    logicforgeDownloadPlcStatus(typeof ip === 'string' ? ip : ''),
  )
  ipcMain.handle('logicforge:templates', (_e, op: unknown, payload: unknown) =>
    logicforgeTemplates(typeof op === 'string' ? op : '', (payload as Record<string, unknown>) ?? {}),
  )

  ipcMain.handle('syloWorkflows:workflowsList', (_e, payload: unknown) => {
    const p = payload as { project_dir?: string; agent_dir?: string } | string | undefined
    const projectDir = typeof p === 'string' ? p : (p?.project_dir ?? '')
    const agentDir =
      typeof p === 'object' && p && typeof p.agent_dir === 'string' && p.agent_dir.trim() ?
        p.agent_dir.trim()
      : hostAgentDir()
    return syloWorkflowsList({ project_dir: projectDir, agent_dir: agentDir })
  })
  ipcMain.handle('syloWorkflows:workflowRead', (_e, payload: unknown) =>
    syloWorkflowRead({
      ...(payload as { project_dir: string; agent_dir?: string; id: string }),
      agent_dir:
        typeof (payload as { agent_dir?: string })?.agent_dir === 'string' &&
        (payload as { agent_dir?: string }).agent_dir!.trim() ?
          (payload as { agent_dir: string }).agent_dir.trim()
        : hostAgentDir(),
    }),
  )
  ipcMain.handle('syloWorkflows:workflowSave', (_e, payload: unknown) =>
    syloWorkflowSave({
      ...(payload as { content: string; previous_id?: string; agent_dir?: string }),
      agent_dir:
        typeof (payload as { agent_dir?: string })?.agent_dir === 'string' &&
        (payload as { agent_dir?: string }).agent_dir!.trim() ?
          (payload as { agent_dir: string }).agent_dir.trim()
        : hostAgentDir(),
    }),
  )
  ipcMain.handle('syloWorkflows:workflowDelete', (_e, payload: unknown) =>
    syloWorkflowDelete({
      ...(payload as { id: string; agent_dir?: string }),
      agent_dir:
        typeof (payload as { agent_dir?: string })?.agent_dir === 'string' &&
        (payload as { agent_dir?: string }).agent_dir!.trim() ?
          (payload as { agent_dir: string }).agent_dir.trim()
        : hostAgentDir(),
    }),
  )

  ipcMain.handle('fieldbrain:configGet', () => {
    const config = readFieldBrainConfig(app.getPath('userData'))
    return {
      ok: true as const,
      config,
      databaseConfigPath: fieldbrainDatabaseConfigPath(),
      guidedSetup: getGuidedSetupSteps(),
    }
  })
  ipcMain.handle('fieldbrain:configSave', (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const wrote = writeFieldBrainConfig(app.getPath('userData'), values as Partial<FieldBrainConfig>)
    if (!wrote.ok) return { ok: false as const, error: wrote.error }
    return {
      ok: true as const,
      config: wrote.config,
      databaseConfigPath: fieldbrainDatabaseConfigPath(),
    }
  })
  ipcMain.handle('fieldbrain:dbCheck', async () => {
    const config = readFieldBrainConfig(app.getPath('userData'))
    try {
      return await runFieldBrainScript(SYLO_REPO_ROOT, 'db_check.py', ['--guided'], config)
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
        guided_setup: getGuidedSetupSteps(),
      }
    }
  })
  ipcMain.handle('fieldbrain:dbMigrate', async () => {
    const config = readFieldBrainConfig(app.getPath('userData'))
    try {
      return await runFieldBrainScript(SYLO_REPO_ROOT, 'db_migrate.py', [], config)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:logList', async () => {
    const config = readFieldBrainConfig(app.getPath('userData'))
    try {
      return await runFieldBrainScript(
        SYLO_REPO_ROOT,
        'fieldbrain_log_search.py',
        ['--limit', '50'],
        config,
      )
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:documentList', async (_e, values: unknown) => {
    const config = readFieldBrainConfig(app.getPath('userData'))
    const raw = values && typeof values === 'object' && !Array.isArray(values) ? (values as Record<string, unknown>) : {}
    const projectId =
      typeof raw.projectId === 'number'
        ? raw.projectId
        : typeof raw.project_id === 'number'
          ? raw.project_id
          : null
    const args =
      projectId != null
        ? ['--scope', 'project', '--project-id', String(projectId)]
        : ['--scope', 'global']
    try {
      return await runFieldBrainScript(SYLO_REPO_ROOT, 'fieldbrain_document_list.py', args, config)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:brainList', async (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const raw = values as Record<string, unknown>
    const projectId =
      typeof raw.projectId === 'number'
        ? raw.projectId
        : typeof raw.project_id === 'number'
          ? raw.project_id
          : null
    if (projectId == null) {
      return { ok: false as const, error: 'projectId is required.' }
    }
    const config = readFieldBrainConfig(app.getPath('userData'))
    try {
      return await runFieldBrainScript(
        SYLO_REPO_ROOT,
        'fieldbrain_ui_brain_list.py',
        ['--scope', 'project', '--project-id', String(projectId)],
        config,
      )
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:projectList', async () => {
    const config = readFieldBrainConfig(app.getPath('userData'))
    try {
      return await runFieldBrainScript(SYLO_REPO_ROOT, 'fieldbrain_ui_project_list.py', [], config)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:projectCreate', async (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const raw = values as Record<string, unknown>
    const jobNumber =
      typeof raw.jobNumber === 'string'
        ? raw.jobNumber.trim()
        : typeof raw.job_number === 'string'
          ? raw.job_number.trim()
          : ''
    const subProjectNumber =
      typeof raw.subProjectNumber === 'string'
        ? raw.subProjectNumber.trim()
        : typeof raw.sub_project_number === 'string'
          ? raw.sub_project_number.trim()
          : ''
    const legacyName = typeof raw.name === 'string' ? raw.name.trim() : ''

    if (!jobNumber && !legacyName) {
      return { ok: false as const, error: 'Project number is required (five digits, e.g. 12345).' }
    }

    const args: string[] = []
    if (jobNumber) {
      args.push('--job-number', jobNumber)
      if (subProjectNumber) args.push('--sub-project-number', subProjectNumber)
    } else {
      args.push('--name', legacyName)
    }
    const config = readFieldBrainConfig(app.getPath('userData'))
    try {
      return await runFieldBrainScript(SYLO_REPO_ROOT, 'fieldbrain_ui_project_create.py', args, config)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:dbBootstrap', async (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const raw = values as Record<string, unknown>
    const adminPassword = typeof raw.adminPassword === 'string' ? raw.adminPassword : ''
    if (!adminPassword.trim()) {
      return { ok: false as const, error: 'Postgres superuser password is required (not saved after bootstrap).' }
    }
    const current = readFieldBrainConfig(app.getPath('userData'))
    const host =
      typeof raw.postgresHost === 'string' && raw.postgresHost.trim() ?
        raw.postgresHost.trim()
      : current.postgresHost
    const port =
      typeof raw.postgresPort === 'number' && Number.isFinite(raw.postgresPort) ?
        Math.floor(raw.postgresPort)
      : current.postgresPort
    const appDatabase =
      typeof raw.postgresDatabase === 'string' && raw.postgresDatabase.trim() ?
        raw.postgresDatabase.trim()
      : current.postgresDatabase
    const appUsername =
      typeof raw.postgresUsername === 'string' && raw.postgresUsername.trim() ?
        raw.postgresUsername.trim()
      : current.postgresUsername
    const appPassword =
      typeof raw.appPassword === 'string' && raw.appPassword.length > 0 ?
        raw.appPassword
      : typeof raw.postgresPassword === 'string' && raw.postgresPassword.length > 0 ?
        raw.postgresPassword
      : current.postgresPassword || 'fieldbrain'
    const adminUser =
      typeof raw.adminUsername === 'string' && raw.adminUsername.trim() ?
        raw.adminUsername.trim()
      : 'postgres'

    const args = [
      '--admin-user',
      adminUser,
      '--host',
      host,
      '--port',
      String(port),
      '--app-database',
      appDatabase,
      '--app-username',
      appUsername,
      '--app-password',
      appPassword,
    ]
    try {
      const result = await runFieldBrainBootstrapScript(SYLO_REPO_ROOT, 'db_bootstrap.py', args, adminPassword.trim())
      if (result.ok === false) return result
      const wrote = writeFieldBrainConfig(app.getPath('userData'), {
        dbMode: current.dbMode,
        postgresHost: host,
        postgresPort: port,
        postgresDatabase: appDatabase,
        postgresUsername: appUsername,
        postgresPassword: appPassword,
        ollamaUrl: current.ollamaUrl,
      })
      if (!wrote.ok) {
        return {
          ok: false as const,
          error: `Database created but saving FieldBrain config failed: ${wrote.error}`,
          bootstrap: result,
        }
      }
      return {
        ...result,
        config: wrote.config,
        databaseConfigPath: fieldbrainDatabaseConfigPath(),
      }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:pgvectorGuide', async () => {
    const config = readFieldBrainConfig(app.getPath('userData'))
    try {
      return await runFieldBrainScript(SYLO_REPO_ROOT, 'pgvector_guide.py', [], config)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:pgvectorInstallFromFolder', async (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const raw = values as Record<string, unknown>
    const adminPassword = typeof raw.adminPassword === 'string' ? raw.adminPassword : ''
    if (!adminPassword.trim()) {
      return { ok: false as const, error: 'Postgres superuser password is required (not saved).' }
    }
    const sourcePath = typeof raw.sourcePath === 'string' ? raw.sourcePath.trim() : ''
    const skipFileCopy = raw.skipFileCopy === true
    const current = readFieldBrainConfig(app.getPath('userData'))
    const host =
      typeof raw.postgresHost === 'string' && raw.postgresHost.trim() ?
        raw.postgresHost.trim()
      : current.postgresHost
    const port =
      typeof raw.postgresPort === 'number' && Number.isFinite(raw.postgresPort) ?
        Math.floor(raw.postgresPort)
      : current.postgresPort
    const appDatabase =
      typeof raw.postgresDatabase === 'string' && raw.postgresDatabase.trim() ?
        raw.postgresDatabase.trim()
      : current.postgresDatabase
    const adminUser =
      typeof raw.adminUsername === 'string' && raw.adminUsername.trim() ?
        raw.adminUsername.trim()
      : 'postgres'

    const args = [
      '--admin-user',
      adminUser,
      '--host',
      host,
      '--port',
      String(port),
      '--database',
      appDatabase,
    ]
    if (skipFileCopy) args.push('--skip-file-copy')
    else if (sourcePath) args.push('--source', sourcePath)
    else return { ok: false as const, error: 'Select the pgvector folder or zip first.' }

    try {
      let result = await runFieldBrainBootstrapScript(
        SYLO_REPO_ROOT,
        'pgvector_install_from_folder.py',
        args,
        adminPassword.trim(),
      )
      if (
        result.ok === false &&
        result.needs_elevation === true &&
        typeof result.source_dir === 'string' &&
        typeof result.pgroot === 'string' &&
        process.platform === 'win32'
      ) {
        const elevated = await copyPgvectorFilesWindowsElevated(result.source_dir, result.pgroot)
        if (!elevated.ok) {
          return { ok: false as const, error: elevated.error, ...result }
        }
        const retryArgs = args.filter((a, i, arr) => a !== '--source' && !(i > 0 && arr[i - 1] === '--source'))
        retryArgs.push('--skip-file-copy')
        result = await runFieldBrainBootstrapScript(
          SYLO_REPO_ROOT,
          'pgvector_install_from_folder.py',
          retryArgs,
          adminPassword.trim(),
        )
      }
      return result
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fieldbrain:pgvectorEnable', async (_e, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false as const, error: 'bad_values' }
    }
    const raw = values as Record<string, unknown>
    const adminPassword = typeof raw.adminPassword === 'string' ? raw.adminPassword : ''
    if (!adminPassword.trim()) {
      return { ok: false as const, error: 'Postgres superuser password is required (not saved).' }
    }
    const current = readFieldBrainConfig(app.getPath('userData'))
    const host =
      typeof raw.postgresHost === 'string' && raw.postgresHost.trim() ?
        raw.postgresHost.trim()
      : current.postgresHost
    const port =
      typeof raw.postgresPort === 'number' && Number.isFinite(raw.postgresPort) ?
        Math.floor(raw.postgresPort)
      : current.postgresPort
    const appDatabase =
      typeof raw.postgresDatabase === 'string' && raw.postgresDatabase.trim() ?
        raw.postgresDatabase.trim()
      : current.postgresDatabase
    const adminUser =
      typeof raw.adminUsername === 'string' && raw.adminUsername.trim() ?
        raw.adminUsername.trim()
      : 'postgres'
    const args = [
      '--admin-user',
      adminUser,
      '--host',
      host,
      '--port',
      String(port),
      '--database',
      appDatabase,
    ]
    try {
      return await runFieldBrainBootstrapScript(SYLO_REPO_ROOT, 'pgvector_enable.py', args, adminPassword.trim())
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('onenote:authStatus', async () => {
    try {
      return await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_auth_status.py', [])
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:authStart', async () => {
    try {
      return await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_auth_start.py', [], 60_000)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:authComplete', async () => {
    try {
      return await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_auth_complete.py', [], 900_000)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:authLogout', async () => {
    try {
      return await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_auth_logout.py', [])
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:settingsGet', async () => {
    try {
      const result = await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_settings_get.py', [])
      return { ...result, config_dir: onenoteConfigDir() }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:settingsSave', async (_e, values: unknown) => {
    const raw =
      values && typeof values === 'object' && !Array.isArray(values) ?
        (values as Record<string, unknown>).settings ?? values
      : values
    try {
      return await runOneNoteSettingsSave(SYLO_REPO_ROOT, raw)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:notebookList', async () => {
    try {
      return await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_notebook_list.py', [], 180_000)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:indexSync', async () => {
    try {
      return await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_index_sync.py', [], 900_000)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:indexProgress', async () => {
    try {
      return await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_index_progress.py', [])
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('onenote:importLegacyCache', async () => {
    try {
      return await runOneNoteScript(SYLO_REPO_ROOT, 'onenote_ui_import_legacy_cache.py', [])
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('skill-surface:inject-follow-up', (_e, text: string) => {
    if (!brokerAgentReady || !broker) {
      return { ok: false as const, error: 'broker_not_ready' }
    }
    try {
      broker.sendBridgeFollowUp(text)
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('skill-surfaces:lint-batch', (_e, paths: unknown) => {
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
    return lintSkillSurfacesBatch(list)
  })

  ipcMain.handle('capabilities:skillParamsMeta', (_e, skillPath: unknown) => {
    if (typeof skillPath !== 'string' || !skillPath.trim()) {
      return { ok: false as const, error: 'Missing skill path' }
    }
    const meta = resolveSkillParamsMeta(skillPath)
    if (!meta) return { ok: false as const, error: 'no_schema' }
    return { ok: true as const, meta }
  })

  ipcMain.handle('capabilities:skillParamsGet', (_e, skillPath: unknown) => {
    if (typeof skillPath !== 'string' || !skillPath.trim()) {
      return { ok: false as const, error: 'Missing skill path' }
    }
    return readSkillParams(skillPath)
  })

  ipcMain.handle('capabilities:skillParamsSave', (_e, skillPath: unknown, values: unknown) => {
    if (typeof skillPath !== 'string' || !skillPath.trim()) {
      return { ok: false as const, error: 'Missing skill path' }
    }
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      return { ok: false as const, error: 'Values must be a JSON object' }
    }
    return saveSkillParams(skillPath, values as Record<string, unknown>)
  })

  ipcMain.handle('capabilities:skillMdGet', (_e, skillPath: unknown, workspaceId?: unknown) => {
    if (typeof skillPath !== 'string' || !skillPath.trim()) {
      return { ok: false as const, error: 'Missing skill path' }
    }
    const { piCwd, agentDir } = resolvePiPackageContext(workspaceId)
    return readSkillMd(skillPath, agentDir, piCwd, readIncludeCursorSkillsPref())
  })

  ipcMain.handle(
    'capabilities:skillMdSave',
    (_e, skillPath: unknown, content: unknown, workspaceId?: unknown, confirmCoreSyloEdit?: unknown) => {
      if (typeof skillPath !== 'string' || !skillPath.trim()) {
        return { ok: false as const, error: 'Missing skill path' }
      }
      if (typeof content !== 'string') {
        return { ok: false as const, error: 'Content must be a string' }
      }
      const { piCwd, agentDir } = resolvePiPackageContext(workspaceId)
      return writeSkillMd(skillPath, content, agentDir, piCwd, readIncludeCursorSkillsPref(), {
        confirmCoreSyloEdit: confirmCoreSyloEdit === true,
      })
    },
  )

  ipcMain.handle('capabilities:extensionConfigMeta', (_e, extensionPath: unknown) => {
    if (typeof extensionPath !== 'string' || !extensionPath.trim()) {
      return { ok: false as const, error: 'Missing extension path' }
    }
        const agentDir = hostAgentDir()
    // The web-access schema is generated lazily; ensure it exists so the
    // Capability manager surfaces a "Configure" button for sylo-web-access.
        ensureWebAccessConfigSchema(agentDir)
    // web-access: resolve directly to the 'web-access' runtime config key.
    // resolveExtensionConfigKey only matches node_modules-style package paths and
    // misses the dev-tree packages/sylo-web-access/extensions layout, so match the
    // extension by path and hand back the schema the broker actually reads.
    if (extensionPath.replace(/\\/g, '/').includes('/sylo-web-access/extensions/')) {
      return {
        ok: true as const,
        meta: {
          configKey: 'web-access',
          schemaPath: join(agentDir, 'extensions-config', 'web-access.schema.json'),
          valuesPath: join(agentDir, 'extensions-config', 'web-access.json'),
        },
      }
    }
    const meta = extensionConfigMeta(extensionPath, agentDir)
    if (!meta) return { ok: false as const, error: 'no_schema' }
    return { ok: true as const, meta }
  })

    ipcMain.handle('capabilities:extensionConfigGet', (_e, configKey: unknown) => {
    if (typeof configKey !== 'string' || !configKey.trim()) {
      return { ok: false as const, error: 'Missing config key' }
    }
    const agentDir = hostAgentDir()
    // web-access config lives in the runtime file (SYLO_WEB_ACCESS_CONFIG, under
    // userData), not the generic extensions-config/<key>.json — bridge it so edits
    // made in the Capability manager take effect for web search.
    if (configKey === 'web-access') {
      ensureWebAccessConfigSchema(agentDir)
      const r = readExtensionConfig('web-access', agentDir)
      if (!r.ok) return r
      const formValues: Record<string, unknown> = { ...readWebAccessConfig(app.getPath('userData')) }
      // searchBackends is an array the schema form can't edit; omit it so a save
      // resets the S2 rotation to the default (duckduckgo, brave_api) via writeWebAccessConfig.
      delete formValues.searchBackends
      return { ok: true as const, meta: r.meta, schema: r.schema, values: formValues }
    }
    return readExtensionConfig(configKey, agentDir)
  })

    ipcMain.handle('capabilities:extensionConfigSave', (_e, configKey: unknown, values: unknown) => {
    if (typeof configKey !== 'string' || !configKey.trim()) {
      return { ok: false as const, error: 'Missing config key' }
    }
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      return { ok: false as const, error: 'Values must be a JSON object' }
    }
    // web-access config routes to the runtime file the broker reads (SYLO_WEB_ACCESS_CONFIG).
    if (configKey === 'web-access') {
      const wrote = writeWebAccessConfig(app.getPath('userData'), values as Record<string, unknown>)
      if (!wrote.ok) return { ok: false as const, error: wrote.error }
      ensureWebAccessConfigSchema(hostAgentDir())
      return { ok: true as const }
    }
    return saveExtensionConfig(configKey, hostAgentDir(), values as Record<string, unknown>)
  })

  ipcMain.handle('broker:restart', () => {
    clearSafeModePrefs()
    registerBroker()
    return true
  })
  ipcMain.handle('broker:prepareConversation', async (_e, conversationId: string) => {
    const id = typeof conversationId === 'string' ? conversationId.trim() : ''
    if (!id) return { ok: false as const, error: 'missing_conversation_id' }
    try {
      await ensureBrokerSessionForConversation(id, { phase: 'ui-focus' })
      return { ok: true as const }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

    ipcMain.handle('broker:status:get', () => {
    const modelInput =
      brokerResolvedModel ?
        resolveModelInputTypes(
          hostAgentDir(),
          brokerResolvedModel.provider,
          brokerResolvedModel.modelId,
        )
      : (['text'] as ('text' | 'image')[])
    return {
      ready: brokerAgentReady,
      safeMode: db.getPref('sylo.safe_mode', false),
      initError: brokerLastSurfaceError ?? null,
      lastCapturedLogs: brokerLastCapturedLogs || null,
      resolvedModel: brokerResolvedModel,
      modelInput,
      visionCapable: modelInput.includes('image'),
    }
  })

  ipcMain.handle('broker:system-prompt-stats:get', () => brokerSystemPromptStats)
  ipcMain.handle('broker:context-window-stats:get', () => brokerActualMessageTokens)


  ipcMain.handle('capabilities:settings', () => readSettingsJson())
  ipcMain.handle('capabilities:writeSettings', (_e, next: Record<string, unknown>) => {
    writeSettingsJson(next)
    return true
  })

  ipcMain.handle('ollama:listTags', (_e, baseOrigin: string) => fetchOllamaTagNames(baseOrigin))

  ipcMain.handle('ollama:probeVision', async (_e, baseOrigin: string, modelId: string) => {
    if (typeof baseOrigin !== 'string' || typeof modelId !== 'string') {
      return { ok: false as const, error: 'bad_args' }
    }
    return probeOllamaVision(baseOrigin, modelId)
  })

  ipcMain.handle('models:getInputConfig', (_e, provider: unknown, modelId: unknown) => {
    if (typeof provider !== 'string' || typeof modelId !== 'string') {
      return { ok: false as const, error: 'bad_args' }
    }
    const agentDir = hostAgentDir()
    const cfg = readModelInputConfig(agentDir, provider, modelId.trim())
    return { ok: true as const, ...cfg }
  })

  ipcMain.handle('models:setVision', (_e, provider: unknown, modelId: unknown, visionCapable: unknown) => {
    if (typeof provider !== 'string' || typeof modelId !== 'string' || typeof visionCapable !== 'boolean') {
      return { ok: false as const, error: 'bad_args' }
    }
    const agentDir = hostAgentDir()
    return writeModelInputTypes(agentDir, provider, modelId.trim(), visionCapable)
  })

  ipcMain.handle('ollama:inferBaseUrl', () => {
    const pref = (db.getPref('sylo.ollama_base_url', '') as string).trim()
    if (pref) return normalizeOllamaOrigin(pref)
    const agentDir = hostAgentDir()
    return inferOllamaBaseOriginFromModelsJson(agentDir) ?? 'http://127.0.0.1:11434'
  })

  ipcMain.handle(
    'pi:patchOllamaBaseUrl',
    async (
      _e,
      baseOrigin: string,
      ensureModelId?: unknown,
      visionCapable?: unknown,
    ) => {
      const agentDir = hostAgentDir()
      const extra = typeof ensureModelId === 'string' ? ensureModelId.trim() : undefined
      const patch = patchOllamaBaseUrlInModelsJson(agentDir, baseOrigin, extra)
      if (!patch.ok || !extra) return patch

      let vision = typeof visionCapable === 'boolean' ? visionCapable : null
      if (vision === null) {
        const cfg = readModelInputConfig(agentDir, 'ollama', extra)
        if (!cfg.explicit) {
          const probed = await probeOllamaVision(baseOrigin, extra)
          if (probed.ok) vision = probed.vision
        }
      }
      if (vision !== null) {
        const wrote = writeModelInputTypes(agentDir, 'ollama', extra, vision)
        if (!wrote.ok) return wrote
      }
      return { ok: true as const }
    },
  )

  // ── Provider API keys (stored in Pi's ~/.pi/agent/auth.json) ──
  ipcMain.handle(
    'pi:getProviderAuth',
    (_e, provider: unknown) => {
      if (typeof provider !== 'string' || provider.trim() === '') {
        return { ok: false as const, error: 'bad_args' }
      }
      return readProviderAuthInfo(hostAgentDir(), provider.trim())
    },
  )

  ipcMain.handle(
    'pi:setProviderAuth',
    (_e, provider: unknown, key: unknown) => {
      if (typeof provider !== 'string' || provider.trim() === '') {
        return { ok: false as const, error: 'bad_args' }
      }
      const normalized =
        typeof key === 'string' ? key : key === null || key === undefined ? '' : null
      if (normalized === null) return { ok: false as const, error: 'bad_args' }
      return writeProviderAuthKey(hostAgentDir(), provider.trim(), normalized)
    },
  )

  // ── OpenRouter free-model list (public endpoint, cached per panel session) ──
  ipcMain.handle('openrouter:listModels', async () => {
    const r = await fetchOpenRouterFreeModels()
    if ('error' in r) return { ok: false as const, error: r.error }
    return { ok: true as const, models: r.models, source: r.source }
  })

  ipcMain.handle('capabilities:disabled:get', () => readSyloDisabledCapabilities())

  ipcMain.handle('capabilities:disabled:set', (_e, next: unknown) => {
    const j = (next && typeof next === 'object' ? next : {}) as Record<string, unknown>
    writeSyloDisabledCapabilities({
      skillPaths: normalizePathListForDisabledJson(j.skillPaths),
      extensionPaths: normalizePathListForDisabledJson(j.extensionPaths),
      disabledTools: normalizeDisabledToolsJson(j.disabledTools),
    })
    return true
  })

  ipcMain.handle('capabilities:disabled:patch', (_e, patch: Record<string, unknown> | undefined) => {
    const kind = patch?.kind
    const excluded = patch?.excluded
    if (typeof excluded !== 'boolean') {
      return { ok: false as const, error: 'bad_excluded' }
    }
    if (kind === 'tool') {
      const extensionPath = patch?.extensionPath
      const toolName = patch?.toolName
      if (typeof extensionPath !== 'string' || !extensionPath.trim()) {
        return { ok: false as const, error: 'bad_extensionPath' }
      }
      if (typeof toolName !== 'string' || !toolName.trim()) {
        return { ok: false as const, error: 'bad_toolName' }
      }
      const disabled = patchSyloDisabledCapability({
        kind: 'tool',
        extensionPath,
        toolName,
        excluded,
      })
      return { ok: true as const, disabled }
    }
    if (kind !== 'skill' && kind !== 'extension') {
      return { ok: false as const, error: 'bad_kind' }
    }
    const pathRaw = patch?.path
    if (typeof pathRaw !== 'string' || !pathRaw.trim()) {
      return { ok: false as const, error: 'bad_path' }
    }
    const disabled = patchSyloDisabledCapability({
      kind,
      path: pathRaw,
      excluded,
    })
    return { ok: true as const, disabled }
  })

  ipcMain.handle('capabilities:discover', (_e, workspaceId?: unknown) => {
    const agentDir = hostAgentDir()
    const wid =
      typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : db.defaultWorkspaceId()
    const piCwd = effectivePiCwdForWorkspace(wid)
    const includeCursorSkills = readIncludeCursorSkillsPref()
    const fs = discoverFilesystemCapabilities(agentDir, piCwd, includeCursorSkills)
    const widForPolicy = typeof workspaceId === 'string' ? workspaceId : null
    const merged = mergedDisabledForWorkspace(widForPolicy)
    const skillDis = new Set(merged.skillPaths)
    const extDis = new Set(merged.extensionPaths)
    return {
      skills: withExcludedSkillRows(fs.skills, skillDis),
      extensions: withExcludedExtensionRows(fs.extensions, extDis),
      agentDir,
      piCwd,
      includeCursorSkills,
    }
  })

  ipcMain.handle('capabilities:list', async (_e, workspaceId?: unknown) => {
    const agentDir = hostAgentDir()
    const wid =
      typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : db.defaultWorkspaceId()
    const piCwd = effectivePiCwdForWorkspace(wid)
    const packageInventory = listPiPackageInventory(piCwd, agentDir)
    const settings = readSettingsJson()
    const packages = Array.isArray(settings.packages)
      ? (settings.packages as unknown[]).map(String)
      : []
    const includeCursorSkills = readIncludeCursorSkillsPref()
    const fs = discoverFilesystemCapabilities(agentDir, piCwd, includeCursorSkills)
    const widForPolicy = typeof workspaceId === 'string' ? workspaceId : null
    const disabledCaps = mergedDisabledForWorkspace(widForPolicy)
    const skillDis = new Set(disabledCaps.skillPaths)
    const extDis = new Set(disabledCaps.extensionPaths)

    const fsExtensionsForUI: ExtensionUI[] = fs.extensions.map((e) => {
      const hint = syloExtensionHintForPath(e.path)
      return {
        ...e,
        tools: [],
        commandNames: [],
        ...(hint ? { builtinHint: hint } : {}),
      }
    })

    if (!brokerAgentReady || !broker) {
      return {
        agentDir,
        piCwd,
        brokerReady: false,
        brokerOk: false,
        brokerError: undefined,
        skills: withExcludedSkillRows(fs.skills, skillDis),
        extensions: withExcludedExtensionRows(fsExtensionsForUI, extDis),
        packages,
        packageInventory,
        loadErrors: [],
        toolNameCollisions: {},
      }
    }

    try {
      const snap = await broker.requestCapabilities(4000)
      const toolNameCollisions = snap.toolNameCollisions ?? {}
      const loadedExtensions: ExtensionUI[] = snap.extensions.map((e) => {
        const origin = classifyExtensionPath(e.path, agentDir, piCwd)
        const hint = syloExtensionHintForPath(e.path)
        return {
          name: e.name,
          path: e.path,
          resolvedPath: e.resolvedPath,
          origin,
          tools: e.tools,
          commandNames: e.commandNames,
          excludedFromAgent: false,
          ...(hint ? { builtinHint: hint } : {}),
        }
      })
      const extensionsMerged = mergeExtensionsByPath([...loadedExtensions, ...fsExtensionsForUI]).sort(
        (a, b) => a.name.localeCompare(b.name),
      )
      const extensions = withExcludedExtensionRows(
        annotateExtensionToolsWithCollisions(extensionsMerged, toolNameCollisions),
        extDis,
      )

      const loadedSkills: SkillEntry[] = filterSkillsToOperatorScope(
        snap.skills.map((s) => ({
          name: s.name,
          path: s.path,
          origin: classifySkillPath(s.path, agentDir, piCwd, includeCursorSkills),
          excludedFromAgent: false,
        })),
        agentDir,
        piCwd,
        includeCursorSkills,
      )
      const skillsMerged = filterSkillsToOperatorScope(
        mergeSkills([...loadedSkills, ...fs.skills]).sort((a, b) => a.name.localeCompare(b.name)),
        agentDir,
        piCwd,
        includeCursorSkills,
      )
      const skills = withExcludedSkillRows(skillsMerged, skillDis)

      return {
        agentDir,
        piCwd,
        brokerReady: true,
        brokerOk: true,
        brokerError: undefined,
        skills,
        extensions,
        packages,
        packageInventory,
        loadErrors: snap.loadErrors,
        toolNameCollisions,
      }
    } catch (e) {
      return {
        agentDir,
        piCwd,
        brokerReady: brokerAgentReady,
        brokerOk: false,
        brokerError: e instanceof Error ? e.message : String(e),
        skills: withExcludedSkillRows(fs.skills, skillDis),
        extensions: withExcludedExtensionRows(fsExtensionsForUI, extDis),
        packages,
        packageInventory,
        loadErrors: [],
        toolNameCollisions: {},
      }
    }
  })

  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))

  ipcMain.handle('shell:openExternal', (_e, raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false as const, error: 'empty_url' }
    }
    void shell.openExternal(raw.trim())
    return { ok: true as const }
  })

  ipcMain.handle('shell:resolveLocalPath', (_e, raw: unknown, workspaceId?: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false as const, error: 'empty_path', tried: [] as string[] }
    }
    const wid =
      typeof workspaceId === 'string' && workspaceId.trim() ?
        workspaceId.trim()
      : db.defaultWorkspaceId()
    const { piCwd } = resolvePiPackageContext(wid)
    const hit = resolveLocalPathOnDisk(raw, piCwd)
    if (hit.ok) return { ok: true as const, path: hit.path }
    return { ok: false as const, error: 'not_found', tried: hit.tried }
  })

  ipcMain.handle('shell:showItemInFolder', (_e, raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) return 'empty_path'
    shell.showItemInFolder(raw.trim())
    return ''
  })

  ipcMain.handle('shell:openDirectory', async (_e, raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false as const, error: 'empty_path' }
    }
    return openDirectoryInShell(raw)
  })

  /**
   * Open the SKILL.md file inside a skill folder using the OS-default handler
   * for `.md` (typically the operator's text editor — VS Code, Cursor, Notepad,
   * Obsidian, etc., depending on file association). Falls back to opening the
   * folder if SKILL.md isn't present so the action still does *something* useful.
   * Returns the empty string on success per Electron's `shell.openPath` contract,
   * or an error string on failure.
   */
  ipcMain.handle('shell:openSkillFile', async (_e, folderPath: string) => {
    if (!folderPath) return 'no path'
    const skillMd = join(folderPath, 'SKILL.md')
    const target = existsSync(skillMd) ? skillMd : folderPath
    return shell.openPath(target)
  })

  ipcMain.handle('skills:removeStandalone', (_e, reportedPath: unknown, workspaceId?: unknown) => {
    if (typeof reportedPath !== 'string' || !reportedPath.trim()) {
      return { ok: false as const, error: 'Missing skill path' }
    }
    const { piCwd, agentDir } = resolvePiPackageContext(workspaceId)
    return removeStandaloneSkillFolder(
      reportedPath,
      agentDir,
      piCwd,
      SYLO_REPO_ROOT,
      readIncludeCursorSkillsPref(),
    )
  })
  ipcMain.handle('dialog:openDirectory', async (_e, opts?: { title?: string; defaultPath?: string }) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: typeof opts?.title === 'string' && opts.title.trim() ? opts.title.trim() : undefined,
      defaultPath:
        typeof opts?.defaultPath === 'string' && opts.defaultPath.trim() ?
          opts.defaultPath.trim()
        : undefined,
    })
    return r.filePaths[0]
  })

  ipcMain.handle(
    'dialog:openFile',
    async (
      _e,
      opts?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
      },
    ) => {
      const r = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        title: typeof opts?.title === 'string' && opts.title.trim() ? opts.title.trim() : undefined,
        defaultPath:
          typeof opts?.defaultPath === 'string' && opts.defaultPath.trim() ?
            opts.defaultPath.trim()
          : undefined,
        filters:
          Array.isArray(opts?.filters) && opts.filters.length > 0 ?
            opts.filters
          : [{ name: 'All files', extensions: ['*'] }],
      })
      return r.filePaths[0]
    },
  )

  ipcMain.handle('files:saveCopyAs', async (_e, args?: unknown) => {
    if (!mainWindow) return { ok: false as const, error: 'no_window' }
    const a = args as
      | { sourcePath?: unknown; suggestedName?: unknown; workspaceId?: unknown }
      | undefined
    const rawSource = typeof a?.sourcePath === 'string' ? a.sourcePath.trim() : ''
    if (!rawSource) return { ok: false as const, error: 'empty_source' }

    const wid =
      typeof a?.workspaceId === 'string' && a.workspaceId.trim() ?
        a.workspaceId.trim()
      : activeWorkspaceId()
    const { piCwd } = resolvePiPackageContext(wid)
    const resolved = resolveSourcePathForSave(rawSource, piCwd)
    if (!resolved.ok) return { ok: false as const, error: resolved.error }

    const suggested =
      typeof a?.suggestedName === 'string' && a.suggestedName.trim() ?
        a.suggestedName.trim()
      : basename(resolved.path)
    const extFromSuggested = extname(suggested)
    const ext = extFromSuggested || extname(resolved.path) || '.wav'
    const baseName = suggested.endsWith(ext) ? suggested : `${suggested}${ext}`
    const defaultPath = join(piCwd, baseName)

    const filterExt = (ext.replace(/^\./, '') || 'wav').toLowerCase()
    const filterName = filterExt === 'wav' ? 'WAV audio' : 'File'

    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Save audio file',
      defaultPath,
      filters: [{ name: filterName, extensions: [filterExt] }],
    })
    if (r.canceled || !r.filePath) return { ok: false as const, cancelled: true as const }

    try {
      copyFileSync(resolved.path, r.filePath)
      return { ok: true as const, path: r.filePath }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

  /** Read a local text file (UTF-8) for renderer drag-drop / canvas preview.
   *  Mirrors the canvas markdown cap (CANVAS_MAX_BYTES) so huge files truncate
   *  instead of hogging memory. Used by the canvas popout window, which can't
   *  receive `canvas:show` (that goes to the main window). */
  ipcMain.handle('files:readTextFile', (_e, pathArg?: unknown) => {
    const p = typeof pathArg === 'string' ? pathArg.trim() : ''
    if (!p) return { ok: false as const, error: 'empty_path' }
    try {
      if (!existsSync(p)) return { ok: false as const, error: 'not_found' }
      const buf = readFileSync(p, 'utf8')
      const truncated = buf.length > CANVAS_MAX_BYTES
      const content = truncated ? `${buf.slice(0, CANVAS_MAX_BYTES)}\n\n<!-- truncated -->` : buf
      return { ok: true as const, content, truncated }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:restore', async (_e, repoRoot: string, fileRel: string) => {
    return await new Promise<{ ok: boolean; err?: string }>((resolve) => {
      execFile(
        'git',
        ['restore', fileRel],
        { cwd: repoRoot },
        (err) => {
          if (err) resolve({ ok: false, err: err.message })
          else resolve({ ok: true })
        },
      )
    })
  })

  ipcMain.handle('package:installPath', (_e, specPath: string, workspaceId?: unknown) => {
    const { piCwd, agentDir } = resolvePiPackageContext(workspaceId)
    return installPackageInPiContext(specPath, piCwd, agentDir)
  })

  ipcMain.handle('package:installSpec', (_e, spec: string, workspaceId?: unknown) => {
    const { piCwd, agentDir } = resolvePiPackageContext(workspaceId)
    return installPackageInPiContext(spec, piCwd, agentDir)
  })

  ipcMain.handle('package:updateSpec', (_e, spec: string, workspaceId?: unknown) => {
    const { piCwd, agentDir } = resolvePiPackageContext(workspaceId)
    return updatePackageInPiContext(spec, piCwd, agentDir)
  })

  ipcMain.handle('package:uninstallSpec', (_e, spec: string, workspaceId?: unknown) => {
    const { piCwd, agentDir } = resolvePiPackageContext(workspaceId)
    return removePackageInPiContext(spec, piCwd, agentDir)
  })

  ipcMain.handle('package:piDevCatalog', async (_e, query: PiDevCatalogQuery) => {
    return fetchPiDevCatalog(query ?? {})
  })

  ipcMain.handle('package:searchPiPackages', async (_e, query: string) => {
    try {
      const raw = query.trim() || 'pi agent tools'
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(raw)}&size=40`
      const res = await fetch(url)
      if (!res.ok) {
        return { ok: false as const, error: `npm registry responded ${res.status}` }
      }
      const data = (await res.json()) as {
        objects?: Array<{ package: { name: string; description?: string; keywords?: string[] } }>
      }
      const packages = (data.objects ?? [])
        .filter((o) =>
          (o.package.keywords ?? []).some((k) => String(k).toLowerCase() === 'pi-package'),
        )
        .slice(0, 24)
        .map((o) => ({
          name: o.package.name,
          description: o.package.description ?? '',
        }))
      return { ok: true as const, packages }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

  ipcMain.handle('optional-packages:installPythonDeps', async (_e, packageId: unknown) => {
    const id = typeof packageId === 'string' ? packageId.trim() : ''
    if (!id) return { ok: false as const, error: 'missing_package_id' }
    return installOptionalPackagePythonDeps(SYLO_REPO_ROOT, id)
  })

  ipcMain.handle('optional-packages:pythonReadiness', async () => getPythonReadiness())

  ipcMain.handle(
    'chat:writePastedImage',
    (_e, payload: { data: unknown; mimeType: string }): { path: string; name: string } => {
      const mimeType =
        typeof payload?.mimeType === 'string' && payload.mimeType.trim() ?
          payload.mimeType.trim()
        : 'image/png'
      const buf = clipboardImagePayloadToBuffer(payload?.data)
      if (!buf || buf.length === 0) {
        throw new Error('empty_clipboard_image')
      }
      const dir = ensurePasteImagesDir(app.getPath('userData'))
      const ext = extForClipboardImageMime(mimeType)
      const base = `paste-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
      const full = join(dir, base)
      writeFileSync(full, buf)
      return { path: full, name: base }
    },
  )

  ipcMain.handle(
    'chat:send',
    async (
      _e,
      conversationId: string,
      text: string,
      attachments?: RawAttachment[],
    ) => {
      const id = typeof conversationId === 'string' ? conversationId.trim() : ''
      const body = typeof text === 'string' ? text.trim() : ''
      if (!id) return { assistantMessageId: '', error: 'missing_conversation_id' as const }
      return chainConversationChatOp(id, async () => {
        const started = await startChatTurn(id, body, normalizeAttachments(attachments))
        if (!started.ok) {
          return { assistantMessageId: started.assistantMessageId, error: 'broker_not_ready' as const }
        }
        if (started.deferred) {
          return { assistantMessageId: started.assistantMessageId, deferred: true as const }
        }
        return { assistantMessageId: started.assistantMessageId }
      })
    },
  )

  ipcMain.handle(
    'chat:deliverQueued',
    async (
      _e,
      conversationId: string,
      text: string,
      attachments?: RawAttachment[],
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const id = typeof conversationId === 'string' ? conversationId.trim() : ''
      const body = typeof text === 'string' ? text.trim() : ''
      if (!id) return { ok: false, error: 'missing_conversation_id' }
      if (!body) return { ok: false, error: 'empty_message' }
      return chainConversationChatOp(id, () =>
        deliverQueuedMessage(id, body, normalizeAttachments(attachments)),
      )
    },
  )

  ipcMain.handle(
    'chat:abort',
    async (
      _e,
      conversationId: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const id = typeof conversationId === 'string' ? conversationId.trim() : ''
      if (!id) return { ok: false, error: 'missing_conversation_id' }
      if (!brokerAgentReady || !broker) return { ok: false, error: 'broker_not_ready' }

      const active = findPendingTurnForConversation(id)
      if (active) {
        const [turnId, pending] = active
        pending.aborted = true
        const assigned = turnBrokerPool.supervisorForTurn(turnId) ?? broker
        finalizePendingTurn(turnId, pending, 'cancelled')
        assigned?.abort()
        void flushDeferredTurns()
        return { ok: true }
      }
      return { ok: false, error: 'no_active_turn' }
    },
  )

  ipcMain.handle(
    'chat:steer',
    async (
      _e,
      conversationId: string,
      text: string,
      attachments?: RawAttachment[],
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const id = typeof conversationId === 'string' ? conversationId.trim() : ''
      const body = typeof text === 'string' ? text.trim() : ''
      if (!id) return { ok: false, error: 'missing_conversation_id' }
      if (!body) return { ok: false, error: 'empty_message' }
      if (!brokerAgentReady || !broker || db.getPref('sylo.safe_mode', false)) {
        return { ok: false, error: 'broker_not_ready' }
      }

      const normAttachments = normalizeAttachments(attachments)
      return chainConversationChatOp(id, async () => {
        const active = findPendingTurnForConversation(id)
        if (!active) {
          finalizeOrphanStreamingAssistants(id)
          const started = await startChatTurn(id, body, normAttachments)
          return started.ok ? { ok: true as const } : { ok: false as const, error: started.error }
        }
        const followUp = await followUpActiveTurn(id, body, normAttachments, { steer: true })
        return followUp.ok ? { ok: true as const } : { ok: false as const, error: followUp.error }
      })
    },
  )

  ipcMain.handle(
    'chat:branchConversation',
    async (
      _e,
      conversationId: string,
    ): Promise<
      { ok: true; conversationId: string; pi_session_relpath: string } | { ok: false; error: string }
    > => {
      const id = typeof conversationId === 'string' ? conversationId.trim() : ''
      if (!id) return { ok: false, error: 'missing_conversation_id' }
      if (!brokerAgentReady || !broker) {
        return { ok: false, error: 'Broker not running or not ready' }
      }
      const source = db.getConversation(id)
      if (!source) return { ok: false, error: 'conversation_not_found' }
      const hasUser = db.listMessages(id).some((m) => m.role === 'user')
      if (!hasUser) return { ok: false, error: 'No user message to branch before' }
      let branchedId: string | undefined
      try {
        await ensureBrokerSessionForConversation(id)
        const { sessionFileAbs } = await broker.forkBeforeLastUser()
        const agentDir = hostAgentDir()
        const rel = relativeSessionPathFromAbsolute(agentDir, sessionFileAbs)
        const baseTitle = source.title?.trim() || 'Chat'
        const branchTitle = `${baseTitle} (branch)`
        const newConv = db.createConversation(branchTitle, source.workspace_id ?? undefined)
        branchedId = newConv.id
        db.setConversationSessionRelPath(newConv.id, rel)
        const copied = db.copyMessagesBeforeLastUser(id, newConv.id)
        if (copied === 'no_user_message') {
          fullyRemoveConversation(app.getPath('userData'), hostAgentDir(), newConv.id)
          return { ok: false, error: 'No user message to branch before' }
        }
        await ensureBrokerSessionForConversation(newConv.id)
        brokerFocusedConversationId = newConv.id
        brokerLastSessionAbs = sessionFileAbs
        brokerLastSessionCwd = sessionBindingForConversation(newConv.id).sessionCwd
        return { ok: true, conversationId: newConv.id, pi_session_relpath: rel }
      } catch (e) {
        if (branchedId) {
          fullyRemoveConversation(app.getPath('userData'), hostAgentDir(), branchedId)
        }
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  ipcMain.handle('skills:saveFromChat', (_e, name: string, description: string, body: string) => {
    const agentDir = hostAgentDir()
    const dir = join(agentDir, 'skills', name)
    mkdirSync(dir, { recursive: true })
    const md = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
    writeFileSync(join(dir, 'SKILL.md'), md, 'utf8')
    return { path: dir }
  })

  ipcMain.handle('safeMode:clear', () => {
    clearSafeModePrefs()
    return true
  })

  ipcMain.handle('companion:getStatus', () => getCompanionStatus())

  ipcMain.handle('companion:openCertsFolder', () => {
    openCompanionCertsFolder()
    return true
  })

  ipcMain.handle(
    'companion:setConfig',
    async (
      _e,
      patch: { enabled?: unknown; bind?: unknown; port?: unknown },
    ) => {
      const nextPatch: { enabled?: boolean; bind?: 'loopback' | 'lan'; port?: number } = {}
      if (typeof patch?.enabled === 'boolean') nextPatch.enabled = patch.enabled
      if (patch?.bind === 'loopback' || patch?.bind === 'lan') nextPatch.bind = patch.bind
      if (typeof patch?.port === 'number') nextPatch.port = patch.port
      return applyCompanionConfig(nextPatch)
    },
  )

  ipcMain.handle(
    'companion:setCredentials',
    async (_e, payload: { username?: unknown; password?: unknown }) => {
      const username = typeof payload?.username === 'string' ? payload.username : ''
      const password = typeof payload?.password === 'string' ? payload.password : ''
      return saveCompanionCredentials(username, password)
    },
  )
}

async function pullGithubBackupWorkspacesOnStartup(): Promise<void> {
  const rows = db.listGithubBackupWorkspaces()
  if (rows.length === 0) return
  for (const ws of rows) {
    // Skip workspaces whose configured folder is missing on disk — resolving
    // via the fallback would recreate the primary folder and pull the wrong
    // repo into it. A missing primary folder is handled by the restore prompt.
    const rawCwd = ws.pi_cwd?.trim() ?? ''
    if (!rawCwd || !existsSync(rawCwd)) {
      console.warn('[sylo workspace backup] skipped (folder missing on disk)', ws.name)
      continue
    }
    const cwd = effectivePiCwdForWorkspace(ws.id)
    try {
      const linked = await linkWorkspaceGitRepo(cwd, ws.github_remote_url)
      if (!linked.ok) {
        console.warn('[sylo workspace backup] link failed', ws.name, linked.error, linked.detail)
        continue
      }
            const pulled = await pullWorkspaceGitRepo(cwd, { token: readGithubToken() ?? undefined })
      if (pulled.ok) {
        db.touchWorkspaceGithubSync(ws.id, Date.now())
        console.info('[sylo workspace backup] pulled', ws.name)
      } else {
        console.warn('[sylo workspace backup] pull failed', ws.name, pulled.error, pulled.detail)
      }
    } catch (e) {
            console.warn('[sylo workspace backup] pull error', ws.name, e)
    }
  }
}

/** Push every GitHub-linked workspace; returns the per-workspace results. */
async function pushAllGithubBackupWorkspaces(): Promise<{
  ok: true
  results: {
    workspaceId: string
    name: string
    result: Awaited<ReturnType<typeof pushWorkspaceGitRepo>>
  }[]
}> {
  const rows = db.listGithubBackupWorkspaces()
  const results: {
    workspaceId: string
    name: string
    result: Awaited<ReturnType<typeof pushWorkspaceGitRepo>>
  }[] = []
  for (const ws of rows) {
    const cwd = effectivePiCwdForWorkspace(ws.id)
    const linked = await linkWorkspaceGitRepo(cwd, ws.github_remote_url)
    if (!linked.ok) {
      results.push({ workspaceId: ws.id, name: ws.name, result: linked })
      continue
    }
        const pushed = await pushWorkspaceGitRepo(cwd, { token: readGithubToken() ?? undefined })
    if (pushed.ok) db.touchWorkspaceGithubSync(ws.id, Date.now())
    results.push({ workspaceId: ws.id, name: ws.name, result: pushed })
  }
  return { ok: true, results }
}

/** Detect linked workspaces with uncommitted or unpushed changes (without pushing). */
async function detectUnpushedGithubWorkspaces(): Promise<string[]> {
  const rows = db.listGithubBackupWorkspaces()
  const names: string[] = []
  for (const ws of rows) {
    const cwd = effectivePiCwdForWorkspace(ws.id)
    if (!cwd) continue
    try {
      const st = await readWorkspaceGitStatus(cwd)
      if (st.isRepo && st.remoteUrl && (st.dirty || st.ahead > 0)) {
        names.push(ws.name)
      }
    } catch {
      /* ignore individual failures */
    }
  }
  return names
}

/**
 * Write the current git HEAD sha to <repo>/.sylo-last-good once the main
 * process has booted far enough to load the renderer. This is the deep-fallback
 * revert target for the standalone sylo-supervisor: if a restart fails to boot
 * even from the last commit, the supervisor resets to this sha. Fire-and-forget;
 * never throws — a missing/stale marker just means the supervisor skips the
 * deep fallback and notifies the operator to RDP.
 */
function markLastGoodCommit(): void {
  try {
    execFile('git', ['-C', SYLO_REPO_ROOT, 'rev-parse', 'HEAD'], (err, stdout) => {
      if (err) return
      const sha = String(stdout).trim()
      if (!/^[0-9a-f]{7,40}$/.test(sha)) return
      try {
        writeFileSync(join(SYLO_REPO_ROOT, '.sylo-last-good'), sha, 'utf8')
      } catch {
        /* ignore */
      }
    })
  } catch {
    /* ignore */
  }
}

function createWindow(): void {
  const devRendererUrl = process.env.ELECTRON_RENDERER_URL
  createSplashWindow()
  const splashActive = splashWindow !== undefined

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0f1115',
    show: !splashActive,
    ...appIconWindowOptions(),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
    let allowingClose = false
  let closeCheckInFlight = false
  mainWindow.on('close', async (e) => {
    if (allowingClose) return
    if (closeCheckInFlight) {
      e.preventDefault()
      return
    }
    closeCheckInFlight = true
    e.preventDefault()
    try {
      const unpushed = await detectUnpushedGithubWorkspaces()
      const mw = mainWindow
      if (!mw || mw.isDestroyed()) return
      if (unpushed.length === 0) {
        allowingClose = true
        mw.close()
        return
      }
      const choice = await dialog.showMessageBox(mw, {
        type: 'question',
        buttons: ['Push, then close', 'Close anyway', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unpushed workspace changes',
        message: `${unpushed.length} workspace(s) have unpushed changes: ${unpushed.join(', ')}.`,
        detail: 'Push them to GitHub before closing, close without pushing, or cancel to stay open.',
      })
      if (choice.response === 2) return // cancel — keep Sylo open
      if (choice.response === 0) {
        const res = await pushAllGithubBackupWorkspaces()
        const failed = res.results.filter(
          (r) => !r.result.ok && !(r.result.error === 'nothing_to_push'),
        )
        if (failed.length > 0 && !mw.isDestroyed()) {
          const retry = await dialog.showMessageBox(mw, {
            type: 'warning',
            buttons: ['Close anyway', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            title: 'Some pushes failed',
            message: `${failed.length} workspace(s) failed to push: ${failed.map((f) => f.name).join(', ')}.`,
            detail: failed
              .map((f) => `${f.name}: ${f.result.ok ? f.result.detail ?? 'push failed' : f.result.error}`)
              .join('\n'),
          })
          if (retry.response === 1) return // cancel — keep Sylo open so the user can investigate
        }
      }
      // Close anyway, or push succeeded — proceed.
      allowingClose = true
      mw.close()
    } finally {
      closeCheckInFlight = false
    }
  })

  mainWindow.on('closed', () => {
    dismissSplash()
    mainWindow = undefined
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[sylo] renderer did-fail-load:', code, desc, url)
    dismissSplash()
    const mw = mainWindow
    if (mw && !mw.isDestroyed()) {
      mw.show()
      void mw.focus()
    }
  })

  if (devRendererUrl) {
    void mainWindow.loadURL(devRendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (devRendererUrl && process.env.SYLO_DEVTOOLS !== '0') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    })
  }

  mainWindow.webContents.on('did-finish-load', () => {
    markWindowSessionActive()
    dismissSplash()
    void markLastGoodCommit()
    const mw = mainWindow
    if (mw && !mw.isDestroyed()) {
      mw.show()
      void mw.focus()
    }
  })
}

async function maybeAutoMigrateFieldBrainDb(): Promise<void> {
  if (!readSyloOptionalPackagesPref()['sylo-fieldbrain']) return
  try {
    const config = readFieldBrainConfig(app.getPath('userData'))
    const result = await runFieldBrainScript(SYLO_REPO_ROOT, 'db_auto_migrate.py', [], config)
    if (result.migrated === true) {
      console.info(
        `[fieldbrain] Database migrated to schema ${String(result.applied_schema_version ?? '?')}`,
      )
    }
  } catch (e) {
    console.warn('[fieldbrain] Auto-migrate on startup failed:', e)
  }
}

let primaryWorkspaceFolderMissing = false

app.whenReady().then(() => {
  registerLocalImageProtocol()
  registerExternalLinkRouting()
  db.openDatabase(app.getPath('userData'), SYLO_REPO_ROOT)
  bindGithubPrefStore({
    get: (key, fallback) => db.getPref(key, fallback),
    set: (key, value) => db.setPref(key, value),
  })
  ensureDefaultCloneDir()
  // Missing user-data workspace? When the folder the primary (universal)
  // workspace row points at does not exist on disk — deleted externally, a new
  // machine, or a botched rename — do not silently re-seed a fallback folder:
  // the renderer offers create-by-name or clone-from-GitHub first, and the
  // provisioning/restore IPC handlers run the steps below once resolved.
  const primaryRow = db.listWorkspaces()[0]
  const primaryRawCwd = primaryRow?.pi_cwd?.trim() ?? ''
  const primaryExpectedDir = primaryRawCwd || db.canonicalDefaultWorkspacePiProjectPath()
  primaryWorkspaceFolderMissing = !existsSync(primaryExpectedDir)
  if (!primaryWorkspaceFolderMissing) {
    // Seed the operator profile file in the Default workspace folder and the global
    // AGENTS.md pointer that tells every workspace where to find it. Idempotent.
    db.ensureDefaultWorkspaceSeedFiles(db.resolveSyloUserDir())
    deployGlobalAgentsFromWorkspace()
    ensureGlobalAgentsMd()
  } else {
    console.warn(
      `[sylo workspace] primary workspace folder missing on disk: ${primaryExpectedDir} — waiting for operator setup (create or clone)`,
    )
  }
  const userData = app.getPath('userData')
  purgeStaleConversations(userData, hostAgentDir())
  subagentTaskStore.pruneStaleHostSessions(Date.now() - CONVERSATION_RETENTION_MS)
  pruneStaleWebAccessRuns(Date.now() - CONVERSATION_RETENTION_MS)
  pruneOrphanChatAttachments(userData)
  pruneStaleTtsRouteClips(userData)
  pruneStalePdfCacheDir()
  initSubagentTaskHostSession()
  initScheduledPromptsService({
    fire: fireScheduledPromptFromHost,
    getMainWindow: () => mainWindow ?? null,
  })
  initSweepService({
    fire: (title, prompt, reader) =>
      (async () => {
        const conv = db.createConversation(title)
        if (reader) {
          db.setConversationModel(conv.id, {
            model_provider: reader.provider,
            model_id: reader.modelId,
            image_model_provider: null,
            image_model_id: null,
            thinking_level: null,
          })
        }
        const started = await startChatTurn(conv.id, prompt)
        return {
          conversationId: conv.id,
          ok: started.ok,
          error: started.ok ? undefined : started.error,
        }
      })(),
    notifyChanged: () => mainWindow?.webContents.send('sweeps:changed', {}),
  })
  registerIpc()
  // Seed the canvas open state from the saved pref, then install the custom
  // application menu (preserves the default File/Edit/View menus and adds the
  // canvas toggle under Window). The renderer re-syncs `canvasOpenState` after
  // mount via the `canvas:set-open-state` IPC.
  canvasOpenState = db.getPref<boolean>('sylo.canvas.open', false) === true
  Menu.setApplicationMenu(buildAppMenu())
  createWindow()

  const strikes = evaluateBootStrikes()
  if (strikes >= 3) {
    db.setPref('sylo.safe_mode', true)
  }

  if (!db.getPref('sylo.safe_mode', false)) {
    registerBroker()
  }

  void pullGithubBackupWorkspacesOnStartup()

  void maybeAutoMigrateFieldBrainDb()

  void restartCompanionServer()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  try {
    unlinkSync(sessionActivePath())
  } catch {
    /* */
  }
    shutdownSubagentTaskHostSession()
  shutdownScheduledPromptsService()
  shutdownSweepService()
  closeAllWorkspaceScheduleDbs()
  void stopCompanionServer()
  broker?.kill()
})
