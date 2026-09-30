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
import {
  COMPOSER_SLASH_COMMANDS,
  extractComposerSlashCommand,
  isComposerQuickCommand,
  slashQueryAtCaret,
  workflowPlaceholders,
  type ComposerSlashCommand,
} from './composerSlash'
import {
  syloWorkflowRead,
  syloWorkflowsList,
  type SyloWorkflowEntry,
} from '../lib/sylo-workflows-bridge'
import { cn } from '../lib/cn'
import {
  applyMentionCompletion,
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
  chatPlanMenu,
  chatPlanMenuItem,
  chatPlanMenuItemActive,
  chatPlanMenuDesc,
  chatPlanMenuTitle,
  chatPlanSelectBtn,
  chatPlanSelectBtnOn,
  chatPlanSelectCaret,
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

/** ── @-references (task 06, Cursor parity) ───────────────────────────────── */

/** A canvas tab the picker can reference (@canvas). */
export type AtRefCanvasItem = {
  /** Tab strip label ("Task board", sketch file name…). */
  title: string
  /** One-line detail (kind + backing file when one exists). */
  detail: string
  /** Text block inserted into the message when picked. */
  refText: string
}

/** An open terminal pane the picker can reference (@terminal). */
export type AtRefTerminalItem = {
  tabId: string
  title: string
  /** Reads the pane's CURRENT output at pick time (never stale). */
  readBuffer: () => string
}

/**
 * Superset trigger of the subagent `mentionQueryAtCaret`: same boundares
 * (token starts a line or follows whitespace), but the query accepts `/` too
 * so `@docs/ma…` matches workspace paths. Agent resolution on SEND is
 * untouched — shared `MENTION_TOKEN` never matches `/`, so a picked file path
 * in the text stays plain prose to the mention parser.
 */
export function atQueryAtCaret(
  text: string,
  caret: number,
): { query: string; start: number; end: number } | null {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null
  const query = upto.slice(at + 1)
  if (/[\s@]/.test(query)) return null
  if (query && !/^[A-Za-z0-9._/-]*$/.test(query)) return null
  const rest = /^[A-Za-z0-9._/-]*/.exec(text.slice(caret))?.[0] ?? ''
  return { query, start: at, end: caret + rest.length }
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

/** Workspace hit shape from `chat.refSearch` (mirrors main/workspace-ref-search.ts). */
type WorkspaceRefHit = { path: string; relativePath: string; kind: 'file' | 'folder' }

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
  /** @-reference sources (task 06): open canvas tabs + terminal panes,
   *  computed App-side. Terminal buffers are read at PICK time via callback. */
  atCanvasItems?: AtRefCanvasItem[]
  atTerminalItems?: AtRefTerminalItem[]
  /** Quick commands (task 10) run App-side (/compact /clear /model). */
  onSlashCommand?: (name: string) => void
  /** Workflow library roots (task 09): workspace cwd + resolved agent dir. */
  atProjectDir?: string
  atAgentDir?: string
  /** Plan mode (task 11): per-chat current state + a setter for the
   *  Claude-style mode chip (Auto = agent decides / Plan = forced read-only). */
  planModeOn?: boolean
  onSetPlanMode?: (on: boolean) => void
}

function newQueueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** @terminal insert (task 06): same fenced shape as the terminal pane's
 *  Share→composer hover (shareTerminalToChat), with the pane title. Tail-capped
 *  like that capture: last 300 lines / 40k chars (registry buffer; alt-screen
 *  windows replay only what reached the byte buffer). */
function terminalRefText(buffer: string, title: string): string {
  let text = (buffer ?? '').trim()
  if (text) {
    const lines = text.split('\n')
    if (lines.length > 300) text = lines.slice(-300).join('\n')
    if (text.length > 40_000) text = text.slice(-40_000)
  }
  if (!text.trim()) {
    return `Shared terminal output from the apps pane ("${title}"):\n\n(the pane had no readable output yet)\n`
  }
  return `Shared terminal output from the apps pane ("${title}"):\n\n\`\`\`\`text\n${text}\n\`\`\`\`\n`
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
    atCanvasItems,
    atTerminalItems,
    onSlashCommand,
    atProjectDir,
    atAgentDir,
    planModeOn,
    onSetPlanMode,
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
  // ── Slash surface (tasks 09 + 10) ──
  const [slashSpan, setSlashSpan] = useState<MentionSpan | null>(null)
  const [slashWorkflows, setSlashWorkflows] = useState<SyloWorkflowEntry[]>([])
  const slashWorkflowsLoadedRef = useRef(false)
  const [slashBusy, setSlashBusy] = useState(false)
  /** Transient non-blocking hint (e.g. "/compact takes no arguments"). */
  const [slashNote, setSlashNote] = useState<string | null>(null)
  // ── Claude-style plan-mode chip: quiet text button + small dropdown ──
  const [planMenuOpen, setPlanMenuOpen] = useState(false)
  const planAnchorRef = useRef<HTMLDivElement>(null)
  const slashNoteTimerRef = useRef<number | null>(null)
  const showSlashNote = useCallback((hint: string) => {
    setSlashNote(hint)
    if (slashNoteTimerRef.current) window.clearTimeout(slashNoteTimerRef.current)
    slashNoteTimerRef.current = window.setTimeout(() => setSlashNote(null), 4000)
  }, [])
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

  // Plan-mode dropdown dismissal: outside pointer-down closes it (capture phase
  // so it works even when the next click lands on a button that ignores blur);
  // Escape closes it and swallows the key so app-level Escape handlers (modal
  // dismiss and the like) don't fire behind the menu.
  useEffect(() => {
    if (!planMenuOpen) return
    const onDocPointerDown = (e: MouseEvent) => {
      if (planAnchorRef.current && !planAnchorRef.current.contains(e.target as Node)) {
        setPlanMenuOpen(false)
      }
    }
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setPlanMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocPointerDown, true)
    document.addEventListener('keydown', onDocKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown, true)
      document.removeEventListener('keydown', onDocKeyDown, true)
    }
  }, [planMenuOpen])

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

  // ── @-reference items (files/folders, canvas, terminal) + the unified ────
  // picker rows. Subagent `@name` mentions share the trigger; each section's
  // query filtering is independent, so agent completion behaves exactly as
  // before when the query matches an agent.
  const [refHits, setRefHits] = useState<WorkspaceRefHit[]>([])
  const refSearchSeqRef = useRef(0)
  useEffect(() => {
    if (!mentionSpan) {
      setRefHits([])
      return
    }
    const q = mentionSpan.query
    const seq = ++refSearchSeqRef.current
    const t = window.setTimeout(() => {
      void window.sylo.chat
        .refSearch(activeId ?? '', q)
        .then((r) => {
          if (seq === refSearchSeqRef.current && r.ok) setRefHits(r.hits)
        })
        .catch(() => {
          /* ref search is optional */
        })
    }, 150)
    return () => window.clearTimeout(t)
  }, [mentionSpan?.query, activeId])

  const refItemMatches = (label: string, detail: string, q: string): boolean =>
    !q || `${label} ${detail}`.toLowerCase().includes(q)

  type PickerRow =
    | { rowKey: string; section: 'files' | 'canvas' | 'terminal' | 'agents'; label: string; sub: string
        file?: WorkspaceRefHit; canvas?: AtRefCanvasItem; terminal?: AtRefTerminalItem; agent?: string }

  const pickerRows = useMemo((): PickerRow[] => {
    if (!mentionSpan) return []
    const q = mentionSpan.query.toLowerCase()
    const rows: PickerRow[] = []
    for (const hit of refHits.slice(0, 5)) {
      rows.push({
        rowKey: `file:${hit.relativePath}`,
        section: 'files',
        label: hit.kind === 'folder' ? `${hit.relativePath}/` : hit.relativePath,
        sub: hit.kind === 'folder' ? 'folder' : 'attach',
        file: hit,
      })
    }
    for (const item of (atCanvasItems ?? []).slice(0, 3)) {
      if (!refItemMatches(item.title, item.detail, q)) continue
      rows.push({ rowKey: `canvas:${item.title}`, section: 'canvas', label: item.title, sub: item.detail, canvas: item })
    }
    for (const item of (atTerminalItems ?? []).slice(0, 3)) {
      if (!refItemMatches(item.title, '', q)) continue
      rows.push({ rowKey: `terminal:${item.tabId}`, section: 'terminal', label: item.title, sub: 'share output', terminal: item })
    }
    for (const agent of mentionMatches) {
      rows.push({ rowKey: `agent:${agent.name}`, section: 'agents', label: `@${agent.name}`, sub: agent.description, agent: agent.name })
    }
    return rows
  }, [mentionSpan, refHits, atCanvasItems, atTerminalItems, mentionMatches])

  // Slash rows: quick commands (task 10) + operator workflows (task 09).
  const slashRows = useMemo(
    () => {
      if (!slashSpan) return []
      const q = slashSpan.query.toLowerCase()
      type SlashRow =
        | { rowKey: string; kind: 'command'; cmd: ComposerSlashCommand }
        | { rowKey: string; kind: 'workflow'; wf: SyloWorkflowEntry }
      const rows: SlashRow[] = []
      for (const cmd of COMPOSER_SLASH_COMMANDS) {
        if (q && !cmd.name.startsWith(q) && !cmd.name.includes(q)) continue
        rows.push({ rowKey: `cmd:${cmd.name}`, kind: 'command', cmd })
      }
      for (const wf of slashWorkflows) {
        const hay = `${wf.title} ${wf.description}`.toLowerCase()
        if (q && !hay.includes(q) && !wf.id.toLowerCase().includes(q)) continue
        rows.push({ rowKey: `wf:${wf.id}`, kind: 'workflow', wf })
      }
      return rows.slice(0, MENTION_PICKER_LIMIT * 2)
    },
    [slashSpan, slashWorkflows],
  )

  type AnyPickerRow =
    | { rowKey: string; section: 'files' | 'canvas' | 'terminal' | 'agents'; label: string; sub: string
        file?: WorkspaceRefHit; canvas?: AtRefCanvasItem; terminal?: AtRefTerminalItem; agent?: string }
    | { rowKey: string; kind: 'command' | 'workflow'; cmd?: ComposerSlashCommand; wf?: SyloWorkflowEntry }

  const activeRows: AnyPickerRow[] = slashSpan !== null
    ? slashRows.map((r) => r as AnyPickerRow)
    : pickerRows.map((r) => r as AnyPickerRow)
  const pickerActive =
    (slashSpan !== null && slashRows.length > 0)
    || (mentionSpan !== null && pickerRows.length > 0)
  const pickerOpen = pickerActive && !safeMode && !inputLocked

  // Refresh workflows EACH open (source badge + fresh list per the spec) —
  // loading state keeps the picker responsive; a failed fetch just means an
  // commands-only picker.
  useEffect(() => {
    if (!slashSpan) return
    if (slashBusy) return
    void (async () => {
      setSlashBusy(true)
      try {
        const r = await syloWorkflowsList({
          project_dir: atProjectDir ?? '',
          agent_dir: atAgentDir ?? undefined,
        })
        setSlashWorkflows(r.workflows)
        slashWorkflowsLoadedRef.current = true
      } catch {
        setSlashWorkflows([])
      } finally {
        setSlashBusy(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashSpan !== null])

  const acceptSlashRow = useCallback(
    async (row: { kind: 'command' | 'workflow'; cmd?: ComposerSlashCommand; wf?: SyloWorkflowEntry }) => {
      setSlashSpan(null)
      if (row.kind === 'command' && row.cmd) {
        if (onSlashCommand) {
          setInput('')
          setSlashNote(null)
          onSlashCommand(row.cmd.name)
        } else {
          // Standalone fallback (no host wiring): send as Pi command text.
          setInput(`/${row.cmd.name}`)
        }
        return
      }
      if (row.kind === 'workflow' && row.wf) {
        setSlashBusy(true)
        try {
          const read = await syloWorkflowRead({
            project_dir: atProjectDir ?? '',
            agent_dir: atAgentDir ?? undefined,
            id: row.wf.id,
          })
          // Replace the whole composer content: workflows are reviewable
          // multi-line prompts, inserted plain ({{arg}} placeholders stay in
          // the text for the operator to edit in place before sending).
          setInput(read.body)
          const ph = workflowPlaceholders(read.body)
          if (ph.length > 0) {
            showSlashNote(`Fill ${ph.length} placeholder${ph.length === 1 ? '' : 's'} before sending: ${ph.slice(0, 5).map((x) => `{{${x}}}`).join('  ')}`)
          }
          requestAnimationFrame(() => textareaRef.current?.focus())
        } catch (e) {
          showSlashNote(`Could not read workflow: ${e instanceof Error ? e.message : String(e)}`)
        } finally {
          setSlashBusy(false)
        }
      }
    },
    [onSlashCommand, atProjectDir, atAgentDir, showSlashNote],
  )

  const acceptPickerRow = useCallback(
    (row: PickerRow) => {
      if (!mentionSpan) return
      if (row.agent) {
        // Subagent mention: original completion path (inserts `@name `).
        const next = applyMentionCompletion(input, mentionSpan, row.agent)
        setInput(next.text)
        setMentionSpan(null)
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (!el) return
          el.focus()
          el.setSelectionRange(next.caret, next.caret)
        })
        return
      }
      if (row.file) {
        // File/folder: clear the `@query` token and stage an attachment chip —
        // the agent receives the absolute path on send (same block as drops).
        setInput((prev) => prev.slice(0, mentionSpan.start) + prev.slice(mentionSpan.end))
        setMentionSpan(null)
        const name = row.file.relativePath.replace(/^.*[/\\]/, '') || row.file.relativePath
        setChatAttachments((prev) => {
          const seen = new Set(prev.filter((a) => !a.pending).map((a) => a.path.toLowerCase()))
          if (seen.has(row.file!.path.toLowerCase())) return prev
          return [
            ...prev,
            {
              id: newQueueId(),
              path: row.file!.path,
              name: row.file!.kind === 'folder' ? `${name}/` : name,
            },
          ]
        })
        requestAnimationFrame(() => textareaRef.current?.focus())
        return
      }
      // Canvas / terminal: replace the `@query` token with the context block.
      const insert = row.terminal ? terminalRefText(row.terminal.readBuffer(), row.terminal.title) : row.canvas?.refText ?? ''
      setInput((prev) => prev.slice(0, mentionSpan.start) + insert + prev.slice(mentionSpan.end))
      setMentionSpan(null)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(mentionSpan.start, mentionSpan.start)
      })
    },
    [input, mentionSpan],
  )

  /** One accept route for both pickers (task 06 @ / tasks 09+10 /). */
  const pickRow = useCallback(
    (row: AnyPickerRow) => {
      if ('kind' in row) {
        void acceptSlashRow(row)
      } else {
        acceptPickerRow(row)
      }
    },
    [acceptSlashRow, acceptPickerRow],
  )

  const syncMentionSpan = useCallback((text: string, caret: number | null) => {
    if (caret == null) {
      setMentionSpan(null)
      setSlashSpan(null)
      setMentionIndex(0)
      return
    }
    // The caret lives in exactly one trigger token: '@' (task 06) or '/' at a
    // line start (tasks 09/10). Whichever matched at the closest span start wins.
    const at = atQueryAtCaret(text, caret)
    const slash = at ? null : slashQueryAtCaret(text, caret)
    setMentionSpan(at)
    setSlashSpan(slash)
    setMentionIndex(0)
  }, [])


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

      // Quick commands (task 10): intercept a recognized `/command` before the
      // send queue machinery gets it (steer passes through — steering is for
      // the running turn, not session commands). /compact /clear /model run
      // App-side; ANY other /word falls through as text (Pi slash command —
      // unchanged behavior).
      if (mode !== 'steer' && onThinkTankInject === undefined) {
        const cmd = extractComposerSlashCommand(trimmed)
        if (cmd && isComposerQuickCommand(cmd.name)) {
          const usageHint =
            COMPOSER_SLASH_COMMANDS.find((c) => c.name === cmd.name)?.usageHint
          if (cmd.hasArgs) {
            showSlashNote(usageHint ?? `${cmd.name} takes no arguments — sent nothing`)
            return
          }
          setInput('')
          onSlashCommand?.(cmd.name)
          return
        }
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
      onSlashCommand,
      showSlashNote,
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
      {slashNote ?
        <div
          className={cn(
            chatQueueAttachBadge,
            'mb-1 self-start border border-border',
            'max-w-full truncate text-[0.72rem]',
          )}
          role="status"
        >
          {slashNote}
        </div>
      : null}
      <div className={cn(chatInputRow, 'relative')}>
        {pickerOpen ?
          <div className={chatMentionPicker} role="listbox" aria-label="@ references">
            {activeRows.map((row, index) => (
              <button
                key={row.rowKey}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                className={cn(chatMentionItem, index === mentionIndex && chatMentionItemActive)}
                // The textarea would blur before onClick fires, closing the picker.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => pickRow(row)}
              >
                {'kind' in row ?
                  <>
                    <span className={chatMentionName}>
                      /{row.kind === 'workflow' ? row.wf!.title : row.cmd!.name}
                    </span>
                    <span className={chatMentionDesc}>
                      {row.kind === 'workflow' ? row.wf!.description : row.cmd!.description}
                    </span>
                    <span className={cn(chatMentionDesc, 'shrink-0')}>
                      {row.kind === 'workflow' ? row.wf!.source : 'command'}
                    </span>
                  </>
                : (
                  <>
                    <span className={chatMentionName}>
                      {row.section === 'agents' ? `@${row.label.slice(1)}` : row.label}
                    </span>
                    <span className={chatMentionDesc}>{row.sub}</span>
                  </>
                )}
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
            if (pickerOpen && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionIndex((i) => (i + 1) % activeRows.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIndex((i) => (i - 1 + activeRows.length) % activeRows.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pickRow(activeRows[mentionIndex] ?? activeRows[0]!)
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
            : 'Message… (`@` for files/canvas/terminal/agents; drop files or paste images; `/mcp reconnect`, …)'
          }
          disabled={safeMode || (inputLocked && !onThinkTankInject)}
        />
        {/* Claude-style plan-mode chip: quiet text label showing the current
            mode; clicking opens a small dropdown with the two options. */}
        <div ref={planAnchorRef} className="relative shrink-0">
          <button
            type="button"
            className={cn(chatPlanSelectBtn, planModeOn && chatPlanSelectBtnOn)}
            title={
              planModeOn
                ? 'Plan mode ON — the next turn runs read-only (no file writes, no extension tools); Approve & execute reruns it with tools. Click to change.'
                : 'Auto — the agent decides whether to plan first. Click to switch to Plan mode.'
            }
            aria-haspopup="menu"
            aria-expanded={planMenuOpen}
            aria-label="Plan mode"
            disabled={safeMode || !onSetPlanMode}
            onClick={() => setPlanMenuOpen((o) => !o)}
          >
            {planModeOn ? 'Plan' : 'Auto'}
            <span className={chatPlanSelectCaret} aria-hidden="true">
              ▾
            </span>
          </button>
          {planMenuOpen ?
            <div className={chatPlanMenu} role="menu" aria-label="Plan mode">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={planModeOn !== true}
                className={cn(chatPlanMenuItem, planModeOn !== true && chatPlanMenuItemActive)}
                onClick={() => {
                  onSetPlanMode?.(false)
                  setPlanMenuOpen(false)
                  requestAnimationFrame(() => textareaRef.current?.focus())
                }}
              >
                <span className={chatPlanMenuTitle}>
                  Auto{planModeOn !== true ? ' ✓' : ''}
                </span>
                <span className={chatPlanMenuDesc}>
                  The agent decides whether to plan first
                </span>
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={planModeOn === true}
                className={cn(chatPlanMenuItem, planModeOn === true && chatPlanMenuItemActive)}
                onClick={() => {
                  onSetPlanMode?.(true)
                  setPlanMenuOpen(false)
                  requestAnimationFrame(() => textareaRef.current?.focus())
                }}
              >
                <span className={chatPlanMenuTitle}>
                  Plan{planModeOn === true ? ' ✓' : ''}
                </span>
                <span className={chatPlanMenuDesc}>
                  Next turn runs read-only (plan only) — Approve &amp; execute applies the plan
                </span>
              </button>
            </div>
          : null}
        </div>
        <button
          type="button"
          className={chatInputSendBtn}
          title={
            onThinkTankInject ?
              'Queue inject for the Moderator (⏎)'
            : activeSending ?
              'Send now — runs at the next tool call (Enter queues · Ctrl+Enter sends immediately)'
            : 'Send (⏎)'
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
                    <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <polyline points="9 10 4 15 9 20" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
          </svg>
        </button>
      </div>
    </div>
  )
})
