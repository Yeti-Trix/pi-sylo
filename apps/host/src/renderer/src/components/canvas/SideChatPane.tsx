import { useCallback, useEffect, useRef, useState } from 'react'
import { CHATGPT_CODEX_MODELS, CHATGPT_CODEX_PROVIDER, SYLO_MODEL_PROVIDERS, SYLO_MODEL_PROVIDER_LABELS } from '../../../../shared/chatgpt-codex'
import { cn } from '../../lib/cn'
import { btnGhostSm, chatInputSendBtn, chatStopBtnCompact, modelBarPill, mutedText } from '../../panels/ui-classes'
import { normalizeOllamaOriginUi, OllamaModelSelect } from '../../panels/ollama-ui'
import { ChatMarkdown } from '../../ChatMarkdown'

const GLOBAL_SENTINEL = '__sylo_global__'

/** Per-chat model override shape (same semantics as ChatModelBar: null = inherit global). */
type SideOverride = {
  model_provider: string | null
  model_id: string | null
  image_model_id: string | null
  image_model_provider: string | null
  thinking_level: string | null
}

const SIDE_NULL_OVERRIDE: SideOverride = {
  model_provider: null,
  model_id: null,
  image_model_id: null,
  image_model_provider: null,
  thinking_level: null,
}

const providerLabel = (p: string) =>
  SYLO_MODEL_PROVIDER_LABELS[p as keyof typeof SYLO_MODEL_PROVIDER_LABELS] ?? p

