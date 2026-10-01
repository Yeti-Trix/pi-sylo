import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  normalizeCompactionOverrides,
  PI_DEFAULT_COMPACTION_RESERVE_TOKENS,
  PI_FALLBACK_CONTEXT_WINDOW_TOKENS,
  SYLO_COMPACTION_RESERVE_PREF,
} from '../../../shared/sylo-compaction-settings'
import { cn } from '../lib/cn'
import {
  chatCompactCaretBtn,
  chatCompactMain,
  chatCompactMenu,
  chatCompactMenuBtn,
  chatCompactMenuHead,
  chatCompactMenuInput,
  chatCompactMenuMeta,
  chatCompactMenuPrimary,
  chatCompactSplit,
} from '../panels/ui-classes'

/**
 * Split "Compact" control for the chat status subfoot — one button, two halves:
 *
 *   [ Compact · 42% ▾ ]
 *    └ main half → compact now immediately (the old behavior, one click)
 *    └ caret half → popover that edits the AUTO-compact trigger for the chat's
 *      effective model in tokens ("compact when the context reaches N tokens").
 *
 * The trigger is stored as a per-model percentage of the context window
 * (`sylo.compaction.reserve_by_model` pref, provider:modelId key, push-live via
 * `compaction.apply`) — exactly the backend Settings → Model (Pi) → Compaction
 * uses; this is the token-first shortcut surfaced in chat.
 */

type CompactStateOk = Extract<Awaited<ReturnType<typeof window.sylo.compaction.state>>, { ok: true }>

/** Digits-only token target from the draft text (null = empty/invalid). */
function parseDraftTokens(draft: string): number | null {
  const raw = Number(draft.replace(/[^0-9]/g, ''))
  if (!Number.isFinite(raw) || raw < 1) return null
  return raw
}

/** Token draft → stored trigger percentage, clamped to the (0, 100] backend range. */
function pctForTokens(tokens: number, contextWindow: number): number | null {
  if (!Number.isFinite(tokens) || tokens < 1) return null
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null
  if (tokens > contextWindow) return null
  return Math.round((tokens / contextWindow) * 100 * 100) / 100
}

