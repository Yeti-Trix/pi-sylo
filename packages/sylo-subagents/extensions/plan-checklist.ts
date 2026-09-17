/** Parse planner markdown. Each `##` section is a goal; the body stays detailed. */

/**
 * How far a goal has got.
 *
 * `built` is the state that makes a crash survivable: the worker finished the section
 * but no reviewer has judged it yet. Without it a run that built two sections and then
 * died looked identical to one that had done nothing, and the resumed run redid the work.
 * Only a reviewer's `VERDICT: PASS` promotes `built` to `passed`.
 */
export type PlanGoalState = 'open' | 'built' | 'passed'

export type PlanTodo = {
  id: string
  text: string
  /** Reviewed and passed. Kept separate from `state` so callers counting "done" stay honest. */
  done: boolean
  state: PlanGoalState
}

const H1_RE = /^#\s+(.*)$/
const H2_RE = /^##\s+(.*)$/
const SECTION_CHECK_RE = /^\[([ xX~])\]\s+(.+)$/

const STATE_MARK: Record<PlanGoalState, string> = { open: ' ', built: '~', passed: 'x' }

function markToState(mark: string): PlanGoalState {
  if (mark === '~') return 'built'
  return mark === ' ' ? 'open' : 'passed'
}
const LIST_CHECK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/
const NUMBERED_RE = /^\s*\d+\.\s+(.+?)\s*$/

const RESERVED_H2 = new Set([
  'goal',
  'overview',
  'summary',
  'checklist',
  'files to modify',
  'files',
  'files changed',
  'risks',
  'notes',
  'notes (if any)',
  'context',
  'constraints',
  'completed',
])

function stripFrontmatter(markdown: string): { fm: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown)
  if (!m) return { fm: '', body: markdown }
  return { fm: m[0], body: markdown.slice(m[0].length) }
}

/** Plan body without the `---` frontmatter block. */
export function planBodyWithoutFrontmatter(markdown: string): string {
  return stripFrontmatter(markdown).body.trim()
}

function parseH2Title(raw: string): { state?: PlanGoalState; title: string } {
  const trimmed = raw.trim()
  const m = SECTION_CHECK_RE.exec(trimmed)
  if (m) return { state: markToState(m[1]!), title: m[2]!.trim() }
  return { title: trimmed }
}

export function isReservedGoalHeading(title: string): boolean {
  return RESERVED_H2.has(title.trim().toLowerCase())
}

function isGoalHeading(title: string): boolean {
  return Boolean(title) && !isReservedGoalHeading(title)
}

export function parsePlanTodos(markdown: string): PlanTodo[] {
  const { body } = stripFrontmatter(markdown)
  const todos: PlanTodo[] = []
  for (const line of body.split(/\r?\n/)) {
    const h = H2_RE.exec(line)
    if (!h) continue
    const parsed = parseH2Title(h[1]!)
    if (!isGoalHeading(parsed.title)) continue
    const state = parsed.state ?? 'open'
    todos.push({
      id: `t${todos.length}`,
      text: parsed.title,
      done: state === 'passed',
      state,
    })
  }
  return todos
}

export function extractPlanGoal(markdown: string): string | undefined {
  const { body } = stripFrontmatter(markdown)
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const h1 = H1_RE.exec(line)
    if (h1) {
      const title = h1[1]!.trim()
      if (title) return title
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (!/^##\s+Goal\s*$/i.test(lines[i]!)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!.trim()
      if (!line) continue
      if (line.startsWith('#')) break
      return line
    }
  }
  return parsePlanTodos(markdown)[0]?.text
}

export function parsePlanField(markdown: string, key: string): string | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (!m) return undefined
  const re = new RegExp(`^${key}:\\s*(.+?)\\s*$`)
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = re.exec(line)
    if (kv) return kv[1]!.trim()
  }
  return undefined
}

export function parsePlanConversationId(markdown: string): string | undefined {
  return parsePlanField(markdown, 'conversation_id')
}

export type PlanStatus = 'active' | 'reviewed'

export function parsePlanStatus(markdown: string): PlanStatus {
  return parsePlanField(markdown, 'status') === 'reviewed' ? 'reviewed' : 'active'
}

