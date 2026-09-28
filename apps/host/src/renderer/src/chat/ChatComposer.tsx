import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AttachmentImageThumb } from '../AttachmentImageThumb'
import {
  formatUserMessageWithAttachments,
  firstClipboardImageFile,
  isImageAttachmentPath,
  resolveImageAttachmentFromFile,
  splitUserMessageAttachments,
} from '../chatUserAttachments'
import { registerComposerDropHandler } from './chatDropBus'
import { cn } from '../lib/cn'
import {
  applyMentionCompletion,
  mentionQueryAtCaret,
} from '../../../shared/subagent-mentions'
import {
  chatAttachmentChip,
  chatAttachmentChipGlyph,
  chatAttachmentChipImage,
  chatAttachmentChipName,
  chatAttachmentChipRemove,
  chatAttachmentPending,
  chatAttachmentStrip,
  chatComposer,
  chatComposerDrag,
  chatInputRow,
    chatInputSendBtn,
  chatInputTextarea,
  chatMentionDesc,
  chatMentionItem,
  chatMentionItemActive,
  chatMentionName,
  chatMentionPicker,
  chatQueueEdit,
  chatQueueEditBtn,
  chatQueueIndex,
  chatQueueItem,
  chatQueueItemDragging,
  chatQueueAttachBadge,
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

/**
 * A staged attachment chip. `pending` marks a drop still being resolved (no
 * local path yet) — the chip renders immediately so the operator can see the
 * drop registered, then upgrades in place to its on-disk path.
 */
export type ComposerAttachment = {
  id: string
  path: string
  name: string
  pending?: boolean
}

type SubagentPickerAgent = {
  name: string
  description: string
  source: 'builtin' | 'user' | 'project'
}

type MentionSpan = { query: string; start: number; end: number }

/** Keep the picker short enough that it never swallows the transcript. */
const MENTION_PICKER_LIMIT = 8

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
  /**
   * Fired the moment Send is dispatched (with the exact formatted prompt text)
   * so App can render an optimistic user bubble while the host prepares the
   * turn (image encode + broker acquire + session ensure) — otherwise dropped
   * files are visible nowhere during that window.
   */
  onOptimisticUserMessage?: (text: string) => void
  /** Fired when the send failed and the optimistic bubble must come down. */
  onOptimisticUserMessageFailed?: () => void
}

function newQueueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * In-memory per-conversation composer drafts. Lives at MODULE scope (not a
 * `useRef`) so it survives ChatComposer unmount/remount when the operator
 * switches to a non-chat tab (e.g. the Tasks dashboard) and back — the
 * textarea state and any component-scoped ref would otherwise be destroyed.
 * Does NOT survive a Sylo restart (process exit clears module state). Pending
 * (still-resolving) drop placeholders are filtered out when stashed — their
 * resolution promise dies with the component.
 */
const composerDrafts = new Map<
  string,
  { input: string; attachments: ComposerAttachment[] }
>()

/**
 * Per-conversation queued follow-ups, same module-scope lifetime as drafts.
 * A queued message is a committed send intent — it must survive switching to
 * another chat (or a non-chat tab) and back, not silently evaporate. Still
 * in-memory only (a restart clears it, like drafts); the auto-flush stays tied
 * to the activeSending transition while that conversation is on screen, so a
 * queue restored after its turn already finished waits for the operator
 * (Send-now / next turn) instead of surprising them.
 */
