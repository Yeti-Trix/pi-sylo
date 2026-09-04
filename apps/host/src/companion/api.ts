export type Conversation = {
  id: string
  title: string
  created_at: number
  updated_at: number
  workspace_id: string | null
  pi_session_relpath: string | null
  model_provider: string | null
  model_id: string | null
  image_model_id: string | null
  image_model_provider: string | null
}

export type Message = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_calls_json: string | null
  status: 'streaming' | 'complete' | 'failed' | 'cancelled'
  created_at: number
}

export type BrokerStatus = {
  ready: boolean
  safeMode: boolean
  initError: string | null
}

export type AuthStatus = {
  authenticated: boolean
  username?: string
  hasCredentials: boolean
}

export type Workspace = {
  id: string
  name: string
}

const fetchOpts: RequestInit = { credentials: 'include' }

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...fetchOpts,
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 401) throw new Error('unauthorized')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `http_${res.status}`)
  }
  return (await res.json()) as T
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return apiFetch('/api/auth/status')
}

export async function login(username: string, password: string): Promise<{ ok: true; username: string }> {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST', body: '{}' })
}

export async function fetchBrokerStatus(): Promise<BrokerStatus> {
  return apiFetch('/api/broker/status')
}

export async function fetchWorkspaces(): Promise<{
  workspaces: Workspace[]
  activeWorkspaceId: string
}> {
  return apiFetch('/api/workspaces')
}

export async function setActiveWorkspace(workspaceId: string): Promise<string> {
  const data = await apiFetch<{ ok: true; activeWorkspaceId: string }>('/api/ui/active-workspace', {
    method: 'PUT',
    body: JSON.stringify({ workspaceId }),
  })
  return data.activeWorkspaceId
}

export async function fetchConversations(workspaceId: string): Promise<{
  conversations: Conversation[]
  running: string[]
}> {
  const data = await apiFetch<{ conversations: Conversation[]; running?: string[] }>(
    `/api/conversations?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
  return { conversations: data.conversations, running: data.running ?? [] }
}

export async function createConversation(title = '', workspaceId?: string): Promise<Conversation> {
  const data = await apiFetch<{ conversation: Conversation }>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, workspaceId }),
  })
  return data.conversation
}

export async function findLatestEmptyConversation(workspaceId: string): Promise<string | null> {
  const data = await apiFetch<{ conversationId: string | null }>(
    `/api/conversations/latest-empty?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
  return data.conversationId
}

/** Rename a conversation (sets the chat title). */
export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<{ ok: boolean; title: string }> {
  return apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/title`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  })
}

/** Permanently delete a conversation and its messages/attachments. */
export async function deleteConversation(
  conversationId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  })
}

export type ModelChoice = {
  global: {
    provider: string
    modelId: string
    imageModelId: string
    imageModelProvider: string
  }
  ollamaOrigin: string
  providers: string[]
  ollamaModels: { id: string; visionCapable: boolean }[]
}

export type ConversationModelOverride = {
  model_provider: string | null
  model_id: string | null
  image_model_id: string | null
  image_model_provider: string | null
}

export async function fetchModels(): Promise<ModelChoice> {
  return apiFetch('/api/models')
}

/** Persist the per-chat model override (null fields inherit the global default). */
export async function setConversationModel(
  conversationId: string,
  model: ConversationModelOverride,
): Promise<{ ok: boolean; conversationId: string }> {
  return apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/model`, {
    method: 'PUT',
    body: JSON.stringify(model),
  })
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const data = await apiFetch<{ messages: Message[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  )
  return data.messages
}

export type ChatAttachment = { path: string; name: string }

export async function uploadAttachment(file: File): Promise<ChatAttachment> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  const data = btoa(binary)
  const name = file.name?.trim() || 'upload'
  return apiFetch('/api/files/upload', {
    method: 'POST',
    body: JSON.stringify({ name, data }),
  })
}

export async function sendMessage(
  conversationId: string,
  text: string,
  attachments?: ChatAttachment[],
): Promise<{ assistantMessageId: string; error?: string; deferred?: boolean }> {
  return apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/send`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      attachments: attachments?.length ? attachments : undefined,
    }),
  })
}

export async function abortTurn(
  conversationId: string,
): Promise<{ ok: boolean; error?: string }> {
  return apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/abort`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

/** Send a message now, interrupting the active turn after the current tool (desktop "send now"). */
export async function steerTurn(
  conversationId: string,
  text: string,
  attachments?: ChatAttachment[],
): Promise<{ ok: boolean; error?: string }> {
  return apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/steer`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      attachments: attachments?.length ? attachments : undefined,
    }),
  })
}

/** Deliver a locally-queued follow-up: follows up the active turn, else starts a new one. */
export async function deliverQueued(
  conversationId: string,
  text: string,
  attachments?: ChatAttachment[],
): Promise<{ ok: boolean; error?: string }> {
  return apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/deliver-queued`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      attachments: attachments?.length ? attachments : undefined,
    }),
  })
}