/**
 * The operator has moved on, so the goals bar stops showing this plan.
 *
 * Hiding is not deleting: a finished plan used to be unlinked on the next send,
 * which meant "continue" after a crash or a close had nothing left to bring back.
 */
export function parsePlanHidden(markdown: string): boolean {
  return parsePlanField(markdown, 'hidden') === 'true'
}

/** Every goal heading ticked. False when the plan has no goals at all. */
export function planGoalsComplete(markdown: string): boolean {
  const todos = parsePlanTodos(markdown)
  return todos.length > 0 && todos.every((t) => t.done)
}

/**
 * The plan has nothing left to execute, which means exactly one thing: a reviewer
 * signed it off.
 *
 * "Every box ticked" is deliberately NOT enough. Boxes can now be marked by the worker
 * that did the work, and retiring a plan on that alone would let a run finish with no
 * review at all — the operator asked for the opposite guarantee.
 */
export function isPlanFinished(markdown: string): boolean {
  return parsePlanStatus(markdown) === 'reviewed'
}

/** First goal a worker still has to build. */
export function nextGoalToBuild(markdown: string): PlanTodo | undefined {
  return parsePlanTodos(markdown).find((t) => t.state === 'open')
}

/** First built-but-unreviewed goal — the section a reviewer should judge next. */
export function nextGoalToReview(markdown: string): PlanTodo | undefined {
  return parsePlanTodos(markdown).find((t) => t.state === 'built')
}

/** First goal that is not finished, whether it needs building or reviewing. */
export function nextOpenGoal(markdown: string): PlanTodo | undefined {
  return parsePlanTodos(markdown).find((t) => t.state !== 'passed')
}

export type ReviewVerdict = 'pass' | 'fail' | 'none'

/**
 * Read a reviewer's `VERDICT: PASS` / `VERDICT: FAIL` sign-off line.
 *
 * Only the marker line counts, and the last one wins — reviewers quote the plan's
 * own "return explicit PASS/FAIL" wording in their prose, so scanning for the bare
 * words would read a template echo as a verdict. Anything else is `none`, which
 * leaves the goal open.
 */
export function parseReviewVerdict(resultText: string | undefined): ReviewVerdict {
  if (!resultText) return 'none'
  let verdict: ReviewVerdict = 'none'
  for (const line of resultText.split(/\r?\n/)) {
    const m = /^\s*>?\s*\**\s*VERDICT\s*\**\s*:\s*\**\s*(PASS|FAIL)\b/i.exec(line)
    if (m) verdict = m[1]!.toLowerCase() === 'pass' ? 'pass' : 'fail'
  }
  return verdict
}

/** Loose compare for goal titles, so surrounding punctuation or case never blocks a tick. */
export function sameGoalTitle(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  return norm(a) === norm(b) && norm(a).length > 0
}

/** A goal only moves forward, except a failed review which sends it back to `open`. */
function canTransition(from: PlanGoalState, to: PlanGoalState): boolean {
  if (from === to) return false
  if (to === 'built') return from === 'open'
  return true
}

/**
 * Set the state of goal headings. `goals` names the sections; `'all'` applies to every
 * goal, which is what a whole-plan review covers.
 *
 * Sylo owns this write, not the agents. Asking the worker to edit its own heading meant
 * the agent that wrote the code also certified it, and in practice it simply never
 * happened — plans sat at 0 ticked through repeated "successful" runs.
 */
export function setPlanGoalStates(
  markdown: string,
  goals: readonly string[] | 'all',
  state: PlanGoalState,
): string {
  const { fm, body } = stripFrontmatter(markdown)
  const wanted = goals === 'all' ? null : goals.filter((g) => g.trim().length > 0)
  if (wanted && wanted.length === 0) return markdown

  const lines = body.split(/\r?\n/)
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const h = H2_RE.exec(lines[i]!)
    if (!h) continue
    const parsed = parseH2Title(h[1]!)
    if (!isGoalHeading(parsed.title)) continue
    if (!canTransition(parsed.state ?? 'open', state)) continue
    if (wanted && !wanted.some((g) => sameGoalTitle(g, parsed.title))) continue
    lines[i] = `## [${STATE_MARK[state]}] ${parsed.title}`
    changed = true
  }
  if (!changed) return markdown
  return `${fm}${lines.join('\n')}`
}

