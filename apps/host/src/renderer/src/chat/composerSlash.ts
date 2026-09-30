/**
 * Composer `/`-surface (tasks 09 + 10): quick commands + workflow picker.
 *
 * One registry so the dropdown and the submit interceptor agree. `/command`
 * picks/typing runs App-side actions (/compact /clear /model); workflows are
 * markdown prompts inserted into the composer for review — nothing sends
 * without the operator pressing Send. Unknown `/word` falls through to the
 * existing Pi slash-command path (isPiUserSlashCommand main-side), which is
 * exactly the old behavior for `/mcp reconnect`, …
 */

export type ComposerSlashCommand = {
  name: string
  description: string
  /** Short non-blocking usage hint shown when the command is typed with args. */
  usageHint?: string
}

export const COMPOSER_SLASH_COMMANDS: ComposerSlashCommand[] = [
  {
    name: 'compact',
    description: 'Compact this chat now — older turns summarized into a note to free context',
    usageHint: '/compact takes no arguments',
  },
  {
    name: 'clear',
    description: 'Archive this chat and start fresh (guided confirm; delete-forever is a separate guarded choice)',
    usageHint: '/clear takes no arguments',
  },
  {
    name: 'model',
    description: "Switch this chat's model — highlights the model bar under the transcript",
    usageHint: '/model takes no arguments — pick in the highlighted bar',
  },
]

export type SlashQuerySpan = { query: string; start: number; end: number }

/**
 * The `/`-token at the caret for the picker: the token must START the input or
 * sit right after a newline (pickers open on leading commands, not mid-prose).
 * Query accepts command-name chars; empty query lists everything.
 */
export function slashQueryAtCaret(text: string, caret: number): SlashQuerySpan | null {
  const upto = text.slice(0, caret)
  const slash = upto.lastIndexOf('/')
  if (slash < 0) return null
  if (slash !== 0 && upto[slash - 1] !== '\n') return null
  const query = upto.slice(slash + 1)
  if (/[\s/]/.test(query)) return null
  if (query && !/^[A-Za-z0-9_-]*$/.test(query)) return null
  const rest = /^[A-Za-z0-9_-]*/.exec(text.slice(caret))?.[0] ?? ''
  return { query, start: slash, end: caret + rest.length }
}

/**
 * Parse a full composer submission as a composer-level quick command
 * (`/name args`); null for normal text, unknown names (Pi keeps those) and
 * `/skill:…` invocations.
 */
export function extractComposerSlashCommand(text: string): { name: string; arg: string; hasArgs: boolean } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('/skill:')) return null
  const m = /^\/([A-Za-z][A-Za-z0-9_-]*)(?:\n? +(.*\S))?\s*$/.exec(trimmed)
  if (!m) return null
  return { name: m[1]!.toLowerCase(), arg: (m[2] ?? '').trim(), hasArgs: Boolean(m[2]) }
}

export function isComposerQuickCommand(name: string): boolean {
  return COMPOSER_SLASH_COMMANDS.some((c) => c.name === name)
}

/** Unique {{placeholder}} names in a workflow body, in first-seen order. */
export function workflowPlaceholders(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\{\{\s*([A-Za-z0-9_ .-]+?)\s*\}\}/g
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const name = m[1]!.trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}