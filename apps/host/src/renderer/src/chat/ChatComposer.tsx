import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { AttachmentImageThumb } from '../AttachmentImageThumb'
import {
  formatUserMessageWithAttachments,
  firstClipboardImageFile,
  isImageAttachmentPath,
  resolveImageAttachmentFromFile,
} from '../chatUserAttachments'
import { cn } from '../lib/cn'
import {
  chatAttachmentChip,
  chatAttachmentChipGlyph,
  chatAttachmentChipImage,
  chatAttachmentChipName,
  chatAttachmentChipRemove,
  chatAttachmentStrip,
  chatComposer,
  chatComposerDrag,
  chatInputRow,
  chatInputSendBtn,
  chatInputTextarea,
  chatQueueIndex,
  chatQueueItem,
  chatQueueItemDragging,
  chatQueueRemove,
  chatQueueSendNow,
  chatQueueStrip,
  chatQueueText,
} from '../panels/ui-classes'

export type QueuedComposerMessage = {
  id: string
  text: string
  attachments?: { path: string; name: string }[]
}

export type ChatComposerHandle = {
  prefill: (text: string) => void
  focus: () => void
}

type ChatComposerProps = {
  activeId: string | undefined
  safeMode: boolean
  agentReady: boolean
  activeSending: boolean
  /** When set, blocks queue/steer while think tank (or similar) runs. */
  inputLocked?: boolean
  inputLockedHint?: string
  /** When set (debate phase), Send queues operator context for the Moderator instead of chat. */
  onThinkTankInject?: (text: string) => Promise<boolean>
  onSendingStarted: () => void
  onRefreshMessages: () => void
  onDeliverQueued: (text: string, attachments?: { path: string; name: string }[]) => Promise<boolean>
}

function newQueueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * In-memory per-conversation composer drafts. Lives at MODULE scope (not a
 * `useRef`) so it survives ChatComposer unmount/remount when the operator
 * switches to a non-chat tab (e.g. the Tasks dashboard) and back — the
 * textarea state and any component-scoped ref would otherwise be destroyed.
 * Does NOT survive a Sylo restart (process exit clears module state). The
 * message *queue* is deliberately NOT persisted here (it's a committed action,
 * not a draft).
 */
const composerDrafts = new Map<
  string,
  { input: string; attachments: { path: string; name: string }[] }