/** Request a Sylo restart via the ntfy supervisor control channel. */
export async function restartSylo(): Promise<{ ok: boolean; error?: string }> {
  return apiFetch('/api/restart', { method: 'POST', body: JSON.stringify({}) })
}

/** Request a Sylo REBUILD + restart (applies code changes) via the supervisor. */
export async function rebuildSylo(): Promise<{ ok: boolean; error?: string }> {
  return apiFetch('/api/rebuild', { method: 'POST', body: JSON.stringify({}) })
}

export type CompanionPersonalEntry = {
  id: string
  title: string
  status?: string
  logged_date?: string
}

/** Companion manifest from the installed personal bundle (null when absent). */
export type PersonalManifest = {
  tabs: { id: string; label: string; icon: string }[]
  appBase: string
  landing: {
    op: string
    payload: Record<string, unknown>
    title: string
    singleLabel: string
    countNoun: string
  }
}

/** Plugin manifest — null when no personal bundle is installed. */
export async function fetchPersonalManifest(): Promise<PersonalManifest | null> {
  try {
    return await apiFetch<PersonalManifest | null>('/api/personal/manifest')
  } catch {
    return null
  }
}

function ymdToday(): string {
  const t = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

/** Today's personal entries for the chat landing screen (manifest-driven). */
export async function fetchPersonalLandingEntries(
  manifest: PersonalManifest,
): Promise<CompanionPersonalEntry[]> {
  const { op, payload } = manifest.landing
  const resolved = Object.fromEntries(
    Object.entries(payload ?? {}).map(([k, v]) => [k, v === '$today' ? ymdToday() : v]),
  )
  const data = await apiFetch<{ result?: { entries?: CompanionPersonalEntry[] } | CompanionPersonalEntry[] }>(
    '/api/personal/rpc',
    {
      method: 'POST',
      body: JSON.stringify({ op, payload: resolved }),
    },
  )
  const result = data.result
  if (Array.isArray(result)) return result
  return result?.entries ?? []
}

export type StreamHandlers = {
  onRefresh: (payload: { conversationId: string; kind: string }) => void
  onStream: (payload: { conversationId: string; messageId: string; delta: string }) => void
  onTool: (payload: { conversationId: string; messageId: string; event: unknown; ts: number }) => void
  onBrokerStatus: (payload: Record<string, unknown>) => void
  /** Called after the SSE socket reconnects (mobile backgrounding often kills it). */
  onReconnect?: () => void
}

export function connectEvents(handlers: StreamHandlers): () => void {
  let closed = false
  let es: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryMs = 1000

  const wire = (source: EventSource) => {
    source.addEventListener('chat:refresh', (ev) => {
      try {
        handlers.onRefresh(JSON.parse((ev as MessageEvent).data))
      } catch {
        /* */
      }
    })
    source.addEventListener('chat:stream', (ev) => {
      try {
        handlers.onStream(JSON.parse((ev as MessageEvent).data))
      } catch {
        /* */
      }
    })
    source.addEventListener('chat:tool', (ev) => {
      try {
        handlers.onTool(JSON.parse((ev as MessageEvent).data))
      } catch {
        /* */
      }
    })
    source.addEventListener('broker:status', (ev) => {
      try {
        handlers.onBrokerStatus(JSON.parse((ev as MessageEvent).data))
      } catch {
        /* */
      }
    })
  }

  const scheduleReconnect = () => {
    if (closed || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (closed) return
      retryMs = Math.min(retryMs * 2, 30_000)
      connect(true)
    }, retryMs)
  }

  const connect = (isReconnect = false) => {
    if (closed) return
    es?.close()
    es = new EventSource('/api/events', { withCredentials: true })
    wire(es)
    es.onopen = () => {
      retryMs = 1000
      if (isReconnect) handlers.onReconnect?.()
    }
    es.onerror = () => {
      es?.close()
      es = null
      scheduleReconnect()
    }
  }

  connect()

  return () => {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    es?.close()
    es = null
  }
}
