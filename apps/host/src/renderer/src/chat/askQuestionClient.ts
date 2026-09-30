import {
  parseAskQuestionSpecs,
  type AskQuestionPrompt,
  type AskQuestionSubmit,
} from '../../../shared/ask-question'

export function ingestAskQuestionPayload(raw: Record<string, unknown>): void {
  const requestId = typeof raw.requestId === 'string' ? raw.requestId.trim() : ''
  const toolCallId = typeof raw.toolCallId === 'string' ? raw.toolCallId.trim() : ''
  const questions = parseAskQuestionSpecs(raw.questions)
  if (!requestId || !toolCallId || questions.length === 0) return
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  upsertAskQuestionPrompt({
    requestId,
    toolCallId,
    conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : null,
    messageId: typeof raw.messageId === 'string' ? raw.messageId : null,
    ...(title ? { title } : {}),
    questions,
    // Host-stamped question time — anchors turn-timer pause windows even across a
    // renderer reload (the reseed re-sends the original stamp).
    ...(typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? { createdAt: raw.createdAt } : {}),
  })
}

type SubmitFn = (
  payload: AskQuestionSubmit,
) => Promise<{ ok: true } | { ok: false; error: string }>

let submitImpl: SubmitFn | null = null
const pendingByToolCallId = new Map<string, AskQuestionPrompt>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const cb of listeners) cb()
}

export function setAskQuestionSubmitImpl(fn: SubmitFn | null): void {
  submitImpl = fn
}

export function upsertAskQuestionPrompt(prompt: AskQuestionPrompt): void {
  const id = prompt.toolCallId.trim()
  if (!id) return
  // Reseeding polls (companion/desktop reload recovery) re-send identical payloads —
  // only notify subscribers when something actually changed.
  const prev = pendingByToolCallId.get(id)
  if (prev && JSON.stringify(prev) === JSON.stringify(prompt)) return
  pendingByToolCallId.set(id, prompt)
  syncQuestionPauseForConversation(prompt.conversationId)
  notify()
}

export function clearAskQuestionPrompt(toolCallId: string): void {
  const cleared = pendingByToolCallId.get(toolCallId)
  if (!pendingByToolCallId.delete(toolCallId)) return
  // The question resolved mid-turn (answered / cancelled): close its pause window
  // and bank the wait into pausedTotalMs. The turn keeps streaming, so the ledger
  // entry must survive until the turn boundary.
  syncQuestionPauseForConversation(cleared?.conversationId)
  notify()
}

export function getAskQuestionPrompt(toolCallId: string): AskQuestionPrompt | undefined {
  return pendingByToolCallId.get(toolCallId)
}

/**
 * Conversation ids that currently have an unanswered question (operator attention
 * needed).
 */
export function pendingQuestionConversationIds(): Set<string> {
  const out = new Set<string>()
  for (const prompt of pendingByToolCallId.values()) {
    const convId = prompt.conversationId?.trim()
    if (convId) out.add(convId)
  }
  return out
}

// --- Turn-pause ledger --------------------------------------------------------------
//
// While a conversation's live turn is parked on an unanswered ask-question the
// turn/reply elapsed timers must not count operator-wait time: pause semantics —
// the timer freezes when the question opens, and resumes FROM the frozen value
// once the answer lands (each paused interval is subtracted, not absorbed).
//
// One entry per conversation:
//   - opens  when the first pending question for that conversation appears
//   - closes + accumulates pausedTotalMs when its last pending question clears
//     (same turn keeps running, so the total must survive)
//   - the entire entry is dropped at the turn boundary
//     (clearAskQuestionPromptsForConversation — turn ended or a new one started)
//     so the NEXT turn counts from zero again.

export type ConversationPauseSnapshot = {
  /** True while at least one question is pending for the conversation. */
  paused: boolean
  /** When the open pause began (question tool start); null when not paused. */
  pausedSinceTs: number | null
  /** Total ms of already-closed pause intervals in the current turn. */
  pausedTotalMs: number
}

/** Shared stable "no pause" value — identity-safe for memoized React props. */
export const NO_QUESTION_PAUSE: ConversationPauseSnapshot = {
  paused: false,
  pausedSinceTs: null,
  pausedTotalMs: 0,
}