/** Close goals outright — a reviewer passed them. */
export function tickPlanGoals(markdown: string, goals: readonly string[] | 'all'): string {
  return setPlanGoalStates(markdown, goals, 'passed')
}

function nextH2Index(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    if (H2_RE.test(lines[i]!)) return i
  }
  return lines.length
}

function listItemsInBlock(lines: string[]): { title: string; done: boolean }[] {
  const items: { title: string; done: boolean }[] = []
  for (const line of lines) {
    const check = LIST_CHECK_RE.exec(line)
    if (check) {
      const title = check[2]!.trim()
      if (title) items.push({ title, done: check[1] !== ' ' })
      continue
    }
    const numbered = NUMBERED_RE.exec(line)
    if (numbered) {
      const title = numbered[1]!.trim()
      if (title) items.push({ title, done: false })
    }
  }
  return items
}

function injectHeadingChecks(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const h = H2_RE.exec(line)
      if (!h) return line
      const parsed = parseH2Title(h[1]!)
      if (!isGoalHeading(parsed.title)) return line
      if (parsed.state !== undefined) return line
      return `## [ ] ${parsed.title}`
    })
    .join('\n')
}

function promoteGoalToH1(body: string): string {
  if (body.split(/\r?\n/).some((line) => H1_RE.test(line))) return body
  const lines = body.split(/\r?\n/)
  const goalIdx = lines.findIndex((line) => /^##\s+Goal\s*$/i.test(line))
  if (goalIdx < 0) return body
  const end = nextH2Index(lines, goalIdx + 1)
  const block = lines.slice(goalIdx + 1, end)
  let title = ''
  const rest: string[] = []
  for (const line of block) {
    if (!title && line.trim() && !line.startsWith('#')) {
      title = line.trim()
      continue
    }
    rest.push(line)
  }
  if (!title) return body
  return [...lines.slice(0, goalIdx), `# ${title}`, ...rest, ...lines.slice(end)].join('\n')
}

function convertLegacyChecklist(body: string): string {
  if (parsePlanTodos(body).length > 0) return body
  const lines = body.split(/\r?\n/)
  const checkIdx = lines.findIndex((line) => /^##\s+Checklist\s*$/i.test(line))
  if (checkIdx >= 0) {
    const end = nextH2Index(lines, checkIdx + 1)
    const items = listItemsInBlock(lines.slice(checkIdx + 1, end))
    if (items.length > 0) {
      const sections = items.flatMap((item) => [
        `## [${item.done ? 'x' : ' '}] ${item.title}`,
        '',
      ])
      return [...lines.slice(0, checkIdx), ...sections, ...lines.slice(end)].join('\n')
    }
  }

  const items = listItemsInBlock(lines)
  if (items.length === 0) return body
  const kept = lines.filter((line) => !LIST_CHECK_RE.test(line) && !NUMBERED_RE.test(line))
  const sections = items.flatMap((item) => [`## [${item.done ? 'x' : ' '}] ${item.title}`, ''])
  return `${kept.join('\n').trim()}\n\n${sections.join('\n')}`.trim()
}

/**
 * Keep a detailed sectioned plan. Add `[ ]` on goal headings when missing.
 * Only flatten a numbered/`- [ ]` list when the planner wrote no `##` goals.
 */
export function ensureSectionGoals(body: string): string {
  const text = body.trim()
  if (!text) return text
  const { fm, body: raw } = stripFrontmatter(text)
  let next = promoteGoalToH1(raw)
  next = convertLegacyChecklist(next)
  next = injectHeadingChecks(next)
  return `${fm}${next}`.trim()
}

/** @deprecated Use ensureSectionGoals — plans are sectioned, not a flat list. */
export function ensureChecklist(body: string): string {
  return ensureSectionGoals(body)
}

export type PlanSnapshot = {
  goal?: string
  todos: PlanTodo[]
  conversationId?: string
  status: PlanStatus
  hidden: boolean
}

export function snapshotPlanMarkdown(markdown: string): PlanSnapshot {
  return {
    goal: extractPlanGoal(markdown),
    todos: parsePlanTodos(markdown),
    conversationId: parsePlanConversationId(markdown),
    status: parsePlanStatus(markdown),
    hidden: parsePlanHidden(markdown),
  }
}
