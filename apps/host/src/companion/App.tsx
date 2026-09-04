import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChatConversationMessageRow } from '@renderer/chat/ConversationMessage'
import { AttachmentImageThumb } from '@renderer/AttachmentImageThumb'
import { formatUserMessageWithAttachments } from '@renderer/chatUserAttachments'
import { cn } from '@renderer/lib/cn'
import type { WorkflowStampedEntry } from '@renderer/workflowTimeline'
import {
  abortTurn,
  connectEvents,
  createConversation,
  deleteConversation,
  findLatestEmptyConversation,
  fetchAuthStatus,
  fetchBrokerStatus,
  fetchConversations,
  fetchMessages,
  fetchWorkspaces,
    login,
  logout,
    rebuildSylo,
  renameConversation,
  sendMessage,
    steerTurn,
  deliverQueued,
  setActiveWorkspace,
  uploadAttachment,
  restartSylo,
  fetchPersonalLandingEntries,
  fetchPersonalManifest,
  type ChatAttachment,
  type CompanionPersonalEntry,
  type PersonalManifest,
  type Conversation,
  type Message,
  type Workspace,
} from './api'
import { companionLocalImageUrl } from './images'
import { BottomTabBar, type CompanionTab } from './BottomTabBar'
import { InstallHintBanner } from './InstallHintBanner'
import { CertificateSetupPanel } from './CertificateSetupPanel'
import { CompanionModelBar } from './CompanionModelBar'

const CHAT_NEAR_BOTTOM_PX = 120

type ConvActivity = 'running' | 'unread' | 'read'

function convStatusDot({ running, unread }: { running: boolean; unread: boolean }): ConvActivity {
  if (running) return 'running'
  if (unread) return 'unread'
  return 'read'
}

function ConvStatusIndicator({ status }: { status: ConvActivity }): React.ReactElement {
  if (status === 'running') {
    return (
      <span
        className="size-3 shrink-0 rounded-full border-2 border-accent border-t-transparent animate-spin"
        role="status"
        aria-label="Agent running"
        title="Agent running"
      />
    )
  }
  return (
    <span
      className={cn(
        'size-2.5 shrink-0 rounded-full',
        status === 'unread' ? 'bg-accent' : 'bg-text-secondary/25',
      )}
      aria-hidden={status === 'read'}
      title={status === 'unread' ? 'Unread reply' : 'Read'}
    />
  )
}

function isChatAreaNearBottom(el: HTMLElement, threshold = CHAT_NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

function LoginScreen({
  onLogin,
  error,
}: {
  onLogin: (username: string, password: string) => Promise<void>
  error: string | null
}): React.ReactElement {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 overflow-auto p-6">
      <CertificateSetupPanel />
      <div>
        <h1 className="m-0 text-xl font-semibold">Sylo Companion</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Log in with the username and password you set on the desktop under Settings → Companion.
        </p>
      </div>
      {error ?
        <p className="m-0 text-sm text-danger">{error}</p>
      : null}
      <label className="flex flex-col gap-1 text-sm text-text-secondary">
        Username
        <input
          className="rounded-lg border border-border bg-bg-secondary px-3 py-3 text-base text-text-primary outline-none focus:border-accent"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          spellCheck={false}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-text-secondary">
        Password
        <input
          type="password"
          className="rounded-lg border border-border bg-bg-secondary px-3 py-3 text-base text-text-primary outline-none focus:border-accent"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <button
        type="button"
        className="rounded-lg bg-accent px-4 py-3 text-base font-medium text-bg-primary disabled:opacity-40"
        disabled={busy || !username.trim() || !password}
        onClick={() => {
          setBusy(true)
          void onLogin(username.trim(), password).finally(() => setBusy(false))
        }}
      >
        Log in
      </button>
    </div>
  )
}

type QueuedMessage = { id: string; text: string; attachments: ChatAttachment[] }

