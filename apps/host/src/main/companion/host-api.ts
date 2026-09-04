import type { ConversationRow, MessageRow, WorkspaceRow } from '../database.js'

export type CompanionHostApi = {
  listWorkspaces: () => WorkspaceRow[]
  getActiveWorkspaceId: () => string
  setActiveWorkspaceId: (workspaceId: string) => void
  listConversations: (workspaceId: string) => ConversationRow[]
  findLatestEmptyConversation: (workspaceId: string) => string | undefined
  createConversation: (title?: string, workspaceId?: string) => ConversationRow
  listMessages: (conversationId: string) => MessageRow[]
  setConversationTitle: (id: string, title: string) => void
  /** Persist the per-chat model override (null fields inherit the global default). */
    setConversationModel: (
    id: string,
    model: {
      model_provider: string | null
      model_id: string | null
      image_model_id: string | null
      image_model_provider: string | null
      thinking_level?: string | null
    },
  ) => { ok: true } | { ok: false; error: string }
  /** Available models + global defaults for the companion model selector. */
  listModels: () => Promise<{
    global: { provider: string; modelId: string; imageModelId: string; imageModelProvider: string }
    ollamaOrigin: string
    providers: string[]
    ollamaModels: { id: string; visionCapable: boolean }[]
  }>
  deleteConversation: (id: string) => boolean
  /** Conversation ids that currently have an in-flight agent turn (for status dots). */
  listRunningConversationIds: () => string[]
  sendChat: (
    conversationId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ) => Promise<{
    assistantMessageId: string
    error?: string
    deferred?: boolean
  }>
  abortChat: (conversationId: string) => Promise<{ ok: boolean; error?: string }>
  /** Inject a message into the active turn, interrupting after the current tool (desktop "send now"). */
  steerChat: (
    conversationId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ) => Promise<{ ok: boolean; error?: string }>
  /** Deliver a locally-queued follow-up: follows up the active turn, else starts a new one (desktop "deliverQueued"). */
  deliverQueuedChat: (
    conversationId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ) => Promise<{ ok: boolean; error?: string }>
  getBrokerStatus: () => {
    ready: boolean
    safeMode: boolean
    initError: string | null
  }
  defaultWorkspaceId: () => string
  personalRpc: (op: string, payload: unknown) => unknown | Promise<unknown>
  /** Plugin-declared companion manifest (tabs + landing), or null when absent. */
  personalManifest: () => unknown | Promise<unknown>
}

let api: CompanionHostApi | null = null

export function setCompanionHostApi(next: CompanionHostApi): void {
  api = next
}

export function getCompanionHostApi(): CompanionHostApi {
  if (!api) throw new Error('companion_host_api_not_ready')
  return api
}