>()

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  {
    activeId,
    safeMode,
    agentReady,
    activeSending,
    inputLocked = false,
    inputLockedHint,
    onThinkTankInject,
    onSendingStarted,
    onRefreshMessages,
    onDeliverQueued,
  },
  ref,
) {
  const [input, setInput] = useState('')
  const [chatAttachments, setChatAttachments] = useState<{ path: string; name: string }[]>([])
  const [messageQueue, setMessageQueue] = useState<QueuedComposerMessage[]>([])
  const [queueDragId, setQueueDragId] = useState<string | null>(null)
  const [composerDragOver, setComposerDragOver] = useState(false)
  const composerBusyRef = useRef(false)
  const [composerBusy, setComposerBusy] = useState(false)
  const prevSendingRef = useRef(false)
  const flushQueueLockRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    prefill: (text: string) => {
      setInput(text)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    focus: () => {
      textareaRef.current?.focus()
    },
  }))

    // Per-conversation draft persistence. Typed-but-unsent text + staged
  // attachments are stashed in the module-scoped `composerDrafts` map so they
  // survive BOTH conversation switches (staying on the chat tab) AND tab
  // switches that unmount this composer (e.g. chat → Tasks → chat). The map is
  // in-memory only — drafts do not survive a Sylo restart. The message *queue*
  // is deliberately still reset on switch (it's a committed action, not a
  // draft).
  const prevActiveIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = prevActiveIdRef.current
    if (prev === activeId) return
    // Save the draft for the conversation we're leaving (state hasn't
    // switched yet, so `input`/`chatAttachments` are still the old conv's).
    if (prev) composerDrafts.set(prev, { input, attachments: chatAttachments })
    prevActiveIdRef.current = activeId
    // Restore the draft for the conversation we're entering. Also runs on
    // mount, so a remount after a tab switch rehydrates the saved draft
    // instead of showing an empty textarea.
    const d = activeId ? composerDrafts.get(activeId) : undefined
    setInput(d?.input ?? '')
    setChatAttachments(d?.attachments ?? [])
    setMessageQueue([])
    setQueueDragId(null)
  }, [activeId, input, chatAttachments])

  // Tab switches to a non-chat tab unmount this composer WITHOUT changing
  // `activeId`, so the effect above never runs its save branch and the textarea
  // state would be lost. Keep a fresh snapshot of the current draft and stash
  // it on unmount so the remount restores it.
  const latestDraftRef = useRef({ activeId, input, chatAttachments })
  useEffect(() => {
    latestDraftRef.current = { activeId, input, chatAttachments }
  })
  useEffect(() => {
    return () => {
      const { activeId: aid, input: inp, chatAttachments: att } = latestDraftRef.current
      if (aid) composerDrafts.set(aid, { input: inp, attachments: att })
    }
  }, [])


  useEffect(() => {
    if (prevSendingRef.current && !activeSending && activeId && !flushQueueLockRef.current) {
      setMessageQueue((q) => {
        if (q.length === 0) return q
        flushQueueLockRef.current = true
        const item = q[0]
        void onDeliverQueued(item.text, item.attachments)
          .then((ok) => {
            if (!ok) {
              setMessageQueue((prev) => [item, ...prev])
            }
          })
          .finally(() => {
            flushQueueLockRef.current = false
          })
        return q.slice(1)
      })
    }
    prevSendingRef.current = activeSending
  }, [activeSending, activeId, onDeliverQueued])

  const reorderMessageQueue = useCallback((fromId: string, toId: string) => {
    setMessageQueue((q) => {
      const fromIdx = q.findIndex((x) => x.id === fromId)
      const toIdx = q.findIndex((x) => x.id === toId)
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return q
      const next = [...q]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  const submitComposer = useCallback(
    async (mode: 'send' | 'queue' | 'steer') => {
      if (!activeId || safeMode || !agentReady || inputLocked) return
      const trimmed = input.trim()
      if (!trimmed && chatAttachments.length === 0) return

      if (onThinkTankInject && trimmed && chatAttachments.length === 0 && mode !== 'steer') {
        setInput('')
        setChatAttachments([])
        composerBusyRef.current = true
        setComposerBusy(true)
        try {
          const ok = await onThinkTankInject(trimmed)
          if (!ok) {
            setInput(trimmed)
          }
        } finally {
          composerBusyRef.current = false
          setComposerBusy(false)
        }
        return
      }

      const restoreAttachments = [...chatAttachments]
      const text = formatUserMessageWithAttachments(trimmed, restoreAttachments)
      const attachmentsForPi = restoreAttachments.length > 0 ? restoreAttachments : undefined

      if (mode === 'queue' && activeSending) {
        setMessageQueue((q) => [
          ...q,
          { id: newQueueId(), text, attachments: attachmentsForPi },
        ])
        setInput('')
        setChatAttachments([])
        return
      }

      if (activeSending && mode === 'send') return
      if (composerBusyRef.current) return

      composerBusyRef.current = true
      setComposerBusy(true)

      if (mode === 'steer' && activeSending) {
        setInput('')
        setChatAttachments([])
        try {
          const r = await window.sylo.chat.steer(activeId, text, attachmentsForPi)
          if (!r.ok) {
            setInput(trimmed)
            setChatAttachments(restoreAttachments)
          }
        } catch {
          setInput(trimmed)
          setChatAttachments(restoreAttachments)
        } finally {
          composerBusyRef.current = false
          setComposerBusy(false)
        }
        return
      }

      setInput('')
      setChatAttachments([])
      try {
        const r = await window.sylo.chat.send(activeId, text, attachmentsForPi)
        if (r.error) {
          setInput(trimmed)
          setChatAttachments(restoreAttachments)
          onRefreshMessages()
          return
        }
        if (r.deferred) {
          onRefreshMessages()
          return
        }
        onSendingStarted()
        onRefreshMessages()
      } catch {
        setInput(trimmed)
        setChatAttachments(restoreAttachments)
        onRefreshMessages()
      } finally {
        composerBusyRef.current = false
        setComposerBusy(false)
      }
    },
    [
      activeId,
      safeMode,
      agentReady,
      inputLocked,
      onThinkTankInject,
      input,
      chatAttachments,
      activeSending,
      onSendingStarted,
      onRefreshMessages,
    ],
  )

  const steerQueuedMessage = useCallback(
    async (item: QueuedComposerMessage) => {
      if (!activeId || safeMode || !agentReady) return
      setMessageQueue((q) => q.filter((x) => x.id !== item.id))
      try {
        const r = await window.sylo.chat.steer(activeId, item.text, item.attachments)
        if (!r.ok) {
          setMessageQueue((q) => [...q, item])
        }
      } catch {
        setMessageQueue((q) => [...q, item])
      }
    },
    [activeId, safeMode, agentReady],
  )

  const send = useCallback(async () => {
    await submitComposer(activeSending ? 'queue' : 'send')
  }, [submitComposer, activeSending])

  const handleComposerPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (safeMode || !activeId) return
      const file = firstClipboardImageFile(e.clipboardData)
      if (!file) return
      e.preventDefault()
      try {
        const { path, name } = await resolveImageAttachmentFromFile(file, {
          pathFromWebFile: (f) => window.sylo.files.pathFromWebFile(f),
          writePastedImage: (data, mimeType) => window.sylo.chat.writePastedImage(data, mimeType),
        })
        if (!path.trim()) return
        setChatAttachments((prev) => {
          const seen = new Set(prev.map((a) => a.path.toLowerCase()))
          const key = path.toLowerCase()
          if (seen.has(key)) return prev
          return [...prev, { path, name }]
        })
      } catch {
        /* invalid or empty image payload */
      }
    },
    [safeMode, activeId],
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setComposerDragOver(false)
      if (safeMode || !activeId) return
      const list = Array.from(e.dataTransfer.files ?? [])
      if (list.length === 0) return
      const added: { path: string; name: string }[] = []
      for (const f of list) {
        try {
          let path = ''
          try {
            path = window.sylo.files.pathFromWebFile(f).trim()
          } catch {
            /* in-memory file */
          }
          if (path) {
            added.push({ path, name: f.name || path.replace(/^.*[/\\]/, '') || 'file' })
            continue
          }
          if (f.type.startsWith('image/')) {
            const resolved = await resolveImageAttachmentFromFile(f, {
              pathFromWebFile: (file) => window.sylo.files.pathFromWebFile(file),
              writePastedImage: (data, mimeType) =>
                window.sylo.chat.writePastedImage(data, mimeType),
            })
            if (resolved.path.trim()) added.push(resolved)
          }
        } catch {
          /* non-local or unreadable file */
        }
      }
      if (added.length === 0) return
      setChatAttachments((prev) => {
        const next = [...prev]
        const seen = new Set(next.map((a) => a.path.toLowerCase()))
        for (const a of added) {
          const key = a.path.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          next.push(a)
        }
        return next
      })
    },
    [safeMode, activeId],
  )

  return (
    <div
      className={cn(chatComposer, composerDragOver && chatComposerDrag)}
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!safeMode && activeId) setComposerDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!safeMode && activeId) setComposerDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setComposerDragOver(false)
        }
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      {messageQueue.length > 0 ?
        <div className={chatQueueStrip} aria-label="Queued follow-ups">
          {messageQueue.map((item, index) => (
            <div
              key={item.id}
              className={cn(chatQueueItem, queueDragId === item.id && chatQueueItemDragging)}
              draggable={!safeMode}
              onDragStart={() => setQueueDragId(item.id)}
              onDragEnd={() => setQueueDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (queueDragId && queueDragId !== item.id) {
                  reorderMessageQueue(queueDragId, item.id)
                }
                setQueueDragId(null)
              }}
            >
              <span className={chatQueueIndex} aria-hidden="true">
                {index + 1}
              </span>
              <span className={chatQueueText} title={item.text}>
                {item.text}
              </span>
              <button
                type="button"
                className={chatQueueSendNow}
                title="Send now — interrupt after the current tool (Ctrl+Enter)"
                aria-label={`Send queued message ${index + 1} now`}
                disabled={safeMode || !agentReady}
                onClick={() => void steerQueuedMessage(item)}
              >
                Now
              </button>
              <button
                type="button"
                className={chatQueueRemove}
                aria-label={`Remove queued message ${index + 1}`}
                onClick={() => setMessageQueue((q) => q.filter((x) => x.id !== item.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      : null}
      {chatAttachments.length > 0 ?
        <div className={chatAttachmentStrip}>
          {chatAttachments.map((a) => (
            <span
              key={a.path}
              className={cn(
                chatAttachmentChip,
                isImageAttachmentPath(a.name, a.path) && chatAttachmentChipImage,
              )}
              title={a.path}
            >
              <AttachmentImageThumb
                path={a.path}
                name={a.name}
                className="size-10"
                fallbackClassName={chatAttachmentChipGlyph}
              />
              <span className={chatAttachmentChipName}>{a.name}</span>
              <button
                type="button"
                className={chatAttachmentChipRemove}
                aria-label={`Remove ${a.name}`}
                onClick={() => setChatAttachments((prev) => prev.filter((x) => x.path !== a.path))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      : null}
      <div className={chatInputRow}>
        <textarea
          ref={textareaRef}
          className={chatInputTextarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => void handleComposerPaste(e)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              const immediate = e.ctrlKey || e.metaKey
              void submitComposer(
                activeSending ?
                  immediate ? 'steer'
                  : 'queue'
                : 'send',
              )
            }
          }}
          placeholder={
            safeMode ?
              'Safe mode — messaging disabled'
            : inputLocked ?
              inputLockedHint ?? 'Think tank running — wait for the current seat to finish…'
            : onThinkTankInject ?
              'Inject context for the Moderator (queued until their next turn)…'
            : !activeId ?
              'Pick or create a conversation…'
            : !agentReady ?
              'Waiting for Pi broker…'
            : activeSending ?
              'Queue a follow-up… (Enter = queue, Ctrl+Enter = send now)'
            : 'Message… (drop files or paste images; `/mcp reconnect`, `/reload`, …)'
          }
          disabled={safeMode || (inputLocked && !onThinkTankInject)}
        />
        <button
          type="button"
          className={chatInputSendBtn}
          disabled={
            safeMode ||
            (inputLocked && !onThinkTankInject) ||
            !activeId ||
            !agentReady ||
            composerBusy ||
            (!input.trim() && chatAttachments.length === 0)
          }
          onClick={() => void send()}
        >
          {onThinkTankInject ? 'Queue inject' : activeSending ? 'Queue' : 'Send'}
        </button>
      </div>
    </div>
  )
})
