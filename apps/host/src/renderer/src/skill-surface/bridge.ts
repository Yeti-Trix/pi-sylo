/**
 * postMessage bridge between host and skill UI iframes (Discussion #317 / ADR-31).
 * Host validates event.source === iframe.contentWindow and msg.nonce === session nonce.
 */

export const SYLO_WIDGET_BRIDGE_KIND = 'sylo-widget-bridge' as const
export const SYLO_WIDGET_BRIDGE_V = 1 as const

export type WidgetBridgeOp = 'sendToAgent' | 'ping'

export type WidgetBridgeMessageFromChild = {
  v: typeof SYLO_WIDGET_BRIDGE_V
  kind: typeof SYLO_WIDGET_BRIDGE_KIND
  nonce: string
  op: WidgetBridgeOp
  payload?: unknown
}

/** Persistent routes + RPC replies (ADR-32). */
export const SYLO_SKILL_BRIDGE_KIND = 'sylo-skill-bridge' as const
export const SYLO_SKILL_BRIDGE_REPLY_KIND = 'sylo-skill-bridge-reply' as const
/** Host → route iframe push (no reqId; not RPC). */
export const SYLO_SKILL_BRIDGE_EVENT_KIND = 'sylo-skill-bridge-event' as const

export type SkillBridgeHostEvent = 'workspaceChanged' | 'libraryChanged'

export type SkillBridgeEventToChild = {
  v: typeof SYLO_WIDGET_BRIDGE_V
  kind: typeof SYLO_SKILL_BRIDGE_EVENT_KIND
  nonce: string
  event: SkillBridgeHostEvent
  /** workspaceChanged → route's workspace. libraryChanged (imagegen fan, §8
   *  step 7; videogen twin §5.5) → optional workspaceKey/reason context + the
   *  §5.5 optional `source` tag so a route can filter; both routes tolerate
   *  the other's nudge (a refetch is cheap) and never trust the payload beyond
   *  a nudge. */
  payload: { piCwd: string; workspaceKey?: string; reason?: string; source?: 'imagegen' | 'videogen' }
}

export type SkillRouteBridgeOp =
  | 'sendToAgent'
  | 'ping'
  | 'readSkillData'
  | 'writeSkillData'
  | 'requestAgentAction'
  | 'webAccessListRuns'
  | 'webAccessStats'
    | 'webAccessConfigGet'
  | 'webAccessConfigSave'
  | 'webAccessBraveQuota'
  | 'settingsOllamaListTags'
  | 'settingsChatgptModels'
    | 'logicforgeParseRulesGet'
  | 'logicforgeParseRulesSave'
  | 'logicforgeParseRulesReset'
  | 'logicforgeIoReviewGet'
  | 'logicforgeIoReviewReseed'
    | 'logicforgeIoReviewSave'
  | 'logicforgeIoReviewApproveBuild'
  | 'logicforgeDownloadAllowlistGet'
  | 'logicforgeDownloadAllowlistSave'
  | 'logicforgeDownloadPlcStatus'
  | 'logicforgeTemplates'
    | 'syloWorkflowsList'
  | 'syloWorkflowRead'
  | 'syloWorkflowSave'
  | 'syloWorkflowDelete'
  | 'onenoteAuthStatus'
  | 'onenoteAuthStart'
  | 'onenoteAuthComplete'
  | 'onenoteAuthLogout'
  | 'onenoteSettingsGet'
  | 'onenoteSettingsSave'
  | 'onenoteNotebookList'
  | 'onenoteIndexSync'
  | 'onenoteIndexProgress'
  | 'onenoteImportLegacyCache'
  | 'workspaceResolvedPiCwd'
  | 'openExternalUrl'
  | 'dialogOpenDirectory'
  | 'dialogOpenFile'
  | 'ttsListVoices'
  | 'ttsConfigGet'
  | 'ttsConfigSave'
  | 'ttsGenerate'
  | 'ttsSaveAudio'
  | 'ttsDeleteRouteClip'
  /** sylo-image-gen Images route (plan §5.6) — additive block. */
  | 'imageGenStatus'
  | 'imageGenConfigGet'
  | 'imageGenConfigSave'
  | 'imageGenGenerate'
  | 'imageGenJobGet'
  | 'imageGenQueueList'
  | 'imageGenLibraryList'
  | 'imageGenImageGet'
  | 'imageGenImageUpdate'
  | 'imageGenImageDelete'
  | 'imageGenRevealFile'
  | 'videoGenStatus'
  | 'videoGenConfigGet'
  | 'videoGenConfigSave'
  | 'videoGenGenerate'
  | 'videoGenJobGet'
  | 'videoGenQueueList'
  | 'videoGenJobsList'
  | 'videoGenJobsReplay'
  | 'videoGenDoctor'
  | 'videoGenLibraryList'
  | 'videoGenVideoGet'
  | 'videoGenVideoUpdate'
  | 'videoGenVideoDelete'
    | 'videoGenRevealFile'
  | 'tasksSnapshotGet'
  | 'tasksListGet'
  | 'tasksListCreate'
  | 'tasksListDelete'
    | 'tasksTaskAdd'
  | 'tasksTaskUpdate'
  | 'tasksTaskDelete'