export function CompactControl({
  conversationId,
  contextTokens,
  busy,
  onCompact,
}: {
  conversationId: string | undefined
  /** Current context fill (broker-reported actual tokens). */
  contextTokens: number
  /** Compaction running for this conversation ("Compacting…"). */
  busy: boolean
  onCompact: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<CompactStateOk | null>(null)
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  /** Token draft while the popover is open; null = not initialized yet. */
  const [draft, setDraft] = useState<string | null>(null)
  const draftTouchedRef = useRef(false)
  const [savingBusy, setSavingBusy] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimerRef = useRef<number | null>(null)

  const contextWindow = state?.contextWindow ?? PI_FALLBACK_CONTEXT_WINDOW_TOKENS
  const fillPct =
    contextTokens > 0 && contextWindow > 0 ?
      Math.max(0, Math.min((contextTokens / contextWindow) * 100, 100))
    : 0

  // Same dismissal discipline as the plan-mode chip: capture-phase outside
  // pointer-down + Escape that doesn't leak into app-level Escape handlers.
  useEffect(() => {
    if (!open) return
    const onDocPointerDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocPointerDown, true)
    document.addEventListener('keydown', onDocKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown, true)
      document.removeEventListener('keydown', onDocKeyDown, true)
    }
  }, [open])

  /** Load the chat's effective model + its compaction trigger state. */
  const reload = useCallback(async () => {
    if (!conversationId) return
    const m = await window.sylo.conversations.getModel(conversationId)
    const eff = m?.effective ?? null
    if (!eff?.provider || !eff?.modelId) {
      setLoadFailed(true)
      return
    }
    setModel({ provider: eff.provider, modelId: eff.modelId })
    const st = await window.sylo.compaction.state(eff.provider, eff.modelId)
    if (st.ok) {
      setState(st)
      setLoadFailed(false)
      // Seed the draft from the CURRENT trigger only when the operator hasn't
      // started typing — reload after save must not erase their draft.
      if (!draftTouchedRef.current) {
        const w = st.contextWindow ?? PI_FALLBACK_CONTEXT_WINDOW_TOKENS
        const tokens = Math.round((st.effectivePct / 100) * w)
        setDraft(tokens > 0 ? String(tokens) : '')
      }
    } else {
      setLoadFailed(true)
    }
  }, [conversationId])

  // Fresh state every open; wipe the draft + touched flag on close.
  useEffect(() => {
    if (open) {
      draftTouchedRef.current = false
      setState(null)
      setModel(null)
      setDraft(null)
      setLoadFailed(false)
      setSavedFlash(false)
      void reload()
    }
  }, [open, reload])

  useEffect(
    () => () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
    },
    [],
  )

  const draftTokens = draft === null ? null : parseDraftTokens(draft)
  const draftPct = draftTokens === null ? null : pctForTokens(draftTokens, contextWindow)
  const draftDirty =
    state != null &&
    draftTokens != null &&
    draftTokens !== Math.round((state.effectivePct / 100) * contextWindow)

  const flashSaved = () => {
    setSavedFlash(true)
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setSavedFlash(false), 1600)
  }

  /** Persist the draft as a per-model override + push it live to the broker. */
  const saveOverride = useCallback(async () => {
    if (!model || draftPct == null || savingBusy) return
    setSavingBusy(true)
    try {
      const raw = (await window.sylo.prefs.get(SYLO_COMPACTION_RESERVE_PREF, {})) as unknown
      const next = normalizeCompactionOverrides(raw)
      next[`${model.provider}:${model.modelId}`] = draftPct
      await window.sylo.prefs.set(SYLO_COMPACTION_RESERVE_PREF, next)
      const r = await window.sylo.compaction.apply(model.provider, model.modelId)
      if (r.ok) {
        draftTouchedRef.current = false
        await reload()
        flashSaved()
      }
    } finally {
      setSavingBusy(false)
    }
  }, [model, draftPct, savingBusy, reload])

  /** Delete the per-model override — back to Pi's default reserve. */
  const resetOverride = useCallback(async () => {
    if (!model || savingBusy) return
    setSavingBusy(true)
    try {
      const raw = (await window.sylo.prefs.get(SYLO_COMPACTION_RESERVE_PREF, {})) as unknown
      const next = normalizeCompactionOverrides(raw)
      delete next[`${model.provider}:${model.modelId}`]
      await window.sylo.prefs.set(SYLO_COMPACTION_RESERVE_PREF, next)
      draftTouchedRef.current = false
      const r = await window.sylo.compaction.apply(model.provider, model.modelId)
      if (r.ok) {
        await reload()
        flashSaved()
      }
    } finally {
      setSavingBusy(false)
    }
  }, [model, savingBusy, reload])

  const hasOverride = state?.overridePct != null
  const ready = state != null && model != null

  /** Trigger preview under the input (or the reason the input is invalid). */
  const draftLine = (): string => {
    if (state == null && !loadFailed) return 'Reading model…'
    if (draftTokens == null) return 'Enter a token count'
    if (draftPct == null) return `Above the window (${contextWindow.toLocaleString()} tok)`
    const reserve = Math.max(0, contextWindow - draftTokens)
    const pctText = `${draftPct.toLocaleString()}%`
    const windowText = state?.usesFallbackWindow ?
      `assuming ${contextWindow.toLocaleString()}-tok window`
    : `${contextWindow.toLocaleString()}-tok window`
    return `${pctText} of the ${windowText} · ${reserve.toLocaleString()} tok left free`
  }

  return (
    <div ref={anchorRef} className="relative shrink-0">
      <div className={chatCompactSplit} role="group" aria-label="Compaction">
        <button
          type="button"
          className={chatCompactMain}
          disabled={busy}
          title="Compact now — summarize older turns into a note to free context space"
          aria-label="Compact now"
          onClick={() => {
            setOpen(false)
            onCompact()
          }}
        >
          {busy ? 'Compacting…' : `Compact · ${fillPct.toFixed(0)}%`}
        </button>
        <button
          type="button"
          className={chatCompactCaretBtn}
          disabled={busy}
          title="Auto-compact trigger for this chat's model — set when compaction should run"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Auto-compact settings"
          onMouseDown={(e) => {
            // Clicks on this half toggling the menu are INSIDE the anchor, but
            // keep the composer textarea blur order predictable.
            e.preventDefault()
          }}
          onClick={() => setOpen((o) => !o)}
        >
          ▾
        </button>
      </div>
      {open ?
        <div className={chatCompactMenu} role="menu" aria-label="Auto-compact settings">
          <div className={chatCompactMenuHead}>
            Auto-compact{hasOverride ? ' · override' : ' (per model)'}
          </div>
          <div className={cn(chatCompactMenuMeta, 'px-3 pb-1.5 pt-0.5')}>
            {ready ?
              <>
                Compacts <span className="text-text-primary/85">{model!.modelId}</span> when the context reaches:
              </>
            : loadFailed ?
              "Could not read this chat's model — set the trigger under Settings → Model (Pi) → Compaction."
            : 'Reading model…'}
          </div>
          <div className="flex items-center gap-2 px-3">
            <input
              type="text"
              inputMode="numeric"
              className={chatCompactMenuInput}
              value={draft ?? ''}
              disabled={state == null || !state.autoCompactionEnabled || savingBusy}
              aria-label="Auto-compact context size in tokens"
              placeholder={state ? Math.round((state.effectivePct / 100) * contextWindow).toLocaleString() : ''}
              onChange={(e) => {
                draftTouchedRef.current = true
                setDraft(e.target.value.replace(/[^0-9]/g, ''))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draftDirty && draftPct != null) {
                  e.preventDefault()
                  void saveOverride()
                }
              }}
            />
            <span className={cn(chatCompactMenuMeta, 'shrink-0 whitespace-nowrap')}>tok</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 pt-1">
            <span
              className={cn(
                chatCompactMenuMeta,
                'min-w-0 flex-1 truncate',
                draftTokens != null && draftPct == null && 'text-[#e8a26a]',
              )}
            >
              {draftLine()}
            </span>
            {ready && hasOverride ?
              <button
                type="button"
                className={chatCompactMenuBtn}
                disabled={savingBusy}
                title={`Delete this override — back to Pi's default ${PI_DEFAULT_COMPACTION_RESERVE_TOKENS.toLocaleString()}-token reserve`}
                onClick={() => void resetOverride()}
              >
                Reset
              </button>
            : null}
            <button
              type="button"
              className={chatCompactMenuBtn}
              disabled={state == null || !draftDirty || draftPct == null || savingBusy}
              title="Save this auto-compact trigger for this model (applies live, no restart)"
              onClick={() => void saveOverride()}
            >
              {savedFlash ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          <div className="px-3 pt-1.5">
            <div className="h-1 w-full overflow-hidden rounded-full bg-[rgb(255_255_255/0.08)]">
              <div
                className={cn(
                  'h-full rounded-full transition-[width,background-color] duration-300',
                  state != null && fillPct >= state.effectivePct ? 'bg-[#e8a26a]' : 'bg-accent/70',
                )}
                style={{ width: `${fillPct}%` }}
                aria-hidden="true"
              />
            </div>
            <div className={cn(chatCompactMenuMeta, 'pt-1')}>
              Now: {contextTokens.toLocaleString()} tok ({fillPct.toFixed(0)}% of{' '}
              {contextWindow.toLocaleString()})
              {state?.usesFallbackWindow ? ' (assumed)' : ''}
            </div>
          </div>
          {state && !state.autoCompactionEnabled ?
            <div className={cn(chatCompactMenuMeta, 'px-3 pt-1.5 text-[#e8a26a]')}>
              Auto-compaction is OFF in ~/.pi/agent/settings.json (compaction.enabled = false) — the trigger has
              no effect until it is re-enabled. Compact now still works.
            </div>
          : null}
          <button
            type="button"
            className={chatCompactMenuPrimary}
            disabled={busy}
            title="Summarize older turns into a note to free context space"
            onClick={() => {
              setOpen(false)
              onCompact()
            }}
          >
            {busy ? 'Compacting…' : 'Compact now'}
          </button>
        </div>
      : null}
    </div>
  )
}