const composerQueues = new Map<string, QueuedComposerMessage[]>()

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
    onOptimisticUserMessage,
    onOptimisticUserMessageFailed,
  },
  ref,
) {
  const [input, setInput] = useState('')
  const [chatAttachments, setChatAttachments] = useState<ComposerAttachment[]>([])
  const [messageQueue, setMessageQueue] = useState<QueuedComposerMessage[]>([])
  const [queueDragId, setQueueDragId] = useState<string | null>(null)
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [composerDragOver, setComposerDragOver] = useState(false)
  const [mentionAgents, setMentionAgents] = useState<SubagentPickerAgent[]>([])
  const [mentionSpan, setMentionSpan] = useState<MentionSpan | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const composerBusyRef = useRef(false)
  const [composerBusy, setComposerBusy] = useState(false)
  const prevSendingRef = useRef(false)
  const flushQueueLockRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queueEditTextareaRef = useRef<HTMLTextAreaElement>(null)
  // Focus + autosize the inline queue editor once when editing starts — NOT in
  // a ref callback (an inline callback re-runs on every parent re-render and
  // would steal the caret back mid-typing on streaming frames).
  useEffect(() => {
    if (!editingQueueId) return
    const el = queueEditTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editingQueueId])
  /** Mirror of the queue for effects/handlers that must not read stale state. */
  const messageQueueRef = useRef<QueuedComposerMessage[]>([])
  useEffect(() => {
    messageQueueRef.current = messageQueue
  })
  /** Active inline edit of a queued item; null when not editing. Uncontrolled textarea. */
  const queueEditRef = useRef<{ id: string; text: string } | null>(null)

  // Composer grows with content: 1 line at rest, up to 4 lines, then internal
  // scroll (Cursor-style). Runs on every input change.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [input])

  useImperativeHandle(ref, () => ({
    prefill: (text: string) => {
      setInput(text)
      setMentionSpan(null)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    focus: () => {
      textareaRef.current?.focus()
    },
  }))

  // Personas available for `@mention`. Re-read per conversation because agent
  // scope (and therefore project `.pi/agents`) follows the chat's workspace.
  useEffect(() => {
    let cancelled = false
    void window.sylo.tasks
      .agents()
      .then((list) => {
        if (!cancelled) setMentionAgents(list)
      })
      .catch(() => {
        /* picker is optional — typing the full name still works */
      })
    return () => {
      cancelled = true
    }
  }, [activeId])

  const mentionMatches = useMemo(() => {
    if (!mentionSpan) return []
    const q = mentionSpan.query.toLowerCase()
    const pool = q ? mentionAgents.filter((a) => a.name.toLowerCase().includes(q)) : mentionAgents
    return [...pool]
      .sort((a, b) => {
        const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1
        return aPrefix - bPrefix || a.name.localeCompare(b.name)
      })
      .slice(0, MENTION_PICKER_LIMIT)
  }, [mentionAgents, mentionSpan])

  const mentionOpen = mentionSpan !== null && mentionMatches.length > 0 && !safeMode && !inputLocked

  const syncMentionSpan = useCallback((text: string, caret: number | null) => {
    setMentionSpan(caret == null ? null : mentionQueryAtCaret(text, caret))
    setMentionIndex(0)
  }, [])

  const acceptMention = useCallback(
    (agentName: string) => {
      if (!mentionSpan) return
      const next = applyMentionCompletion(input, mentionSpan, agentName)
      setInput(next.text)
      setMentionSpan(null)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(next.caret, next.caret)
      })
    },
    [input, mentionSpan],
  )

    // Per-conversation draft + queue persistence. Typed-but-unsent text, staged
  // attachments AND the queued follow-ups are stashed in module-scoped maps so
  // they survive BOTH conversation switches (staying on the chat tab) AND tab
  // switches that unmount this composer (e.g. chat → Tasks → chat). The maps
  // are in-memory only — nothing here survives a Sylo restart.
  const prevActiveIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = prevActiveIdRef.current
    if (prev === activeId) return
    // Save the draft for the conversation we're leaving (state hasn't
    // switched yet, so `input`/`chatAttachments`/`messageQueue` are still the
    // old conv's).
    if (prev) {
      composerDrafts.set(prev, {
        input,
        attachments: chatAttachments.filter((a) => !a.pending),
      })
      composerQueues.set(prev, messageQueueRef.current)
    }
    prevActiveIdRef.current = activeId
    // Entering a different conversation: any activeSending true→false
    // transition in flight belongs to the conversation we LEFT, not this one.
    // Without this reset, switching away from a sending chat would make the
    // flush effect fire the just-restored queue of the chat we switched TO
    // (the old always-empty reset masked this).
    prevSendingRef.current = false
    // Restore the draft for the conversation we're entering. Also runs on
    // mount, so a remount after a tab switch rehydrates the saved state
    // instead of showing an empty composer.
    const d = activeId ? composerDrafts.get(activeId) : undefined
    setInput(d?.input ?? '')
    setChatAttachments(d?.attachments ?? [])
    setMentionSpan(null)
    const q = activeId ? composerQueues.get(activeId) : undefined
    setMessageQueue(q ? [...q] : [])
    setQueueDragId(null)
    queueEditRef.current = null
    setEditingQueueId(null)
  }, [activeId, input, chatAttachments])

  // Tab switches to a non-chat tab unmount this composer WITHOUT changing
  // `activeId`, so the effect above never runs its save branch and the state
  // would be lost. Keep a fresh snapshot of the current draft + queue and stash
  // it on unmount so the remount restores them.
  const latestStateRef = useRef({ activeId, input, chatAttachments, messageQueue })
  useEffect(() => {
    latestStateRef.current = { activeId, input, chatAttachments, messageQueue }
  })
  useEffect(() => {
    return () => {
      const { activeId: aid, input: inp, chatAttachments: att, messageQueue: q } = latestStateRef.current
      if (aid) {
        composerDrafts.set(aid, { input: inp, attachments: att.filter((a) => !a.pending) })
        composerQueues.set(aid, q)
      }
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

  /** Queued text minus the structured attachment block — what the operator edits. */
  const queuedDisplayText = useCallback((item: QueuedComposerMessage): string => {
    return splitUserMessageAttachments(item.text).text
  }, [])

  const startQueueEdit = useCallback(
    (item: QueuedComposerMessage) => {
      queueEditRef.current = { id: item.id, text: queuedDisplayText(item) }
      setEditingQueueId(item.id)
    },
    [queuedDisplayText],
  )

  /**
   * Commit (or cancel) the inline edit. The attachment block parsed from the
   * original item is preserved verbatim — editing prose must never mangle the
   * paths the agent receives. Emptying the prose removes the item when there
   * are no attachments to carry it.
   */
  const commitQueueEdit = useCallback(
    (cancel = false) => {
      const cur = queueEditRef.current
      if (!cur) return
      queueEditRef.current = null
      setEditingQueueId(null)
      if (cancel) return
      const item = messageQueueRef.current.find((x) => x.id === cur.id)
      if (!item) return
      const trimmed = cur.text.trim()
      const { attachments } = splitUserMessageAttachments(item.text)
      if (!trimmed && attachments.length === 0) {
        setMessageQueue((q) => q.filter((x) => x.id !== cur.id))
        return
      }
      const nextText = formatUserMessageWithAttachments(trimmed, attachments)
      setMessageQueue((q) => q.map((x) => (x.id === cur.id ? { ...x, text: nextText } : x)))
    },
    [],
  )

  const submitComposer = useCallback(
    async (mode: 'send' | 'queue' | 'steer') => {
      if (!activeId || safeMode || !agentReady || inputLocked) return
      setMentionSpan(null)
      const trimmed = input.trim()
      if (!trimmed && chatAttachments.length === 0) return
      // Drop placeholders still resolving — their path isn't known yet, so the
      // message can't be formatted. Resolution is fast; send re-enables right
      // after. (The Send button is disabled with a hint meanwhile.)
      if (chatAttachments.some((a) => a.pending)) return

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
      const text = formatUserMessageWithAttachments(
        trimmed,
        restoreAttachments.map(({ path, name }) => ({ path, name })),
      )
      const attachmentsForPi =
        restoreAttachments.length > 0 ? restoreAttachments.map(({ path, name }) => ({ path, name })) : undefined

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
      // Optimistic user bubble: the host does not insert the user row until
      // image encoding + broker acquire + session ensure have all run, which
      // can take seconds — without this the just-sent files are visible
      // nowhere. App supersedes it as soon as the real row lands via refresh.
      onOptimisticUserMessage?.(text)
      try {
        const r = await window.sylo.chat.send(activeId, text, attachmentsForPi)
        if (r.error) {
          onOptimisticUserMessageFailed?.()
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
        onOptimisticUserMessageFailed?.()
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
      onOptimisticUserMessage,
      onOptimisticUserMessageFailed,
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
          const seen = new Set(prev.filter((a) => !a.pending).map((a) => a.path.toLowerCase()))
          const key = path.toLowerCase()
          if (seen.has(key)) return prev
          return [...prev, { id: newQueueId(), path, name }]
        })
      } catch {
        /* invalid or empty image payload */
      }
    },
    [safeMode, activeId],
  )

  /**
   * Resolve dropped files into staged attachment chips. Placeholders are added
   * SYNCHRONOUSLY (pending state) so the operator instantly sees the drop
   * registered; each file then resolves concurrently and upgrades its chip in
   * place. Failed resolutions just remove their placeholder (same silent
   * semantics as before) — a non-image file with no local path can't be staged.
   */
  const ingestDroppedFiles = useCallback(
    (files: File[]) => {
      if (safeMode || !activeId || files.length === 0) return
      const placeholders = files.map(
        (f): ComposerAttachment => ({
          id: newQueueId(),
          path: '',
          name: f.name || 'file',
          pending: true,
        }),
      )
      setChatAttachments((prev) => [...prev, ...placeholders])
      void Promise.all(
        files.map(async (f, i) => {
          const ph = placeholders[i]!
          const upgrade = (resolved: { path: string; name: string } | null) => {
            setChatAttachments((prev) => {
              const idx = prev.findIndex((x) => x.id === ph.id)
              if (idx === -1) return prev
              if (!resolved || !resolved.path.trim()) {
                return prev.filter((x) => x.id !== ph.id)
              }
              // Dedupe by path against the other staged chips.
              const seen = new Set(
                prev
                  .filter((x) => x.id !== ph.id && !x.pending && x.path)
                  .map((x) => x.path.toLowerCase()),
              )
              if (seen.has(resolved.path.toLowerCase())) {
                return prev.filter((x) => x.id !== ph.id)
              }
              const next = [...prev]
              next[idx] = { id: ph.id, path: resolved.path, name: resolved.name }
              return next
            })
          }
          try {
            let path = ''
            try {
              path = window.sylo.files.pathFromWebFile(f).trim()
            } catch {
              /* in-memory file */
            }
            if (path) {
              upgrade({ path, name: f.name || path.replace(/^.*[/\\]/, '') || 'file' })
              return
            }
            if (f.type.startsWith('image/')) {
              const resolved = await resolveImageAttachmentFromFile(f, {
                pathFromWebFile: (file) => window.sylo.files.pathFromWebFile(file),
                writePastedImage: (data, mimeType) =>
                  window.sylo.chat.writePastedImage(data, mimeType),
              })
              upgrade(resolved.path.trim() ? resolved : null)
              return
            }
            upgrade(null)
          } catch {
            upgrade(null)
          }
        }),
      )
    },
    [safeMode, activeId],
  )

  // The chat transcript area forwards drops here so files dropped outside the
  // small composer box still attach instead of silently no-oping.
  useEffect(() => {
    registerComposerDropHandler((files) => ingestDroppedFiles(files))
    return () => registerComposerDropHandler(null)
  }, [ingestDroppedFiles])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setComposerDragOver(false)
      ingestDroppedFiles(Array.from(e.dataTransfer.files ?? []))
    },
    [ingestDroppedFiles],
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
      onDrop={handleDrop}
    >
      {messageQueue.length > 0 ?
        <div className={chatQueueStrip} aria-label="Queued follow-ups">
          {messageQueue.map((item, index) => {
            const display = queuedDisplayText(item)
            const attachCount = item.attachments?.length ?? 0
            const editing = editingQueueId === item.id
            return (
              <div
                key={item.id}
                className={cn(chatQueueItem, queueDragId === item.id && chatQueueItemDragging)}
                draggable={!safeMode && !editing}
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
                {editing ?
                  <textarea
                    ref={queueEditTextareaRef}
                    className={chatQueueEdit}
                    rows={1}
                    defaultValue={queueEditRef.current?.text ?? display}
                    aria-label={`Edit queued message ${index + 1}`}
                    onInput={(e) => {
                      const el = e.currentTarget
                      el.style.height = 'auto'
                      el.style.height = `${Math.min(el.scrollHeight, 96)}px`
                      if (queueEditRef.current) queueEditRef.current.text = el.value
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        commitQueueEdit()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        commitQueueEdit(true)
                      }
                    }}
                    onBlur={() => commitQueueEdit()}
                  />
                : <span
                    className={chatQueueText}
                    title={attachCount > 0 ? `${display || '(attachment only)'}  ·  ${attachCount} attachment(s)` : display}
                  >
                    {display || (attachCount > 0 ? '(attachment only)' : item.text)}
                  </span>}
                {attachCount > 0 && !editing ?
                  <span className={chatQueueAttachBadge} title={`${attachCount} attachment(s)`}>
                    📎 {attachCount}
                  </span>
                : null}
                {editing ?
                  <button
                    type="button"
                    className={chatQueueEditBtn}
                    title="Save edit (Enter) — Shift+Enter for a new line, Esc cancels"
                    aria-label={`Save queued message ${index + 1}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitQueueEdit()}
                  >
                    Save
                  </button>
                : <button
                    type="button"
                    className={chatQueueEditBtn}
                    title="Edit this queued message before it sends"
                    aria-label={`Edit queued message ${index + 1}`}
                    onClick={() => startQueueEdit(item)}
                  >
                    ✎
                  </button>}
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
            )
          })}
        </div>
      : null}
      {chatAttachments.length > 0 ?
        <div className={chatAttachmentStrip}>
          {chatAttachments.map((a) => (
            <span
              key={a.id}
              className={cn(
                chatAttachmentChip,
                isImageAttachmentPath(a.name, a.path) && chatAttachmentChipImage,
                a.pending && chatAttachmentPending,
              )}
              title={a.pending ? `${a.name} — reading…` : a.path}
            >
              {a.pending ?
                <span
                  className={cn(chatAttachmentChipGlyph, 'animate-pulse')}
                  aria-hidden="true"
                >
                  ◇
                </span>
              : <AttachmentImageThumb
                  path={a.path}
                  name={a.name}
                  className="size-10"
                  fallbackClassName={chatAttachmentChipGlyph}
                />}
              <span className={chatAttachmentChipName}>
                {a.pending ? `${a.name} — reading…` : a.name}
              </span>
              <button
                type="button"
                className={chatAttachmentChipRemove}
                aria-label={`Remove ${a.name}`}
                onClick={() =>
                  setChatAttachments((prev) => prev.filter((x) => x.id !== a.id))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      : null}
      <div className={cn(chatInputRow, 'relative')}>
        {mentionOpen ?
          <div className={chatMentionPicker} role="listbox" aria-label="Subagents">
            {mentionMatches.map((agent, index) => (
              <button
                key={agent.name}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                className={cn(chatMentionItem, index === mentionIndex && chatMentionItemActive)}
                // The textarea would blur before onClick fires, closing the picker.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => acceptMention(agent.name)}
              >
                <span className={chatMentionName}>@{agent.name}</span>
                <span className={chatMentionDesc}>{agent.description}</span>
              </button>
            ))}
          </div>
        : null}
        <textarea
          ref={textareaRef}
          className={chatInputTextarea}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            syncMentionSpan(e.target.value, e.target.selectionStart)
          }}
          onBlur={() => setMentionSpan(null)}
          onPaste={(e) => void handleComposerPaste(e)}
          onKeyDown={(e) => {
            // Mid-IME composition, Enter commits the candidate text — stealing
            // it for the mention picker would discard what was being typed.
            if (mentionOpen && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionIndex((i) => (i + 1) % mentionMatches.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                acceptMention((mentionMatches[mentionIndex] ?? mentionMatches[0]!).name)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMentionSpan(null)
                return
              }
            }
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
            : 'Message… (`@agent` forces a subagent; drop files or paste images; `/mcp reconnect`, …)'
          }
          disabled={safeMode || (inputLocked && !onThinkTankInject)}
        />
                <button
          type="button"
          className={chatInputSendBtn}
          title={
            onThinkTankInject ?
              'Queue inject for the Moderator'
            : activeSending ?
              'Send now — runs at the next tool call (Enter queues · Ctrl+Enter sends immediately)'
            : 'Send'
          }
          aria-label={
            onThinkTankInject ?
              'Queue inject for the Moderator'
            : activeSending ?
              'Send now'
            : 'Send'
          }
          disabled={
            safeMode ||
            (inputLocked && !onThinkTankInject) ||
            !activeId ||
            !agentReady ||
            composerBusy ||
            (!input.trim() && chatAttachments.length === 0) ||
            chatAttachments.some((a) => a.pending)
          }
          onClick={() =>
            void (
              onThinkTankInject ?
                submitComposer('queue')
              : submitComposer(activeSending ? 'steer' : 'send')
            )
          }
        >
                    {(
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M12 4 6.8 9.2h3.4V20h3.6V9.2h3.4L12 4z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
})