export type SkillBridgeMessageFromChild = {
  v: typeof SYLO_WIDGET_BRIDGE_V
  kind: typeof SYLO_SKILL_BRIDGE_KIND
  nonce: string
  reqId: string
  op: SkillRouteBridgeOp
  payload?: unknown
}

export type SkillBridgeReplyToChild = {
  v: typeof SYLO_WIDGET_BRIDGE_V
  kind: typeof SYLO_SKILL_BRIDGE_REPLY_KIND
  reqId: string
  ok: boolean
  result?: unknown
  error?: string
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Parse and validate shape; returns null if not a Sylo widget bridge message. */
export function parseWidgetBridgeMessage(data: unknown): WidgetBridgeMessageFromChild | null {
  if (!isRecord(data)) return null
  const ver = Number(data.v)
  if (ver !== SYLO_WIDGET_BRIDGE_V) return null
  if (data.kind !== SYLO_WIDGET_BRIDGE_KIND) return null
  if (typeof data.nonce !== 'string' || data.nonce.length === 0) return null
  if (data.op !== 'sendToAgent' && data.op !== 'ping') return null
  return {
    v: SYLO_WIDGET_BRIDGE_V,
    kind: SYLO_WIDGET_BRIDGE_KIND,
    nonce: data.nonce,
    op: data.op,
    payload: data.payload,
  }
}

export function newBridgeNonce(): string {
  return crypto.randomUUID()
}

const ROUTE_OPS: ReadonlySet<string> = new Set([
  'sendToAgent',
  'ping',
  'readSkillData',
  'writeSkillData',
  'requestAgentAction',
  'webAccessListRuns',
  'webAccessStats',
    'webAccessConfigGet',
  'webAccessConfigSave',
  'webAccessBraveQuota',
  'settingsOllamaListTags',
  'settingsChatgptModels',
    'logicforgeParseRulesGet',
  'logicforgeParseRulesSave',
  'logicforgeParseRulesReset',
  'logicforgeIoReviewGet',
  'logicforgeIoReviewReseed',
    'logicforgeIoReviewSave',
  'logicforgeIoReviewApproveBuild',
  'logicforgeDownloadAllowlistGet',
  'logicforgeDownloadAllowlistSave',
  'logicforgeDownloadPlcStatus',
  'logicforgeTemplates',
    'syloWorkflowsList',
  'syloWorkflowRead',
  'syloWorkflowSave',
  'syloWorkflowDelete',
  'onenoteAuthStatus',
  'onenoteAuthStart',
  'onenoteAuthComplete',
  'onenoteAuthLogout',
  'onenoteSettingsGet',
  'onenoteSettingsSave',
  'onenoteNotebookList',
  'onenoteIndexSync',
  'onenoteIndexProgress',
  'onenoteImportLegacyCache',
  'workspaceResolvedPiCwd',
  'openExternalUrl',
  'dialogOpenDirectory',
  'dialogOpenFile',
  'ttsListVoices',
  'ttsConfigGet',
  'ttsConfigSave',
  'ttsGenerate',
  'ttsSaveAudio',
  'ttsDeleteRouteClip',
  // sylo-image-gen Images route (plan §5.6) — additive block.
  'imageGenStatus',
  'imageGenConfigGet',
  'imageGenConfigSave',
  'imageGenGenerate',
  'imageGenJobGet',
  'imageGenQueueList',
  'imageGenLibraryList',
  'imageGenImageGet',
  'imageGenImageUpdate',
  'imageGenImageDelete',
  'imageGenRevealFile',
  // sylo-video-gen Videos route (plan §5, §8 step 7) — additive block (videoGenVideoGet/Update/Delete; job ops are DURABLE-LEDGER reads; videoGenDoctor = status with the doctor probe).
  'videoGenStatus',
  'videoGenConfigGet',
  'videoGenConfigSave',
  'videoGenGenerate',
  'videoGenJobGet',
  'videoGenQueueList',
  'videoGenJobsList',
  'videoGenJobsReplay',
  'videoGenDoctor',
  'videoGenLibraryList',
  'videoGenVideoGet',
  'videoGenVideoUpdate',
  'videoGenVideoDelete',
    'videoGenRevealFile',
  'tasksSnapshotGet',
  'tasksListGet',
  'tasksListCreate',
  'tasksListDelete',
    'tasksTaskAdd',
  'tasksTaskUpdate',
  'tasksTaskDelete',
])

/**
 * Personal-bundle ops (loaded from the installed plugin at runtime) are also
 * valid route-bridge ops. The cache is populated by refreshPersonalBridgeOps()
 * during app boot — before any personal UI iframe can post messages.
 */
const personalPluginOpsSync = new Set<string>()
export async function refreshPersonalBridgeOps(): Promise<void> {
  try {
    const ops = await window.sylo.personal?.ops()
    if (Array.isArray(ops)) for (const o of ops) personalPluginOpsSync.add(String(o))
  } catch {
    /* no personal bundle installed */
  }
}

export function parseSkillBridgeMessage(data: unknown): SkillBridgeMessageFromChild | null {
  if (!isRecord(data)) return null
  const ver = Number(data.v)
  if (ver !== SYLO_WIDGET_BRIDGE_V) return null
  if (data.kind !== SYLO_SKILL_BRIDGE_KIND) return null
  if (typeof data.nonce !== 'string' || data.nonce.length === 0) return null
  if (typeof data.reqId !== 'string' || data.reqId.length === 0) return null
  const op = data.op
  if (typeof op !== 'string') return null
  // Static allowlist first; personal-plugin ops (dynamic, runtime-declared by
  // the installed bundle) second. Unknown ops never reach the host.
  if (!ROUTE_OPS.has(op) && !personalPluginOpsSync.has(op)) return null
  return {
    v: SYLO_WIDGET_BRIDGE_V,
    kind: SYLO_SKILL_BRIDGE_KIND,
    nonce: data.nonce,
    reqId: data.reqId,
    op: op as SkillRouteBridgeOp,
    payload: data.payload,
  }
}

export function skillBridgeReply(reqId: string, ok: boolean, result?: unknown, error?: string): SkillBridgeReplyToChild {
  return {
    v: SYLO_WIDGET_BRIDGE_V,
    kind: SYLO_SKILL_BRIDGE_REPLY_KIND,
    reqId,
    ok,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  }
}

export function skillBridgeEvent(
  nonce: string,
  event: SkillBridgeHostEvent,
  payload: SkillBridgeEventToChild['payload'],
): SkillBridgeEventToChild {
  return {
    v: SYLO_WIDGET_BRIDGE_V,
    kind: SYLO_SKILL_BRIDGE_EVENT_KIND,
    nonce,
    event,
    payload,
  }
}
