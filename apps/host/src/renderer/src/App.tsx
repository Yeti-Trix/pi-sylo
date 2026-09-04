import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChatConversationMessageRow, type ChatMessageRowModel } from './chat/ConversationMessage'
import { ChatComposer, type ChatComposerHandle } from './chat/ChatComposer'
import { ChatModelBar } from './chat/ChatModelBar'
import { LiveElapsedLabel } from './chat/LiveElapsedLabel'
import {
  ChatTimelineList,
  CHAT_NEAR_BOTTOM_PX,
  type ChatTimelineListHandle,
} from './chat/ChatTimelineList'
import {
  buildConversationMarkdown,
  downloadTextFile,
  sanitizeExportFilename,
} from './exportChatMarkdown'
// import { WorkflowModal } from './WorkflowModal'
import { SYLO_DEFAULT_MODEL_ID, SYLO_DEFAULT_MODEL_PROVIDER } from '../../shared/sylo-model-defaults'
import { SettingsPanel } from './panels/SettingsPanel'
import { normalizeOllamaOriginUi } from './panels/ollama-ui'
import {
  type WorkflowStampedEntry,
} from './workflowTimeline'
import { WorkspaceSelect } from './components/WorkspaceSelect'
import { CanvasPanel } from './components/canvas/CanvasPanel'
import { CanvasPopoutView } from './components/canvas/CanvasPopoutView'
import { CanvasResizeHandle } from './components/canvas/CanvasResizeHandle'
import { useCanvasTabs } from './components/canvas/useCanvasTabs'
import {
  CANVAS_SIZE_DEFAULT,
  clampCanvasSize,
} from './components/canvas/canvasLayout'
import { SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR } from './skill-surface/hostCapabilityDescriptor'
import { SkillSurfaceSandbox } from './skill-surface/iframe-host'
import { CapabilityManagerPanel } from './panels/capability'
import { EvalDashboardPanel } from './panels/EvalDashboardPanel'
import { ProposalsPanel } from './panels/ProposalsPanel'
import { SchedulesPanel } from './panels/schedules/SchedulesPanel'
import { useSubagentTasks } from './panels/tasks/useSubagentTasks'
import { SubagentRunsStrip } from './components/subagent/SubagentRunsStrip'
import {
  applyThinkTankLifecycleEvent,
  type ThinkTankLiveSession,
} from './components/think-tank/ThinkTankSessionCard'
import {
  applyThinkTankBubbleEvent,
  type ThinkTankBubbleRow,
} from './components/think-tank/thinkTankBubbleState'
import {
  mergeThinkTankTurnsForExport,
  thinkTankUiBubblesFromDb,
} from './components/think-tank/mergeThinkTankExportTurns'
import { buildChatTimeline, type ChatTimelineRow } from './components/think-tank/buildChatTimeline'
import {
  ThinkTankSessionBlock,
  type ThinkTankSessionUiState,
} from './components/think-tank/ThinkTankSessionBlock'
import { thinkTankSessionViewsFromDb } from './components/think-tank/thinkTankSessionViewsFromDb'
import {
  banner,
  bannerMuted,
  btnDanger,
  btnDangerSm,
  btnGhost,
  btnGhostSm,
  btnPrimary,
  convActionBtn,
  convActionDanger,
  convRow,
  convRowActions,
  convRowMain,
  convRowSelect,
  convRowSelectActive,
  convRowSelectLabel,
  convRowSelected,
  convStatusDot,
  convStatusDotRead,
  convStatusDotUnread,
  convStatusSpinner,
  leadText,
  mainContent,
  mutedText,
  navBtn,
  navBtnActive,
  navBtnRoute,
  navRouteRow,
  navSectionDetails,
  navSectionSummary,
  routeCtxItem,
  routeCtxItemDanger,
  shellGrid,
  sidebar,
  sidebarBrandRow,
  sidebarBrandTitle,
  sidebarChatFolderBar,
  sidebarAsideCollapsed,
  sidebarConvList,
  sidebarDevList,
  sidebarDevPanel,
  sidebarDragHandle,
  sidebarResizeBtn,
  sidebarResizeBtnCollapsed,
  sidebarWorkspaceEditBtn,
  sidebarWorkspaceLabel,
  sidebarWorkspaceLabelRow,
  chatPane,
  chatArea,
  chatStatusSubfoot,
  chatBrokerHint,
  chatTurnElapsed,
  chatTurnActions,
  chatStopBtn,
  chatStopBtnCompact,
  agentWidgetHost,
  chatWorkbench,
  ctxMenuBackdrop,
  ctxMenuShell,
  folderNewPathWrap,
  modalActions,
  modalActionsFooter,
  modalBody,
  modalBodyWorkspace,
  modalField,
  modalInput,
  modalInputFlex,
  modalLabel,
  modalOverlay,
  modalShell,
  modalShellWide,
  modalShellWorkspace,
  modalTitle,
  modalTitleWorkspace,
  panelShell,
  panelTitle,
  routePopoutBody,
  routePopoutHeader,
  routePopoutHeaderTitle,
  routePopoutLoading,
  routePopoutNotFound,
  routePopoutNotFoundPre,
  routePopoutNotFoundTitle,
  routePopoutRoot,
  settingsCaption,
  errorText,
  toolLogPre,
  workspaceEditDisclosure,
  workspaceEditDisclosureInner,
  workspaceEditDisclosureOpen,
  workspaceField,
  workspaceFieldLabel,
  workspaceFieldTight,
  workspaceFormActions,
  workspaceFormInput,
  workspaceFormInputPath,
  workspaceFormPathWrap,
  workspaceManageTable,
  workspaceManageTableTd,
  workspaceManageTableTh,
  workspaceModalDone,
  workspaceModalLead,
  workspaceModalSection,
  workspaceModalSectionAdd,
  workspaceModalSectionTitle,
  workspaceTableColEdit,
  workspaceTablePath,
  workspaceTableRowActive,
  workspaceTableWrap,
} from './panels/ui-classes'
import { cn } from './lib/cn'
import {
  logicforgeParseRulesGet,
  logicforgeParseRulesReset,
  logicforgeParseRulesSave,
  logicforgeIoReviewApproveBuild,
  logicforgeIoReviewGet,
  logicforgeIoReviewReseed,
  logicforgeIoReviewSave,
    logicforgeDownloadAllowlistGet,
  logicforgeDownloadAllowlistSave,
  logicforgeDownloadPlcStatus,
  logicforgeTemplates,
} from './lib/logicforge-bridge'
import {
  syloWorkflowDelete,
  syloWorkflowRead,
  syloWorkflowSave,
  syloWorkflowsList,
} from './lib/sylo-workflows-bridge'
import {
  fieldbrainConfigGet,
  fieldbrainConfigSave,
  fieldbrainDbCheck,
  fieldbrainDbMigrate,
  fieldbrainDocumentList,
  fieldbrainBrainList,
  fieldbrainProjectList,
  fieldbrainProjectCreate,
  fieldbrainDbBootstrap,
  fieldbrainPgvectorEnable,
  fieldbrainPgvectorGuide,
  fieldbrainPgvectorInstallFromFolder,
  fieldbrainLogList,
} from './lib/fieldbrain-bridge'
import {
  onenoteAuthComplete,
  onenoteAuthLogout,
  onenoteAuthStart,
  onenoteAuthStatus,
  onenoteIndexSync,
  onenoteIndexProgress,
  onenoteImportLegacyCache,
  onenoteNotebookList,
  onenoteSettingsGet,
  onenoteSettingsSave,
} from './lib/onenote-bridge'
import {
  normalizeSkillRouteBridgeOp,
  refreshPersonalBridgeOps,
  type SkillRouteBridgeOp,
} from './skill-surface/bridge'
import {
  DEFAULT_SKILL_NAV_LAYOUT,
  ROUTE_NAV_SECTION_SEQUENCE,
  skillRouteRowKey,
  sortedRoutesForNavSection,
  type SkillNavLayoutState,
  type SkillRouteNavSection,
} from './skill-nav-layout'
/** Memoized personal-plugin op list (only non-empty results are cached). */
let personalOpsCache: Promise<string[]> | null = null
function getPersonalOps(): Promise<string[]> {
  if (!personalOpsCache) personalOpsCache = Promise.resolve([])
  personalOpsCache = personalOpsCache.then((ops) =>
    ops.length > 0 ? ops : (window.sylo.personal?.ops() ?? Promise.resolve([])),
  )
  return personalOpsCache
}

function parseRoutePopoutKey(): string | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  if (!raw.startsWith('popout-route=')) return null
  return decodeURIComponent(raw.slice('popout-route='.length))
}

function parseCanvasPopoutKey(): string | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  if (raw.startsWith('popout-canvas=')) {
    return decodeURIComponent(raw.slice('popout-canvas='.length))
  }
  // Live popout window: `#popout-canvas-live=<liveId>`. `CanvasPopoutView`
  // probes `getPopout` (snapshot) first, then `getLivePopout` (live), so a single
  // `popoutId` covers both variants.
  if (raw.startsWith('popout-canvas-live=')) {
    return decodeURIComponent(raw.slice('popout-canvas-live='.length))
  }
  return null
}

function normalizeNavLayoutPref(raw: unknown): SkillNavLayoutState {
  if (!raw || typeof raw !== 'object' || raw === null) return { ...DEFAULT_SKILL_NAV_LAYOUT }
  const o = raw as Record<string, unknown>
  const hidden = Array.isArray(o.hidden)
    ? o.hidden.filter((x): x is string => typeof x === 'string')
    : []
  const pinned = Array.isArray(o.pinned)
    ? o.pinned.filter((x): x is string => typeof x === 'string')
    : []
  const rawOrder =
    o.order && typeof o.order === 'object' && o.order !== null
      ? (o.order as Record<string, unknown>)
      : {}
  const order: Partial<Record<SkillRouteNavSection, string[]>> = {}
  for (const s of ROUTE_NAV_SECTION_SEQUENCE) {
    const v = rawOrder[s]
    order[s] = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }
  return { hidden, pinned, order }
}

/** Compare Pi cwd strings for normalizing saves (slash style, trailing slashes, case). */
function pathsEffectivelyEqual(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase()
  return norm(a) === norm(b)
}

/** Truncate path for dense table cells (full string in title). */
type ConvActivityStatus = 'running' | 'unread' | 'read'

function convActivityStatus(
  convId: string,
  sending: ReadonlySet<string>,
  unread: ReadonlySet<string>,
): ConvActivityStatus {
  if (sending.has(convId)) return 'running'
  if (unread.has(convId)) return 'unread'
  return 'read'
}

function ConvStatusIndicator({ status }: { status: ConvActivityStatus }): React.ReactElement {
  if (status === 'running') {
    return (
      <span
        className={convStatusSpinner}
        role="status"
        aria-label="Agent running"
        title="Agent running"
      />
    )
  }
  return (
    <span
      className={cn(
        convStatusDot,
        status === 'unread' ? convStatusDotUnread : convStatusDotRead,
      )}
      aria-hidden={status === 'read'}
      title={status === 'unread' ? 'Unread reply' : 'Read'}
    />
  )
}

function truncatePathMiddle(s: string, maxLen: number): string {
  const t = s.trim()
  if (t.length <= maxLen) return t
  const edge = Math.max(8, Math.floor((maxLen - 1) / 2))
  return `${t.slice(0, edge)}…${t.slice(t.length - edge)}`
}

function workspaceBackupErrorMessage(error: string, detail?: string): string {
  switch (error) {
    case 'git_not_installed':
      return 'Git is not installed. Install Git for Windows and retry.'
    case 'not_linked':
      return 'Save a GitHub URL with backup enabled first.'
    case 'not_a_repo':
      return 'Project folder is not a git repo yet. Save backup settings to link it.'
    case 'nothing_to_push':
      return 'Nothing to push (clean and up to date).'
    case 'url_required':
      return 'GitHub URL is required when backup is enabled.'
    case 'pull_failed':
      return detail ? `Pull failed: ${detail}` : 'Pull failed.'
    case 'push_failed':
      return detail ? `Push failed: ${detail}` : 'Push failed.'
    case 'link_failed':
      return detail ? `Link failed: ${detail}` : 'Link failed.'
    default:
      return detail ? `${error}: ${detail}` : error
  }
}

/**
 * Backed-up workspaces whose configured Pi project folder is missing on disk.
 * Uses the *raw* `pi_cwd` (not the resolved/fallback path) so a deleted folder is
 * detected instead of silently resolved onto the primary workspace's folder.
 * Primary/inherit workspaces (empty `pi_cwd`) are skipped — they always resolve.
 */
async function backedUpWorkspacesWithMissingFolder(
  workspaces: { id: string; name: string; pi_cwd: string; github_backup_enabled: number }[],
): Promise<{ id: string; name: string; pi_cwd: string }[]> {
  const out: { id: string; name: string; pi_cwd: string }[] = []
  for (const w of workspaces) {
    if (w.github_backup_enabled !== 1) continue
    const cwd = w.pi_cwd?.trim()
    if (!cwd) continue
    let exists = false
    try {
      exists = await window.sylo.paths.exists(cwd)
    } catch {
      exists = false
    }
    if (!exists) out.push({ id: w.id, name: w.name, pi_cwd: cwd })
  }
  return out
}

/**
 * True when the given workspace's configured folder is missing on disk.
 * Primary/inherit workspaces (empty `pi_cwd`) return false — they always resolve.
 */
async function workspaceFolderMissing(w: {
  pi_cwd: string
}): Promise<string | null> {
  const cwd = w.pi_cwd?.trim()
  if (!cwd) return null
  try {
    if (await window.sylo.paths.exists(cwd)) return null
  } catch {
    /* treat as missing */
  }
  return cwd
}

/** Aggregate push results into the Push-all status line. */
function summarizePushResults(
  results: { name: string; result: { ok: true; detail?: string } | { ok: false; error: string; detail?: string } }[],
  skippedMissing: number,
): string {
  const ok = results.filter((r) => r.result.ok).length
  const failed = results.filter(
    (r): r is { name: string; result: { ok: false; error: string; detail?: string } } => !r.result.ok,
  )
  const upToDate = failed.filter((r) => r.result.error === 'nothing_to_push').length
  const errors = failed.filter((r) => r.result.error !== 'nothing_to_push')
  const parts = [`Pushed ${ok} workspace(s).`]
  if (upToDate > 0) parts.push(`${upToDate} already up to date.`)
  if (skippedMissing > 0) parts.push(`${skippedMissing} skipped (folder missing).`)
  if (errors.length > 0) {
    parts.push(
      errors
        .map((r) => `${r.name}: ${workspaceBackupErrorMessage(r.result.error, r.result.detail)}`)
        .join(' '),
    )
  }
  return parts.join(' ')
}

function describeWorkspaceGitStatus(git: {
  isRepo: boolean
  branch: string
  dirty: boolean
  ahead: number
  behind: number
  remoteUrl: string
}): string {
  if (!git.isRepo) return 'Not a git repo yet (save backup settings to link).'
  const parts: string[] = []
  if (git.branch) parts.push(`branch ${git.branch}`)
  if (git.dirty) parts.push('uncommitted changes')
  if (git.ahead > 0) parts.push(`${git.ahead} commit(s) ahead`)
  if (git.behind > 0) parts.push(`${git.behind} commit(s) behind remote`)
  if (git.remoteUrl) parts.push(`origin → ${git.remoteUrl}`)
  return parts.length > 0 ? parts.join(' · ') : 'Linked, clean, up to date'
}

type WorkspacePiProjectDirResult =
  | { ok: true }
  | { ok: false; error: 'pi_project_dir_not_found'; path: string }
  | { ok: false; error: 'mkdir_failed'; path: string; detail: string }
  | { ok: false; error: 'rename_failed'; detail: string }

async function persistWithPiProjectDirConfirm(
  save: (createPiProjectDir: boolean) => Promise<WorkspacePiProjectDirResult | { ok: true }>,
  setPathError: (msg: string) => void,
): Promise<boolean> {
  let result = await save(false)
  if (result.ok) {
    setPathError('')
    return true
  }
  if (result.error === 'pi_project_dir_not_found') {
    setPathError(`Folder does not exist: ${result.path}`)
    const create = window.confirm(
      `The Pi project directory does not exist:\n\n${result.path}\n\nCreate this folder and continue?`,
    )
    if (!create) return false
    result = await save(true)
    if (result.ok) {
      setPathError('')
      return true
    }
  }
    const msg =
    result.error === 'mkdir_failed' ?
      `Could not create folder: ${result.detail}`
    : result.error === 'rename_failed' ?
      `Could not rename workspace folder: ${result.detail}`
    : result.error === 'pi_project_dir_not_found' ?
      `Folder does not exist: ${result.path}`
    : 'Could not save workspace'
  setPathError(msg)
  return false
}

function skillNavSectionHeading(section: SkillRouteNavSection): string {
  switch (section) {
    case 'domain':
      return 'Dashboards'
    case 'tools':
      return 'Tools'
    case 'library':
      return 'Library routes'
    case 'dev':
      return 'Developer'
  }
}

/** React 19 may null `currentTarget` on `<details onToggle>`; prefer nativeEvent.target. */
function detailsOpenFromToggleEvent(e: React.SyntheticEvent<HTMLDetailsElement>): boolean {
  const t = e.nativeEvent.target
  if (t instanceof HTMLDetailsElement) return t.open
  const c = e.currentTarget
  if (c instanceof HTMLDetailsElement) return c.open
  return false
}

type Tab = 'chat' | 'schedules' | 'evals' | 'proposals' | 'skills' | 'settings' | 'skill-route'

type SkillRouteRow = {
  skillName: string
  skillFolderName: string
  skillDir: string
  routeId: string
  title: string
  entry: string
  fallback: string
  fixturePath: string
  nav_section: SkillRouteNavSection
}

function formatBrokerBrief(p: unknown): string {
  if (!p || typeof p !== 'object') return ''
  const o = p as { status?: string; error?: string }
  if (o.status === 'ready') return ''
  if (o.status === 'starting') return 'Connecting to Pi agent broker…'
  if (o.status === 'init_error') return `Agent broker failed: ${o.error ?? '(unknown)'}`
  return ''
}

type Conv = {
  id: string
  title: string
  created_at: number
  updated_at: number
  workspace_id: string | null
  pi_session_relpath: string | null
}
type WorkspaceRow = {
  id: string
  name: string
  pi_cwd: string
  path_segment: string
  disabled_skill_paths_json: string
  disabled_extension_paths_json: string
  sort_order: number
    created_at: number
  github_remote_url: string
  github_backup_enabled: number
  github_last_sync_at: number | null
  resolved_pi_cwd: string
  /** Primary only: its folder was missing on disk at app startup. */
  folder_missing: boolean
}
/** Stable empty slice for memoized message rows with no live workflow events. */
const EMPTY_WORKFLOW: WorkflowStampedEntry[] = []
const EMPTY_THINK_TANK_BUBBLES: ThinkTankBubbleRow[] = []
const EMPTY_THINK_TANK_SESSION_VIEWS: ReturnType<typeof thinkTankSessionViewsFromDb> = []

type Msg = ChatMessageRowModel & { conversation_id: string }

const SIDEBAR_WIDTH_DEFAULT = 240
const SIDEBAR_WIDTH_MIN = 160
const SIDEBAR_WIDTH_MAX = 520
const SIDEBAR_COLLAPSED_WIDTH = 44

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)))
}

function scrollChatAreaToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight
}

