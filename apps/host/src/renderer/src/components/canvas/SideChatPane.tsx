import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { btnGhostSm, chatInputSendBtn, chatStopBtnCompact, mutedText } from '../../panels/ui-classes'
import { ChatMarkdown } from '../../ChatMarkdown'

/**
 * Side chat pane (apps pane, Phase 7 + v2): one DB child conversation per tab,
 * scoped to the parent chat. Same turn pipeline as any conversation
 * (`chat.send` on the child id) — the broker pool treats it like any other
 * chat. v2: the composer stays live while a turn runs — Enter STEERS the
 * active response (falls back to a chained send when the turn just ended);
 * Stop still aborts. Model override intentionally not built yet (needs the
 * ChatModelBar option machinery; child inherits the parent chat's model).
 *
 * The child conversation is created lazily on first send so closing the tab
 * without messaging leaves nothing behind. Deleting the parent chat
 * cascades (DB-level) to its side chats.
 */

type SideMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status: string
  created_at: number
}

export function SideChatPane({
  parentId,
  className,
}: {
  parentId: string | null
  className?: string
}): React.ReactElement {
  const [childId, setChildId] = useState<string | null>(null)
  const [childLoading, setChildLoading] = useState(true)
  const [rows, setRows] = useState<SideMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  /** Streaming assistant tail (between DB writes) keyed by turn. */
  const streamBufRef = useRef('')
  const [streamText, setStreamText] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  const reload = useCallback(
    async (id: string) => {
      const rowsRaw = (await window.sylo.messages.list(id)) as unknown
      if (!Array.isArray(rowsRaw)) return
      setRows(
        rowsRaw
          .filter((m): m is SideMessage => {
            const r = m as SideMessage
            return typeof r?.id === 'string' && (r.role === 'user' || r.role === 'assistant' || r.role === 'system')
          })
          .map((m) => ({ id: m.id, role: m.role, content: m.content, status: m.status, created_at: m.created_at })),
      )
    },
    [],
  )

  // Adopt the tab's existing side chat (most recent child) or wait for first send.
  useEffect(() => {
    let dead = false
    setChildLoading(true)
    setChildId(null)
    setRows([])
    setStreamText('')
    if (!parentId) {
      setChildLoading(false)
      return
    }
    void (async () => {
      try {
        const kids = await window.sylo.conversations.listSide(parentId)
        if (dead) return
        const last = kids[kids.length - 1]
        if (last) {
          setChildId(last.id)
          await reload(last.id)
        }
      } finally {
        if (!dead) setChildLoading(false)
      }
    })()
    return () => {
      dead = true
    }
  }, [parentId, reload])

  // Turn events for the child conversation (registered once; filtered by id).
  useEffect(() => {
    const onRefresh = window.sylo.chatEvents?.onRefresh
    const onStream = window.sylo.chatEvents?.onStream
    const unsubs: Array<() => void> = []
    if (onRefresh) {
      unsubs.push(
        onRefresh((p) => {
          if (!childId || p.conversationId !== childId) return
          if (p.kind === 'turnStarted') {
            setSending(true)
            streamBufRef.current = ''
            setStreamText('')
            void reload(childId)
          } else if (p.kind === 'turnFinished') {
            setSending(false)
            streamBufRef.current = ''
            setStreamText('')
            void reload(childId)
          } else if (p.kind === 'messages') {
            void reload(childId)
          }
        }),
      )
    }
    if (onStream) {
      unsubs.push(
        onStream((p) => {
          if (!childId || p.conversationId !== childId) return
          streamBufRef.current += p.delta
          setStreamText(streamBufRef.current)
        }),
      )
    }
    return () => unsubs.forEach((u) => u())
  }, [childId, reload])

  // Keep the pane pinned to the bottom as content streams in.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows, streamText])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || !parentId) return
    let id = childId
    if (!id) {
      if (sending) return // no child yet + a turn running cannot co-occur
      const r = await window.sylo.conversations.createSide(parentId)
      if (!r.ok) return
      id = r.conversation.id
      setChildId(id)
    }
    setInput('')
    streamBufRef.current = ''
    if (sending) {
      // v2 queue/steer: while a turn runs, Enter STEERS the active response
      // (user row lands in the thread; Pi redirects mid-turn). If the turn
      // just finished (state lag), fall back to a normal chained send.
      const r = await window.sylo.chat.steer(id, text)
      if (!r.ok) {
        await window.sylo.chat.send(id, text)
      }
      void reload(id)
      return
    }
    setSending(true)
    setStreamText('')
    await window.sylo.chat.send(id, text)
    void reload(id)
  }, [input, parentId, sending, childId, reload])

  const noParent = !parentId

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {noParent ?
          <p className={cn(mutedText, 'm-0 text-center text-[0.8rem]')}>
            Open a chat to use a side conversation.
          </p>
        : childLoading ?
          <p className={cn(mutedText, 'm-0 text-center text-[0.8rem]')}>…</p>
        : rows.length === 0 && !streamText ?
          <p className={cn(mutedText, 'm-0 text-center text-[0.8rem]')}>
            Side conversation — ask a follow-up without cluttering the main thread.
          </p>
        : (
          <div className="flex flex-col gap-4">
            {rows.map((m) =>
              m.role === 'user' ?
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[92%] rounded-xl bg-[#232323] px-3.5 py-2.5 text-[0.9rem] leading-[1.55] text-text-primary [overflow-wrap:anywhere]">
                    {m.content}
                  </div>
                </div>
              : m.role === 'assistant' ?
                <div key={m.id} className="max-w-full text-[0.9rem] leading-[1.55] text-text-primary">
                  <div className="chat-md">
                    <ChatMarkdown text={m.content} />
                  </div>
                </div>
              : null,
            )}
            {streamText ?
              <div className="max-w-full text-[0.9rem] leading-[1.55] text-text-primary">
                <div className="chat-md">
                  <ChatMarkdown text={streamText} />
                </div>
              </div>
            : null}
          </div>
        )}
      </div>
      <div className="mx-3 mb-3 mt-1 flex items-end gap-2 rounded-xl border border-border bg-[#1e1e1e] px-3 py-2.5">
        <textarea
          className="max-h-[120px] min-h-9 flex-1 resize-none border-0 bg-transparent px-0 py-1 font-[inherit] text-[0.9rem] leading-[1.5] text-text-primary placeholder:text-text-muted outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={noParent ? 'No parent chat' : sending ? 'Responding — Enter steers the turn…' : 'Message the side chat…'}
          disabled={noParent || childLoading}
          rows={1}
        />
        {sending && childId ?
          <button
            type="button"
            className={cn(chatStopBtnCompact, 'shrink-0 cursor-pointer self-end rounded-lg border border-[rgb(241_106_80/0.55)] bg-[rgb(241_106_80/0.12)] px-2.5 py-2 text-[0.78rem] text-[#f6b3a4] hover:bg-[rgb(241_106_80/0.22)] disabled:cursor-not-allowed disabled:opacity-50')}
            title="Stop the side-chat turn"
            onClick={() => void window.sylo.chat.abort(childId)}
          >
            Stop
          </button>
        : null}
        <button
          type="button"
          className={cn(chatInputSendBtn, 'px-3 py-2 text-[0.8rem]')}
          disabled={noParent || childLoading || !input.trim()}
          title={sending ? 'Steer the running turn with this message' : 'Send'}
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
    </div>
  )
}