function newQueueId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function App(): React.ReactElement {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [brokerReady, setBrokerReady] = useState(false)
  const [brokerHint, setBrokerHint] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set())
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [liveDelta, setLiveDelta] = useState<Record<string, string>>({})
  const [liveWorkflow, setLiveWorkflow] = useState<Record<string, WorkflowStampedEntry[]>>({})
  const [segmentOverrides, setSegmentOverrides] = useState<Record<string, boolean>>({})
  const [composer, setComposer] = useState('')
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([])
  const [attachBusy, setAttachBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [companionTab, setCompanionTab] = useState<CompanionTab>('chat')
  const [landingEntries, setLandingEntries] = useState<CompanionPersonalEntry[] | null>(null)
  // Personal bundle manifest (null → no personal tabs / no landing card).
  const [personalManifest, setPersonalManifest] = useState<PersonalManifest | null>(null)
  const pluginTabs = (personalManifest?.tabs ?? []).map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
  }))
  const [showChatsList, setShowChatsList] = useState(false)
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
  const flushQueueLockRef = useRef(false)
  const prevAgentActiveRef = useRef(false)
    const [restartBusy, setRestartBusy] = useState(false)
  const [restartStatus, setRestartStatus] = useState<string | null>(null)
  const [rebuildBusy, setRebuildBusy] = useState(false)
  const [rebuildStatus, setRebuildStatus] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const pendingConvScrollRef = useRef(false)
  const prevMessagesLenRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeIdRef = useRef<string | null>(null)
  const workspaceIdRef = useRef('')
  activeIdRef.current = activeId
  workspaceIdRef.current = workspaceId

  const showTabBar = !activeId

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )

  useEffect(() => {
    void (async () => {
      try {
        const st = await fetchAuthStatus()
        setAuthenticated(st.authenticated)
        setUsername(st.username ?? null)
        if (!st.hasCredentials) {
          setAuthError('Desktop login not configured yet. Set username/password in Sylo Settings → Companion.')
        }
      } catch {
        setAuthenticated(false)
      }
    })()
  }, [])

  const loadWorkspaces = useCallback(async () => {
    const st = await fetchWorkspaces()
    setWorkspaces(st.workspaces)
    setWorkspaceId(st.activeWorkspaceId)
    return st.activeWorkspaceId
  }, [])

  const loadConversations = useCallback(async (wid: string, opts?: { silent?: boolean }) => {
    if (!wid) {
      setConversations([])
      setRunningIds(new Set())
      return
    }
    if (!opts?.silent) setLoadingList(true)
    try {
      let res = await fetchConversations(wid)
      if (res.conversations.length === 0) {
        await createConversation('', wid)
        res = await fetchConversations(wid)
      }
      setConversations(res.conversations)
      setRunningIds(new Set(res.running))
      setAuthError(null)
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!opts?.silent) setLoadingList(false)
    }
  }, [])

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const rows = await fetchMessages(conversationId)
      setMessages(rows)
      setLiveDelta((prev) => {
        const next = { ...prev }
        for (const row of rows) {
          delete next[row.id]
        }
        return next
      })
      setLiveWorkflow((prev) => {
        const next = { ...prev }
        for (const row of rows) {
          if (row.role === 'assistant' && row.status !== 'streaming') delete next[row.id]
        }
        return next
      })
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    }
  }, [])

    const refreshBroker = useCallback(async () => {
    try {
      const st = await fetchBrokerStatus()
      setBrokerReady(st.ready && !st.safeMode)
      setBrokerHint(
        st.safeMode ? 'Safe mode is on on desktop.'
        : st.initError ? st.initError
        : st.ready ? null
        : 'Broker not ready on desktop.',
      )
    } catch {
      setBrokerReady(false)
    }
  }, [])

  const refreshPersonalLanding = useCallback(async () => {
    const manifest = await fetchPersonalManifest()
    setPersonalManifest(manifest)
    if (!manifest) {
      // No personal bundle installed — plain chat list, no personal tabs.
      setLandingEntries(null)
      return
    }
    try {
      setLandingEntries(await fetchPersonalLandingEntries(manifest))
    } catch {
      setLandingEntries([])
    }
  }, [])

    const resyncFromServer = useCallback(async () => {
    await refreshBroker()
    const wid = workspaceIdRef.current
    const convId = activeIdRef.current
    if (wid) await loadConversations(wid, { silent: true })
    if (convId) await loadMessages(convId)
    await refreshPersonalLanding()
  }, [refreshBroker, loadConversations, loadMessages, refreshPersonalLanding])

  const scrollChatToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const streamingTailRevision = useMemo(() => {
    const tail = messages[messages.length - 1]
    if (!tail || tail.status !== 'streaming') return ''
    const live = liveDelta[tail.id] ?? ''
    const wf = liveWorkflow[tail.id]
    return `${tail.id}:${tail.content.length}:${live.length}:${wf?.length ?? 0}`
  }, [messages, liveDelta, liveWorkflow])

  /** True when the agent is actively working on this conversation (a streaming assistant message). */
  const agentActive = useMemo(
    () => messages.some((m) => m.role === 'assistant' && m.status === 'streaming'),
    [messages],
  )

    useEffect(() => {
    if (!authenticated) return
    void (async () => {
      await loadWorkspaces()
      await refreshBroker()
      await refreshPersonalLanding()
    })()
  }, [authenticated, loadWorkspaces, refreshBroker, refreshPersonalLanding])

  useEffect(() => {
    if (!authenticated || !workspaceId) return
    void loadConversations(workspaceId)
  }, [authenticated, workspaceId, loadConversations])

  useEffect(() => {
    if (!authenticated || !activeId) return
    void loadMessages(activeId)
  }, [authenticated, activeId, loadMessages])

    useEffect(() => {
    pendingConvScrollRef.current = true
    prevMessagesLenRef.current = 0
    stickToBottomRef.current = true
    setMessageQueue([])
    flushQueueLockRef.current = false
    prevAgentActiveRef.current = false
  }, [activeId])

  useEffect(() => {
    if (!authenticated) return
    return connectEvents({
      onReconnect: () => {
        void resyncFromServer()
      },
      onRefresh: (payload) => {
                if (
          payload.kind === 'messages' ||
          payload.kind === 'turnFinished' ||
          payload.kind === 'turnStarted' ||
          payload.kind === 'conversationRenamed' ||
          payload.kind === 'conversationDeleted'
        ) {
          if (workspaceId) void loadConversations(workspaceId)
          if (activeId && payload.conversationId === activeId && payload.kind !== 'conversationDeleted') {
            void loadMessages(activeId)
          }
                    if (payload.kind === 'turnFinished' && payload.conversationId !== activeId) {
            void refreshPersonalLanding()
            setUnreadIds((prev) => {
              if (prev.has(payload.conversationId)) return prev
              const next = new Set(prev)
              next.add(payload.conversationId)
              return next
            })
          }
          if (payload.kind === 'conversationDeleted') {
            if (payload.conversationId === activeId) {
              setActiveId(null)
              setMessages([])
              setLiveDelta({})
              setLiveWorkflow({})
            }
            setUnreadIds((prev) => {
              if (!prev.has(payload.conversationId)) return prev
              const next = new Set(prev)
              next.delete(payload.conversationId)
              return next
            })
            setRunningIds((prev) => {
              if (!prev.has(payload.conversationId)) return prev
              const next = new Set(prev)
              next.delete(payload.conversationId)
              return next
            })
          }
        }
      },
      onStream: (payload) => {
        if (payload.conversationId !== activeId) return
        setLiveDelta((prev) => ({
          ...prev,
          [payload.messageId]: (prev[payload.messageId] ?? '') + payload.delta,
        }))
      },
      onTool: (payload) => {
        if (payload.conversationId !== activeId) return
        setLiveWorkflow((prev) => ({
          ...prev,
          [payload.messageId]: [...(prev[payload.messageId] ?? []), { ts: payload.ts, event: payload.event }],
        }))
      },
      onBrokerStatus: (payload) => {
        const status = typeof payload.status === 'string' ? payload.status : ''
        if (status === 'ready') {
          setBrokerReady(true)
          setBrokerHint(null)
        } else if (status === 'starting') {
          setBrokerReady(false)
          setBrokerHint('Broker starting on desktop…')
        }
      },
    })
  }, [authenticated, activeId, workspaceId, loadConversations, loadMessages, resyncFromServer, refreshPersonalLanding])

  useEffect(() => {
    if (!authenticated) return
    let lastResyncAt = 0
    const resyncIfVisible = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastResyncAt < 400) return
      lastResyncAt = now
      void resyncFromServer()
    }
    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) resyncIfVisible()
    }
    document.addEventListener('visibilitychange', resyncIfVisible)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', resyncIfVisible)
    return () => {
      document.removeEventListener('visibilitychange', resyncIfVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', resyncIfVisible)
    }
  }, [authenticated, resyncFromServer])

  useLayoutEffect(() => {
    if (!activeId || messages.length === 0) return

    if (pendingConvScrollRef.current) {
      scrollChatToBottom()
      stickToBottomRef.current = true
      pendingConvScrollRef.current = false
      prevMessagesLenRef.current = messages.length
      return
    }

    const prev = prevMessagesLenRef.current
    if (messages.length > prev && stickToBottomRef.current) {
      scrollChatToBottom()
    }
    prevMessagesLenRef.current = messages.length
  }, [messages.length, activeId, scrollChatToBottom])

  useLayoutEffect(() => {
    if (!activeId || !stickToBottomRef.current) return
    if (!streamingTailRevision) return
    scrollChatToBottom()
  }, [streamingTailRevision, activeId, scrollChatToBottom])

  const handleLogin = async (user: string, pass: string) => {
    setAuthError(null)
    try {
      const result = await login(user, pass)
      setAuthenticated(true)
      setUsername(result.username)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAuthError(msg === 'invalid_credentials' || msg === 'unauthorized' ? 'Wrong username or password.' : msg)
      setAuthenticated(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    setAuthenticated(false)
    setUsername(null)
    setActiveId(null)
    setMessages([])
    setConversations([])
  }

  const handleWorkspaceChange = async (nextId: string) => {
    if (!nextId || nextId === workspaceId) return
    setWorkspaceId(nextId)
    setActiveId(null)
    setMessages([])
    try {
      await setActiveWorkspace(nextId)
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleNewChat = async () => {
    if (!workspaceId) return
    setBusy(true)
    try {
      const reuseId = await findLatestEmptyConversation(workspaceId)
      if (reuseId) {
        await loadConversations(workspaceId)
        setActiveId(reuseId)
        return
      }
      const conv = await createConversation('', workspaceId)
      await loadConversations(workspaceId)
      setActiveId(conv.id)
    } finally {
      setBusy(false)
    }
  }

  const handleSend = async () => {
    if (!activeId) return
    const trimmed = composer.trim()
    if ((!trimmed && chatAttachments.length === 0) || busy) return
    const restoreAttachments = [...chatAttachments]
    const text = formatUserMessageWithAttachments(trimmed, restoreAttachments)
    setComposer('')
    setChatAttachments([])
    setBusy(true)
    try {
      const result = await sendMessage(
        activeId,
        text,
        restoreAttachments.length > 0 ? restoreAttachments : undefined,
      )
      if (result.error) setAuthError(result.error)
      await loadMessages(activeId)
      if (workspaceId) await loadConversations(workspaceId)
    } catch (e) {
      setComposer(trimmed)
      setChatAttachments(restoreAttachments)
      setAuthError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleSendNow = async () => {
    if (!activeId) return
    const trimmed = composer.trim()
    if ((!trimmed && chatAttachments.length === 0) || busy) return
    const restoreAttachments = [...chatAttachments]
    const text = formatUserMessageWithAttachments(trimmed, restoreAttachments)
    setComposer('')
    setChatAttachments([])
    setBusy(true)
    try {
      const result = await steerTurn(
        activeId,
        text,
        restoreAttachments.length > 0 ? restoreAttachments : undefined,
      )
      if (!result.ok && result.error) setAuthError(result.error)
      await loadMessages(activeId)
    } catch (e) {
      setComposer(trimmed)
      setChatAttachments(restoreAttachments)
      setAuthError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files?.length || attachBusy) return
    setAttachBusy(true)
    setAuthError(null)
    try {
      const uploaded: ChatAttachment[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files.item(i)
        if (!file) continue
        uploaded.push(await uploadAttachment(file))
      }
      if (uploaded.length > 0) {
        setChatAttachments((prev) => [...prev, ...uploaded])
      }
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    } finally {
      setAttachBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

    const handleAbort = async () => {
    if (!activeId) return
    await abortTurn(activeId)
    await loadMessages(activeId)
  }

  /** Hold a follow-up locally (desktop "queue") — delivered when the active turn ends. */
  const handleQueue = () => {
    const trimmed = composer.trim()
    if ((!trimmed && chatAttachments.length === 0) || busy) return
    const text = formatUserMessageWithAttachments(trimmed, [...chatAttachments])
    setMessageQueue((q) => [...q, { id: newQueueId(), text, attachments: [...chatAttachments] }])
    setComposer('')
    setChatAttachments([])
  }

  /** Send a queued item immediately, interrupting the active turn (desktop "steer queued"). */
  const handleQueueSteerNow = (item: QueuedMessage) => {
    if (!activeId) return
    setMessageQueue((q) => q.filter((x) => x.id !== item.id))
    void steerTurn(activeId, item.text, item.attachments.length ? item.attachments : undefined)
      .then((r) => {
        if (!r.ok) setMessageQueue((q) => [{ ...item }, ...q])
        else {
          void loadMessages(activeId)
          if (workspaceId) void loadConversations(workspaceId)
        }
      })
  }

  const handleQueueRemove = (item: QueuedMessage) => {
    setMessageQueue((q) => q.filter((x) => x.id !== item.id))
  }

  // Deliver the first queued follow-up when the active turn ends (true → false).
  useEffect(() => {
    const wasActive = prevAgentActiveRef.current
    prevAgentActiveRef.current = agentActive
    if (!wasActive || agentActive || !activeId || flushQueueLockRef.current) return
    setMessageQueue((q) => {
      if (q.length === 0) return q
      const item = q[0]
      flushQueueLockRef.current = true
      void deliverQueued(activeId, item.text, item.attachments.length ? item.attachments : undefined)
        .then((r) => {
          if (!r.ok) {
            setMessageQueue((prev) => [item, ...prev])
          } else {
            void loadMessages(activeId)
            if (workspaceId) void loadConversations(workspaceId)
          }
        })
        .finally(() => {
          flushQueueLockRef.current = false
        })
      return q.slice(1)
    })
  }, [agentActive, activeId, loadMessages, loadConversations, workspaceId])

  const openConversation = useCallback((id: string) => {
    setActiveId(id)
    setUnreadIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const handleRenameSubmit = async (id: string) => {
    const title = renameDraft.trim()
    setRenamingId(null)
    if (!title) return
    try {
      await renameConversation(id, title)
      if (workspaceId) await loadConversations(workspaceId, { silent: true })
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      const r = await deleteConversation(target.id)
      if (!r.ok) {
        setAuthError('Could not delete chat.')
        return
      }
      if (activeId === target.id) {
        setActiveId(null)
        setMessages([])
      }
      setUnreadIds((prev) => {
        if (!prev.has(target.id)) return prev
        const next = new Set(prev)
        next.delete(target.id)
        return next
      })
      if (workspaceId) await loadConversations(workspaceId, { silent: true })
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    }
  }

  if (authenticated === null) {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 items-center p-6 text-sm text-text-secondary">Loading…</div>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
        <LoginScreen onLogin={handleLogin} error={authError} />
      </div>
    )
  }

  const activeWorkspaceName =
    workspaces.find((w) => w.id === workspaceId)?.name ?? 'Workspace'

    const pluginTab = pluginTabs.find((t) => t.id === companionTab)
    if (pluginTab) {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
        <InstallHintBanner />
        <div className="flex min-h-0 flex-1 flex-col">
          <iframe
            key={companionTab}
            src={`${personalManifest!.appBase}?tab=${companionTab}`}
            title={pluginTab.label}
            className="min-h-0 w-full flex-1 border-0 bg-bg-primary"
          />
        </div>
        {showTabBar ?
          <BottomTabBar
            active={companionTab}
            onChange={(tab) => {
              setCompanionTab(tab)
            }}
            pluginTabs={pluginTabs}
          />
        : null}
      </div>
    )
  }

  if (companionTab === 'system') {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
        <InstallHintBanner />
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <h1 className="m-0 text-lg font-semibold">System</h1>
                    <div className="rounded-lg border border-border bg-bg-secondary p-4">
            <h2 className="m-0 mb-1 text-base font-semibold">Rebuild &amp; restart</h2>
            <p className="m-0 mb-3 text-sm text-text-secondary">
              Restarts Sylo and <strong>applies your code changes</strong> — runs the build
              (npm install + prepare:dev) so companion, broker, and skill-surface edits load.
              Takes ~1–2 min. If it doesn&apos;t come back healthy in 5 min, the changes are
              automatically reverted and you get an ntfy notification with the error.
            </p>
            <button
              type="button"
              className="w-full rounded-lg bg-accent py-3 font-medium text-bg-primary disabled:opacity-40"
              disabled={rebuildBusy}
              onClick={() => {
                if (
                  !window.confirm(
                    'Rebuild + restart Sylo now?\nThis runs the build (~1–2 min). If it fails to come back in 5 min, your changes are auto-reverted and you get an ntfy notification.',
                  )
                )
                  return
                setRebuildBusy(true)
                setRebuildStatus(null)
                void rebuildSylo()
                  .then(() => setRebuildStatus('Rebuild requested. Sylo will rebuild + restart (~1–2 min); you may lose this connection. Watch the ntfy app for the result.'))
                  .catch((e) => setRebuildStatus(`Request failed: ${e instanceof Error ? e.message : String(e)}`))
                  .finally(() => setRebuildBusy(false))
              }}
            >
              {rebuildBusy ? 'Requesting…' : 'Rebuild & restart'}
            </button>
            {rebuildStatus ?
              <p className={`m-0 mt-3 text-sm ${rebuildStatus.startsWith('Request failed') ? 'text-danger' : 'text-text-secondary'}`}>
                {rebuildStatus}
              </p>
            : null}
          </div>

          <div className="rounded-lg border border-border bg-bg-secondary p-4">
            <h2 className="m-0 mb-1 text-base font-semibold">Restart Sylo (no rebuild)</h2>
            <p className="m-0 mb-3 text-sm text-text-secondary">
              Fast restart of the <em>current build</em> — use this when Sylo is hung or dead and
              you just want it back. Does not apply code changes. Same 5-min auto-revert safety net.
            </p>
            <p className="m-0 mb-3 text-xs text-text-secondary">
              Tip: if the companion is unreachable, open the ntfy app and publish
              <code className="rounded bg-bg-tertiary px-1">restart</code> (or
              <code className="rounded bg-bg-tertiary px-1">rebuild</code>) to topic{' '}
              <code className="rounded bg-bg-tertiary px-1">sylo-&lt;node&gt;-control</code>.
            </p>
            <button
              type="button"
              className="w-full rounded-lg bg-bg-tertiary py-3 font-medium text-text-primary disabled:opacity-40"
              disabled={restartBusy}
              onClick={() => {
                if (
                  !window.confirm(
                    'Restart Sylo on the desktop now (no rebuild)?\nIf it fails to come back in 5 min, recent changes are auto-reverted and you get an ntfy notification.',
                  )
                )
                  return
                setRestartBusy(true)
                setRestartStatus(null)
                void restartSylo()
                  .then(() => setRestartStatus('Restart requested. Sylo will restart shortly; you may lose this connection. Watch the ntfy app for the result.'))
                  .catch((e) => setRestartStatus(`Request failed: ${e instanceof Error ? e.message : String(e)}`))
                  .finally(() => setRestartBusy(false))
              }}
            >
              {restartBusy ? 'Requesting…' : 'Restart Sylo'}
            </button>
            {restartStatus ?
              <p className={`m-0 mt-3 text-sm ${restartStatus.startsWith('Request failed') ? 'text-danger' : 'text-text-secondary'}`}>
                {restartStatus}
              </p>
            : null}
          </div>
        </div>
        {showTabBar ?
          <BottomTabBar
            active={companionTab}
            onChange={(tab) => {
              setCompanionTab(tab)
            }}
            pluginTabs={pluginTabs}
          />
        : null}
      </div>
    )
  }

    const showPersonalLanding =
    !activeId && companionTab === 'chat' && !showChatsList && (landingEntries?.length ?? 0) > 0

  if (showPersonalLanding) {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
        <InstallHintBanner />
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-secondary px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-semibold">{personalManifest!.landing.title}</h1>
            <p className="m-0 truncate text-xs text-text-secondary">
              {landingEntries!.length === 1 ? landingEntries![0]?.title || personalManifest!.landing.singleLabel : `${landingEntries!.length} ${personalManifest!.landing.countNoun}`}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary"
            onClick={() => setShowChatsList(true)}
          >
            Chats
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <iframe
            key="chat-landing-personal"
            src={`${personalManifest!.appBase}?tab=${personalManifest!.tabs[0]?.id ?? ''}`}
            title={personalManifest!.landing.title}
            className="min-h-0 w-full flex-1 border-0 bg-bg-primary"
          />
        </div>
        {showTabBar ?
          <BottomTabBar
            active={companionTab}
            onChange={(tab) => {
              setCompanionTab(tab)
            }}
            pluginTabs={pluginTabs}
          />
        : null}
      </div>
    )
  }

  if (!activeId) {
    return (
      <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
        <InstallHintBanner />
        <header className="shrink-0 border-b border-border bg-bg-secondary px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-lg font-semibold">Chats</h1>
              <p className="m-0 text-xs text-text-secondary">
                {username ? `Signed in as ${username}` : 'Signed in'}
                {' · '}
                {brokerReady ? 'Desktop broker ready' : (brokerHint ?? 'Waiting for desktop broker')}
              </p>
            </div>
            {(landingEntries?.length ?? 0) > 0 ? (
              <button
                type="button"
                className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-accent"
                onClick={() => setShowChatsList(false)}
              >
                ← {personalManifest!.landing.title}
              </button>
            ) : null}
            <button type="button" className="shrink-0 text-sm text-text-secondary" onClick={() => void handleLogout()}>
              Log out
            </button>
          </div>
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-xs text-text-secondary">Workspace</span>
            <select
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2.5 text-base text-text-primary outline-none focus:border-accent"
              value={workspaceId}
              disabled={workspaces.length === 0}
              onChange={(e) => void handleWorkspaceChange(e.target.value)}
            >
              {workspaces.length === 0 ?
                <option value="">No workspaces</option>
              : workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))
              }
            </select>
          </label>
        </header>
        {authError === 'unauthorized' ?
          <div className="p-4 text-sm text-danger">
            Session expired. Log in again.
            <button type="button" className="ml-2 underline" onClick={() => void handleLogout()}>
              Log out
            </button>
          </div>
        : authError ?
          <div className="p-4 text-sm text-danger">{authError}</div>
        : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          {loadingList ?
            <p className="p-4 text-sm text-text-secondary">Loading…</p>
          : conversations.length === 0 ?
            <p className="p-4 text-sm text-text-secondary">No chats in {activeWorkspaceName}.</p>
                    : conversations.map((c) => {
            const status = convStatusDot({ running: runningIds.has(c.id), unread: unreadIds.has(c.id) })
            const renaming = renamingId === c.id
            return (
              <div
                key={c.id}
                className="flex items-center gap-2 border-b border-border px-3 py-2.5 active:bg-bg-tertiary"
              >
                <ConvStatusIndicator status={status} />
                {renaming ? (
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded-md border border-accent bg-bg-primary px-2 py-1 text-sm text-text-primary outline-none"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRenameSubmit(c.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => void handleRenameSubmit(c.id)}
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openConversation(c.id)}
                  >
                    <span className="block truncate font-medium">{c.title || 'Untitled chat'}</span>
                  </button>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-text-secondary active:bg-bg-tertiary"
                    aria-label={`Rename ${c.title || 'chat'}`}
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenamingId(c.id)
                      setRenameDraft(c.title || '')
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-text-secondary active:bg-bg-tertiary"
                    aria-label={`Delete ${c.title || 'chat'}`}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(c)
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })
          }
        </div>
        <footer className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            className="w-full rounded-lg bg-accent py-3 font-medium text-bg-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => void handleNewChat()}
          >
            New chat
          </button>
        </footer>
                {showTabBar ?
          <BottomTabBar active={companionTab} onChange={setCompanionTab} pluginTabs={pluginTabs} />
        : null}
        {deleteTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-secondary p-5">
              <h2 className="m-0 text-base font-semibold">Delete chat?</h2>
              <p className="mt-2 text-sm text-text-secondary">
                "{deleteTarget.title || 'Untitled chat'}" and all its messages will be permanently deleted.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 text-sm text-text-secondary"
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white"
                  onClick={() => void handleDelete()}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
      <InstallHintBanner />
      <header className="shrink-0 flex items-center gap-2 border-b border-border bg-bg-secondary px-2 py-2">
        <button
          type="button"
          className="rounded-lg px-3 py-2 text-sm text-accent"
          onClick={() => {
            setActiveId(null)
            setMessages([])
          }}
        >
          ← Chats
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{activeConversation?.title || 'Chat'}</h1>
          <p className="truncate text-xs text-text-secondary">{activeWorkspaceName}</p>
          {!brokerReady && brokerHint ?
            <p className="truncate text-xs text-danger">{brokerHint}</p>
          : null}
        </div>
        <button type="button" className="rounded-lg px-2 py-2 text-sm text-text-secondary" onClick={() => void handleAbort()}>
          Stop
        </button>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-3 py-4 touch-pan-y"
        onScroll={() => {
          const el = scrollRef.current
          if (!el) return
          stickToBottomRef.current = isChatAreaNearBottom(el)
        }}
      >
        {messages.map((m) => (
          <ChatConversationMessageRow
            key={m.id}
            m={m}
            liveDeltaForId={liveDelta[m.id] ?? ''}
            liveWorkflowForMessage={liveWorkflow[m.id] ?? []}
            segmentOverrides={segmentOverrides}
            onSegmentToggle={(key, next) =>
              setSegmentOverrides((prev) => ({ ...prev, [key]: next }))
            }
            localImageUrl={companionLocalImageUrl}
          />
        ))}
      </div>

      <footer className="shrink-0 border-t border-border bg-bg-secondary p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {activeId ? (
          <div className="mb-2">
            <CompanionModelBar
              conversation={activeConversation ?? undefined}
              brokerReady={brokerReady}
              onChanged={() => { if (workspaceId) void loadConversations(workspaceId, { silent: true }) }}
            />
          </div>
        ) : null}
        {chatAttachments.length > 0 ?
          <div className="mb-2 flex flex-wrap gap-2">
            {chatAttachments.map((a) => (
              <span
                key={a.path}
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary"
                title={a.name}
              >
                <AttachmentImageThumb
                  path={a.path}
                  name={a.name}
                  className="size-10"
                  fallbackClassName="text-accent/75"
                  resolveImageUrl={companionLocalImageUrl}
                />
                <span className="max-w-[9rem] truncate">{a.name}</span>
                <button
                  type="button"
                  className="rounded px-1 text-text-secondary"
                  aria-label={`Remove ${a.name}`}
                  onClick={() =>
                    setChatAttachments((prev) => prev.filter((x) => x.path !== a.path))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        : null}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept="image/*,application/pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx"
          onChange={(e) => void handleAttachFiles(e.target.files)}
        />
                {messageQueue.length > 0 ? (
          <div className="mb-2 flex flex-col gap-1.5" aria-label="Queued follow-ups">
            {messageQueue.map((item, i) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-bg-tertiary px-2 py-1.5 text-xs"
              >
                <span className="shrink-0 text-text-secondary" title="Queued — sends after the current turn">
                  ⏳ {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-primary">
                  {item.text ||
                    (item.attachments.length
                      ? `${item.attachments.length} attachment${item.attachments.length > 1 ? 's' : ''}`
                      : 'Queued')}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-text-secondary active:bg-bg-primary"
                  aria-label={`Send queued message ${i + 1} now`}
                  title="Send now (interrupt)"
                  onClick={() => handleQueueSteerNow(item)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-text-secondary active:bg-bg-primary"
                  aria-label={`Remove queued message ${i + 1}`}
                  title="Remove"
                  onClick={() => handleQueueRemove(item)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-bg-primary text-text-secondary disabled:opacity-40"
            disabled={busy || attachBusy}
            aria-label="Attach file or photo"
            title="Attach file or photo"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
                    <textarea
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-bg-primary px-3 py-2 text-base text-text-primary outline-none focus:border-accent"
            rows={1}
            placeholder={agentActive ? 'Send now - interrupts the current tool...' : 'Message Sylo...'}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void (agentActive ? handleSendNow() : handleSend())
              }
            }}
          />
          {agentActive ? (
            <button
              type="button"
              className="rounded-xl border border-border bg-bg-primary px-3 py-2 font-medium text-text-secondary disabled:opacity-40"
              disabled={busy || attachBusy || (!composer.trim() && chatAttachments.length === 0)}
                              onClick={handleQueue}
              title="Queue this message to run after the current turn finishes"
            >
              Queue
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-xl bg-accent px-4 py-2 font-medium text-bg-primary disabled:opacity-40"
            disabled={busy || attachBusy || (!composer.trim() && chatAttachments.length === 0)}
            onClick={() => void (agentActive ? handleSendNow() : handleSend())}
            title={agentActive ? 'Send now - interrupt after the current tool' : 'Send message'}
          >
            {agentActive ? 'Send now' : 'Send'}
          </button>
        </div>
      </footer>
    </div>
  )
}