function isChatAreaNearBottom(el: HTMLElement, threshold = CHAT_NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

/** Streaming perf: min/max ms to wait before rendering buffered chat:stream deltas.
 *
 * The interval is adaptive: short replies flush at the minimum (snappy), but as
 * the accumulated text grows the interval scales up to the max. This prevents
 * expensive react-markdown re-parses of long streaming text from consuming too
 * much frame budget (a 50 KB reply at 50 ms = 1 MB/s of markdown parsing). */
const STREAM_FLUSH_MS_MIN = 50
const STREAM_FLUSH_MS_MAX = 200
/** Bytes of streaming text per 1 ms of added flush delay (tuning knob). */
const STREAM_FLUSH_BYTES_PER_MS = 2000

function streamFlushMs(totalLen: number): number {
  return Math.min(
    STREAM_FLUSH_MS_MAX,
    STREAM_FLUSH_MS_MIN + Math.floor(totalLen / STREAM_FLUSH_BYTES_PER_MS),
  )
}


export function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('chat')
  const tabRef = useRef<Tab>(tab)
  tabRef.current = tab
  const [safeMode, setSafeMode] = useState(false)
  const [conversations, setConversations] = useState<Conv[]>([])
  const [activeId, setActiveId] = useState<string | undefined>()
  const activeIdRef = useRef<string | undefined>(undefined)
  activeIdRef.current = activeId
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
  const [sidebarWorkspaceId, setSidebarWorkspaceId] = useState<string>('')
      const [workspaceManageOpen, setWorkspaceManageOpen] = useState(false)
  const [onboardingNameOpen, setOnboardingNameOpen] = useState(false)
  const [onboardingName, setOnboardingName] = useState('')
  const [onboardingError, setOnboardingError] = useState('')
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  // Missing user-data workspace restore flow (folder deleted externally / new machine):
  // offer create-by-name or clone-from-GitHub on startup.
  const [restoreWsOpen, setRestoreWsOpen] = useState(false)
  const [restoreName, setRestoreName] = useState('')
  const [restoreCloneUrl, setRestoreCloneUrl] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [restoreBusy, setRestoreBusy] = useState<'create' | 'clone' | ''>('')
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspacePiCwd, setNewWorkspacePiCwd] = useState('')
  const [newWorkspacePiCwdError, setNewWorkspacePiCwdError] = useState('')
  const [newWorkspacePiCwdTouched, setNewWorkspacePiCwdTouched] = useState(false)
  const newWorkspacePrefillGen = useRef(0)
  const [newWorkspaceEnableGit, setNewWorkspaceEnableGit] = useState(false)
  const [newWorkspaceGitUrl, setNewWorkspaceGitUrl] = useState('')
  const [newWorkspaceError, setNewWorkspaceError] = useState('')
  /** Modal: which workspace is loaded into the edit form below the table. */
  const [workspaceEditId, setWorkspaceEditId] = useState<string | null>(null)
  const [workspaceEditName, setWorkspaceEditName] = useState('')
  const [workspaceEditPath, setWorkspaceEditPath] = useState('')
  const [workspaceEditPathError, setWorkspaceEditPathError] = useState('')
  const [workspaceEditOpen, setWorkspaceEditOpen] = useState(false)
  const [workspaceBackupEnabled, setWorkspaceBackupEnabled] = useState(false)
  const [workspaceBackupUrl, setWorkspaceBackupUrl] = useState('')
  const [workspaceBackupError, setWorkspaceBackupError] = useState('')
  const [workspaceBackupStatus, setWorkspaceBackupStatus] = useState('')
  const [workspaceBackupBusy, setWorkspaceBackupBusy] = useState(false)
  const [workspacePushAllMessage, setWorkspacePushAllMessage] = useState('')
  // GitHub clone-from-repo flow (workspaces modal)
  const [ghConnected, setGhConnected] = useState(false)
  const [ghLogin, setGhLogin] = useState<string | null>(null)
    const [ghEncrypted, setGhEncrypted] = useState(true)
  const [ghConnectBusy, setGhConnectBusy] = useState(false)
  const [ghConnectError, setGhConnectError] = useState('')
  // OAuth device-flow sign-in UI state
  const [ghDevicePending, setGhDevicePending] = useState(false)
  const [ghDeviceCode, setGhDeviceCode] = useState('')
  const [ghDeviceUri, setGhDeviceUri] = useState('')
  const [ghDeviceUriComplete, setGhDeviceUriComplete] = useState<string | undefined>(undefined)
  const ghPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ghRepos, setGhRepos] = useState<GithubRepoLite[]>([])
  const [ghReposLoading, setGhReposLoading] = useState(false)
  const [ghReposError, setGhReposError] = useState('')
  const [ghRepoFilter, setGhRepoFilter] = useState('')
  const [ghHasMore, setGhHasMore] = useState(false)
  const [ghLoaded, setGhLoaded] = useState(false)
  const [ghSelected, setGhSelected] = useState<string | null>(null)
  const [ghCloneName, setGhCloneName] = useState('')
  const [ghCloneDest, setGhCloneDest] = useState('')
  const [ghCloneDestTouched, setGhCloneDestTouched] = useState(false)
  const [ghCloneError, setGhCloneError] = useState('')
  const [ghCloning, setGhCloning] = useState(false)
  const [ghCloneEnableBackup, setGhCloneEnableBackup] = useState(true)
  const [ghDefaultDir, setGhDefaultDir] = useState('')
  // Publish-to-GitHub (create a new repo from a local workspace folder).
  const [ghPublishOpen, setGhPublishOpen] = useState(false)
  const [ghPublishName, setGhPublishName] = useState('')
  const [ghPublishOwner, setGhPublishOwner] = useState('')
  const [ghPublishOwners, setGhPublishOwners] = useState<Array<{ login: string; id: number }>>([])
  const [ghPublishPrivate, setGhPublishPrivate] = useState(true)
  const [ghPublishDesc, setGhPublishDesc] = useState('')
  const [ghPublishBusy, setGhPublishBusy] = useState(false)
  const [ghPublishError, setGhPublishError] = useState('')
  const [ghPublishResult, setGhPublishResult] = useState<{ html_url: string; full_name: string } | null>(null)
  const [branchingConvId, setBranchingConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const composerRef = useRef<ChatComposerHandle>(null)
  /** Phase 5: backup of the last freehand canvas sketch (PNG data URL). Held at
   *  App level so the sketch survives CanvasPanel unmount when the operator
   *  switches to a non-chat tab and back. Draw mode restores from this. */
  const sketchBackupRef = useRef<string | null>(null)
  /** Prefill text waiting for ChatComposer mount after switching to chat tab. */
  const pendingComposerPrefillRef = useRef<string | null>(null)
  const [sendingConvIds, setSendingConvIds] = useState<Set<string>>(() => new Set())
  /** Conversations with a completed turn the operator has not opened since. */
  const [unreadConvIds, setUnreadConvIds] = useState<Set<string>>(() => new Set())
  /** True when the active conversation has an in-flight agent turn. */
  const activeSending = activeId ? sendingConvIds.has(activeId) : false
  const activeTurnStartTs = useMemo(() => {
    if (!activeSending) return null
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.role === 'assistant' && m.status === 'streaming') return m.created_at
    }
    return null
  }, [activeSending, messages])
    const [brokerHint, setBrokerHint] = useState('')
  const [liveDelta, setLiveDelta] = useState<Record<string, string>>({})
  /**
   * Streaming perf: coalesce chat:stream deltas into at most one render per
   * adaptive interval (STREAM_FLUSH_MS_MIN..MAX). Without this, every delta (LLMs
   * emit up to ~150+/s) triggers a full app re-render AND a full react-markdown
   * re-parse of the entire assistant text — cost grows with message length, so
   * long replies visibly lag behind the stream.
   * Safe to coalesce: main persists each delta to the DB, and a turn-end refresh
   * replaces live deltas with the full DB content.
   */
  const liveDeltaPendingRef = useRef<Map<string, string>>(new Map())
  const liveDeltaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Rough total length of all live deltas (for adaptive flush interval). */
  const liveDeltaTotalLenRef = useRef(0)
  const flushLiveDeltas = useCallback(() => {
    liveDeltaFlushTimerRef.current = null
    const pending = liveDeltaPendingRef.current
    if (pending.size === 0) return
    const flushed = [...pending.entries()]
    pending.clear()
    setLiveDelta((prev) => {
      const next = { ...prev }
      for (const [id, delta] of flushed) next[id] = (next[id] ?? '') + delta
      liveDeltaTotalLenRef.current = Object.values(next).reduce((s, d) => s + d.length, 0)
      return next
    })
  }, [])
  const scheduleLiveDeltaFlush = useCallback(() => {
    if (liveDeltaFlushTimerRef.current != null) return
    // Adaptive: longer accumulated text → less frequent flush → fewer
    // expensive markdown re-parses. Short text still flushes at the min.
    const pendingLen = [...liveDeltaPendingRef.current.values()].reduce((s, d) => s + d.length, 0)
    const ms = streamFlushMs(liveDeltaTotalLenRef.current + pendingLen)
    liveDeltaFlushTimerRef.current = setTimeout(flushLiveDeltas, ms)
  }, [flushLiveDeltas])
  /** Assistant message telemetry rows received mid-stream before messages refresh from DB. */
  const [liveWorkflow, setLiveWorkflow] = useState<Record<string, WorkflowStampedEntry[]>>({})
  // const [workflowModalId, setWorkflowModalId] = useState<string | null>(null)
  /**
   * Per-segment user open/close override keyed by `${messageId}:${segmentId}`.
   * Auto-collapse on completion still applies to segments without an explicit override.
   */
  const [segmentOverrides, setSegmentOverrides] = useState<Record<string, boolean>>({})
  const [capabilities, setCapabilities] = useState<CapabilitiesView | null>(null)
  const [settingsJson, setSettingsJson] = useState<Record<string, unknown>>({})
  const [skillSurfaceLintByPath, setSkillSurfaceLintByPath] = useState<
    Record<string, SkillSurfaceLintReport>
  >({})
  const [agentReady, setAgentReady] = useState(false)
  const {
    tasks: subagentTasks,
    running: subagentRunning,
    reload: reloadSubagentTasks,
  } = useSubagentTasks(activeId ?? null)
  const subagentRunningCount = subagentRunning.length
  const [subagentNotice, setSubagentNotice] = useState<string | null>(null)
  const [thinkTankByConv, setThinkTankByConv] = useState<Record<string, ThinkTankLiveSession>>({})
  const thinkTankByConvRef = useRef(thinkTankByConv)
  useEffect(() => {
    thinkTankByConvRef.current = thinkTankByConv
  }, [thinkTankByConv])
  // Personal-bundle route-bridge ops — seed the bridge allowlist from the
  // installed plugin (no-op when absent). Must happen before personal UI
  // iframes post their first bridge messages.
  useEffect(() => {
    void refreshPersonalBridgeOps()
  }, [])
  const [thinkTankBubblesByConv, setThinkTankBubblesByConv] = useState<Record<string, ThinkTankBubbleRow[]>>({})
  const [thinkTankSessionsByConv, setThinkTankSessionsByConv] = useState<
    Record<string, ReturnType<typeof thinkTankSessionViewsFromDb>>
  >({})
  const [thinkTankUiBySession, setThinkTankUiBySession] = useState<
    Record<string, ThinkTankSessionUiState>
  >({})
  const activeThinkTankBubbles = activeId ?
    (thinkTankBubblesByConv[activeId] ?? EMPTY_THINK_TANK_BUBBLES)
  : EMPTY_THINK_TANK_BUBBLES
  const activeThinkTankSession = activeId ? thinkTankByConv[activeId] : undefined
  const activeThinkTankSessionViews = activeId ?
    (thinkTankSessionsByConv[activeId] ?? EMPTY_THINK_TANK_SESSION_VIEWS)
  : EMPTY_THINK_TANK_SESSION_VIEWS
  const chatTimeline = useMemo(
    () =>
      buildChatTimeline({
        messages,
        bubbles: activeThinkTankBubbles,
        sessions: activeThinkTankSessionViews,
        liveSession: activeThinkTankSession,
      }),
    [messages, activeThinkTankBubbles, activeThinkTankSessionViews, activeThinkTankSession],
  )
  const [brokerInitError, setBrokerInitError] = useState<string | null>(null)
  /** Model Pi bound to the session (from broker), not Sylo prefs. */
  const [resolvedModel, setResolvedModel] = useState<{
    provider: string
    modelId: string
    displayName?: string
  } | null>(null)
  const [systemPromptStats, setSystemPromptStats] = useState<{
    totalChars: number
    totalTokens: number
    sections: { label: string; chars: number; tokens: number; pct: number }[]
  } | null>(null)
  const [systemPromptStatsOpen, setSystemPromptStatsOpen] = useState(false)
  const [actualMessageTokens, setActualMessageTokens] = useState<number | null>(null)

  /** Full context-window token estimate: system prompt + all messages + tool calls + live streaming. */
  const contextStats = useMemo(() => {
    const sysTokens = systemPromptStats?.totalTokens ?? 0
    let userTokens = 0
    let assistantTokens = 0
    let toolTokens = 0
    for (const m of messages) {
      const contentLen = (m.content ?? '').length
      if (m.role === 'user') {
        userTokens += Math.ceil(contentLen / 4)
      } else if (m.role === 'assistant') {
        assistantTokens += Math.ceil(contentLen / 4)
        if (m.tool_calls_json) {
          try { toolTokens += Math.ceil(m.tool_calls_json.length / 4) } catch { /* ignore */ }
        }
        // Add live streaming delta for in-flight assistant messages
        const live = liveDelta[m.id]
        if (live) assistantTokens += Math.ceil(live.length / 4)
      } else {
        // system messages (compaction notices, etc.)
        assistantTokens += Math.ceil(contentLen / 4)
      }
    }
    const total = sysTokens + userTokens + assistantTokens + toolTokens
    // Actual context from broker (reflects Pi compaction): system prompt + post-compaction messages
    // During streaming, add live delta so the number grows in real-time
    const actualBase = actualMessageTokens != null ? actualMessageTokens + sysTokens : null
    const liveTotal = Object.values(liveDelta).reduce((sum, d) => sum + Math.ceil(d.length / 4), 0)
    const actualTokens = actualBase != null ? actualBase + liveTotal : null
    const sections = [
      { label: 'System prompt', tokens: sysTokens },
      { label: 'User messages', tokens: userTokens },
      { label: 'Assistant text', tokens: assistantTokens },
      { label: 'Tool calls + results', tokens: toolTokens },
    ].map((s) => ({ ...s, pct: total > 0 ? Math.round((s.tokens / total) * 1000) / 10 : 0 }))
    return { totalTokens: total, actualTokens, sections }
  }, [messages, systemPromptStats, liveDelta, actualMessageTokens])
  const [diagnostics, setDiagnostics] = useState({
    userData: '',
    db: '',
    modelProvider: '',
    modelId: '',
    /** Resolved primary workspace Pi project directory (secondary workspaces inherit when unset). */
    resolvedHostPiCwd: '',
    piAgentDir: '',
    resolvedPiAgentDir: '',
        canonicalWorkspaceProject: '',
    concurrentTurns: false,
    chatOnly: false,
    strikes: 0,
    skillSurfaceSummary: '',
  })

  const [renameConvModal, setRenameConvModal] = useState<{ id: string; draft: string } | null>(null)
  const [deleteConvModal, setDeleteConvModal] = useState<{ id: string; title: string } | null>(null)

  const [agentWidgetPayload, setAgentWidgetPayload] = useState<{
    toolCallId: string
    html?: string
    path?: string
    data: unknown
  } | null>(null)
  const [agentWidgetLog, setAgentWidgetLog] = useState<string[]>([])

  const [canvasOpen, setCanvasOpen] = useState(false)
  // Tab state for the docked canvas (one CanvasTab per view, keyed per
  // workspace) lives in `useCanvasTabs` — called below, after the callbacks
  // it needs. `activeWorkspaceCwdRef` mirrors the active workspace's cwd for
  // the canvas show gates registered inside the hook (they read the ref, not
  // a stale closure).
  const activeWorkspaceCwdRef = useRef<string>('')
  const [canvasSize, setCanvasSize] = useState(CANVAS_SIZE_DEFAULT)
  const canvasResizeRef = useRef<{
    pointerId: number
    startX: number
    startSize: number
  } | null>(null)

  const [skillRoutes, setSkillRoutes] = useState<SkillRouteRow[]>([])
  const [activeSkillRoute, setActiveSkillRoute] = useState<SkillRouteRow | null>(null)

  const [routePopoutKey] = useState(parseRoutePopoutKey)
  const [canvasPopoutKey] = useState(parseCanvasPopoutKey)
  const [popoutRoute, setPopoutRoute] = useState<SkillRouteRow | null>(null)
  const [popoutResolved, setPopoutResolved] = useState(() => routePopoutKey === null)

  const [navLayout, setNavLayout] = useState<SkillNavLayoutState>(DEFAULT_SKILL_NAV_LAYOUT)
  const [routeContextMenu, setRouteContextMenu] = useState<{
    route: SkillRouteRow
    clientX: number
    clientY: number
  } | null>(null)
  const [convContextMenu, setConvContextMenu] = useState<{
    id: string
    title: string
    clientX: number
    clientY: number
  } | null>(null)

  const [routeActionModal, setRouteActionModal] = useState<{
    prompt: string
    payload: unknown
    resolve: (confirmed: boolean, editedPrompt?: string) => void
  } | null>(null)
  const [routeActionDraft, setRouteActionDraft] = useState('')

  /** Collapsible Developer route bucket (sidebar). */
  const [devNavOpen, setDevNavOpen] = useState(false)
  /** Collapsible sidebar route buckets (Developer uses {@link devNavOpen}). */
  const [routeBucketsOpen, setRouteBucketsOpen] = useState<Record<'domain' | 'tools' | 'library', boolean>>({
    domain: true,
    tools: false,
    library: false,
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT)
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startW: number } | null>(null)

  const chatAreaRef = useRef<HTMLDivElement>(null)
  const chatListRef = useRef<ChatTimelineListHandle>(null)
  const stickToBottomRef = useRef(true)
  const pendingConvScrollRef = useRef(false)
  const prevMessagesLenRef = useRef(0)
  const prevChatTabVisibleRef = useRef(tab === 'chat')
  /** Timestamp until which scrollTop decreases should not clear stick-to-bottom intent. */
  const suppressScrollClearUntilRef = useRef(0)
  /** Last time the user wheeled up (deltaY < 0) — used to opt out of stick-to-bottom. */
  const lastUpWheelAtRef = useRef(0)
  /** Last observed scrollTop, used to detect scrollbar-drag opt-outs. */
  const lastChatScrollTopRef = useRef(0)

  const activeWorkspaceForSettings = useMemo(() => {
    const wid = sidebarWorkspaceId.trim()
    const hit = workspaces.find((w) => w.id === wid)
    return {
      id: hit?.id ?? wid,
      name: hit?.name ?? 'Default',
      resolvedPiCwd: hit?.resolved_pi_cwd ?? diagnostics.resolvedHostPiCwd,
    }
  }, [sidebarWorkspaceId, workspaces, diagnostics.resolvedHostPiCwd])

  const refreshPrefsDiag = useCallback(async () => {
    const userData = await window.sylo.paths.userData()
    const dbp = await window.sylo.paths.db()
    const modelId = (await window.sylo.prefs.get('sylo.model_id', SYLO_DEFAULT_MODEL_ID)) as string
    const modelProvider = (await window.sylo.prefs.get(
      'sylo.model_provider',
      SYLO_DEFAULT_MODEL_PROVIDER,
    )) as string
    const piAgentDir = (await window.sylo.prefs.get('sylo.pi_agent_dir', '')) as string
    const resolvedPiAgentDir = await window.sylo.paths.piAgentDir()
        const canonicalWorkspaceProject = await window.sylo.paths.canonicalWorkspaceProject()
    const resolvedHostPiCwd = await window.sylo.paths.hostPiCwd()
    const concurrentTurns = (await window.sylo.prefs.get('sylo.chat.concurrent_turns', false)) as boolean
    const chatOnly = (await window.sylo.prefs.get('sylo.chat_only', false)) as boolean
    const strikes = (await window.sylo.prefs.get('sylo.boot_strikes', 0)) as number
    const surf = SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR
    const skillSurfaceSummary = `widget v${surf.widget_protocol_version}, route v${surf.route_protocol_version}, widgets=${surf.supports_widget}, routes=${surf.supports_route}`
    setDiagnostics({
      userData,
      db: dbp,
      modelProvider,
      modelId,
      resolvedHostPiCwd,
      piAgentDir,
      resolvedPiAgentDir,
            canonicalWorkspaceProject,
      concurrentTurns,
      chatOnly,
      strikes,
      skillSurfaceSummary,
    })
  }, [])

    const refreshWorkspaces = useCallback(async () => {
    const list = (await window.sylo.workspaces.list()) as WorkspaceRow[]
    setWorkspaces(list)
    return list
  }, [])

  // First-run onboarding: ask the operator to name the universal workspace once,
  // BEFORE any GitHub backup is wired to it (a pull against the wrong repo is how
  // separate installs combine). Fires only on a pristine auto-created install:
  // one workspace, default name, no backup URL, flag unset. Confirm runs through
  // workspaces.update, which renames the folder on disk + repoints the row +
  // refreshes the global pointer block. Skip keeps `sylo-user` forever (flag set).
  const onboardingCheckedRef = useRef(false)
  useEffect(() => {
    if (onboardingCheckedRef.current || workspaces.length === 0) return
    onboardingCheckedRef.current = true
    void (async () => {
      const w = workspaces[0]
      // Missing user-data workspace folder (deleted externally, fresh machine,
      // botched rename): offer create-by-name or restore-from-GitHub first —
      // this takes precedence over the first-run naming onboarding.
      if (w.folder_missing) {
        setRestoreName(w.name)
        // Prefill the clone URL only when GitHub is actually signed in — a wired
        // remote on the row is that operator's account, don't suggest it otherwise.
        const gh = await window.sylo.workspaces.github.status()
        setRestoreCloneUrl(gh.connected ? w.github_remote_url : '')
        setRestoreWsOpen(true)
        return
      }
      const named = await window.sylo.prefs.get('sylo.onboarding.universal_named', false)
      if (named) return
      if (workspaces.length !== 1 || w.name !== 'Sylo-user' || w.github_remote_url.trim()) return
      setOnboardingName(w.name)
      setOnboardingNameOpen(true)
    })()
  }, [workspaces])

  const confirmOnboardingName = useCallback(async () => {
    const w = workspaces[0]
    const name = onboardingName.trim()
    if (!w || !name) {
      setOnboardingError('A workspace name is required.')
      return
    }
    setOnboardingBusy(true)
    setOnboardingError('')
    const res = await window.sylo.workspaces.update(w.id, { name, pi_cwd: '' }, { createPiProjectDir: false })
    setOnboardingBusy(false)
    if (!res.ok) {
      setOnboardingError(
        res.error === 'rename_failed' ? `Could not rename folder: ${res.detail}` : 'Could not rename workspace',
      )
      return
    }
    await window.sylo.prefs.set('sylo.onboarding.universal_named', true)
    setOnboardingNameOpen(false)
    await refreshWorkspaces()
  }, [workspaces, onboardingName, refreshWorkspaces])

  const skipOnboardingName = useCallback(async () => {
    await window.sylo.prefs.set('sylo.onboarding.universal_named', true)
    setOnboardingNameOpen(false)
  }, [])

  // Missing user-data workspace: create a fresh folder under the chosen name.
  const confirmRestoreCreate = useCallback(async () => {
    const name = restoreName.trim()
    if (!name) {
      setRestoreError('A workspace name is required.')
      return
    }
    setRestoreBusy('create')
    setRestoreError('')
    const res = await window.sylo.workspaces.primaryProvision({ name })
    if (!res.ok) {
      setRestoreBusy('')
      setRestoreError(res.detail || 'Could not create the workspace folder.')
      return
    }
    await window.sylo.prefs.set('sylo.onboarding.universal_named', true)
    setRestoreBusy('')
    setRestoreWsOpen(false)
    await refreshWorkspaces()
  }, [restoreName, refreshWorkspaces])

  // Missing user-data workspace: clone a GitHub repo back into place.
  const confirmRestoreClone = useCallback(async () => {
    const url = restoreCloneUrl.trim()
    if (!url) {
      setRestoreError('A GitHub clone URL is required.')
      return
    }
    setRestoreBusy('clone')
    setRestoreError('')
    const res = await window.sylo.workspaces.primaryRestoreFromGithub({ cloneUrl: url })
    if (!res.ok) {
      setRestoreBusy('')
      setRestoreError(res.detail || 'Could not clone the repo.')
      return
    }
    await window.sylo.prefs.set('sylo.onboarding.universal_named', true)
    setRestoreBusy('')
    setRestoreWsOpen(false)
    await refreshWorkspaces()
  }, [restoreCloneUrl, refreshWorkspaces])

  const refreshWorkspaceBackupStatus = useCallback(async (workspaceId: string) => {
    const res = await window.sylo.workspaces.backup.status(workspaceId)
    if (!res.ok) {
      setWorkspaceBackupStatus('')
      return
    }
    setWorkspaceBackupStatus(describeWorkspaceGitStatus(res.git))
  }, [])

  const loadGhRepos = useCallback(async (reset: boolean) => {
    setGhReposLoading(true)
    setGhReposError('')
    try {
      const page = reset ? 1 : Math.max(1, Math.ceil(ghRepos.length / 100) + 1)
      const res = await window.sylo.workspaces.github.listRepos({ page, perPage: 100 })
      if (!res.ok) {
        setGhReposError(res.error)
        return
      }
      setGhHasMore(res.hasMore)
      setGhRepos((prev) => (reset ? res.repos : [...prev, ...res.repos]))
      setGhLoaded(true)
    } finally {
      setGhReposLoading(false)
    }
  }, [ghRepos.length])

  const refreshGithubStatus = useCallback(async () => {
    const st = await window.sylo.workspaces.github.status()
    setGhConnected(st.connected)
    setGhLogin('login' in st ? st.login : null)
    setGhEncrypted('encrypted' in st ? st.encrypted : true)
    let dir = await window.sylo.workspaces.github.defaultCloneDir()
    if (!dir) dir = ''
    setGhDefaultDir(dir)
    return st
    }, [])

  const startGithubDeviceFlow = useCallback(async () => {
    setGhConnectError('')
    setGhConnectBusy(true)
    try {
      const res = await window.sylo.workspaces.github.deviceFlow.start()
      if (!res.ok) {
        setGhConnectError(res.error)
        return
      }
      setGhDevicePending(true)
      setGhDeviceCode(res.userCode)
      setGhDeviceUri(res.verificationUri)
      setGhDeviceUriComplete(res.verificationUriComplete)
      let interval = res.interval
      const poll = async () => {
        let r: Awaited<ReturnType<typeof window.sylo.workspaces.github.deviceFlow.poll>>
        try {
          r = await window.sylo.workspaces.github.deviceFlow.poll()
        } catch (e) {
          setGhDevicePending(false)
          setGhDeviceCode('')
          setGhConnectError(e instanceof Error ? e.message : String(e))
          return
        }
        if (r.status === 'success') {
          setGhDevicePending(false)
          setGhDeviceCode('')
          if (r.auth.ok) {
            setGhConnected(true)
            setGhLogin(r.auth.login)
            setGhEncrypted(true)
            await loadGhRepos(true)
          } else {
            setGhConnectError(r.auth.error)
          }
        } else if (r.status === 'pending') {
          ghPollRef.current = setTimeout(poll, Math.max(1, interval) * 1000)
        } else if (r.status === 'slow_down') {
          interval = r.interval
          ghPollRef.current = setTimeout(poll, Math.max(1, interval) * 1000)
        } else {
          setGhDevicePending(false)
          setGhDeviceCode('')
          setGhConnectError(r.error)
        }
      }
      ghPollRef.current = setTimeout(poll, Math.max(1, interval) * 1000)
    } catch (e) {
      setGhConnectError(e instanceof Error ? e.message : String(e))
    } finally {
      setGhConnectBusy(false)
    }
  }, [loadGhRepos])

  const cancelGithubDeviceFlow = useCallback(async () => {
    if (ghPollRef.current) {
      clearTimeout(ghPollRef.current)
      ghPollRef.current = null
    }
    setGhDevicePending(false)
    setGhDeviceCode('')
    try {
      await window.sylo.workspaces.github.deviceFlow.cancel()
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => () => {
    if (ghPollRef.current) clearTimeout(ghPollRef.current)
  }, [])

  const disconnectGithub = useCallback(async () => {
    if (ghPollRef.current) {
      clearTimeout(ghPollRef.current)
      ghPollRef.current = null
    }
    setGhDevicePending(false)
    setGhDeviceCode('')
    await window.sylo.workspaces.github.disconnect()
    setGhConnected(false)
    setGhLogin(null)
    setGhRepos([])
    setGhLoaded(false)
    setGhSelected(null)
    setGhCloneName('')
    setGhCloneDest('')
    setGhCloneDestTouched(false)
  }, [])

  const pickGhRepo = useCallback(
    (r: GithubRepoLite) => {
      setGhSelected(r.full_name)
      setGhCloneName(r.name)
      const base = ghDefaultDir || ''
      setGhCloneDest(base ? `${base}/${r.name}` : '')
      setGhCloneDestTouched(false)
      setGhCloneError('')
    },
    [ghDefaultDir],
  )

  const cloneSelectedRepo = useCallback(async () => {
    const r = ghRepos.find((x) => x.full_name === ghSelected)
    if (!r) return
    const name = ghCloneName.trim() || r.name
    const dest = ghCloneDest.trim()
    if (!dest) {
      setGhCloneError('Destination directory is required.')
      return
    }
    setGhCloning(true)
    setGhCloneError('')
    try {
      const res = await window.sylo.workspaces.github.clone({
        cloneUrl: r.clone_url,
        destDir: dest,
        name,
        privateRepo: r.private,
        enableBackup: ghCloneEnableBackup,
      })
      if (!res.ok) {
        setGhCloneError(res.detail || res.error)
        return
      }
      setGhSelected(null)
      setGhCloneName('')
      setGhCloneDest('')
      setGhCloneDestTouched(false)
      await refreshWorkspaces()
    } catch (e) {
      setGhCloneError(e instanceof Error ? e.message : String(e))
    } finally {
      setGhCloning(false)
    }
  }, [ghRepos, ghSelected, ghCloneName, ghCloneDest, ghCloneEnableBackup, refreshWorkspaces])

  const ghAutoLoadedRef = useRef(false)
  useEffect(() => {
    if (!workspaceManageOpen) return
    ghAutoLoadedRef.current = false
    void (async () => {
      const st = await refreshGithubStatus()
      if (st.connected && !ghAutoLoadedRef.current) {
        ghAutoLoadedRef.current = true
        void loadGhRepos(true)
      }
    })()
  }, [workspaceManageOpen, refreshGithubStatus, loadGhRepos])

  // Load orgs for the Publish owner dropdown (best-effort; token may lack scope).
  const loadGhOrgs = useCallback(async () => {
    const res = await window.sylo.workspaces.github.listOrgs()
    if (res.ok) setGhPublishOwners(res.orgs)
    else setGhPublishOwners([])
  }, [])

  // Prefill the Publish form from the workspace currently being edited.
  const openGhPublish = useCallback(() => {
    const w = workspaces.find((x) => x.id === workspaceEditId)
    if (!w) return
    const baseName = (w.name || '').trim() || workspaceEditPath.trim().split(/[\\/]/).filter(Boolean).pop() || ''
    setGhPublishName(baseName || '')
    setGhPublishOwner(ghLogin ?? '')
    setGhPublishPrivate(true)
    setGhPublishDesc('')
    setGhPublishError('')
    setGhPublishResult(null)
    void loadGhOrgs()
    setGhPublishOpen(true)
  }, [workspaces, workspaceEditId, workspaceEditPath, ghLogin, loadGhOrgs])

  const publishWorkspaceToGithub = useCallback(async () => {
    if (!workspaceEditId) return
    const name = ghPublishName.trim()
    if (!name) {
      setGhPublishError('Repository name is required.')
      return
    }
    setGhPublishBusy(true)
    setGhPublishError('')
    setGhPublishResult(null)
    try {
      const res = await window.sylo.workspaces.github.publish({
        workspaceId: workspaceEditId,
        name,
        owner: ghPublishOwner && ghPublishOwner !== (ghLogin ?? '') ? ghPublishOwner : undefined,
        privateRepo: ghPublishPrivate,
        description: ghPublishDesc,
      })
      if (!res.ok) {
        setGhPublishError(res.detail || res.error)
        return
      }
      setGhPublishResult({ html_url: res.repo.html_url, full_name: res.repo.full_name })
      setWorkspaceBackupUrl(res.workspace.github_remote_url)
      setWorkspaceBackupEnabled(true)
      await refreshWorkspaces()
      await refreshPrefsDiag()
      if (workspaceEditId) void refreshWorkspaceBackupStatus(workspaceEditId)
      setGhPublishOpen(false)
    } catch (e) {
      setGhPublishError(e instanceof Error ? e.message : String(e))
    } finally {
      setGhPublishBusy(false)
    }
  }, [
    workspaceEditId,
    ghPublishName,
    ghPublishOwner,
    ghLogin,
    ghPublishPrivate,
    ghPublishDesc,
    refreshWorkspaces,
    refreshPrefsDiag,
    refreshWorkspaceBackupStatus,
  ])

  const backupEnabledWorkspaceCount = useMemo(
    () => workspaces.filter((w) => w.github_backup_enabled === 1 && w.github_remote_url.trim()).length,
    [workspaces],
  )

  const refreshConversations = useCallback(async () => {
    const wid = sidebarWorkspaceId.trim()
    if (!wid) {
      setConversations([])
      return
    }
    let list: Conv[] = (await window.sylo.conversations.list(wid)) as Conv[]
    if (list.length === 0) {
      await window.sylo.conversations.create('Chat', wid)
      list = (await window.sylo.conversations.list(wid)) as Conv[]
    }

    setConversations(list)

    const saved = (await window.sylo.prefs.get('sylo.ui.active_conversation_id', '')) as string
    const savedTrim = typeof saved === 'string' ? saved.trim() : ''
    const cur = activeIdRef.current
    if (cur && list.some((x) => x.id === cur)) {
      return
    }
    if (savedTrim && list.some((x) => x.id === savedTrim)) {
      setActiveId(savedTrim)
    } else if (list.length > 0) {
      setActiveId(list[0]!.id)
    } else {
      setActiveId(undefined)
    }
  }, [sidebarWorkspaceId])

  const refreshMessages = useCallback(async () => {
    if (!activeId) return
    const m = await window.sylo.messages.list(activeId)
    setMessages(m as Msg[])
    setLiveDelta((prev) => {
      const next = { ...prev }
      for (const row of m) {
        delete next[row.id]
      }
      liveDeltaTotalLenRef.current = Object.values(next).reduce((s, d) => s + d.length, 0)
      return next
    })
    setLiveWorkflow((prev) => {
      const next = { ...prev }
      for (const row of m) {
        if (row.role === 'assistant' && row.status !== 'streaming') delete next[row.id]
      }
      return next
    })
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    void window.sylo.thinkTank.listForConversation(activeId).then((sessions) => {
      const rows = sessions as Array<Record<string, unknown>>
      setThinkTankSessionsByConv((prev) => ({ ...prev, [activeId]: thinkTankSessionViewsFromDb(rows) }))
      const fromDb = thinkTankUiBubblesFromDb(rows as Parameters<typeof thinkTankUiBubblesFromDb>[0])
      if (fromDb.length === 0) return
      setThinkTankBubblesByConv((prev) => {
        const existing = prev[activeId] ?? []
        if (existing.length > 0) return prev
        return { ...prev, [activeId]: fromDb }
      })
    })
  }, [activeId])

  const refreshCapabilities = useCallback(async () => {
    const wid = sidebarWorkspaceId.trim()
    setCapabilities(await window.sylo.capabilities.list(wid || undefined))
    setSettingsJson(await window.sylo.capabilities.settings())
  }, [sidebarWorkspaceId])

  useEffect(() => {
    if (!capabilities) {
      setSkillSurfaceLintByPath({})
      return
    }
    const paths = [
      ...new Set(capabilities.skills.map((s) => s.path).filter((p): p is string => typeof p === 'string' && !!p.trim())),
    ]
    if (paths.length === 0) {
      setSkillSurfaceLintByPath({})
      return
    }
    let cancelled = false
    void window.sylo.skillSurfaces.lintBatch(paths).then((r) => {
      if (!cancelled) setSkillSurfaceLintByPath(r)
    })
    return () => {
      cancelled = true
    }
  }, [capabilities])

  const refreshSkillRoutes = useCallback(async () => {
    try {
      const wid = sidebarWorkspaceId.trim() || undefined
      const list = await window.sylo.skillRoutes.list(wid)
      setSkillRoutes(list as SkillRouteRow[])
    } catch {
      setSkillRoutes([])
    }
  }, [sidebarWorkspaceId])

  const persistNavLayout = useCallback(async (next: SkillNavLayoutState) => {
    setNavLayout(next)
    await window.sylo.prefs.set('sylo.nav.layout', next)
  }, [])

  /** Sync agent UX + banner copy from main (handles missed IPC events). */
  const refreshBrokerFromMain = useCallback(async () => {
    const st = await window.sylo.broker.getStatus()
    setSafeMode(!!st.safeMode)
    setResolvedModel(st.resolvedModel ?? null)
    if (st.ready) {
      setAgentReady(true)
      setBrokerInitError(null)
      // Fetch system prompt stats when broker is ready. This is a best-effort UI
      // nicety (token counter) — tolerate a missing/unregistered IPC handler
      // (e.g. stale build or dev race) instead of crashing the app.
      try {
        const stats = await window.sylo.broker.getSystemPromptStats()
        setSystemPromptStats(stats)
      } catch {
        setSystemPromptStats(null)
      }
      try {
        const actual = await window.sylo.broker.getActualContextTokens()
        setActualMessageTokens(actual)
      } catch {
        setActualMessageTokens(null)
      }
    } else if (st.initError) {
      setAgentReady(false)
      setBrokerInitError(st.initError)
    } else {
      setAgentReady(false)
      setBrokerInitError(null)
    }
  }, [])

  const notifyPathPrefsSaved = useCallback(async () => {
    await refreshPrefsDiag()
    const savedCanvasOpen = (await window.sylo.prefs.get('sylo.canvas.open', false)) === true
    setCanvasOpen(savedCanvasOpen)
    const savedCanvasSize = Number(await window.sylo.prefs.get('sylo.canvas.size', CANVAS_SIZE_DEFAULT))
    setCanvasSize(clampCanvasSize(savedCanvasSize))
    await refreshWorkspaces()
    await refreshBrokerFromMain()
  }, [refreshPrefsDiag, refreshWorkspaces, refreshBrokerFromMain])

  const toggleCanvasOpen = useCallback(() => {
    setCanvasOpen((open) => {
      const next = !open
      void window.sylo.prefs.set('sylo.canvas.open', next)
      return next
    })
  }, [])

  // Native Window-menu "Show/Hide Canvas" toggle. The menu item lives in the
  // main process (Electron application menu); clicking it sends `canvas:toggle`
  // to the main window only, so guard popout windows out.
  useEffect(() => {
    if (canvasPopoutKey !== null || routePopoutKey !== null) return
    const onToggle = window.sylo.canvas?.onToggleRequest
    if (!onToggle) return
    return onToggle(() => toggleCanvasOpen())
  }, [toggleCanvasOpen, canvasPopoutKey, routePopoutKey])

  // Keep the native Window-menu item label in sync with the docked canvas'
  // open state. Skipped in popout windows so a popout's local `canvasOpen`
  // (always false there) doesn't clobber the main window's reported state.
  useEffect(() => {
    if (canvasPopoutKey !== null || routePopoutKey !== null) return
    void window.sylo.canvas?.reportOpenState?.(canvasOpen)
  }, [canvasOpen, canvasPopoutKey, routePopoutKey])

  const collapseCanvas = useCallback(() => {
    setCanvasOpen(false)
    void window.sylo.prefs.set('sylo.canvas.open', false)
  }, [])

  const openCanvasPanel = useCallback(() => {
    setCanvasOpen(true)
    void window.sylo.prefs.set('sylo.canvas.open', true)
  }, [])

  // Docked-canvas tabs (per workspace). Owns the canvas:show / canvas:live-*
  // listeners and the workspace-switch tab swap/restore — see useCanvasTabs.ts
  // for the model (each tab owns exactly one view; live tabs stay subscribed
  // in the background).
  const {
    tabs: canvasTabs,
    activeTabId: canvasActiveTabId,
    view: canvasView,
    setActiveTab: onCanvasSelectTab,
    closeTab: closeCanvasTab,
    updateActiveSnapshot: updateActiveCanvasSnapshot,
  } = useCanvasTabs({
    workspaceId: sidebarWorkspaceId,
    workspaceCwd: activeWorkspaceForSettings.resolvedPiCwd ?? '',
    activeWorkspaceCwdRef,
    onOpenPanel: openCanvasPanel,
  })

  const openCanvasPopout = useCallback(() => {
    // Pop out the ACTIVE tab's view — snapshot first, mirroring the render
    // precedence of `canvasView`. (The old single-slot code checked the live
    // subscription first while the panel actually rendered the snapshot, so
    // the per-workspace restore path — snapshot shown + old board hidden —
    // popped out the hidden stale board instead of what was on screen.)
    const v = canvasView
    if (!v) return
    if (v.mode === 'snapshot') {
      const p = v.payload
      void window.sylo.canvas
        .openPopoutWindow({
          kind: p.kind,
          title: p.title,
          content: p.content,
          filePath: p.filePath,
          sourcePath: p.sourcePath,
          toolCallId: p.toolCallId,
        })
        .then((r) => {
          if (!r.ok) window.alert(`Could not open canvas window: ${r.error}`)
        })
      return
    }
    // Live tabs pop out bound to their `liveId` (the popout subscribes to
    // `canvas:live-update` and stays in sync).
    void window.sylo.canvas
      .openLivePopoutWindow({ liveId: v.sub.liveId, title: v.sub.title })
      .then((r) => {
        if (!r.ok) window.alert(`Could not open canvas window: ${r.error}`)
      })
  }, [canvasView])

  useEffect(() => {
    if (routeActionModal) setRouteActionDraft(routeActionModal.prompt)
  }, [routeActionModal])

  useEffect(() => {
    if (!routePopoutKey) {
      setPopoutResolved(true)
      return
    }
    let cancelled = false
    setPopoutResolved(false)
    void (async () => {
      try {
        const list = (await window.sylo.skillRoutes.list()) as SkillRouteRow[]
        if (cancelled) return
        const hit = list.find((r) => skillRouteRowKey(r) === routePopoutKey)
        setPopoutRoute(hit ?? null)
      } catch {
        if (!cancelled) setPopoutRoute(null)
      } finally {
        if (!cancelled) setPopoutResolved(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [routePopoutKey])

  useEffect(() => {
    if (!routeContextMenu && !convContextMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRouteContextMenu(null)
        setConvContextMenu(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [routeContextMenu, convContextMenu])

  useEffect(() => {
    void (async () => {
      const sm = (await window.sylo.prefs.get('sylo.safe_mode', false)) as boolean
      setSafeMode(sm)
      await refreshBrokerFromMain()
      await refreshPrefsDiag()
      const list = await refreshWorkspaces()
      const pref = ((await window.sylo.prefs.get('sylo.ui.active_workspace_id', '')) as string).trim()
      const pick = pref && list.some((w) => w.id === pref) ? pref : (list[0]?.id ?? '')
      setSidebarWorkspaceId(pick)
      const savedSidebarWidth = Number(
        await window.sylo.prefs.get('sylo.ui.sidebar_width', SIDEBAR_WIDTH_DEFAULT),
      )
      setSidebarWidth(clampSidebarWidth(savedSidebarWidth))
      setCanvasOpen((await window.sylo.prefs.get('sylo.canvas.open', false)) === true)
      const savedCanvasSize = Number(await window.sylo.prefs.get('sylo.canvas.size', CANVAS_SIZE_DEFAULT))
      setCanvasSize(clampCanvasSize(savedCanvasSize))
      await refreshSkillRoutes()
      const layoutPref = await window.sylo.prefs.get('sylo.nav.layout', DEFAULT_SKILL_NAV_LAYOUT)
      setNavLayout(normalizeNavLayoutPref(layoutPref))
    })()
  }, [refreshBrokerFromMain, refreshWorkspaces, refreshPrefsDiag, refreshSkillRoutes])

  useEffect(() => {
    void refreshConversations()
  }, [sidebarWorkspaceId, refreshConversations])

  useEffect(() => {
    if (!activeId) return
    void window.sylo.prefs.set('sylo.ui.active_conversation_id', activeId)
  }, [activeId])

  useEffect(() => {
    if (!activeId || !agentReady || safeMode) return
    void window.sylo.broker.prepareConversation(activeId)
  }, [activeId, agentReady, safeMode])

  useEffect(() => {
    if (!workspaceManageOpen) return
    void refreshPrefsDiag()
  }, [workspaceManageOpen, refreshPrefsDiag])

  useEffect(() => {
    if (!workspaceManageOpen) {
      setWorkspaceEditId(null)
      setWorkspaceEditOpen(false)
      return
    }
    setWorkspaceEditOpen(false)
    setWorkspaceEditId(null)
    setNewWorkspaceName('')
    setNewWorkspacePiCwd('')
    setNewWorkspacePiCwdTouched(false)
    setNewWorkspaceEnableGit(false)
    setNewWorkspaceGitUrl('')
    setNewWorkspaceError('')
    newWorkspacePrefillGen.current += 1
  }, [workspaceManageOpen])

  useEffect(() => {
    if (!workspaceManageOpen || !workspaceEditOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWorkspaceEditOpen(false)
        window.setTimeout(() => setWorkspaceEditId(null), 220)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [workspaceManageOpen, workspaceEditOpen])

  useEffect(() => {
    if (!workspaceEditId) {
      setWorkspaceEditName('')
      setWorkspaceEditPath('')
      setWorkspaceEditPathError('')
      return
    }
    const w = workspaces.find((x) => x.id === workspaceEditId)
    if (!w) return
    const primary = workspaces[0]
    const inheritFrom = primary?.resolved_pi_cwd ?? diagnostics.resolvedHostPiCwd
    setWorkspaceEditName(w.name)
    setWorkspaceEditPath(w.pi_cwd.trim() ? w.pi_cwd : inheritFrom)
    setWorkspaceBackupEnabled(w.github_backup_enabled === 1)
    setWorkspaceBackupUrl(w.github_remote_url)
    setWorkspaceBackupError('')
    setGhPublishOpen(false)
    setGhPublishError('')
    setGhPublishResult(null)
    void refreshWorkspaceBackupStatus(w.id)
  }, [workspaceEditId, workspaces, diagnostics.resolvedHostPiCwd, refreshWorkspaceBackupStatus])

  useEffect(() => {
    if (!workspaceManageOpen || newWorkspacePiCwdTouched) return
    const gen = ++newWorkspacePrefillGen.current
    const trimmed = newWorkspaceName.trim()
    void (async () => {
      const path = trimmed ? await window.sylo.workspaces.defaultPathForName(newWorkspaceName) : ''
      if (newWorkspacePrefillGen.current !== gen) return
      setNewWorkspacePiCwd(path)
    })()
  }, [newWorkspaceName, workspaceManageOpen, newWorkspacePiCwdTouched])

  useEffect(() => {
    if (!activeId) return
    setUnreadConvIds((prev) => {
      if (!prev.has(activeId)) return prev
      const next = new Set(prev)
      next.delete(activeId)
      return next
    })
  }, [activeId])

  useEffect(() => {
    void refreshMessages()
  }, [activeId, refreshMessages])

  useEffect(() => {
    pendingConvScrollRef.current = true
    prevMessagesLenRef.current = 0
    // Initialize lastChatScrollTopRef to the current scroll position so that
    // a conversation switch (which may clamp scrollTop on a shorter list)
    // does not trigger a false "scrollbar-drag" opt-out.
    suppressScrollClearUntilRef.current = performance.now() + 300
    lastChatScrollTopRef.current = chatAreaRef.current?.scrollTop ?? 0
  }, [activeId])

  /** Called when the user genuinely scrolls up (wheel up or scrollbar drag). */
  const markUserScrolledUp = useCallback(() => {
    stickToBottomRef.current = false
  }, [])

  /** onScroll handler for both chat panes: keeps stick-to-bottom intent true
   * when at the true end, and only clears it on a real user upward scroll.
   * Content growing below the fold (compaction, next turn) must NOT opt out. */
  const onChatAreaScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atEnd = chatListRef.current?.isAtEnd() ?? isChatAreaNearBottom(el)
    if (atEnd) {
      stickToBottomRef.current = true
      lastChatScrollTopRef.current = el.scrollTop
      return
    }
    // Only a genuine upward scroll opts out: scrollTop decrease (scrollbar drag)
    // not caused by programmatic scrolls, or an up-wheel (handled in onWheel).
    const decreased = el.scrollTop < lastChatScrollTopRef.current - 1
    if (decreased && performance.now() > suppressScrollClearUntilRef.current) {
      stickToBottomRef.current = false
    }
    lastChatScrollTopRef.current = el.scrollTop
  }, [])

  const scrollChatToEnd = useCallback(() => {
    if (chatTimeline.length === 0) return
    if (chatListRef.current) {
      chatListRef.current.scrollToEnd()
      // The settle pump inside ChatTimelineList will re-assert intent via
      // its onSettleEnd callback. Keep the suppression window open for the
      // duration of the pump (up to ~45 frames).
      suppressScrollClearUntilRef.current = performance.now() + 1000
      return
    }
    const el = chatAreaRef.current
    if (el) {
      scrollChatAreaToBottom(el)
      suppressScrollClearUntilRef.current = performance.now() + 300
    }
  }, [chatTimeline.length])

  useLayoutEffect(() => {
    const chatTabJustOpened = tab === 'chat' && !prevChatTabVisibleRef.current
    prevChatTabVisibleRef.current = tab === 'chat'

    if (tab !== 'chat') return
    if (chatTimeline.length === 0) return

    // If the last message belongs to a different conversation, the timeline
    // is still showing the old conversation's content. Do NOT scroll — the
    // new conversation's messages will arrive shortly and trigger a fresh run.
    const lastRow = chatTimeline[chatTimeline.length - 1]
    if (
      lastRow?.kind === 'message' &&
      activeId &&
      (lastRow.message as Msg).conversation_id !== activeId
    ) {
      return
    }

    if (pendingConvScrollRef.current) {
      scrollChatToEnd()
      stickToBottomRef.current = true
      pendingConvScrollRef.current = false
      prevMessagesLenRef.current = chatTimeline.length
      return
    }

    if (chatTabJustOpened && stickToBottomRef.current) {
      scrollChatToEnd()
      prevMessagesLenRef.current = chatTimeline.length
      return
    }

    const prev = prevMessagesLenRef.current
    if (chatTimeline.length > prev && stickToBottomRef.current) {
      scrollChatToEnd()
    }
    if (activeThinkTankBubbles.length > 0 && stickToBottomRef.current) {
      scrollChatToEnd()
    }
    prevMessagesLenRef.current = chatTimeline.length
  }, [chatTimeline.length, activeThinkTankBubbles.length, activeId, scrollChatToEnd, tab])

  useEffect(() => {
    if (!renameConvModal && !deleteConvModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRenameConvModal(null)
        setDeleteConvModal(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [renameConvModal, deleteConvModal])

  useEffect(() => {
    if (!routeContextMenu && !convContextMenu) return
    const dismiss = () => {
      setRouteContextMenu(null)
      setConvContextMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    // Full-screen menu backdrops intercept wheel events; dismiss so panel scroll is not trapped.
    const onWheel = () => dismiss()
    document.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [routeContextMenu, convContextMenu])

  useEffect(() => {
    const u = window.sylo.skillSurface.onShow((p) => {
      setAgentWidgetPayload(p)
      setAgentWidgetLog([])
    })
    return u
  }, [])

  // Keep the active-workspace-cwd ref current for the canvas show gates inside
  // useCanvasTabs (those listeners are registered once, so they read this
  // ref, not a stale closure value).
  useEffect(() => {
    activeWorkspaceCwdRef.current = activeWorkspaceForSettings.resolvedPiCwd ?? ''
  }, [activeWorkspaceForSettings.resolvedPiCwd])

  // Keep the docked canvas within the (viewport-relative) clamp when the
  // window is resized smaller, so a previously-dragged-wide canvas doesn't
  // overflow the new viewport. The drag handler already clamps on pointer move.
  useEffect(() => {
    const onResize = () => setCanvasSize((s) => clampCanvasSize(s))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const u1 = window.sylo.broker.onStatus((p) => {
      setBrokerHint(formatBrokerBrief(p))
      void refreshBrokerFromMain()
      const o = p && typeof p === 'object' ? (p as { status?: string }) : {}
      const st = o.status
      if (st !== 'starting') void refreshSkillRoutes()
      const t = tabRef.current
      if (t === 'skills' && st !== 'starting') void refreshCapabilities()
    })
    const u2 = window.sylo.broker.onError((p) => {
      if (!p || typeof p !== 'object') {
        setBrokerHint('Broker error.')
        return
      }
      const o = p as { error?: string }
      setBrokerHint(`Broker error: ${o.error ?? '(unknown)'}`)
    })
    const u_sp = window.sylo.broker.onSystemPromptStats((p) => {
      if (p && typeof p === 'object') setSystemPromptStats(p as { totalChars: number; totalTokens: number; sections: { label: string; chars: number; tokens: number; pct: number }[] })
    })
        const u_ac = window.sylo.broker.onActualContextTokens((tokens) => {
      if (typeof tokens === 'number') setActualMessageTokens(tokens)
    })
    const u3 = window.sylo.chatEvents.onRefresh((p) => {
      if (!p?.conversationId) return
      if (p.conversationId === activeId) void refreshMessages()
      if (p.kind === 'turnStarted') {
        setUnreadConvIds((prev) => {
          if (!prev.has(p.conversationId)) return prev
          const next = new Set(prev)
          next.delete(p.conversationId)
          return next
        })
        setSendingConvIds((prev) => {
          const next = new Set(prev)
          next.add(p.conversationId)
          return next
        })
        if (p.conversationId === activeIdRef.current) void refreshMessages()
        void refreshConversations()
        return
      }
      if (p.kind === 'turnFinished') {
        setSendingConvIds((prev) => {
          if (!prev.has(p.conversationId)) return prev
          const next = new Set(prev)
          next.delete(p.conversationId)
          return next
        })
        if (p.conversationId !== activeIdRef.current) {
          setUnreadConvIds((prev) => {
            const next = new Set(prev)
            next.add(p.conversationId)
            return next
          })
        }
                if (p.conversationId !== activeId && activeId && agentReady && !safeMode) {
          void window.sylo.broker.prepareConversation(activeId)
        }
        void refreshConversations()
      }
      if (p.kind === 'conversationRenamed') {
        void refreshConversations()
        return
      }
      if (p.kind === 'conversationDeleted') {
        if (p.conversationId === activeIdRef.current) {
          activeIdRef.current = undefined
          setActiveId(undefined)
        }
        setUnreadConvIds((prev) => {
          if (!prev.has(p.conversationId)) return prev
          const next = new Set(prev)
          next.delete(p.conversationId)
          return next
        })
        setSendingConvIds((prev) => {
          if (!prev.has(p.conversationId)) return prev
          const next = new Set(prev)
          next.delete(p.conversationId)
          return next
        })
        void refreshConversations()
        return
      }
    })
        const u4 = window.sylo.chatEvents.onStream((ev) => {
      const pending = liveDeltaPendingRef.current
      pending.set(ev.messageId, (pending.get(ev.messageId) ?? '') + ev.delta)
      scheduleLiveDeltaFlush()
    })
    const u5 = window.sylo.chatEvents.onTool((x) => {
      setLiveWorkflow((prev) => ({
        ...prev,
        [x.messageId]: [...(prev[x.messageId] ?? []), { ts: x.ts, event: x.event }],
      }))
    })
        return () => {
      u1()
      u2()
      u_sp()
      u_ac()
      u3()
      u4()
      u5()
      if (liveDeltaFlushTimerRef.current != null) {
        clearTimeout(liveDeltaFlushTimerRef.current)
        liveDeltaFlushTimerRef.current = null
      }
      flushLiveDeltas()
    }
  }, [
    activeId,
    agentReady,
    safeMode,
    refreshMessages,
    refreshConversations,
    refreshBrokerFromMain,
    refreshCapabilities,
    refreshSkillRoutes,
    flushLiveDeltas,
    scheduleLiveDeltaFlush,
  ])

  useEffect(() => {
    if (tab === 'skills') void refreshCapabilities()
    if (tab === 'skill-route') void refreshSkillRoutes()
  }, [tab, refreshCapabilities, refreshSkillRoutes])

  useEffect(() => {
    void refreshSkillRoutes()
  }, [sidebarWorkspaceId, refreshSkillRoutes])

  useEffect(() => {
    if (tab === 'skills') void refreshCapabilities()
  }, [sidebarWorkspaceId, tab, refreshCapabilities])

  useEffect(() => {
    if (!activeSkillRoute) return
    const k = skillRouteRowKey(activeSkillRoute)
    if (!skillRoutes.some((r) => skillRouteRowKey(r) === k)) {
      setActiveSkillRoute(null)
      if (tab === 'skill-route') setTab('chat')
    }
  }, [skillRoutes, activeSkillRoute, tab])

  useEffect(() => {
    if (tab === 'skill-route' && !activeSkillRoute) setTab('chat')
  }, [tab, activeSkillRoute])

  const deliverQueuedText = useCallback(
    async (
      text: string,
      attachments?: { path: string; name: string }[],
    ): Promise<boolean> => {
      if (!activeId || safeMode || !agentReady) return false
      try {
        const r = await window.sylo.chat.deliverQueued(activeId, text, attachments)
        if (!r.ok) return false
        setSendingConvIds((prev) => {
          if (!activeId || prev.has(activeId)) return prev
          const next = new Set(prev)
          next.add(activeId)
          return next
        })
        void refreshMessages()
        return true
      } catch {
        return false
      }
    },
    [activeId, safeMode, agentReady, refreshMessages],
  )

  const handleSendingStarted = useCallback(() => {
    setSendingConvIds((prev) => {
      if (!activeId || prev.has(activeId)) return prev
      const next = new Set(prev)
      next.add(activeId)
      return next
    })
  }, [activeId])

  const handleSegmentToggle = useCallback((key: string, next: boolean) => {
    setSegmentOverrides((prev) => ({ ...prev, [key]: next }))
  }, [])

  const handleSubagentNotice = useCallback((message: string) => {
    setSubagentNotice(message)
  }, [])

  const scrollToRunningSubagent = useCallback(() => {
    document.querySelector('[data-subagent-running="true"]')?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [])

  const stopAllSubagents = useCallback(async () => {
    for (const t of subagentRunning) {
      await window.sylo.tasks.cancel(t.id)
    }
    await reloadSubagentTasks()
  }, [subagentRunning, reloadSubagentTasks])

  useEffect(() => {
    const unsub = window.sylo.thinkTank.onLifecycle((raw) => {
      const payload = raw as Record<string, unknown> & { conversationId?: string | null }
      let convId = typeof payload.conversationId === 'string' ? payload.conversationId : undefined
      if (!convId) {
        const sessionId = String(payload.sessionId ?? '')
        if (sessionId) {
          convId = Object.keys(thinkTankByConvRef.current).find(
            (id) => thinkTankByConvRef.current[id]?.sessionId === sessionId,
          )
        }
      }
      if (!convId) return
      if (payload.type === 'session_start') {
        const sessionId = String(payload.sessionId ?? '')
        if (sessionId) {
          setThinkTankSessionsByConv((prev) => {
            const list = prev[convId] ?? []
            if (list.some((s) => s.sessionId === sessionId)) return prev
            return {
              ...prev,
              [convId]: [
                ...list,
                {
                  sessionId,
                  topic: String(payload.topic ?? '(think tank)'),
                  status: 'debating',
                  sourceMessageId:
                    typeof payload.sourceMessageId === 'string' ? payload.sourceMessageId : null,
                  createdAt: Date.now(),
                },
              ],
            }
          })
        }
      }
      if (payload.type === 'phase' || payload.type === 'complete' || payload.type === 'error') {
        const sessionId = String(payload.sessionId ?? '')
        const phaseStatus =
          payload.type === 'complete' ? 'complete'
          : payload.type === 'error' ?
            /stopped by operator|run aborted/i.test(String(payload.message ?? '')) ?
              'cancelled'
            : 'error'
          : String(payload.phase ?? '')
        if (sessionId && phaseStatus) {
          setThinkTankSessionsByConv((prev) => {
            const list = prev[convId] ?? []
            const idx = list.findIndex((s) => s.sessionId === sessionId)
            if (idx < 0) return prev
            const next = [...list]
            next[idx] = { ...next[idx]!, status: phaseStatus }
            return { ...prev, [convId]: next }
          })
        }
      }
      setThinkTankByConv((prev) => {
        const next = applyThinkTankLifecycleEvent(prev[convId], payload)
        if (!next) return prev
        return { ...prev, [convId]: next }
      })
      setThinkTankBubblesByConv((prev) => ({
        ...prev,
        [convId]: applyThinkTankBubbleEvent(prev[convId], payload),
      }))
      if (payload.type === 'turn_workflow') {
        const messageId = String(payload.messageId ?? '')
        if (!messageId) return
        const ts = typeof payload.ts === 'number' ? payload.ts : Date.now()
        setLiveWorkflow((prev) => ({
          ...prev,
          [messageId]: [...(prev[messageId] ?? []), { ts, event: payload.event }],
        }))
      }
      if (payload.type === 'turn') {
        const messageId = String(payload.messageId ?? '')
        if (!messageId) return
        setLiveWorkflow((prev) => {
          if (!(messageId in prev)) return prev
          const next = { ...prev }
          delete next[messageId]
          return next
        })
      }
    })
    return unsub
  }, [])

  const handleThinkTankAbort = useCallback(async (sessionId: string) => {
    const r = await window.sylo.thinkTank.abort(sessionId)
    if (!r.ok) window.alert(r.error)
  }, [])

  const handleThinkTankInject = useCallback(async (text: string) => {
    const sessionId = activeThinkTankSession?.sessionId
    if (!sessionId) return false
    const r = await window.sylo.thinkTank.inject(sessionId, text)
    if (!r.ok) {
      window.alert(r.error)
      return false
    }
    return true
  }, [activeThinkTankSession?.sessionId])

  const handleThinkTankUiChange = useCallback((sessionId: string, ui: ThinkTankSessionUiState) => {
    setThinkTankUiBySession((prev) => ({ ...prev, [sessionId]: ui }))
  }, [])

  const handleOpenThinkTankRoute = useCallback(() => {
    const hit = skillRoutes.find(
      (r) => r.routeId === 'think-tank' || r.title.toLowerCase() === 'think tank',
    )
    if (!hit) return
    setActiveSkillRoute(hit)
    setTab('skill-route')
  }, [skillRoutes])

  const handleOpenLogicForgeIoReview = useCallback(
    async (runDirRaw: string) => {
      let runDir = runDirRaw.trim()
      if (!runDir) return
      if (runDir.replace(/[/\\]+$/, '').split(/[/\\]/).pop()?.toLowerCase() === 'parse') {
        runDir = runDir.replace(/[/\\]parse[/\\]?$/i, '')
      }
      const hit = skillRoutes.find(
        (r) => r.routeId === 'logicforge' || r.title.toLowerCase() === 'logicforge',
      )
      if (!hit) {
        window.alert(
          'LogicForge route not found — enable sylo-logicforge + logicforge skill, then restart Sylo.',
        )
        return
      }
      const sk = hit.skillFolderName
      let existing: Record<string, unknown> = {}
      try {
        const r = await window.sylo.skillData.read(sk, 'logicforge-io-review')
        if (!r.ok || !r.value) {
          const legacy = await window.sylo.skillData.read(sk, 'io-scaffold-paths')
          if (legacy.ok && legacy.value) {
            existing = legacy.value as Record<string, unknown>
          }
        } else if (r.value && typeof r.value === 'object' && !Array.isArray(r.value)) {
          existing = r.value as Record<string, unknown>
        }
      } catch {
        /* ignore */
      }
      const wr = await window.sylo.skillData.write(sk, 'logicforge-io-review', {
        ...existing,
        runDir,
        openReviewTab: true,
        autoLoadReview: true,
      })
      if (!wr.ok) {
        window.alert(wr.error)
        return
      }
      setActiveSkillRoute(hit)
      setTab('skill-route')
    },
    [skillRoutes],
  )

  const renderChatTimelineRow = useCallback(
    (row: ChatTimelineRow) => {
      if (row.kind === 'message') {
        const m = row.message as Msg
        return (
          <ChatConversationMessageRow
            m={m}
            liveDeltaForId={liveDelta[m.id] ?? ''}
            liveWorkflowForMessage={liveWorkflow[m.id] ?? EMPTY_WORKFLOW}
            segmentOverrides={segmentOverrides}
            onSegmentToggle={handleSegmentToggle}
            subagentTasks={subagentTasks}
            onSubagentNotice={handleSubagentNotice}
            onOpenLogicForgeIoReview={(runDir) => void handleOpenLogicForgeIoReview(runDir)}
            workspaceId={sidebarWorkspaceId}
          />
        )
      }
      return (
        <ThinkTankSessionBlock
          sessionId={row.sessionId}
          topic={row.topic}
          status={row.status}
          bubbles={row.bubbles}
          liveSession={row.liveSession}
          uiState={thinkTankUiBySession[row.sessionId]}
          onUiChange={handleThinkTankUiChange}
          liveWorkflow={liveWorkflow}
          segmentOverrides={segmentOverrides}
          onSegmentToggle={handleSegmentToggle}
          subagentTasks={subagentTasks}
          onSubagentNotice={handleSubagentNotice}
          onOpenThinkTankRoute={handleOpenThinkTankRoute}
          onAbort={(id) => void handleThinkTankAbort(id)}
          workspaceId={sidebarWorkspaceId}
        />
      )
    },
    [
      handleOpenLogicForgeIoReview,
      handleSubagentNotice,
      handleOpenThinkTankRoute,
      handleSegmentToggle,
      handleThinkTankUiChange,
      handleThinkTankAbort,
      liveDelta,
      liveWorkflow,
      subagentTasks,
      segmentOverrides,
      thinkTankUiBySession,
      sidebarWorkspaceId,
    ],
  )

  const thinkTankLive =
    activeThinkTankSession?.status === 'debating' || activeThinkTankSession?.status === 'final_reports'

  const thinkTankInjectMode = activeThinkTankSession?.status === 'debating'

  const thinkTankLocksComposer = activeThinkTankSession?.status === 'final_reports'

  const showComposerStop = activeSending || thinkTankLive
  const thinkTankAbortSessionId =
    thinkTankLive ? activeThinkTankSession?.sessionId : undefined

  const stopActiveTurn = useCallback(async () => {
    if (!activeId || safeMode || (!activeSending && !thinkTankLive)) return
    if (thinkTankAbortSessionId) {
      await window.sylo.thinkTank.abort(thinkTankAbortSessionId)
      return
    }
    await window.sylo.chat.abort(activeId)
  }, [activeId, activeSending, thinkTankLive, thinkTankAbortSessionId, safeMode])

  const branchConversation = async (convId: string) => {
    if (branchingConvId || safeMode || !agentReady) return
    setBranchingConvId(convId)
    setConvContextMenu(null)
    try {
      const r = await window.sylo.chat.branchConversation(convId)
      if (!r.ok) {
        window.alert(r.error)
        return
      }
      await refreshConversations()
      setActiveId(r.conversationId)
      setTab('chat')
      void window.sylo.prefs.set('sylo.ui.active_conversation_id', r.conversationId)
    } finally {
      setBranchingConvId(null)
    }
  }

  const exportConversationMarkdown = useCallback(
    async (convId: string) => {
      try {
        const msgs = await window.sylo.messages.list(convId)
        const conv = conversations.find((c) => c.id === convId)
        const workspace = workspaces.find((w) => w.id === conv?.workspace_id)
        const brokerStatus = await window.sylo.broker.getStatus()
        const caps = await window.sylo.capabilities.list(workspace?.id ?? undefined)
        const isActive = convId === activeId
        const messagesWithLive = msgs.map((m) => {
          if (!isActive || m.role !== 'assistant') return m
          const delta = liveDelta[m.id] ?? ''
          return delta ? { ...m, content: m.content + delta } : m
        })
        const dbThinkTankSessions = await window.sylo.thinkTank.listForConversation(convId)
        const uiThinkTankBubbles = isActive ? (thinkTankBubblesByConv[convId] ?? []) : []
        const uiSessionById: Record<string, { topic: string; status: string }> = {}
        const liveThinkTank = thinkTankByConv[convId]
        if (liveThinkTank) {
          uiSessionById[liveThinkTank.sessionId] = {
            topic: liveThinkTank.topic,
            status: liveThinkTank.status,
          }
        }
        for (const session of dbThinkTankSessions) {
          const sid = String(session.id ?? '')
          if (!sid || uiSessionById[sid]) continue
          uiSessionById[sid] = {
            topic: String(session.topic ?? ''),
            status: String(session.status ?? 'debating'),
          }
        }
        const { turns: thinkTankTurns, reports: thinkTankReports } = mergeThinkTankTurnsForExport({
          dbSessions: dbThinkTankSessions,
          uiBubbles: uiThinkTankBubbles,
          liveWorkflow: isActive ? liveWorkflow : {},
          uiSessionById,
        })
        const md = buildConversationMarkdown({
          conversation: {
            id: convId,
            title: conv?.title ?? '(untitled)',
            pi_session_relpath: conv?.pi_session_relpath ?? null,
            created_at: conv?.created_at,
            updated_at: conv?.updated_at,
          },
          workspace:
            workspace ?
              { name: workspace.name, cwd: workspace.resolved_pi_cwd }
            : null,
          messages: messagesWithLive,
          liveTelemetryByMessageId: isActive ? liveWorkflow : undefined,
          thinkTankTurns,
          thinkTankReports,
          agentModel:
            brokerStatus.resolvedModel ?
              {
                provider: brokerStatus.resolvedModel.provider,
                modelId: brokerStatus.resolvedModel.modelId,
                displayName: brokerStatus.resolvedModel.displayName,
                input: brokerStatus.modelInput,
                visionCapable: brokerStatus.visionCapable,
              }
            : null,
          capabilities: {
            brokerOk: caps.brokerOk,
            brokerReady: caps.brokerReady,
            brokerError: caps.brokerError,
            agentDir: caps.agentDir,
            piCwd: caps.piCwd,
            skills: caps.skills.map((s) => ({
              name: s.name,
              path: s.path,
              origin: s.origin,
              excludedFromAgent: s.excludedFromAgent,
            })),
            extensions: caps.extensions.map((e) => ({
              name: e.name,
              path: e.path,
              origin: e.origin,
              excludedFromAgent: e.excludedFromAgent,
              tools: e.tools.map((t) => ({
                name: t.name,
                excludedFromAgent: Boolean(t.excludedFromAgent),
              })),
              commandNames: e.commandNames,
            })),
            packages: caps.packages,
            loadErrors: caps.loadErrors,
            toolNameCollisions: caps.toolNameCollisions,
          },
        })
        downloadTextFile(`${sanitizeExportFilename(conv?.title ?? '')}.md`, md)
      } catch (e) {
        window.alert(`Could not export conversation: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [activeId, conversations, thinkTankBubblesByConv, thinkTankByConv, liveDelta, liveWorkflow, workspaces],
  )

  const prefillChatPrompt = useCallback((text: string) => {
    pendingComposerPrefillRef.current = text
    setTab('chat')
  }, [])

  const prefillNewChatPrompt = useCallback(
    async (text: string) => {
      const wid = sidebarWorkspaceId.trim()
      if (!wid) throw new Error('no_workspace_selected')
      pendingComposerPrefillRef.current = text
      const reuseId = await window.sylo.conversations.findLatestEmpty(wid)
      if (reuseId) {
        await refreshConversations()
        setActiveId(reuseId)
      } else {
        const c = await window.sylo.conversations.create('', wid)
        await refreshConversations()
        setActiveId(c.id)
      }
      setTab('chat')
    },
    [refreshConversations, sidebarWorkspaceId],
  )

  useEffect(() => {
    if (tab !== 'chat') return
    const pending = pendingComposerPrefillRef.current
    if (!pending) return
    pendingComposerPrefillRef.current = null
    composerRef.current?.prefill(pending)
  }, [tab, activeId])

  const prefillNewSkill = useCallback(() => {
    prefillChatPrompt('/skill:sylo-skill-author ')
  }, [prefillChatPrompt])

  const newChat = async () => {
    const wid = sidebarWorkspaceId.trim()
    if (!wid) return
    const reuseId = await window.sylo.conversations.findLatestEmpty(wid)
    if (reuseId) {
      await refreshConversations()
      setActiveId(reuseId)
      setTab('chat')
      return
    }
    const c = await window.sylo.conversations.create('', wid)
    await refreshConversations()
    setActiveId(c.id)
    setTab('chat')
  }

  const handleAttachUiFolder = useCallback(async () => {
    const p = await window.sylo.dialog.openDirectory({
      title: 'Select folder to attach to Sylo (skill or app with HTML UI)',
    })
    if (!p?.trim()) return
    prefillChatPrompt(
      `/skill:sylo-attach-ui Attach this folder to Sylo GUI (sidebar route or chat widget).\n\nFolder path: ${p.trim()}`,
    )
  }, [prefillChatPrompt])

  const openRenameConversationModal = (id: string, currentTitle: string) => {
    setRenameConvModal({ id, draft: currentTitle ?? '' })
  }

  const commitRenameConversation = async () => {
    if (!renameConvModal) return
    await window.sylo.conversations.setTitle(renameConvModal.id, renameConvModal.draft.trim())
    setRenameConvModal(null)
    await refreshConversations()
  }

  const performDeleteConversation = async (id: string) => {
    if (sendingConvIds.has(id)) {
      try {
        await window.sylo.chat.abort(id)
      } catch {
        /* best-effort — still delete */
      }
    }
    await window.sylo.conversations.delete(id)
    if (activeId === id) {
      activeIdRef.current = undefined
      setActiveId(undefined)
    }
    await refreshConversations()
  }

  const confirmDeleteConversation = async () => {
    if (!deleteConvModal) return
    const id = deleteConvModal.id
    setDeleteConvModal(null)
    await performDeleteConversation(id)
  }

  // const workflowModalMessage =
  //   workflowModalId ? messages.find((m) => m.id === workflowModalId) : undefined
  // const workflowModalUserCreatedAt = (() => {
  //   if (!workflowModalMessage) return null
  //   const ix = messages.findIndex((m) => m.id === workflowModalMessage.id)
  //   if (ix <= 0) return null
  //   for (let i = ix - 1; i >= 0; i--) {
  //     const prev = messages[i]
  //     if (prev?.role === 'user') return prev.created_at
  //   }
  //   return null
  // })()

  /** Toggle a package entry in settings; `alsoStrip` removes legacy alias specs when disabling. */
  const togglePackage = async (
    pkg: string,
    enabled: boolean,
    alsoStrip: string[] = [],
    opts?: { skillPaths?: string[] },
  ) => {
    if (enabled && opts?.skillPaths?.length) {
      const batch = await window.sylo.skillSurfaces.lintBatch(opts.skillPaths)
      const messages: string[] = []
      for (const p of opts.skillPaths) {
        const rep = batch[p]
        if (rep?.errors.length) {
          messages.push(`${p}: ${rep.errors.join('; ')}`)
        }
      }
      if (messages.length) {
        window.alert(
          [
            'Cannot turn package on for the agent — skill UI lint failed (widgets/routes need fallback.md on disk).',
            '',
            ...messages,
            '',
            'Fix the files above, then try again.',
          ].join('\n'),
        )
        return
      }
    }
    const strip = new Set([pkg, ...alsoStrip])
    const packages = Array.isArray(settingsJson.packages)
      ? settingsJson.packages.map(String)
      : []
    const nextPkgs = enabled
      ? [...new Set([...packages.filter((p) => !strip.has(p)), pkg])]
      : packages.filter((p) => !strip.has(p))
    const next = { ...settingsJson, packages: nextPkgs }
    await window.sylo.capabilities.writeSettings(next)
    setSettingsJson(next)
  }

  const reorderRouteWithinSection = (
    section: SkillRouteNavSection,
    draggedKey: string,
    targetKey: string,
  ) => {
    if (draggedKey === targetKey) return
    const keys = sortedRoutesForNavSection(section, skillRoutes, navLayout).map(skillRouteRowKey)
    const fi = keys.indexOf(draggedKey)
    const ti = keys.indexOf(targetKey)
    if (fi < 0 || ti < 0 || fi === ti) return
    const next = [...keys]
    next.splice(fi, 1)
    next.splice(ti, 0, draggedKey)
    void persistNavLayout({
      ...navLayout,
      order: { ...navLayout.order, [section]: next },
    })
  }

  const togglePinSkillRouteKey = (k: string) => {
    const arr = [...navLayout.pinned]
    const ix = arr.indexOf(k)
    if (ix >= 0) arr.splice(ix, 1)
    else arr.push(k)
    void persistNavLayout({ ...navLayout, pinned: arr })
  }

    const bridgeTargetRoute = routePopoutKey ? popoutRoute : activeSkillRoute

  const handleSkillRouteBridge = useCallback(
    async (op: SkillRouteBridgeOp, payload: unknown) => {
      op = normalizeSkillRouteBridgeOp(op)
      const route = bridgeTargetRoute
      if (!route) throw new Error('no_active_route')
      const sk = route.skillFolderName
      if (op === 'ping') {
        return { pong: true }
      }
      if (op === 'readSkillData') {
        const p = payload as { key?: string }
        const key = typeof p?.key === 'string' ? p.key : 'default'
        const r = await window.sylo.skillData.read(sk, key)
        if (!r.ok) throw new Error(r.error)
        return r.value
      }
      if (op === 'writeSkillData') {
        const p = payload as { key?: string; value?: unknown }
        const key = typeof p?.key === 'string' ? p.key : 'default'
        const r = await window.sylo.skillData.write(sk, key, p.value)
        if (!r.ok) throw new Error(r.error)
        return { written: true }
      }
      if (op === 'sendToAgent') {
        const inj = await window.sylo.skillSurface.injectFollowUp(
          `[Sylo route sendToAgent] skill=${sk} route=${route.routeId} payload=${JSON.stringify(payload)}`,
        )
        if (!inj.ok) throw new Error(inj.error)
        return { queued: true }
      }
      if (op === 'webAccessListRuns') {
        const p = payload as { limit?: number }
        const limit = typeof p?.limit === 'number' ? p.limit : 80
        return await window.sylo.webAccess.listRuns(limit)
      }
      if (op === 'webAccessStats') {
        return await window.sylo.webAccess.stats()
      }
      if (op === 'webAccessConfigGet') {
        return await window.sylo.webAccess.configGet()
      }
            if (op === 'webAccessConfigSave') {
        const p = payload as { values?: Record<string, unknown> }
        if (!p?.values || typeof p.values !== 'object') throw new Error('bad_values')
        const r = await window.sylo.webAccess.configSave(p.values)
        if (!r.ok) throw new Error(r.error)
        return r
      }
      if (op === 'webAccessBraveQuota') {
        return await window.sylo.webAccess.braveQuota()
      }
      if (op === 'settingsOllamaListTags') {
        const pref = (await window.sylo.prefs.get('sylo.ollama_base_url', '')) as string
        const baseUrl = normalizeOllamaOriginUi(pref.trim() || (await window.sylo.ollama.inferBaseUrl()))
        const listed = await window.sylo.ollama.listTags(baseUrl)
        if (!listed.ok) throw new Error(listed.error)
        return { baseUrl, models: listed.models }
      }
      if (window.sylo.personal) {
        // Personal-bundle ops (route bridge + companion) — generic dispatch;
        // op list comes from the installed bundle. Cache non-empty lists only
        // (the plugin loads async right after boot; an early empty result must
        // not stick).
        const ops = await getPersonalOps()
        if (ops.includes(op)) {
          return await window.sylo.personal.rpc(op, payload)
        }
      }
      if (op === 'logicforgeParseRulesGet') {
        return await logicforgeParseRulesGet()
      }
      if (op === 'logicforgeParseRulesSave') {
        const p = payload as { parse_config?: unknown; settings?: unknown }
        return await logicforgeParseRulesSave(p ?? {})
      }
      if (op === 'logicforgeParseRulesReset') {
        return await logicforgeParseRulesReset()
      }
      if (op === 'logicforgeIoReviewGet') {
        const p = payload as { run_dir?: string }
        return await logicforgeIoReviewGet({ run_dir: String(p?.run_dir ?? '') })
      }
      if (op === 'logicforgeIoReviewReseed') {
        const p = payload as { run_dir?: string; overwrite?: boolean }
        return await logicforgeIoReviewReseed({
          run_dir: String(p?.run_dir ?? ''),
          overwrite: Boolean(p?.overwrite),
        })
      }
      if (op === 'logicforgeIoReviewSave') {
        const p = payload as { run_dir?: string; review?: unknown }
        return await logicforgeIoReviewSave({
          run_dir: String(p?.run_dir ?? ''),
          review: p?.review,
        })
      }
      if (op === 'logicforgeIoReviewApproveBuild') {
        const p = payload as { run_dir?: string; review?: unknown }
        return await logicforgeIoReviewApproveBuild({
          run_dir: String(p?.run_dir ?? ''),
          review: p?.review,
        })
      }
      if (op === 'logicforgeDownloadAllowlistGet') {
        return await logicforgeDownloadAllowlistGet()
      }
      if (op === 'logicforgeDownloadAllowlistSave') {
        const p = payload as {
          allow_downloads?: boolean
          post_download_mode?: 'program' | 'run'
          ips?: Array<{ ip: string; label?: string; enabled?: boolean }>
          notes?: string
        }
        return await logicforgeDownloadAllowlistSave(p ?? {})
      }
            if (op === 'logicforgeDownloadPlcStatus') {
        const p = payload as { ip?: string }
        return await logicforgeDownloadPlcStatus(String(p?.ip ?? ''))
      }
      if (op === 'logicforgeTemplates') {
        const p = payload as { op?: string; payload?: Record<string, unknown> }
        return await logicforgeTemplates(String(p?.op ?? ''), p?.payload)
      }
      if (op === 'syloWorkflowsList') {
        const p = payload as { project_dir?: string }
        const wid = sidebarWorkspaceId.trim()
        const hit = workspaces.find((w) => w.id === wid)
        const projectDir =
          typeof p?.project_dir === 'string' && p.project_dir.trim() ?
            p.project_dir.trim()
          : (hit?.resolved_pi_cwd ?? diagnostics.resolvedHostPiCwd ?? '')
        return await syloWorkflowsList({
          project_dir: projectDir,
          agent_dir: diagnostics.resolvedPiAgentDir,
        })
      }
      if (op === 'syloWorkflowRead') {
        const p = payload as { project_dir?: string; id?: string }
        const wid = sidebarWorkspaceId.trim()
        const hit = workspaces.find((w) => w.id === wid)
        const projectDir =
          typeof p?.project_dir === 'string' && p.project_dir.trim() ?
            p.project_dir.trim()
          : (hit?.resolved_pi_cwd ?? diagnostics.resolvedHostPiCwd ?? '')
        return await syloWorkflowRead({
          project_dir: projectDir,
          agent_dir: diagnostics.resolvedPiAgentDir,
          id: String(p?.id ?? ''),
        })
      }
      if (op === 'syloWorkflowSave') {
        const p = payload as { content?: string; previous_id?: string }
        const content = typeof p?.content === 'string' ? p.content : ''
        if (!content.trim()) throw new Error('workflow content is required')
        return await syloWorkflowSave({
          content,
          previous_id: typeof p?.previous_id === 'string' ? p.previous_id : undefined,
          agent_dir: diagnostics.resolvedPiAgentDir,
        })
      }
      if (op === 'syloWorkflowDelete') {
        const p = payload as { id?: string }
        return await syloWorkflowDelete({
          id: String(p?.id ?? ''),
          agent_dir: diagnostics.resolvedPiAgentDir,
        })
      }
      if (op === 'fieldbrainConfigGet') {
        return await fieldbrainConfigGet()
      }
      if (op === 'fieldbrainConfigSave') {
        const p = payload as Record<string, unknown>
        return await fieldbrainConfigSave(p ?? {})
      }
      if (op === 'fieldbrainDbCheck') {
        return await fieldbrainDbCheck()
      }
      if (op === 'fieldbrainDbMigrate') {
        return await fieldbrainDbMigrate()
      }
      if (op === 'fieldbrainLogList') {
        return await fieldbrainLogList()
      }
      if (op === 'fieldbrainDocumentList') {
        const p = payload as Record<string, unknown> | undefined
        return await fieldbrainDocumentList(p ?? {})
      }
      if (op === 'fieldbrainBrainList') {
        const p = payload as Record<string, unknown>
        return await fieldbrainBrainList(p ?? {})
      }
      if (op === 'fieldbrainProjectList') {
        return await fieldbrainProjectList()
      }
      if (op === 'fieldbrainProjectCreate') {
        const p = payload as Record<string, unknown>
        return await fieldbrainProjectCreate(p ?? {})
      }
      if (op === 'fieldbrainDbBootstrap') {
        const p = payload as Record<string, unknown>
        return await fieldbrainDbBootstrap(p as import('./lib/fieldbrain-bridge').FieldBrainBootstrapPayload)
      }
      if (op === 'fieldbrainPgvectorGuide') {
        return await fieldbrainPgvectorGuide()
      }
      if (op === 'fieldbrainPgvectorInstallFromFolder') {
        const p = payload as Record<string, unknown>
        return await fieldbrainPgvectorInstallFromFolder(p as import('./lib/fieldbrain-bridge').FieldBrainPgvectorInstallPayload)
      }
      if (op === 'fieldbrainPgvectorEnable') {
        const p = payload as Record<string, unknown>
        return await fieldbrainPgvectorEnable(p as import('./lib/fieldbrain-bridge').FieldBrainBootstrapPayload)
      }
      if (op === 'onenoteAuthStatus') {
        return await onenoteAuthStatus()
      }
      if (op === 'onenoteAuthStart') {
        return await onenoteAuthStart()
      }
      if (op === 'onenoteAuthComplete') {
        return await onenoteAuthComplete()
      }
      if (op === 'onenoteAuthLogout') {
        return await onenoteAuthLogout()
      }
      if (op === 'onenoteSettingsGet') {
        return await onenoteSettingsGet()
      }
      if (op === 'onenoteSettingsSave') {
        const p = payload as Record<string, unknown>
        return await onenoteSettingsSave(p ?? {})
      }
      if (op === 'onenoteNotebookList') {
        return await onenoteNotebookList()
      }
      if (op === 'onenoteIndexSync') {
        return await onenoteIndexSync()
      }
      if (op === 'onenoteIndexProgress') {
        return await onenoteIndexProgress()
      }
      if (op === 'onenoteImportLegacyCache') {
        return await onenoteImportLegacyCache()
      }
            if (op === 'workspaceResolvedPiCwd') {
        const wid = sidebarWorkspaceId.trim()
        const hit = workspaces.find((w) => w.id === wid)
        return hit?.resolved_pi_cwd ?? diagnostics.resolvedHostPiCwd ?? ''
      }
      // ── sylo-tasks sidebar dashboard (Phase 3) ─────────────────────────
      // The dashboard iframe is workspace-scoped: the host injects the active
      // workspace's resolved cwd into every call so the route itself never
      // needs to resolve it (and never sees a different workspace's store).
      if (
        op === 'tasksSnapshotGet' ||
        op === 'tasksListGet' ||
        op === 'tasksListCreate' ||
        op === 'tasksListDelete' ||
        op === 'tasksTaskAdd' ||
        op === 'tasksTaskUpdate' ||
        op === 'tasksTaskDelete'
      ) {
        const wid = sidebarWorkspaceId.trim()
        const hit = workspaces.find((w) => w.id === wid)
        const workspaceCwd = (hit?.resolved_pi_cwd ?? diagnostics.resolvedHostPiCwd ?? '').trim()
        const p = (payload ?? {}) as Record<string, unknown>
        if (op === 'tasksSnapshotGet') return await window.sylo.tasksDb.snapshotGet(workspaceCwd)
        if (op === 'tasksListGet')
          return await window.sylo.tasksDb.listGet({
            workspaceCwd,
            listId: String(p.listId ?? ''),
          })
        if (op === 'tasksListCreate')
          return await window.sylo.tasksDb.listCreate({
            workspaceCwd,
            title: String(p.title ?? ''),
            mode: typeof p.mode === 'string' ? p.mode : undefined,
            description: typeof p.description === 'string' ? p.description : undefined,
          })
        if (op === 'tasksListDelete')
          return await window.sylo.tasksDb.listDelete({
            workspaceCwd,
            listId: String(p.listId ?? ''),
          })
        if (op === 'tasksTaskAdd')
          return await window.sylo.tasksDb.taskAdd({
            workspaceCwd,
            list_id: String(p.list_id ?? ''),
            title: String(p.title ?? ''),
            status: typeof p.status === 'string' ? p.status : undefined,
            notes: typeof p.notes === 'string' ? p.notes : undefined,
            due: typeof p.due === 'string' ? p.due : undefined,
            blocked_by: Array.isArray(p.blocked_by) ? (p.blocked_by as string[]) : undefined,
          })
        if (op === 'tasksTaskUpdate')
          return await window.sylo.tasksDb.taskUpdate({
            workspaceCwd,
            id: String(p.id ?? ''),
            title: typeof p.title === 'string' ? p.title : undefined,
            status: typeof p.status === 'string' ? p.status : undefined,
            notes: p.notes === undefined ? undefined : p.notes === null ? null : String(p.notes),
            due: p.due === undefined ? undefined : p.due === null ? null : String(p.due),
            blocked_by: Array.isArray(p.blocked_by) ? (p.blocked_by as string[]) : undefined,
          })
        // tasksTaskDelete
        return await window.sylo.tasksDb.taskDelete({
          workspaceCwd,
          taskId: String(p.taskId ?? ''),
        })
      }
      if (op === 'openExternalUrl') {
        const p = payload as { url?: string }
        const url = typeof p?.url === 'string' ? p.url.trim() : ''
        if (!url) throw new Error('empty_url')
        await window.sylo.shell.openExternal(url)
        return { ok: true as const }
      }
      if (op === 'dialogOpenDirectory') {
        const p = payload as { title?: string; defaultPath?: string }
        return await window.sylo.dialog.openDirectory(p ?? {})
      }
      if (op === 'dialogOpenFile') {
        const p = payload as {
          title?: string
          defaultPath?: string
          filters?: { name: string; extensions: string[] }[]
        }
        return await window.sylo.dialog.openFile(p ?? {})
      }
      if (op === 'ttsListVoices') {
        return await window.sylo.tts.listVoices()
      }
      if (op === 'ttsConfigGet') {
        return await window.sylo.tts.configGet()
      }
      if (op === 'ttsConfigSave') {
        const p = payload as Record<string, unknown>
        const r = await window.sylo.tts.configSave(p ?? {})
        if (!r.ok) throw new Error(r.error)
        return r
      }
      if (op === 'ttsGenerate') {
        const p = payload as {
          text?: string
          voice_id?: string
          kokoro_speed?: number
          orpheus_temperature?: number
          orpheus_top_p?: number
        }
        const r = await window.sylo.tts.generate({
          text: typeof p?.text === 'string' ? p.text : '',
          voice_id: typeof p?.voice_id === 'string' ? p.voice_id : undefined,
          kokoro_speed: typeof p?.kokoro_speed === 'number' ? p.kokoro_speed : undefined,
          orpheus_temperature:
            typeof p?.orpheus_temperature === 'number' ? p.orpheus_temperature : undefined,
          orpheus_top_p: typeof p?.orpheus_top_p === 'number' ? p.orpheus_top_p : undefined,
        })
        if (!r.ok) throw new Error(r.error)
        return {
          wavPath: r.wavPath,
          durationMs: r.durationMs,
          voiceId: r.voiceId,
          voiceLabel: r.voiceLabel,
        }
      }
      if (op === 'ttsSaveAudio') {
        const p = payload as { sourcePath?: string; suggestedName?: string }
        const sourcePath = typeof p?.sourcePath === 'string' ? p.sourcePath : ''
        if (!sourcePath.trim()) throw new Error('missing_source_path')
        const r = await window.sylo.files.saveCopyAs({
          sourcePath,
          suggestedName:
            typeof p?.suggestedName === 'string' ? p.suggestedName : undefined,
        })
        if (!r.ok) {
          if (r.cancelled) throw new Error('cancelled')
          throw new Error(r.error ?? 'save_failed')
        }
        return { path: r.path }
      }
      if (op === 'ttsDeleteRouteClip') {
        const p = payload as { wavPath?: string }
        const wavPath = typeof p?.wavPath === 'string' ? p.wavPath : ''
        if (!wavPath.trim()) throw new Error('missing_wav_path')
        const r = await window.sylo.tts.deleteRouteClip(wavPath)
        if (!r.ok) throw new Error(r.error)
        return r
      }
      if (op === 'thinkTankConfigGet') {
        return await window.sylo.thinkTank.configGet()
      }
      if (op === 'thinkTankConfigSave') {
        const p = payload as { values?: Record<string, unknown> }
        if (!p?.values || typeof p.values !== 'object') throw new Error('bad_values')
        const r = await window.sylo.thinkTank.configSave(p.values)
        if (!r.ok) throw new Error(r.error)
        return r
      }
      if (op === 'thinkTankSessionGet') {
        const p = payload as { sessionId?: string }
        const sessionId = typeof p?.sessionId === 'string' ? p.sessionId.trim() : ''
        if (!sessionId) return null
        return await window.sylo.thinkTank.sessionGet(sessionId)
      }
      if (op === 'thinkTankPickReport') {
        const p = payload as { sessionId?: string; reportId?: string }
        const sessionId = typeof p?.sessionId === 'string' ? p.sessionId : ''
        const reportId = typeof p?.reportId === 'string' ? p.reportId : ''
        if (!sessionId || !reportId) throw new Error('bad_args')
        const r = await window.sylo.thinkTank.pickReport(sessionId, reportId)
        if (!r.ok) throw new Error(r.error)
        return r
      }
      if (op === 'requestAgentAction') {
        const p = payload as {
          prompt?: string
          delivery?: 'confirm_modal' | 'prefill_new_chat'
          new_chat?: boolean
        }
        const promptText = typeof p?.prompt === 'string' ? p.prompt : ''
        const prefillNewChat = p?.delivery === 'prefill_new_chat' || p?.new_chat === true
        if (prefillNewChat) {
          if (!promptText.trim()) throw new Error('empty_prompt')
          await prefillNewChatPrompt(promptText)
          return { queued: true, prefill: true }
        }
        return await new Promise((resolve, reject) => {
          setRouteActionModal({
            prompt: promptText,
            payload,
            resolve: (confirmed, edited) => {
              setRouteActionModal(null)
              void (async () => {
                try {
                  if (!confirmed) {
                    reject(new Error('operator_denied'))
                    return
                  }
                  const text = (edited ?? promptText).trim()
                  const inj = await window.sylo.skillSurface.injectFollowUp(
                    `[Sylo route requestAgentAction] skill=${sk} route=${route.routeId}\n${text}\n\npayload=${JSON.stringify(p)}`,
                  )
                  if (!inj.ok) reject(new Error(inj.error))
                  else resolve({ queued: true })
                } catch (e) {
                  reject(e instanceof Error ? e : new Error(String(e)))
                }
              })()
            },
          })
        })
      }
      throw new Error(`unsupported_op:${op}`)
    },
    [
      bridgeTargetRoute,
      sidebarWorkspaceId,
      workspaces,
      diagnostics.resolvedHostPiCwd,
      diagnostics.resolvedPiAgentDir,
      prefillNewChatPrompt,
    ],
  )

  const endSidebarResize = useCallback((clientX: number) => {
    const drag = sidebarResizeRef.current
    if (!drag) return
    const next = clampSidebarWidth(drag.startW + (clientX - drag.startX))
    setSidebarWidth(next)
    void window.sylo.prefs.set('sylo.ui.sidebar_width', next)
    sidebarResizeRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const onSidebarResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return
    e.preventDefault()
    sidebarResizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startW: sidebarWidth,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onSidebarResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sidebarResizeRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    setSidebarWidth(clampSidebarWidth(drag.startW + (e.clientX - drag.startX)))
  }

  const onSidebarResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sidebarResizeRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    endSidebarResize(e.clientX)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const endCanvasResize = useCallback((clientX: number) => {
    const drag = canvasResizeRef.current
    if (!drag) return
    const next = clampCanvasSize(drag.startSize + (drag.startX - clientX))
    setCanvasSize(next)
    void window.sylo.prefs.set('sylo.canvas.size', next)
    canvasResizeRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const onCanvasResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    canvasResizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startSize: canvasSize,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onCanvasResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = canvasResizeRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    setCanvasSize(clampCanvasSize(drag.startSize + (drag.startX - e.clientX)))
  }

  const onCanvasResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = canvasResizeRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    endCanvasResize(e.clientX)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  useEffect(() => {
    return () => {
      if (!sidebarResizeRef.current) return
      sidebarResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  useEffect(() => {
    return () => {
      if (!canvasResizeRef.current) return
      canvasResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  return (
    <>
      {canvasPopoutKey !== null ?
        <CanvasPopoutView popoutId={canvasPopoutKey} />
      : routePopoutKey === null ? (
    <div
      className={shellGrid}
      style={{
        gridTemplateColumns: sidebarCollapsed
          ? `${SIDEBAR_COLLAPSED_WIDTH}px minmax(0, 1fr)`
          : `${sidebarWidth}px minmax(0, 1fr)`,
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        const f = e.dataTransfer.files[0] as (File & { path?: string }) | undefined
        if (f?.path) {
          const r = await window.sylo.package.installPath(f.path)
          alert(r.ok ? `Installed: ${r.detail ?? 'ok'}` : `Install failed: ${r.detail}`)
          void refreshCapabilities()
        }
      }}
    >
      <aside className={cn(sidebar, sidebarCollapsed && sidebarAsideCollapsed)}>
        {sidebarCollapsed ?
          <button
            type="button"
            className={sidebarResizeBtnCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={() => setSidebarCollapsed(false)}
          >
            ▶
          </button>
        : <>
            <div className={sidebarBrandRow}>
              <h1 className={sidebarBrandTitle}>Sylo</h1>
              <button
                type="button"
                className={sidebarResizeBtn}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                onClick={() => setSidebarCollapsed(true)}
              >
                ◀
              </button>
            </div>

        {SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR.supports_route &&
          ROUTE_NAV_SECTION_SEQUENCE.filter((s) => s !== 'dev').map((section) => {
            const rows = sortedRoutesForNavSection(section, skillRoutes, navLayout)
            const showBuiltinToolsNav = section === 'tools'
            if (rows.length === 0 && !showBuiltinToolsNav) return null
            return (
              <details
                key={section}
                className={navSectionDetails}
                open={routeBucketsOpen[section]}
                onToggle={(e) =>
                  setRouteBucketsOpen((prev) => ({
                    ...prev,
                    [section]: detailsOpenFromToggleEvent(e),
                  }))
                }
              >
                <summary className={navSectionSummary}>{skillNavSectionHeading(section)}</summary>
                {rows.map((r) => {
                  const k = skillRouteRowKey(r)
                  const active =
                    tab === 'skill-route' &&
                    activeSkillRoute?.skillFolderName === r.skillFolderName &&
                    activeSkillRoute.routeId === r.routeId
                  return (
                    <div
                      key={k}
                      className={navRouteRow}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const from = e.dataTransfer.getData('sylo/route')
                        if (!from || from === k) return
                        reorderRouteWithinSection(section, from, k)
                      }}
                    >
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('sylo/route', k)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        className={cn(navBtnRoute, active && navBtnActive)}
                        onClick={() => {
                          setActiveSkillRoute(r)
                          setTab('skill-route')
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setRouteContextMenu({ route: r, clientX: e.clientX, clientY: e.clientY })
                        }}
                      >
                        {navLayout.pinned.includes(k) ? '◆ ' : ''}
                        {r.title}
                      </button>
                    </div>
                  )
                })}
                {showBuiltinToolsNav ?
                  <div className={navRouteRow}>
                    <button
                      type="button"
                      className={cn(navBtnRoute, tab === 'schedules' && navBtnActive)}
                      onClick={() => setTab('schedules')}
                    >
                      Schedules
                    </button>
                  </div>
                : null}
              </details>
            )
          })}

        <hr className="w-full border-border" />
        <div className={sidebarChatFolderBar}>
          <div className={sidebarWorkspaceLabelRow}>
            <span className={sidebarWorkspaceLabel} id="sidebar-workspace-heading">
              Workspaces
            </span>
            <button
              type="button"
              className={sidebarWorkspaceEditBtn}
              aria-label="Edit workspaces"
              title="Add or edit workspaces"
              onClick={() => {
                setWorkspaceManageOpen(true)
                void refreshWorkspaces()
              }}
            >
              Edit
            </button>
          </div>
          <WorkspaceSelect
            id="sidebar-workspace-select"
            aria-labelledby="sidebar-workspace-heading"
            workspaces={workspaces}
            value={sidebarWorkspaceId}
            onChange={(v) => {
              setSidebarWorkspaceId(v)
              void window.sylo.prefs.set('sylo.ui.active_workspace_id', v)
            }}
          />
        </div>
        <button type="button" className={navBtn} onClick={() => void newChat()}>
          + Conversation
        </button>
        <div className={sidebarConvList}>
          {conversations.map((c) => {
            const selected = c.id === activeId
            const activity = convActivityStatus(c.id, sendingConvIds, unreadConvIds)
            return (
            <div
              key={c.id}
              className={cn(convRow, selected ? convRowSelected : 'hover:bg-bg-tertiary')}
              role="presentation"
            >
              <div className={convRowMain}>
                <button
                  type="button"
                  className={cn(convRowSelect, selected && convRowSelectActive)}
                  onClick={() => {
                    setActiveId(c.id)
                    setTab('chat')
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setConvContextMenu({
                      id: c.id,
                      title: c.title ?? '',
                      clientX: e.clientX,
                      clientY: e.clientY,
                    })
                  }}
                >
                  <ConvStatusIndicator status={activity} />
                  <span className={convRowSelectLabel}>{c.title || '(untitled)'}</span>
                </button>
                <div className={convRowActions}>
                  <button
                    type="button"
                    className={convActionBtn}
                    aria-label={`Export ${c.title || 'conversation'} as Markdown`}
                    title="Download as Markdown"
                    onClick={(e) => {
                      e.stopPropagation()
                      void exportConversationMarkdown(c.id)
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={convActionBtn}
                    aria-label={`Rename ${c.title || 'conversation'}`}
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      openRenameConversationModal(c.id, c.title)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={cn(convActionBtn, convActionDanger)}
                    aria-label={`Delete ${c.title || 'conversation'}`}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConvModal({ id: c.id, title: c.title || '(untitled)' })
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
            )
          })}
        </div>
        <div className={sidebarDevPanel}>
          <details
            className={navSectionDetails}
            open={devNavOpen}
            onToggle={(e) => setDevNavOpen(detailsOpenFromToggleEvent(e))}
          >
            <summary className={navSectionSummary}>{skillNavSectionHeading('dev')}</summary>
            <div className={sidebarDevList}>
              {SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR.supports_route ?
                sortedRoutesForNavSection('dev', skillRoutes, navLayout).map((r) => {
                  const k = skillRouteRowKey(r)
                  const active =
                    tab === 'skill-route' &&
                    activeSkillRoute?.skillFolderName === r.skillFolderName &&
                    activeSkillRoute?.routeId === r.routeId
                  return (
                    <div
                      key={k}
                      className={navRouteRow}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const from = e.dataTransfer.getData('sylo/route')
                        if (!from || from === k) return
                        reorderRouteWithinSection('dev', from, k)
                      }}
                    >
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('sylo/route', k)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        className={cn(navBtnRoute, active && navBtnActive)}
                        onClick={() => {
                          setActiveSkillRoute(r)
                          setTab('skill-route')
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setRouteContextMenu({ route: r, clientX: e.clientX, clientY: e.clientY })
                        }}
                      >
                        {navLayout.pinned.includes(k) ? '◆ ' : ''}
                        {r.title}
                      </button>
                    </div>
                  )
                })
              : null}
              <button
                type="button"
                className={cn(navBtnRoute, tab === 'proposals' && navBtnActive)}
                onClick={() => setTab('proposals')}
              >
                Proposals
              </button>
              <button
                type="button"
                className={cn(navBtnRoute, tab === 'evals' && navBtnActive)}
                onClick={() => setTab('evals')}
              >
                Testing
              </button>
              <button
                type="button"
                className={cn(navBtnRoute, tab === 'skills' && navBtnActive)}
                onClick={() => setTab('skills')}
              >
                Capability manager
              </button>
              <button
                type="button"
                className={cn(navBtnRoute, tab === 'settings' && navBtnActive)}
                onClick={() => setTab('settings')}
              >
                Settings
              </button>
              <button
                type="button"
                className={navBtnRoute}
                onClick={() =>
                  void (async () => {
                    await window.sylo.broker.restart()
                    await refreshCapabilities()
                    await refreshBrokerFromMain()
                  })()
                }
              >
                Restart broker
              </button>
              {safeMode ?
                <button
                  type="button"
                  className={navBtnRoute}
                  onClick={() =>
                    void (async () => {
                      await window.sylo.safeMode.clear()
                      await window.sylo.broker.restart()
                      await refreshCapabilities()
                      await refreshBrokerFromMain()
                    })()
                  }
                >
                  Clear safe mode
                </button>
              : null}
            </div>
          </details>
        </div>
          </>
        }
        {!sidebarCollapsed ?
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize sidebar"
            className={sidebarDragHandle}
            onPointerDown={onSidebarResizePointerDown}
            onPointerMove={onSidebarResizePointerMove}
            onPointerUp={onSidebarResizePointerUp}
            onPointerCancel={onSidebarResizePointerUp}
          />
        : null}
      </aside>

      <section className={mainContent}>
        {safeMode && (
          <div className={banner}>
            Safe Mode — agent broker disabled after repeated crash boots. Use{' '}
            <strong>Developer → Restart broker</strong> (clears safe mode) or{' '}
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  await window.sylo.safeMode.clear()
                  setSafeMode(false)
                  await window.sylo.broker.restart()
                  await refreshBrokerFromMain()
                })()
              }}
            >
              Clear safe mode & restart broker
            </button>
            .
          </div>
        )}

        {!safeMode && (!agentReady || brokerInitError) && (
          <div className={bannerMuted}>
            {brokerInitError ?
              <>
                <strong>Agent offline.</strong> {brokerInitError} The rest of Sylo (settings,
                capability lists) still works. After fixing Pi, use <strong>Developer → Restart broker</strong>.{' '}
                <span className={mutedText}>Note: </span>
                <code style={{ fontSize: '0.85em' }}>npm run bootstrap-pi</code> only seeds Sylo files into{' '}
                <code style={{ fontSize: '0.85em' }}>~/.pi/agent</code> — it does not install Pi itself.
              </>
            : <>
                <strong>Connecting Pi agent…</strong> Chat needs Pi on your machine (
                <code style={{ fontSize: '0.85em' }}>~/.pi/agent</code>). If Pi is not installed yet, wait up
                to ~45s for a timeout message, or install Pi from <code style={{ fontSize: '0.85em' }}>pi.dev</code>.
                Until then, explore Settings.
              </>
            }
          </div>
        )}

        {tab === 'chat' && (
          <>
            {canvasOpen ?
              <div className={chatWorkbench}>
                <div className={cn(chatPane, 'min-w-0 flex-1')}>
                  <div
                    ref={chatAreaRef}
                    className={chatArea}
                    onScroll={onChatAreaScroll}
                    onWheel={(e) => { if (e.deltaY < 0) markUserScrolledUp() }}
                  >
                    <ChatTimelineList
                      ref={chatListRef}
                      rows={chatTimeline}
                      scrollRef={chatAreaRef}
                      renderRow={renderChatTimelineRow}
                      thinkTankUi={thinkTankUiBySession}
                      onSettleEnd={() => { stickToBottomRef.current = true }}
                    />
                  </div>
                  {agentWidgetPayload ?
                    <details className={agentWidgetHost}>
                      <summary className={cn(mutedText, 'cursor-pointer text-[0.8rem]')}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">
                            Ecosystem widget (show_widget) ·{' '}
                            <code>{agentWidgetPayload.toolCallId.slice(0, 8)}…</code>
                          </span>
                          <button
                            type="button"
                            className={cn(convActionBtn, 'shrink-0 px-1.5 py-0.5 text-[0.85rem]')}
                            title="Close widget"
                            aria-label="Close widget"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setAgentWidgetPayload(null)
                              setAgentWidgetLog([])
                            }}
                          >
                            ×
                          </button>
                        </span>
                      </summary>
                      {agentWidgetPayload.html && agentWidgetPayload.path ?
                        <p className={cn(mutedText, 'text-[0.8rem]')}>Invalid payload: both html and path set.</p>
                      : !agentWidgetPayload.html && !agentWidgetPayload.path ?
                        <p className={cn(mutedText, 'text-[0.8rem]')}>Invalid payload: missing html and path.</p>
                      : (
                        <SkillSurfaceSandbox
                          key={agentWidgetPayload.toolCallId}
                          {...(agentWidgetPayload.html ?
                            { inlineHtmlFragment: agentWidgetPayload.html }
                          : { fixturePath: agentWidgetPayload.path! })}
                          widgetData={agentWidgetPayload.data}
                          title="Agent-driven widget"
                          onBridge={(m) => {
                            setAgentWidgetLog((prev) => {
                              const line = `[${m.op}] ${JSON.stringify(m.payload)}`
                              const next = [...prev, line]
                              return next.length > 20 ? next.slice(-20) : next
                            })
                            if (m.op === 'sendToAgent') {
                              void window.sylo.skillSurface
                                .injectFollowUp(
                                  `[Sylo widget sendToAgent] toolCallId=${agentWidgetPayload.toolCallId} payload=${JSON.stringify(m.payload)}`,
                                )
                                .then((inj) => {
                                  if (!inj.ok) {
                                    setAgentWidgetLog((prev) => [...prev, `[inject] ${inj.error}`])
                                  }
                                })
                            }
                          }}
                          onBridgeReject={() => {
                            setAgentWidgetLog((prev) => [...prev, '[rejected: nonce_mismatch]'])
                          }}
                          onError={(err) => {
                            setAgentWidgetLog((prev) => [...prev, `[error] ${err}`])
                          }}
                        />
                      )}
                      {agentWidgetLog.length > 0 ?
                        <pre className={cn(toolLogPre, 'max-h-[100px] text-[0.78rem]')}>
                          {agentWidgetLog.join('\n')}
                        </pre>
                      : null}
                    </details>
                  : null}
                  <div className={chatStatusSubfoot}>
                    <ChatModelBar conversationId={activeId} agentReady={agentReady} />
                    {contextStats.totalTokens > 0 ?
                      <button
                        type="button"
                        className={cn(btnGhostSm, 'text-[0.72rem] opacity-70 hover:opacity-100')}
                        title="Context window breakdown — updates live as the agent works"
                        onClick={() => setSystemPromptStatsOpen((v) => !v)}
                      >
                        ⚡ {(contextStats.actualTokens ?? contextStats.totalTokens).toLocaleString()} tok
                      </button>
                    : null}
                    {systemPromptStatsOpen && contextStats.totalTokens > 0 ?
                      <div className={cn(mutedText, 'text-[0.72rem] leading-tight border border-zinc-700/50 rounded px-2 py-1.5 mb-1')}>
                        {contextStats.sections.map((s, i) => (
                          <div key={i} className="flex justify-between gap-4">
                            <span className="truncate">{s.label}</span>
                            <span className="tabular-nums">{s.tokens.toLocaleString()} tok · {s.pct}%</span>
                          </div>
                        ))}
                        <div className="flex justify-between gap-4 pt-1 border-t border-zinc-700/30 mt-1">
                          <span className="font-semibold">Total</span>
                          <span className="tabular-nums font-semibold">{(contextStats.actualTokens ?? contextStats.totalTokens).toLocaleString()} tok</span>
                        </div>
                      </div>
                    : null}
                    {brokerHint ? <div className={chatBrokerHint}>{brokerHint}</div> : null}
                    {subagentNotice ?
                      <p className={cn(mutedText, 'text-[0.78rem]')}>{subagentNotice}</p>
                    : null}
                    {subagentRunningCount > 0 ?
                      <SubagentRunsStrip
                        runningCount={subagentRunningCount}
                        onScrollToRunning={scrollToRunningSubagent}
                        onStopAll={stopAllSubagents}
                      />
                    : null}
                    <div className={chatTurnActions}>
                      {chatTimeline.length > 0 && activeId ?
                        <button
                          type="button"
                          className={btnGhostSm}
                          title="Jump to the end of the chat"
                          onClick={() => {
                            stickToBottomRef.current = true
                            scrollChatToEnd()
                          }}
                        >
                          End
                        </button>
                      : null}
                      {activeTurnStartTs !== null ?
                        <LiveElapsedLabel
                          startTs={activeTurnStartTs}
                          className={chatTurnElapsed}
                          prefix="Turn · "
                          title="Elapsed since this assistant reply started"
                        />
                      : null}
                      {showComposerStop ?
                        <button
                          type="button"
                          className={cn(chatStopBtn, chatStopBtnCompact)}
                          disabled={safeMode || !activeId || !agentReady}
                          title="Stop the current agent turn or think tank session"
                          onClick={() => void stopActiveTurn()}
                        >
                          Stop
                        </button>
                      : null}
                    </div>
                  </div>
                </div>
                <CanvasResizeHandle
                  onPointerDown={onCanvasResizePointerDown}
                  onPointerMove={onCanvasResizePointerMove}
                  onPointerUp={onCanvasResizePointerUp}
                />
                                <CanvasPanel
                  view={canvasView}
                  tabs={canvasTabs}
                  activeTabId={canvasActiveTabId}
                  onSelectTab={onCanvasSelectTab}
                  onCloseTab={closeCanvasTab}
                  onUpdatePayload={(p) => updateActiveCanvasSnapshot(() => p)}
                  className="shrink-0"
                  style={{ width: canvasSize }}
                  conversationId={activeId}
                  sketchBackupRef={sketchBackupRef}
                  onCollapse={collapseCanvas}
                  onPopOut={openCanvasPopout}
                  onDropFile={(filePath, kind) => {
                    void window.sylo.canvas
                      .showFile({ kind, filePath, title: filePath.replace(/^.*[/\\]/, '') })
                      .then((r) => {
                        if (!r?.ok) window.alert(`Could not open in canvas: ${r?.error ?? 'unknown error'}`)
                      })
                  }}
                />
              </div>
            : <div className={chatPane}>
                <div
                  ref={chatAreaRef}
                  className={chatArea}
                  onScroll={onChatAreaScroll}
                  onWheel={(e) => { if (e.deltaY < 0) markUserScrolledUp() }}
                >
                  <ChatTimelineList
                    ref={chatListRef}
                    rows={chatTimeline}
                    scrollRef={chatAreaRef}
                    renderRow={renderChatTimelineRow}
                    thinkTankUi={thinkTankUiBySession}
                    onSettleEnd={() => { stickToBottomRef.current = true }}
                  />
                </div>
                {agentWidgetPayload ?
                  <details className={agentWidgetHost}>
                    <summary className={cn(mutedText, 'cursor-pointer text-[0.8rem]')}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          Ecosystem widget (show_widget) ·{' '}
                          <code>{agentWidgetPayload.toolCallId.slice(0, 8)}…</code>
                        </span>
                        <button
                          type="button"
                          className={cn(convActionBtn, 'shrink-0 px-1.5 py-0.5 text-[0.85rem]')}
                          title="Close widget"
                          aria-label="Close widget"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setAgentWidgetPayload(null)
                            setAgentWidgetLog([])
                          }}
                        >
                          ×
                        </button>
                      </span>
                    </summary>
                    {agentWidgetPayload.html && agentWidgetPayload.path ?
                      <p className={cn(mutedText, 'text-[0.8rem]')}>Invalid payload: both html and path set.</p>
                    : !agentWidgetPayload.html && !agentWidgetPayload.path ?
                      <p className={cn(mutedText, 'text-[0.8rem]')}>Invalid payload: missing html and path.</p>
                    : (
                      <SkillSurfaceSandbox
                        key={agentWidgetPayload.toolCallId}
                        {...(agentWidgetPayload.html ?
                          { inlineHtmlFragment: agentWidgetPayload.html }
                        : { fixturePath: agentWidgetPayload.path! })}
                        widgetData={agentWidgetPayload.data}
                        title="Agent-driven widget"
                        onBridge={(m) => {
                          setAgentWidgetLog((prev) => {
                            const line = `[${m.op}] ${JSON.stringify(m.payload)}`
                            const next = [...prev, line]
                            return next.length > 20 ? next.slice(-20) : next
                          })
                          if (m.op === 'sendToAgent') {
                            void window.sylo.skillSurface
                              .injectFollowUp(
                                `[Sylo widget sendToAgent] toolCallId=${agentWidgetPayload.toolCallId} payload=${JSON.stringify(m.payload)}`,
                              )
                              .then((inj) => {
                                if (!inj.ok) {
                                  setAgentWidgetLog((prev) => [...prev, `[inject] ${inj.error}`])
                                }
                              })
                          }
                        }}
                        onBridgeReject={() => {
                          setAgentWidgetLog((prev) => [...prev, '[rejected: nonce_mismatch]'])
                        }}
                        onError={(err) => {
                          setAgentWidgetLog((prev) => [...prev, `[error] ${err}`])
                        }}
                      />
                    )}
                    {agentWidgetLog.length > 0 ?
                      <pre className={cn(toolLogPre, 'max-h-[100px] text-[0.78rem]')}>
                        {agentWidgetLog.join('\n')}
                      </pre>
                    : null}
                  </details>
                : null}
                <div className={chatStatusSubfoot}>
                  <ChatModelBar conversationId={activeId} agentReady={agentReady} />
                  {contextStats.totalTokens > 0 ?
                    <button
                      type="button"
                      className={cn(btnGhostSm, 'text-[0.72rem] opacity-70 hover:opacity-100')}
                      title="Context window breakdown — updates live as the agent works"
                      onClick={() => setSystemPromptStatsOpen((v) => !v)}
                    >
                      ⚡ {(contextStats.actualTokens ?? contextStats.totalTokens).toLocaleString()} tok
                    </button>
                  : null}
                  {systemPromptStatsOpen && contextStats.totalTokens > 0 ?
                    <div className={cn(mutedText, 'text-[0.72rem] leading-tight border border-zinc-700/50 rounded px-2 py-1.5 mb-1')}>
                      {contextStats.sections.map((s, i) => (
                        <div key={i} className="flex justify-between gap-4">
                          <span className="truncate">{s.label}</span>
                          <span className="tabular-nums">{s.tokens.toLocaleString()} tok · {s.pct}%</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-4 pt-1 border-t border-zinc-700/30 mt-1">
                        <span className="font-semibold">Total</span>
                        <span className="tabular-nums font-semibold">{(contextStats.actualTokens ?? contextStats.totalTokens).toLocaleString()} tok</span>
                      </div>
                    </div>
                  : null}
                  {brokerHint ? <div className={chatBrokerHint}>{brokerHint}</div> : null}
                  {subagentNotice ?
                    <p className={cn(mutedText, 'text-[0.78rem]')}>{subagentNotice}</p>
                  : null}
                  {subagentRunningCount > 0 ?
                    <SubagentRunsStrip
                      runningCount={subagentRunningCount}
                      onScrollToRunning={scrollToRunningSubagent}
                      onStopAll={stopAllSubagents}
                    />
                  : null}
                  <div className={chatTurnActions}>
                    {chatTimeline.length > 0 && activeId ?
                      <button
                        type="button"
                        className={btnGhostSm}
                        title="Jump to the end of the chat"
                        onClick={() => {
                          stickToBottomRef.current = true
                          scrollChatToEnd()
                        }}
                      >
                        End
                      </button>
                    : null}
                    {activeTurnStartTs !== null ?
                      <LiveElapsedLabel
                        startTs={activeTurnStartTs}
                        className={chatTurnElapsed}
                        prefix="Turn · "
                        title="Elapsed since this assistant reply started"
                      />
                    : null}
                    {showComposerStop ?
                      <button
                        type="button"
                        className={cn(chatStopBtn, chatStopBtnCompact)}
                        disabled={safeMode || !activeId || !agentReady}
                        title="Stop the current agent turn or think tank session"
                        onClick={() => void stopActiveTurn()}
                      >
                        Stop
                      </button>
                    : null}
                  </div>
                </div>
              </div>
            }
            <ChatComposer
              ref={composerRef}
              activeId={activeId}
              safeMode={safeMode}
              agentReady={agentReady}
              activeSending={activeSending}
              inputLocked={thinkTankLocksComposer}
              inputLockedHint="Think tank writing final reports — wait for seats to finish"
              onThinkTankInject={thinkTankInjectMode ? handleThinkTankInject : undefined}
              onSendingStarted={handleSendingStarted}
              onRefreshMessages={refreshMessages}
              onDeliverQueued={deliverQueuedText}
            />
          </>
        )}

        {tab === 'schedules' && (
          <div className={panelShell}>
            <SchedulesPanel
              workspaceId={sidebarWorkspaceId}
              workspaceName={workspaces.find((w) => w.id === sidebarWorkspaceId)?.name ?? ''}
              onOpenConversation={(conversationId) => {
                setActiveId(conversationId)
                setTab('chat')
              }}
            />
          </div>
        )}

        {tab === 'evals' && (
          <div className={panelShell}>
            <EvalDashboardPanel />
          </div>
        )}

        {tab === 'proposals' && (
          <div className={panelShell}>
            <ProposalsPanel />
          </div>
        )}

        {tab === 'skills' && (
          <div className={panelShell}>
            <CapabilityManagerPanel
              capabilities={capabilities}
              settingsJson={settingsJson}
              skillSurfaceLintByPath={skillSurfaceLintByPath}
              exclusionWorkspaceId={sidebarWorkspaceId}
              exclusionWorkspaceName={
                workspaces.find((w) => w.id === sidebarWorkspaceId)?.name ?? ''
              }
              onTogglePackage={togglePackage}
              onRestartBroker={() =>
                void (async () => {
                  await window.sylo.broker.restart()
                  await refreshCapabilities()
                })()
              }
              onRefresh={() => {
                void refreshCapabilities()
                void refreshSkillRoutes()
              }}
              onAttachUi={() => void handleAttachUiFolder()}
              onNewSkill={prefillNewSkill}
            />
          </div>
        )}

        {tab === 'skill-route' && activeSkillRoute ?
          <div className={cn(panelShell, 'flex min-h-0 flex-col')}>
            <header className="mb-2 shrink-0">
              <h2 className={panelTitle}>{activeSkillRoute.title}</h2>
              <p className={cn(mutedText, 'm-0 text-[0.74rem]')}>
                <code>{activeSkillRoute.skillFolderName}</code> /{' '}
                <code>{activeSkillRoute.routeId}</code>
              </p>
            </header>
            <SkillSurfaceSandbox
              key={`${activeSkillRoute.skillFolderName}:${activeSkillRoute.routeId}`}
              variant="route"
              fixturePath={activeSkillRoute.fixturePath}
              title={activeSkillRoute.title}
              widgetData={{}}
              compactChrome
              hostPiCwd={activeWorkspaceForSettings.resolvedPiCwd}
              onSkillBridgeRpc={handleSkillRouteBridge}
              onBridgeReject={() => {}}
              onError={() => {}}
            />
          </div>
        : null}

        {tab === 'settings' && (
          <SettingsPanel
            onChanged={notifyPathPrefsSaved}
            diagnostics={diagnostics}
                        activeWorkspace={activeWorkspaceForSettings}
          />
        )}
      </section>

      {/* {workflowModalMessage ?
        <WorkflowModal
          message={workflowModalMessage}
          liveTelemetry={liveWorkflow}
          precedingUserCreatedAt={workflowModalUserCreatedAt}
          onClose={() => setWorkflowModalId(null)}
        />
      : null} */}

      {workspaceManageOpen ?
        createPortal(
          <div
            className={modalOverlay}
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setWorkspaceManageOpen(false)
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sylo-workspace-manage-title"
              className={cn(modalShell, modalShellWide, modalShellWorkspace)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 id="sylo-workspace-manage-title" className={cn(modalTitle, modalTitleWorkspace)}>
                Workspaces
              </h3>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <p className={cn(modalBody, modalBodyWorkspace, leadText, 'mt-0')}>
                A <strong>workspace</strong> is a Sylo bucket for chats (sidebar switcher). Each workspace can set its
                own <strong>Pi project directory</strong>; leave it empty and it uses the{' '}
                <strong>primary</strong> workspace&apos;s folder (see Settings or the workspace editor below). The
                primary workspace starts as <strong>Sylo-user</strong> — you can rename it; its folder defaults to{' '}
                <code>{diagnostics.canonicalWorkspaceProject}</code> until you change it here. You can’t delete the last
                workspace or the primary workspace. Global exclusions still use <code>.sylo/disabled.json</code>.
              </p>
              <p className={workspaceModalLead}>Configured workspaces</p>
              <div className={workspaceTableWrap}>
                <table className={workspaceManageTable}>
                  <thead>
                    <tr>
                      <th scope="col" className={workspaceManageTableTh}>
                        Name
                      </th>
                      <th scope="col" className={workspaceManageTableTh}>
                        Pi project directory
                      </th>
                      <th scope="col" className={cn(workspaceManageTableTh, workspaceTableColEdit)} />
                    </tr>
                  </thead>
                  <tbody>
                    {workspaces.map((w) => {
                      const storedPath = w.pi_cwd.trim()
                      const fullPath = storedPath || w.resolved_pi_cwd
                      const pathTitle =
                        storedPath && storedPath !== w.resolved_pi_cwd ?
                          `Saved: ${storedPath}\nEffective (folder missing or unreadable): ${w.resolved_pi_cwd}`
                        : fullPath
                      return (
                        <tr
                          key={w.id}
                          className={
                            workspaceEditOpen && w.id === workspaceEditId ? workspaceTableRowActive : undefined
                          }
                        >
                          <td className={workspaceManageTableTd}>{w.name}</td>
                          <td className={workspaceManageTableTd}>
                            <code className={workspaceTablePath} title={pathTitle}>
                              {truncatePathMiddle(fullPath, 56)}
                            </code>
                          </td>
                          <td className={cn(workspaceManageTableTd, workspaceTableColEdit)}>
                            <button
                              type="button"
                              className={cn(btnGhost, btnGhostSm)}
                              onClick={() => {
                                if (workspaceEditOpen && workspaceEditId === w.id) {
                                  setWorkspaceEditOpen(false)
                                  window.setTimeout(() => setWorkspaceEditId(null), 220)
                                  return
                                }
                                if (workspaceEditOpen && workspaceEditId !== w.id) {
                                  setWorkspaceEditId(w.id)
                                  return
                                }
                                setWorkspaceEditId(w.id)
                                setWorkspaceEditOpen(false)
                                requestAnimationFrame(() => {
                                  requestAnimationFrame(() => setWorkspaceEditOpen(true))
                                })
                              }}
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {workspaceEditId ?
                <div
                  className={cn(
                    workspaceEditDisclosure,
                    workspaceEditOpen && workspaceEditDisclosureOpen,
                  )}
                >
                  <div className={workspaceEditDisclosureInner}>
                                        <div className={workspaceField}>
                      <label className={workspaceFieldLabel} htmlFor="workspace-edit-name">
                        Name
                      </label>
                      <input
                        id="workspace-edit-name"
                        type="text"
                        className={workspaceFormInput}
                        value={workspaceEditName}
                        onChange={(e) => setWorkspaceEditName(e.target.value)}
                        autoComplete="off"
                      />
                      {workspaceEditId === workspaces[0]?.id ?
                        <p className={cn(settingsCaption, 'mt-1.5')}>
                          Renaming the universal workspace also renames this folder on disk — the git repo,
                          seed files, and the global pointer file stay wired to it. Restart Sylo afterwards so
                          running agents pick up the new path.
                        </p>
                      : null}
                    </div>
                    <div className={cn(workspaceField, workspaceFieldTight)}>
                      <span className={workspaceFieldLabel}>Pi project directory</span>
                                            {workspaceEditId === workspaces[0]?.id ?
                        <p className={cn(settingsCaption, 'my-1 mb-1.5')}>
                          <strong>📌 Pinned</strong> — this is your user profile workspace: all user config data
                          lives here — workflows, tool config parameters, global AI instructions, and the operator
                          profile. It can be renamed, but not deleted or detached. On a new install it uses{' '}
                          <code>{diagnostics.canonicalWorkspaceProject}</code> — choose{' '}
                          <strong>Reset to default folder</strong> if it was mis-set.
                        </p>
                      : null}
                      <div className={cn(folderNewPathWrap, workspaceFormPathWrap)}>
                        <input
                          id="workspace-edit-pi-cwd-input"
                          type="text"
                          className={cn(modalInputFlex, workspaceFormInput, workspaceFormInputPath)}
                          value={workspaceEditPath}
                          onChange={(e) => {
                            setWorkspaceEditPathError('')
                            setWorkspaceEditPath(e.target.value)
                          }}
                          placeholder="Empty → same folder as primary workspace"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className={cn(btnGhost, btnGhostSm)}
                          onClick={() =>
                            void (async () => {
                              const p = await window.sylo.dialog.openDirectory()
                              if (p) {
                                setWorkspaceEditPathError('')
                                setWorkspaceEditPath(p)
                              }
                            })()
                          }
                        >
                          Browse…
                        </button>
                      </div>
                      {workspaceEditPathError ?
                        <p className={cn(errorText, 'mt-1.5')} role="alert">
                          {workspaceEditPathError}
                        </p>
                      : null}
                    </div>
                    <div className={cn(workspaceField, workspaceFieldTight)}>
                      <span className={workspaceFieldLabel}>GitHub backup</span>
                      <p className={cn(settingsCaption, 'my-1 mb-1.5')}>
                        Backs up the Pi project folder only (not chats). If the folder is already a git repo, Sylo
                        links it without re-initializing. Sylo pulls on startup when backup is enabled.
                      </p>
                      <label className="mb-2 flex items-center gap-2 text-[0.85rem] text-text-primary">
                        <input
                          type="checkbox"
                          checked={workspaceBackupEnabled}
                          onChange={(e) => {
                            setWorkspaceBackupError('')
                            setWorkspaceBackupEnabled(e.target.checked)
                          }}
                        />
                        Enable GitHub backup for this workspace
                      </label>
                      <input
                        id="workspace-edit-github-url"
                        type="text"
                        className={cn(modalInputFlex, workspaceFormInput, workspaceFormInputPath, 'mb-2')}
                        value={workspaceBackupUrl}
                        onChange={(e) => {
                          setWorkspaceBackupError('')
                          setWorkspaceBackupUrl(e.target.value)
                        }}
                        placeholder="https://github.com/you/your-repo.git"
                        spellCheck={false}
                        disabled={!workspaceBackupEnabled}
                      />
                      {workspaceBackupStatus ?
                        <p className={cn(settingsCaption, 'mb-2')}>{workspaceBackupStatus}</p>
                      : null}
                      {workspaceBackupError ?
                        <p className={cn(errorText, 'mb-2')} role="alert">
                          {workspaceBackupError}
                        </p>
                      : null}
                      {ghPublishResult ?
                        <p className={cn(settingsCaption, 'mb-2')}>
                          Published to{' '}
                          <a href={ghPublishResult.html_url} target="_blank" rel="noreferrer" className="underline">
                            {ghPublishResult.full_name}
                          </a>{' '}
                          — backup is now wired. Pull/Push to sync.
                        </p>
                      : null}
                      {!workspaceBackupUrl.trim() && ghConnected ?
                        <div className="mb-2 mt-1">
                          {!ghPublishOpen ?
                            <button
                              type="button"
                              className={btnGhost}
                              disabled={workspaceBackupBusy || !workspaceEditId}
                              onClick={() => openGhPublish()}
                            >
                              Publish to GitHub…
                            </button>
                          : (
                            <div className={cn(workspaceField, workspaceFieldTight, 'mt-1')}>
                              <span className={workspaceFieldLabel}>Publish as a new GitHub repo</span>
                              <p className={cn(settingsCaption, 'my-1 mb-1.5')}>
                                Creates a repo under your account and pushes this folder. One click — no GitHub Desktop needed.
                              </p>
                              <div className={cn(workspaceField, workspaceFieldTight)}>
                                <label className={workspaceFieldLabel} htmlFor="gh-publish-name">
                                  Repository name
                                </label>
                                <input
                                  id="gh-publish-name"
                                  type="text"
                                  className={cn(modalInputFlex, workspaceFormInput)}
                                  value={ghPublishName}
                                  onChange={(e) => {
                                    setGhPublishError('')
                                    setGhPublishName(e.target.value)
                                  }}
                                  placeholder="my-workspace"
                                  spellCheck={false}
                                />
                              </div>
                              {ghPublishOwners.length > 0 ?
                                <div className={cn(workspaceField, workspaceFieldTight)}>
                                  <label className={workspaceFieldLabel} htmlFor="gh-publish-owner">
                                    Owner
                                  </label>
                                  <select
                                    id="gh-publish-owner"
                                    className={cn(modalInputFlex, workspaceFormInput)}
                                    value={ghPublishOwner}
                                    onChange={(e) => setGhPublishOwner(e.target.value)}
                                  >
                                    {ghLogin ? <option value={ghLogin}>{ghLogin} (personal)</option> : null}
                                    {ghPublishOwners.map((o) => (
                                      <option key={o.id} value={o.login}>
                                        {o.login}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              : null}
                              <label className="mb-2 flex items-center gap-2 text-[0.85rem] text-text-primary">
                                <input
                                  type="checkbox"
                                  checked={ghPublishPrivate}
                                  onChange={(e) => setGhPublishPrivate(e.target.checked)}
                                />
                                Private repo
                              </label>
                              <div className={cn(workspaceField, workspaceFieldTight)}>
                                <label className={workspaceFieldLabel} htmlFor="gh-publish-desc">
                                  Description (optional)
                                </label>
                                <input
                                  id="gh-publish-desc"
                                  type="text"
                                  className={cn(modalInputFlex, workspaceFormInput)}
                                  value={ghPublishDesc}
                                  onChange={(e) => setGhPublishDesc(e.target.value)}
                                  placeholder="What this workspace is for"
                                  spellCheck={false}
                                />
                              </div>
                              {ghPublishError ?
                                <p className={cn(errorText, 'mb-2')} role="alert">
                                  {ghPublishError}
                                </p>
                              : null}
                              <div className={cn(workspaceFormActions, 'mt-0 justify-start')}>
                                <button
                                  type="button"
                                  className={btnPrimary}
                                  disabled={ghPublishBusy || !ghPublishName.trim()}
                                  onClick={() => void publishWorkspaceToGithub()}
                                >
                                  {ghPublishBusy ? 'Creating & pushing…' : 'Create & push'}
                                </button>
                                <button
                                  type="button"
                                  className={btnGhost}
                                  disabled={ghPublishBusy}
                                  onClick={() => setGhPublishOpen(false)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      : null}
                      <div className={cn(workspaceFormActions, 'mt-0 justify-start')}>
                        <button
                          type="button"
                          className={btnGhost}
                          disabled={workspaceBackupBusy || !workspaceEditId}
                          onClick={() =>
                            void (async () => {
                              if (!workspaceEditId) return
                              setWorkspaceBackupBusy(true)
                              setWorkspaceBackupError('')
                              try {
                                const pulled = await window.sylo.workspaces.backup.pull(workspaceEditId)
                                if (!pulled.ok) {
                                  setWorkspaceBackupError(
                                    workspaceBackupErrorMessage(pulled.error, pulled.detail),
                                  )
                                  return
                                }
                                await refreshWorkspaceBackupStatus(workspaceEditId)
                              } finally {
                                setWorkspaceBackupBusy(false)
                              }
                            })()
                          }
                        >
                          Pull
                        </button>
                        <button
                          type="button"
                          className={btnGhost}
                          disabled={workspaceBackupBusy || !workspaceEditId}
                          onClick={() =>
                            void (async () => {
                              if (!workspaceEditId) return
                              const w = workspaces.find((x) => x.id === workspaceEditId)
                              const missing = w ? await workspaceFolderMissing(w) : null
                              if (missing) {
                                if (
                                  !window.confirm(
                                    `The folder for workspace “${w?.name ?? ''}” is missing:\n${missing}\n\nIt may have been deleted outside Sylo. Pushing would back up the wrong folder.\n\nCancel, or Continue without pushing this workspace?`,
                                  )
                                ) {
                                  return
                                }
                                setWorkspaceBackupError(
                                  `Skipped push — folder missing: ${missing}`,
                                )
                                return
                              }
                              setWorkspaceBackupBusy(true)
                              setWorkspaceBackupError('')
                              try {
                                const pushed = await window.sylo.workspaces.backup.push(workspaceEditId)
                                if (!pushed.ok) {
                                  setWorkspaceBackupError(
                                    workspaceBackupErrorMessage(pushed.error, pushed.detail),
                                  )
                                  return
                                }
                                await refreshWorkspaceBackupStatus(workspaceEditId)
                              } finally {
                                setWorkspaceBackupBusy(false)
                              }
                            })()
                          }
                        >
                          Push
                        </button>
                      </div>
                    </div>
                    <div className={workspaceFormActions}>
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => {
                          setWorkspaceEditOpen(false)
                          window.setTimeout(() => setWorkspaceEditId(null), 220)
                        }}
                      >
                        Cancel
                      </button>
                      {workspaceEditId === workspaces[0]?.id ?
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() =>
                            void (async () => {
                              await window.sylo.workspaces.resetPrimaryPiProject()
                              await refreshWorkspaces()
                              await refreshPrefsDiag()
                              if (activeId) void window.sylo.broker.prepareConversation(activeId)
                            })()
                          }
                        >
                          Reset to default folder
                        </button>
                      : null}
                      <button
                        type="button"
                        className={btnPrimary}
                        disabled={workspaceBackupBusy}
                        onClick={() =>
                          void (async () => {
                            if (!workspaceEditId) return
                            setWorkspaceBackupError('')
                            setWorkspaceBackupBusy(true)
                            try {
                              const primary = workspaces[0]
                              const inheritFrom = primary?.resolved_pi_cwd ?? diagnostics.resolvedHostPiCwd
                              const cwdTrim = workspaceEditPath.trim()
                              const pi_cwd =
                                cwdTrim === '' || pathsEffectivelyEqual(cwdTrim, inheritFrom) ? '' : cwdTrim
                              const nameTrim = workspaceEditName.trim()
                              if (!nameTrim) {
                                setWorkspaceBackupError('Workspace name is required.')
                                return
                              }
                              const patch = {
                                name: nameTrim,
                                pi_cwd,
                              }
                              const saved = await persistWithPiProjectDirConfirm(
                                (createPiProjectDir) =>
                                  window.sylo.workspaces.update(workspaceEditId, patch, { createPiProjectDir }),
                                setWorkspaceEditPathError,
                              )
                              if (!saved) return

                              const backupSaved = await window.sylo.workspaces.backup.save(workspaceEditId, {
                                github_remote_url: workspaceBackupUrl.trim(),
                                github_backup_enabled: workspaceBackupEnabled,
                              })
                              if (!backupSaved.ok) {
                                setWorkspaceBackupError(
                                  workspaceBackupErrorMessage(backupSaved.error, backupSaved.detail),
                                )
                                await refreshWorkspaces()
                                await refreshPrefsDiag()
                                return
                              }

                              await refreshWorkspaces()
                              await refreshPrefsDiag()
                              if (backupSaved.detail) setWorkspaceBackupStatus(backupSaved.detail)
                              setWorkspaceEditOpen(false)
                              window.setTimeout(() => setWorkspaceEditId(null), 220)
                            } finally {
                              setWorkspaceBackupBusy(false)
                            }
                          })()
                        }
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        className={cn(btnDanger, btnGhostSm)}
                        disabled={workspaces.length <= 1 || workspaceEditId === workspaces[0]?.id}
                        title={
                          workspaces.length <= 1
                            ? 'The last workspace cannot be deleted'
                            : workspaceEditId === workspaces[0]?.id
                              ? 'The universal workspace is pinned and cannot be deleted'
                              : undefined
                        }
                        onClick={() =>
                          void (async () => {
                            const id = workspaceEditId
                            if (!id) return
                            const w = workspaces.find((x) => x.id === id)
                            if (
                              !window.confirm(
                                `Delete workspace “${w?.name ?? ''}”? All chats in it and their attachments will be deleted permanently. (Files inside the workspace folder are not removed.)`,
                              )
                            ) {
                              return
                            }
                            await window.sylo.workspaces.delete(id)
                            const next = await refreshWorkspaces()
                            setWorkspaceEditOpen(false)
                            window.setTimeout(() => setWorkspaceEditId(null), 220)
                            if (sidebarWorkspaceId === id) {
                              const nw = next[0]?.id ?? ''
                              setSidebarWorkspaceId(nw)
                              await window.sylo.prefs.set('sylo.ui.active_workspace_id', nw)
                            }
                            await refreshConversations()
                          })()
                        }
                      >
                        Delete workspace
                      </button>
                    </div>
                  </div>
                </div>
              : null}

              <div className={cn(workspaceModalSection, workspaceModalSectionAdd)}>
                <h4 className={workspaceModalSectionTitle}>New workspace</h4>
                <p className={cn(settingsCaption, 'mb-1.5')}>
                  Creates a new folder for this workspace under{' '}
                  <code>&lt;clone root&gt;/&lt;name&gt;</code> (next to the primary workspace folder, not inside it).
                  You can edit the path or pick another folder with Browse… — the folder is created if it
                  doesn&apos;t exist.
                </p>
                <div className={workspaceField}>
                  <label className={workspaceFieldLabel} htmlFor="workspace-add-name">
                    Name
                  </label>
                  <input
                    id="workspace-add-name"
                    type="text"
                    className={workspaceFormInput}
                    placeholder="New workspace name"
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                  />
                </div>
                <div className={cn(workspaceField, workspaceFieldTight)}>
                  <span className={workspaceFieldLabel}>Folder location</span>
                  <div className={cn(folderNewPathWrap, workspaceFormPathWrap)}>
                    <input
                      id="workspace-add-pi-cwd"
                      type="text"
                      className={cn(modalInputFlex, workspaceFormInput, workspaceFormInputPath)}
                      placeholder="Prefilled from name when set"
                      value={newWorkspacePiCwd}
                      onChange={(e) => {
                        setNewWorkspacePiCwdError('')
                        setNewWorkspacePiCwdTouched(true)
                        setNewWorkspacePiCwd(e.target.value)
                      }}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className={cn(btnGhost, btnGhostSm)}
                      onClick={() =>
                        void (async () => {
                          const p = await window.sylo.dialog.openDirectory()
                          if (p) {
                            setNewWorkspacePiCwdError('')
                            setNewWorkspacePiCwdTouched(true)
                            setNewWorkspacePiCwd(p)
                          }
                        })()
                      }
                    >
                      Browse…
                    </button>
                  </div>
                  {newWorkspacePiCwdError ?
                    <p className={cn(errorText, 'mt-1.5')} role="alert">
                      {newWorkspacePiCwdError}
                    </p>
                  : null}
                </div>
                <label className="mb-1 flex items-center gap-2 text-[0.85rem] text-text-primary">
                  <input
                    type="checkbox"
                    checked={newWorkspaceEnableGit}
                    onChange={(e) => {
                      setNewWorkspaceError('')
                      setNewWorkspaceEnableGit(e.target.checked)
                    }}
                  />
                  Enable GitHub backup (include this workspace in Push all)
                </label>
                {newWorkspaceEnableGit ?
                  <div className={cn(workspaceField, workspaceFieldTight)}>
                    <label className={workspaceFieldLabel} htmlFor="workspace-add-git-url">
                      GitHub remote URL
                    </label>
                    <input
                      id="workspace-add-git-url"
                      type="text"
                      className={cn(modalInputFlex, workspaceFormInput, workspaceFormInputPath, 'mb-2')}
                      placeholder="https://github.com/you/your-repo.git"
                      value={newWorkspaceGitUrl}
                      onChange={(e) => {
                        setNewWorkspaceError('')
                        setNewWorkspaceGitUrl(e.target.value)
                      }}
                      spellCheck={false}
                    />
                    <p className={cn(settingsCaption, 'mb-1')}>
                      Sylo links the folder to this remote and pushes on <strong>Push all</strong>. Leave
                      unchecked to set this up later (e.g. via Publish to GitHub).
                    </p>
                  </div>
                : null}
                {newWorkspaceError ?
                  <p className={cn(errorText, 'mb-2')} role="alert">
                    {newWorkspaceError}
                  </p>
                : null}
                <div className={workspaceFormActions}>
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() =>
                      void (async () => {
                        const n = newWorkspaceName.trim()
                        if (!n) {
                          setNewWorkspaceError('Name is required.')
                          return
                        }
                        const piCwd = newWorkspacePiCwd.trim()
                        if (!piCwd) {
                          setNewWorkspaceError('Folder location is required.')
                          return
                        }
                        const url = newWorkspaceEnableGit ? newWorkspaceGitUrl.trim() : ''
                        if (newWorkspaceEnableGit && !url) {
                          setNewWorkspaceError('GitHub remote URL is required when backup is enabled.')
                          return
                        }
                        setNewWorkspaceError('')
                        try {
                          // New workspace always creates the folder (no confirm prompt).
                          const res = await window.sylo.workspaces.create(n, piCwd, {
                            createPiProjectDir: true,
                          })
                          if (!res.ok) {
                            setNewWorkspaceError(
                              res.error === 'mkdir_failed' ?
                                `Could not create folder: ${res.detail}`
                              : `Could not create folder: ${res.path ?? ''}`,
                            )
                            return
                          }
                          if (newWorkspaceEnableGit && url) {
                            const backup = await window.sylo.workspaces.backup.save(res.workspace.id, {
                              github_remote_url: url,
                              github_backup_enabled: true,
                            })
                            if (!backup.ok) {
                              setNewWorkspaceError(backup.detail || backup.error)
                              await refreshWorkspaces()
                              return
                            }
                          }
                          setNewWorkspaceName('')
                          setNewWorkspacePiCwd('')
                          setNewWorkspacePiCwdError('')
                          setNewWorkspacePiCwdTouched(false)
                          setNewWorkspaceEnableGit(false)
                          setNewWorkspaceGitUrl('')
                          setNewWorkspaceError('')
                          newWorkspacePrefillGen.current += 1
                          await refreshWorkspaces()
                        } catch (e) {
                          setNewWorkspaceError(e instanceof Error ? e.message : String(e))
                        }
                      })()
                    }
                  >
                    Create workspace
                  </button>
                </div>
              </div>

              <div className={cn(workspaceModalSection, workspaceModalSectionAdd)}>
                <h4 className={workspaceModalSectionTitle}>Clone from GitHub</h4>
                <p className={cn(settingsCaption, 'mb-2')}>
                  Connect a GitHub account, browse your repos, and clone one straight into a new
                  workspace. Backup (push/pull/sync) is wired automatically. The token is stored
                  encrypted with the OS keyring and never written into repo config.
                </p>

                {ghConnected ? (
                  <>
                    <div className={cn(workspaceFormActions, 'justify-between')}>
                      <span className={settingsCaption}>
                        Connected as <strong>{ghLogin}</strong>
                        {!ghEncrypted ? ' (stored unencrypted)' : ''}
                      </span>
                      <button
                        type="button"
                        className={cn(btnGhost, btnGhostSm)}
                        onClick={() => void disconnectGithub()}
                      >
                        Disconnect
                      </button>
                    </div>

                    <div className={cn(workspaceField, workspaceFieldTight)}>
                      <div className={cn(folderNewPathWrap, workspaceFormPathWrap)}>
                        <input
                          type="search"
                          className={cn(modalInputFlex, workspaceFormInput)}
                          placeholder="Filter repos by name…"
                          value={ghRepoFilter}
                          onChange={(e) => setGhRepoFilter(e.target.value)}
                        />
                        <button
                          type="button"
                          className={cn(btnGhost, btnGhostSm)}
                          disabled={ghReposLoading}
                          onClick={() => void loadGhRepos(true)}
                        >
                          {ghReposLoading ? 'Loading…' : 'Refresh'}
                        </button>
                      </div>
                      {ghReposError ? (
                        <p className={cn(errorText, 'mt-1.5')} role="alert">
                          {ghReposError}
                        </p>
                      ) : null}
                    </div>

                    <div
                      className="max-h-[220px] min-h-[60px] overflow-auto rounded-[6px] border border-border"
                      role="listbox"
                      aria-label="GitHub repositories"
                    >
                      {ghRepos.length === 0 && !ghReposLoading ? (
                        <p className={cn(settingsCaption, 'p-2.5')}>No repositories found.</p>
                      ) : null}
                      {ghRepos
                        .filter((r) =>
                          ghRepoFilter.trim() ?
                            r.full_name.toLowerCase().includes(ghRepoFilter.trim().toLowerCase())
                          : true,
                        )
                        .map((r) => {
                          const active = r.full_name === ghSelected
                          return (
                            <button
                              key={r.id}
                              type="button"
                              role="option"
                              aria-selected={active}
                              className={cn(
                                'flex w-full items-start gap-2 border-b border-border px-2.5 py-1.5 text-left last:border-b-0',
                                active ? 'bg-[rgb(107_159_255/0.12)]' : 'hover:bg-bg-tertiary',
                              )}
                              onClick={() => pickGhRepo(r)}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[0.84rem] text-text-primary">
                                  {r.full_name}
                                  {r.private ? <span className="ml-1.5 text-[0.7rem] text-text-secondary">private</span> : null}
                                  {r.archived ? <span className="ml-1.5 text-[0.7rem] text-text-secondary">archived</span> : null}
                                </span>
                                {r.description ? (
                                  <span className="block truncate text-[0.72rem] text-text-secondary">
                                    {r.description}
                                  </span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-[0.68rem] text-text-secondary">
                                {r.pushed_at ? new Date(r.pushed_at).toLocaleDateString() : ''}
                              </span>
                            </button>
                          )
                        })}
                    </div>

                    {ghHasMore ? (
                      <div className={workspaceFormActions}>
                        <button
                          type="button"
                          className={cn(btnGhost, btnGhostSm)}
                          disabled={ghReposLoading}
                          onClick={() => void loadGhRepos(false)}
                        >
                          {ghReposLoading ? 'Loading…' : 'Load more'}
                        </button>
                      </div>
                    ) : null}

                    {ghSelected ? (
                      <div className={cn(workspaceField, workspaceFieldTight, 'rounded-[6px] border border-border p-2.5')}>
                        <span className={workspaceFieldLabel}>Clone {ghSelected}</span>
                        <div className={cn(workspaceField, workspaceFieldTight)}>
                          <label className={workspaceFieldLabel} htmlFor="gh-clone-name">
                            Workspace name
                          </label>
                          <input
                            id="gh-clone-name"
                            type="text"
                            className={workspaceFormInput}
                            value={ghCloneName}
                            onChange={(e) => setGhCloneName(e.target.value)}
                          />
                        </div>
                        <div className={cn(workspaceField, workspaceFieldTight)}>
                          <span className={workspaceFieldLabel}>Clone destination</span>
                          <div className={cn(folderNewPathWrap, workspaceFormPathWrap)}>
                            <input
                              id="gh-clone-dest"
                              type="text"
                              className={cn(modalInputFlex, workspaceFormInput, workspaceFormInputPath)}
                              placeholder="Prefilled from default location"
                              value={ghCloneDest}
                              onChange={(e) => {
                                setGhCloneDestTouched(true)
                                setGhCloneDest(e.target.value)
                              }}
                              spellCheck={false}
                            />
                            <button
                              type="button"
                              className={cn(btnGhost, btnGhostSm)}
                              onClick={() =>
                                void (async () => {
                                  const p = await window.sylo.dialog.openDirectory()
                                  if (p) {
                                    setGhCloneDestTouched(true)
                                    setGhCloneDest(p)
                                  }
                                })()
                              }
                            >
                              Browse…
                            </button>
                          </div>
                          <p className={cn(settingsCaption, 'mt-1')}>
                            Prefilled from the default clone root (<code>{ghDefaultDir || '(unset)'}</code>). Change it in{' '}
                            <strong>Settings &rarr; Clone folder</strong>.
                          </p>
                        </div>
                        <label className="mb-2 mt-2 flex items-center gap-2 text-[0.85rem] text-text-primary">
                          <input
                            type="checkbox"
                            checked={ghCloneEnableBackup}
                            onChange={(e) => setGhCloneEnableBackup(e.target.checked)}
                          />
                          Enable GitHub backup (push/pull/sync) for this workspace
                        </label>
                        {ghCloneError ? (
                          <p className={cn(errorText, 'mb-2')} role="alert">
                            {ghCloneError}
                          </p>
                        ) : null}
                        <div className={workspaceFormActions}>
                          <button
                            type="button"
                            className={btnPrimary}
                            disabled={ghCloning}
                            onClick={() => void cloneSelectedRepo()}
                          >
                            {ghCloning ? 'Cloning…' : 'Clone & add workspace'}
                          </button>
                          <button
                            type="button"
                            className={cn(btnGhost, btnGhostSm)}
                            onClick={() => {
                              setGhSelected(null)
                              setGhCloneName('')
                              setGhCloneDest('')
                              setGhCloneDestTouched(false)
                              setGhCloneError('')
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                                    <>
                    {ghDevicePending ? (
                      <>
                        <div className={workspaceField}>
                          <p className={cn(settingsCaption, 'mb-2')}>
                            Open the link below and enter this code to finish signing in. The code
                            expires in a few minutes.
                          </p>
                          <div className={cn('flex items-center gap-3 rounded-[6px] border border-border p-3')}>
                            <code className={cn('select-all text-2xl font-bold tracking-[0.2em]')}>{ghDeviceCode}</code>
                            <a
                              className={cn(btnPrimary, 'ml-auto')}
                              href={ghDeviceUriComplete || ghDeviceUri}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open github.com
                            </a>
                          </div>
                          <p className={cn(settingsCaption, 'mt-1.5')}>
                            Waiting for approval…{' '}
                            <a
                              className="underline opacity-70"
                              href={ghDeviceUri}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {ghDeviceUri}
                            </a>
                          </p>
                        </div>
                        <div className={workspaceFormActions}>
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => void cancelGithubDeviceFlow()}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {ghConnectError ? (
                          <p className={cn(errorText, 'mb-2')} role="alert">
                            {ghConnectError}
                          </p>
                        ) : null}
                        <div className={workspaceFormActions}>
                          <button
                            type="button"
                            className={btnPrimary}
                            disabled={ghConnectBusy}
                            onClick={() => void startGithubDeviceFlow()}
                          >
                            {ghConnectBusy ? 'Starting…' : 'Sign in with GitHub'}
                          </button>
                        </div>
                        <p className={cn(settingsCaption, 'mt-1.5')}>
                          Opens a one-time code you approve at github.com. The token is stored encrypted
                          on this machine and used to clone/pull/push your repos. No password or secret
                          is sent to Sylo.
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
              </div>
              <div className={cn(modalActions, modalActionsFooter)}>
                {workspacePushAllMessage ?
                  <p className={cn(settingsCaption, 'mr-auto self-center')}>{workspacePushAllMessage}</p>
                : null}
                <button
                  type="button"
                  className={btnGhost}
                  disabled={backupEnabledWorkspaceCount === 0 || workspaceBackupBusy}
                  title={
                    backupEnabledWorkspaceCount === 0 ?
                      'Enable backup on at least one workspace first'
                    : undefined
                  }
                  onClick={() =>
                    void (async () => {
                                            setWorkspacePushAllMessage('')
                      const missing = await backedUpWorkspacesWithMissingFolder(workspaces)
                      if (missing.length > 0) {
                        const list = missing.map((m) => `• ${m.name}: ${m.pi_cwd}`).join('\n')
                        if (
                          !window.confirm(
                            `These backed-up workspaces have folders missing (deleted outside Sylo):\n${list}\n\nPushing them would back up the wrong folder. Cancel, or Continue and skip them?`,
                          )
                        ) {
                          return
                        }
                      }
                      setWorkspaceBackupBusy(true)
                      try {
                        if (missing.length > 0) {
                          // Push the non-missing backed-up workspaces one by one so
                          // the missing-folder ones are skipped (pushAll would
                          // resolve them onto the primary folder — wrong repo).
                          const missingIds = new Set(missing.map((m) => m.id))
                          const toPush = workspaces.filter(
                            (w) => w.github_backup_enabled === 1 && !missingIds.has(w.id),
                          )
                          const results: {
                            workspaceId: string
                            name: string
                            result: { ok: true; detail?: string } | { ok: false; error: string; detail?: string }
                          }[] = []
                          for (const w of toPush) {
                            const pushed = await window.sylo.workspaces.backup.push(w.id)
                            results.push({ workspaceId: w.id, name: w.name, result: pushed })
                          }
                          setWorkspacePushAllMessage(summarizePushResults(results, missing.length))
                        } else {
                          const res = await window.sylo.workspaces.backup.pushAll()
                          setWorkspacePushAllMessage(summarizePushResults(res.results, 0))
                        }
                        if (workspaceEditId) await refreshWorkspaceBackupStatus(workspaceEditId)
                      } finally {
                        setWorkspaceBackupBusy(false)
                      }
                    })()
                  }
                >
                  Push all backed-up ({backupEnabledWorkspaceCount})
                </button>
                <button type="button" className={cn(btnPrimary, workspaceModalDone)} onClick={() => setWorkspaceManageOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}

      {renameConvModal ?
        createPortal(
          <div
            className={modalOverlay}
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setRenameConvModal(null)
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sylo-rename-conv-title"
              className={modalShell}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 id="sylo-rename-conv-title" className={modalTitle}>
                Rename conversation
              </h3>
              <label className={modalField}>
                <span className={modalLabel}>Title</span>
                <input
                  autoFocus
                  type="text"
                  className={modalInput}
                  value={renameConvModal.draft}
                  onChange={(e) =>
                    setRenameConvModal((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitRenameConversation()
                    }
                  }}
                />
              </label>
              <div className={modalActions}>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => setRenameConvModal(null)}
                >
                  Cancel
                </button>
                <button type="button" className={btnPrimary} onClick={() => void commitRenameConversation()}>
                  Save
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}

      {deleteConvModal ?
        createPortal(
          <div
            className={modalOverlay}
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDeleteConvModal(null)
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sylo-delete-conv-title"
              className={modalShell}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 id="sylo-delete-conv-title" className={modalTitle}>
                Delete conversation?
              </h3>
              <p className={modalBody}>
                <strong>{deleteConvModal.title}</strong> will be removed permanently, including all messages.
              </p>
              <div className={modalActions}>
                <button type="button" className={btnGhost} onClick={() => setDeleteConvModal(null)}>
                  Cancel
                </button>
                <button type="button" className={btnDanger} onClick={() => void confirmDeleteConversation()}>
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}

    </div>
      ) : !popoutResolved ? (
        <div className={routePopoutLoading}>Loading route…</div>
      ) : !popoutRoute ? (
        <div className={routePopoutNotFound}>
          <h2 className={routePopoutNotFoundTitle}>Route not found</h2>
          <pre className={routePopoutNotFoundPre}>{routePopoutKey}</pre>
          <p className={cn(mutedText, 'text-[0.85rem]')}>
            Run <code>npm run bootstrap-pi</code>, restart the broker, and ensure the skill is under{' '}
            <code>~/.pi/agent/skills/</code>.
          </p>
        </div>
      ) : (
        <div className={routePopoutRoot}>
          <header className={routePopoutHeader}>
            <h2 className={routePopoutHeaderTitle}>{popoutRoute.title}</h2>
            <button type="button" className={navBtn} onClick={() => window.close()}>
              Close window
            </button>
          </header>
          <div className={routePopoutBody}>
            <SkillSurfaceSandbox
              key={`${popoutRoute.skillFolderName}:${popoutRoute.routeId}`}
              variant="route"
              fixturePath={popoutRoute.fixturePath}
              title={popoutRoute.title}
              widgetData={{}}
              hostPiCwd={activeWorkspaceForSettings.resolvedPiCwd}
              onSkillBridgeRpc={handleSkillRouteBridge}
              onBridgeReject={() => {}}
              onError={() => {}}
            />
          </div>
        </div>
      )}

      {routeContextMenu ?
        createPortal(
          <>
            <div
              role="presentation"
              aria-hidden="true"
              className={ctxMenuBackdrop}
              onMouseDown={() => setRouteContextMenu(null)}
              onWheel={() => setRouteContextMenu(null)}
            />
            <div
              className={ctxMenuShell}
              style={{
                left: routeContextMenu.clientX,
                top: routeContextMenu.clientY,
              }}
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
            >
            <button
              type="button"
              className={routeCtxItem}
              role="menuitem"
              onClick={() => {
                togglePinSkillRouteKey(skillRouteRowKey(routeContextMenu.route))
                setRouteContextMenu(null)
              }}
            >
              {navLayout.pinned.includes(skillRouteRowKey(routeContextMenu.route)) ? 'Unpin' : 'Pin to top'}
                        </button>
            <button
              type="button"
              className={routeCtxItem}
              role="menuitem"
              onClick={() => {
                const k = skillRouteRowKey(routeContextMenu.route)
                setRouteContextMenu(null)
                void window.sylo.skillRoutes.openPopoutWindow(k).then((r) => {
                  if (!r.ok) window.alert(`Could not open window: ${r.error}`)
                })
              }}
            >
              Open in new window
            </button>
          </div>
          </>,
          document.body,
        )
      : null}

      {convContextMenu ?
        createPortal(
          <>
            <div
              role="presentation"
              aria-hidden="true"
              className={ctxMenuBackdrop}
              onMouseDown={() => setConvContextMenu(null)}
              onWheel={() => setConvContextMenu(null)}
            />
            <div
              className={ctxMenuShell}
              style={{
                left: convContextMenu.clientX,
                top: convContextMenu.clientY,
              }}
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={routeCtxItem}
                role="menuitem"
                disabled={safeMode || !agentReady || branchingConvId !== null}
                title="New conversation with history up to your last message; Pi context matches what you see"
                onClick={() => void branchConversation(convContextMenu.id)}
              >
                Branch
              </button>
              <button
                type="button"
                className={routeCtxItem}
                role="menuitem"
                onClick={() => {
                  const { id } = convContextMenu
                  setConvContextMenu(null)
                  void exportConversationMarkdown(id)
                }}
              >
                Export Markdown
              </button>
              <button
                type="button"
                className={routeCtxItem}
                role="menuitem"
                onClick={() => {
                  const { id, title } = convContextMenu
                  setConvContextMenu(null)
                  openRenameConversationModal(id, title)
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className={cn(routeCtxItem, routeCtxItemDanger)}
                role="menuitem"
                onClick={() => {
                  const { id, title } = convContextMenu
                  setConvContextMenu(null)
                  setDeleteConvModal({ id, title: title.trim() || '(untitled)' })
                }}
              >
                Delete
              </button>
            </div>
          </>,
          document.body,
        )
      : null}

      {onboardingNameOpen ?
        createPortal(
          <div
            className={modalOverlay}
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) void skipOnboardingName()
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sylo-onboarding-name-title"
              className={modalShell}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 id="sylo-onboarding-name-title" className={modalTitle}>
                Name your user-data workspace
              </h3>
              <p className={cn(modalBody, leadText, 'mt-0')}>
                This is your <strong>user profile workspace</strong> — all user config data lives here: workflows,
                tool config parameters, global AI instructions, and your profile. It is also the folder Sylo backs up
                to GitHub. Name it before wiring any backup — for example{' '}
                <code>sylo-user-work</code> on a work computer so it never combines with your personal one.
              </p>
              <input
                type="text"
                className={cn(modalInputFlex, workspaceFormInput)}
                value={onboardingName}
                onChange={(e) => {
                  setOnboardingError('')
                  setOnboardingName(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmOnboardingName()
                }}
                autoFocus
                spellCheck={false}
                aria-label="Workspace name"
              />
              {onboardingError ?
                <p className={cn(errorText, 'mt-1.5')} role="alert">
                  {onboardingError}
                </p>
              : null}
              <p className={cn(settingsCaption, 'mt-2')}>
                Renaming creates this folder and moves everything with it. You can rename it anytime in Workspaces.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className={btnGhost} disabled={onboardingBusy} onClick={() => void skipOnboardingName()}>
                  Keep sylo-user
                </button>
                <button type="button" className={btnPrimary} disabled={onboardingBusy || !onboardingName.trim()} onClick={() => void confirmOnboardingName()}>
                                    {onboardingBusy ? 'Renaming…' : 'Continue'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}

      {restoreWsOpen && workspaces[0] ?
        createPortal(
          <div className={modalOverlay} role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sylo-restore-ws-title"
              className={modalShell}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 id="sylo-restore-ws-title" className={modalTitle}>
                Set up your user-data workspace
              </h3>
              <p className={cn(modalBody, leadText, 'mt-0')}>
                The folder for your <strong>user-data workspace</strong> is missing on disk:
              </p>
              <p className="mt-1">
                <code className="text-xs">{workspaces[0].pi_cwd?.trim() || workspaces[0].resolved_pi_cwd}</code>
              </p>
              <p className={cn(modalBody, leadText, 'mt-2')}>
                It holds your profile, global AI instructions, workflows, and tool config — and is the folder
                Sylo backs up to GitHub. Create a new one by naming it, or restore it from GitHub.
              </p>

              <label className={cn(workspaceFieldLabel, 'mt-4 block')} htmlFor="restore-ws-name">
                Create a new workspace
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="restore-ws-name"
                  type="text"
                  className={cn(modalInputFlex, workspaceFormInput)}
                  value={restoreName}
                  onChange={(e) => {
                    setRestoreError('')
                    setRestoreName(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void confirmRestoreCreate()
                  }}
                  autoFocus
                  spellCheck={false}
                  aria-label="New workspace name"
                />
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={restoreBusy !== '' || !restoreName.trim()}
                  onClick={() => void confirmRestoreCreate()}
                >
                  {restoreBusy === 'create' ? 'Creating…' : 'Create folder'}
                </button>
              </div>

              <div className={cn(settingsCaption, 'my-3 text-center')}>— or —</div>

              <label className={cn(workspaceFieldLabel, 'block')} htmlFor="restore-ws-url">
                Restore from GitHub
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="restore-ws-url"
                  type="text"
                  className={cn(modalInputFlex, workspaceFormInput)}
                  value={restoreCloneUrl}
                  placeholder="https://github.com/you/your-workspace-repo"
                  onChange={(e) => {
                    setRestoreError('')
                    setRestoreCloneUrl(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void confirmRestoreClone()
                  }}
                  spellCheck={false}
                  aria-label="GitHub clone URL"
                />
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={restoreBusy !== '' || !restoreCloneUrl.trim()}
                  onClick={() => void confirmRestoreClone()}
                >
                  {restoreBusy === 'clone' ? 'Cloning…' : 'Clone & restore'}
                </button>
              </div>
              <p className={cn(settingsCaption, 'mt-1.5')}>
                Clones into the folder above (same name). Public repos clone without signing in; private repos
                need GitHub connected in Workspaces settings.
              </p>

              {restoreError ? (
                <p className={cn(errorText, 'mt-2')} role="alert">
                  {restoreError}
                </p>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className={btnGhost} onClick={() => setRestoreWsOpen(false)}>
                  Decide later
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}

      {routeActionModal ?
        createPortal(
          <div
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) routeActionModal.resolve(false)
            }}
          >
            <dialog
              open
              style={{
                margin: 0,
                maxWidth: 520,
                width: '90vw',
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                color: 'inherit',
                padding: 16,
              }}
            >
              <h3 style={{ marginTop: 0 }}>Confirm agent action</h3>
              <p className={cn(mutedText, 'text-[0.85rem]')}>
                Review or edit the prompt before it is injected into the Pi session.
              </p>
              <textarea
                value={routeActionDraft}
                onChange={(e) => setRouteActionDraft(e.target.value)}
                rows={6}
                style={{ width: '100%', marginTop: 8, fontFamily: 'inherit' }}
              />
              <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => routeActionModal.resolve(false)}>
                  Cancel
                </button>
                <button type="button" onClick={() => routeActionModal.resolve(true, routeActionDraft)}>
                  Send to agent
                </button>
              </div>
            </dialog>
          </div>,
          document.body,
        )
      : null}
    </>
  )
}