type ConversationPauseLedger = {
  paused: boolean
  pausedSinceTs: number | null
  pausedTotalMs: number
}
const pauseLedgerByConv = new Map<string, ConversationPauseLedger>()

export function conversationPauseSnapshot(
  conversationId: string | null | undefined,
): ConversationPauseSnapshot {
  const id = conversationId?.trim()
  const led = id ? pauseLedgerByConv.get(id) : undefined
  if (!led) return NO_QUESTION_PAUSE
  if (!led.paused || led.pausedSinceTs === null) {
    // Pause closed but the same turn is still running: keep surfacing the banked
    // waits so resumed timers continue subtracting them until the turn boundary
    // wipes the entry. Nothing banked → collapse to the stable identity.
    if (led.pausedTotalMs <= 0) return NO_QUESTION_PAUSE
    return { paused: false, pausedSinceTs: null, pausedTotalMs: led.pausedTotalMs }
  }
  return {
    paused: led.paused,
    pausedSinceTs: led.pausedSinceTs,
    pausedTotalMs: led.pausedTotalMs,
  }
}

/**
 * Re-sync the pause ledger for one conversation after a pending-question mutation.
 * Opens/closes the pause window from whichever pending questions currently exist;
 * earliest question timestamp wins so waits that started earlier are not re-anchored.
 */
function syncQuestionPauseForConversation(conversationId: string | null | undefined): void {
  const id = conversationId?.trim()
  if (!id) return
  let earliestPendingTs: number | null = null
  let pendingCount = 0
  for (const prompt of pendingByToolCallId.values()) {
    if (prompt.conversationId?.trim() !== id) continue
    pendingCount += 1
    const ts = typeof prompt.createdAt === 'number' && Number.isFinite(prompt.createdAt) ? prompt.createdAt : null
    if (ts !== null && (earliestPendingTs === null || ts < earliestPendingTs)) {
      earliestPendingTs = ts
    }
  }
  const led = pauseLedgerByConv.get(id)
  if (pendingCount > 0) {
    const openTs = earliestPendingTs ?? Date.now()
    if (!led) {
      pauseLedgerByConv.set(id, { paused: true, pausedSinceTs: openTs, pausedTotalMs: 0 })
    } else if (!led.paused) {
      led.paused = true
      led.pausedSinceTs = openTs
    } else if (led.pausedSinceTs !== null && openTs < led.pausedSinceTs) {
      led.pausedSinceTs = openTs
    }
  } else if (led && led.paused) {
    led.paused = false
    led.pausedTotalMs += Math.max(0, Date.now() - (led.pausedSinceTs ?? Date.now()))
    led.pausedSinceTs = null
  }
}

/**
 * Drop every unanswered question for a conversation — the turn ended (done, error,
 * abort, broker exit) or a new one started, so nothing in it is answerable anymore.
 * Keeps the sidebar's "attention needed" indicator from sticking forever when a
 * waiting turn dies without the question being submitted.
 *
 * This is the turn boundary, so the pause ledger entry is dropped with it — the
 * next turn's timers must count from zero, not subtract the old turn's waits.
 */
export function clearAskQuestionPromptsForConversation(conversationId: string): void {
  const id = conversationId.trim()
  if (!id) return
  let removed = false
  for (const [toolCallId, prompt] of [...pendingByToolCallId.entries()]) {
    if (prompt.conversationId?.trim() === id) {
      pendingByToolCallId.delete(toolCallId)
      removed = true
    }
  }
  // Turn boundary: the pause ledger entry belongs to the turn that just ended —
  // wipe it even when every question was already answered individually, so the
  // next turn's timers count from zero instead of subtracting old waits.
  const hadLedger = pauseLedgerByConv.delete(id)
  if (removed || hadLedger) notify()
}

export function subscribeAskQuestionPrompts(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export async function submitAskQuestion(
  payload: AskQuestionSubmit,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (submitImpl) return submitImpl(payload)
  if (typeof window !== 'undefined' && window.sylo?.askQuestion?.submit) {
    return window.sylo.askQuestion.submit(payload)
  }
  return { ok: false, error: 'ask_question_unavailable' }
}