/**
 * Side chat pane (apps pane, Phase 7 + v2): one DB child conversation per tab,
 * scoped to the parent chat. Same turn pipeline as any conversation
 * (`chat.send` on the child id) — the broker pool treats it like any other
 * chat. v2: the composer stays live while a turn runs — Enter STEERS the
 * active response (falls back to a chained send when the turn just ended);
 * Stop still aborts. Model override: a compact picker above the composer
 * persists provider/model on the child conversation (null fields inherit the
 * global default, same semantics as the main ChatModelBar); picks made before
 * the child exists are stashed and applied on first send.
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
  /** Textarea ref for Cursor-style auto-grow (1 line at rest → 4 lines max). */
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [override, setOverride] = useState<SideOverride>(SIDE_NULL_OVERRIDE)
  /** Host-reported effective model for the child (per-chat ?? global ?? default). */
  const [effModel, setEffModel] = useState<{ provider: string; modelId: string } | null>(null)
  const [ollamaTags, setOllamaTags] = useState<string[]>([])
  /** Model picked before the child exists — applied to the child on first send. */
  const pendingModelRef = useRef<SideOverride | null>(null)

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
    pendingModelRef.current = null
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

  // Model selection: the child's own per-chat override (host resolves effective
  // = per-chat ?? global ?? SYLO default). With no child yet, show the global
  // default; any pre-child pick is stashed and applied to the child on send.
  useEffect(() => {
    let dead = false
    if (!childId) {
      setOverride(SIDE_NULL_OVERRIDE)
      void (async () => {
        const gProvider = ((await window.sylo.prefs.get('sylo.model_provider', '')) as string).trim()
        const gModelId = ((await window.sylo.prefs.get('sylo.model_id', '')) as string).trim()
        if (!dead) setEffModel({ provider: gProvider, modelId: gModelId })
      })()
      return () => {
        dead = true
      }
    }
    void (async () => {
      const m = await window.sylo.conversations.getModel(childId)
      if (dead) return
      if (!m) {
        setOverride(SIDE_NULL_OVERRIDE)
        setEffModel(null)
        return
      }
      setOverride({
        model_provider: m.model_provider?.trim() || null,
        model_id: m.model_id?.trim() || null,
        image_model_id: null,
        image_model_provider: null,
        thinking_level: null,
      })
      setEffModel({ provider: m.effective.provider, modelId: m.effective.modelId })
    })()
    return () => {
      dead = true
    }
  }, [childId])

  // Auto-grow the composer with content (1 line at rest → 4 lines, then scroll).
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [input])

  // Ollama tags for the picker's model dropdown (lazy — first open only).
  useEffect(() => {
    if (!pickerOpen || ollamaTags.length > 0) return
    let dead = false
    void (async () => {
      const pref = ((await window.sylo.prefs.get('sylo.ollama_base_url', '')) as string).trim()
      const origin = pref ? normalizeOllamaOriginUi(pref) : await window.sylo.ollama.inferBaseUrl()
      const r = await window.sylo.ollama.listTags(origin)
      if (!dead && r.ok) setOllamaTags(r.models)
    })()
    return () => {
      dead = true
    }
  }, [pickerOpen, ollamaTags.length])

  /** Persist the override on the child; stash it when the child doesn't exist yet. */
  const persistModel = useCallback(
    (next: SideOverride) => {
      setOverride(next)
      if (childId) void window.sylo.conversations.setModel(childId, next)
      else pendingModelRef.current = next
    },
    [childId],
  )

  const onSideProviderChange = useCallback(
    (raw: string) => {
      const provider = raw === GLOBAL_SENTINEL ? null : raw
      persistModel({
        ...SIDE_NULL_OVERRIDE,
        model_provider: provider,
        model_id: provider === null ? null : override.model_id,
      })
    },
    [override, persistModel],
  )

  const onSideModelChange = useCallback(
    (raw: string) => {
      const modelId = raw === '' ? null : raw
      persistModel({
        ...SIDE_NULL_OVERRIDE,
        model_id: modelId,
        model_provider: modelId === null ? null : (override.model_provider ?? effModel?.provider ?? 'ollama'),
      })
    },
    [override, effModel, persistModel],
  )

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
      // Apply a pre-child model pick before the first send resolves the model.
      const pend = pendingModelRef.current
      if (pend) {
        pendingModelRef.current = null
        await window.sylo.conversations.setModel(id, pend)
      }
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
  const shownProvider = (override.model_provider ?? effModel?.provider ?? '').trim()

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
      {pickerOpen && !noParent ? (
        <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-lg border border-border bg-[#1e1e1e] px-2.5 py-2">
          <span className={cn(mutedText, 'shrink-0 text-[0.68rem]')}>Model</span>
          <select
            className={cn(modelBarPill, 'h-7 max-w-[150px] shrink-0 py-0 text-[0.7rem]')}
            value={override.model_provider ?? GLOBAL_SENTINEL}
            onChange={(e) => onSideProviderChange(e.target.value)}
            aria-label="Side chat model provider"
          >
            <option value={GLOBAL_SENTINEL}>
              Default{effModel ? ` (${providerLabel(effModel.provider)})` : ''}
            </option>
            {SYLO_MODEL_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {providerLabel(p)}
              </option>
            ))}
          </select>
          {override.model_provider ? (
            override.model_provider === 'ollama' ? (
              <OllamaModelSelect
                modelId={override.model_id ?? ''}
                setModelId={(v) => onSideModelChange(v)}
                ollamaTags={ollamaTags}
                emptyOptionLabel={`Default (${effModel?.modelId ?? 'model'})`}
                id="sylo-side-chat-model-select"
                className={cn(modelBarPill, 'h-7 min-w-0 max-w-[220px] flex-1 py-0 text-[0.7rem]')}
              />
            ) : override.model_provider === CHATGPT_CODEX_PROVIDER ? (
              <select
                className={cn(modelBarPill, 'h-7 min-w-0 max-w-[220px] flex-1 py-0 text-[0.7rem]')}
                value={override.model_id ?? ''}
                onChange={(e) => onSideModelChange(e.target.value)}
                aria-label="Side chat model"
              >
                <option value="">Model…</option>
                {CHATGPT_CODEX_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                {override.model_id && !CHATGPT_CODEX_MODELS.some((m) => m.id === override.model_id) ? (
                  <option value={override.model_id}>{override.model_id}</option>
                ) : null}
              </select>
            ) : (
              <input
                className={cn(modelBarPill, 'h-7 max-w-[200px] flex-1 py-0 text-[0.7rem]')}
                value={override.model_id ?? ''}
                onChange={(e) => onSideModelChange(e.target.value)}
                placeholder={`Model id (default: ${effModel?.modelId ?? ''})`}
                aria-label="Model id"
              />
            )
          ) : null}
        </div>
      ) : null}
      <div className="mx-3 mb-3 mt-1 flex items-end gap-2 rounded-xl border border-border bg-[#1e1e1e] px-3 py-2.5">
        <button
          type="button"
          className={cn(modelBarPill, 'h-9 max-w-[150px] shrink-0 cursor-pointer self-end truncate py-0 text-[0.7rem]')}
          title={`Side chat model — ${override.model_id?.trim() || effModel?.modelId || 'default'}${shownProvider ? ` (${providerLabel(shownProvider)})` : ''}`}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((o) => !o)}
        >
          {override.model_id?.trim() || effModel?.modelId || 'model'}
        </button>
        <textarea
          ref={taRef}
          className="max-h-[96px] min-h-9 flex-1 resize-none border-0 bg-transparent px-0 py-1 font-[inherit] text-[0.9rem] leading-[1.5] text-text-primary placeholder:text-text-muted outline-none"
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
          className={chatInputSendBtn}
          disabled={noParent || childLoading || !input.trim()}
          title={sending ? 'Steer the running turn with this message (Enter steers too)' : 'Send'}
          aria-label={sending ? 'Steer the running turn' : 'Send'}
          onClick={() => void send()}
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
}