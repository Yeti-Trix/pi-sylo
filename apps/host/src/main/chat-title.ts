/**
 * Auto-derive a chat title from the operator's first user message.
 *
 * Rule: take the first sentence, or the first 80 characters — whichever is
 * shorter. Pure string transform with no I/O so the main process can call it
 * synchronously on every new chat without touching the model or the broker.
 *
 * This is intentionally a deterministic local helper. An "AI titles" mode was
 * considered (separate small model via a sidecar Pi session) and rejected for
 * the MVP to avoid silent token spend per new chat. The operator can always
 * rename via the existing "Rename" context-menu action.
 */

/** Hard cap on the persisted title length, in JS string length units. */
export const CHAT_TITLE_MAX_LEN = 80

/**
 * Conversation titles considered "auto-eligible" — safe to overwrite with a
 * derived title. Comparison is trim + lowercase.
 *
 * - `''` and `'(untitled)'`: created by `newChat` and the markdown export
 *   fallback respectively (renderer shows `(untitled)` for blank titles).
 * - `'chat'`: the placeholder seeded by the empty-workspace bootstrap and the
 *   broker fallback in `registerBroker`.
 *
 * Any other title is treated as operator intent (manual rename, branch chat
 * `'… (branch)'`, etc.) and must NOT be overwritten.
 */
const AUTO_TITLE_ELIGIBLE_VALUES: ReadonlySet<string> = new Set([
  '',
  '(untitled)',
  'chat',
  'new chat',
])

export function isAutoTitleEligible(currentTitle: string | undefined | null): boolean {
  if (typeof currentTitle !== 'string') return true
  return AUTO_TITLE_ELIGIBLE_VALUES.has(currentTitle.trim().toLowerCase())
}

/**
 * Collapse a possibly multi-line user message into a single-line string with
 * runs of whitespace normalized to one space. Blank lines and lines that are
 * pure whitespace are dropped before joining.
 */
function flattenWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip a single leading markdown decoration so titles drawn from things like
 * "# Question" or "- todo item" don't carry the formatting marker. Only the
 * very first marker is removed; interior markdown is left alone.
 */
function stripLeadingMarkdownNoise(text: string): string {
  return text
    .replace(/^```[a-zA-Z0-9_+\-.]*\s*/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^>\s+/, '')
    .trim()
}

/**
 * Match the shortest prefix that ends in a sentence terminator (`.`, `!`, `?`)
 * within the first 80 characters. Allows an optional trailing close-quote or
 * close-bracket so things like `She said "hi!"` end cleanly.
 *
 * Returns the matched text (terminator included), or undefined if no full
 * sentence fits in the budget.
 */
function firstSentenceWithinBudget(text: string): string | undefined {
  const m = text.match(/^(.{1,80}?[.!?][)\]"'\u201D\u2019]?)(?=\s|$)/u)
  if (!m) return undefined
  return m[1]
}

/**
 * Truncate a >80-char single-line string to <=80 chars on a word boundary,
 * appending a horizontal ellipsis. Falls back to a hard cut when the last
 * space sits absurdly early (e.g. a single 200-char unbroken token).
 */
function smartTruncate(text: string): string {
  if (text.length <= CHAT_TITLE_MAX_LEN) return text
  const sliceLen = CHAT_TITLE_MAX_LEN - 1 // leave one slot for the ellipsis
  const hard = text.slice(0, sliceLen)
  const lastSpace = hard.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(sliceLen / 2) ? hard.slice(0, lastSpace) : hard
  return cut.replace(/[\s,.;:!?\-–—]+$/u, '') + '\u2026'
}

/**
 * Derive a chat title from the operator's first user message.
 *
 * @param text Raw user text (the value passed to `chat:send`, before any image
 *   metadata is appended for persistence). Newlines and markdown decorations
 *   are tolerated and normalized.
 * @returns A trimmed title <=80 characters. Returns `''` when the input has no
 *   visible characters; callers should treat that as "no auto-title" and leave
 *   the existing placeholder in place.
 */
export function deriveChatTitleFromUserText(text: unknown): string {
  if (typeof text !== 'string') return ''
  const flat = flattenWhitespace(text)
  if (!flat) return ''
  const stripped = stripLeadingMarkdownNoise(flat)
  const source = stripped.length > 0 ? stripped : flat

  const sentence = firstSentenceWithinBudget(source)
  if (sentence) return sentence.trim().slice(0, CHAT_TITLE_MAX_LEN)

  if (source.length <= CHAT_TITLE_MAX_LEN) return source
  return smartTruncate(source)
}
