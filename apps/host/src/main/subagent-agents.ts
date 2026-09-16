import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseFrontmatter } from '@earendil-works/pi-coding-agent'

import { PI_BUILTIN_TOOL_IDS, isPiBuiltinToolId } from '../shared/pi-builtin-tools.js'

/**
 * Read-only view of the agent personas the subagents extension would discover.
 *
 * The extension does its own discovery inside the broker (see
 * `packages/sylo-subagents/extensions/agents.ts`); this exists so Settings can list the
 * personas without reaching across the package boundary or waiting on a broker round trip.
 * Precedence matches the extension: builtin, then user, then project.
 */
export type SubagentAgentInfo = {
  name: string
  description: string
  source: 'builtin' | 'user' | 'project'
  /** Frontmatter `tools:`, or undefined when the persona is unrestricted. */
  tools?: string[]
  /** Frontmatter `timeout_seconds`, or undefined when it uses the default. */
  timeoutSeconds?: number
}

export type SubagentAgentScope = 'user' | 'project' | 'both'

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function readAgentsIn(dir: string, source: SubagentAgentInfo['source']): SubagentAgentInfo[] {
  if (!isDirectory(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: SubagentAgentInfo[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    let fm: Record<string, unknown>
    try {
      fm = parseFrontmatter(readFileSync(join(dir, entry), 'utf8')).frontmatter as Record<
        string,
        unknown
      >
    } catch {
      continue
    }
    const name = typeof fm.name === 'string' ? fm.name.trim() : ''
    const description = typeof fm.description === 'string' ? fm.description.trim() : ''
    if (!name || !description) continue
    // Split the same way the extension does, so Settings shows what would actually be enforced.
    const tools =
      typeof fm.tools === 'string'
        ? fm.tools
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : []
    const timeout = Number(fm.timeout_seconds)
    out.push({
      name,
      description,
      source,
      ...(tools.length > 0 ? { tools } : {}),
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutSeconds: timeout } : {}),
    })
  }
  return out
}

/** Walk up from `cwd` for the nearest `.pi/agents`, the way the extension does. */
export function nearestProjectAgentsDir(cwd: string): string | null {
  let current = cwd
  for (;;) {
    const candidate = join(current, '.pi', 'agents')
    if (isDirectory(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function listSubagentAgents(opts: {
  bundledDir: string
  userAgentsDir: string
  projectCwd: string
  scope: SubagentAgentScope
}): SubagentAgentInfo[] {
  const { bundledDir, userAgentsDir, projectCwd, scope } = opts
  const projectDir = scope === 'user' ? null : nearestProjectAgentsDir(projectCwd)

  const byName = new Map<string, SubagentAgentInfo>()
  const layers: SubagentAgentInfo[][] = [
    scope === 'project' ? [] : readAgentsIn(bundledDir, 'builtin'),
    scope === 'project' ? [] : readAgentsIn(userAgentsDir, 'user'),
    projectDir ? readAgentsIn(projectDir, 'project') : [],
  ]
  for (const layer of layers) {
    for (const agent of layer) byName.set(agent.name, agent)
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Same charset the composer's `@mention` parser accepts — an agent whose name
 * cannot be mentioned would be invisible to the feature it exists for.
 */
const SUBAGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/

export type CustomSubagentInput = {
  name: string
  description: string
  prompt: string
  /**
   * Pi built-in tools this agent may use, written as frontmatter `tools:` and
   * passed to the child as `--tools`. Omitted, or all of them, means
   * unrestricted — the extension only sends `--tools` when the list is a subset.
   */
  tools?: readonly string[]
  /** Frontmatter `timeout_seconds` wall-clock kill. Omitted keeps Sylo's default. */
  timeoutSeconds?: number
}

/**
 * Bounds for `timeout_seconds`, matching what the extension actually honours
 * (`resolveSubagentTimeoutMs` clamps to 60s–2h). Accepting a wider range here
 * would just write a number that is silently clamped at run time.
 */
const MIN_SUBAGENT_TIMEOUT_SECONDS = 60
const MAX_SUBAGENT_TIMEOUT_SECONDS = 7_200

export type CustomSubagentWriteResult =
  | { ok: true; name: string; filePath: string }
  | { ok: false; error: string }

/** Double-quoted YAML scalar. JSON escaping is a valid subset, so this is safe for any input. */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/** Canonical tool order, deduped, so the written file does not depend on click order. */
function orderedTools(tools: readonly string[]): string[] {
  const picked = new Set(tools)
  return PI_BUILTIN_TOOL_IDS.filter((id) => picked.has(id))
}

/** Full path of the user-scope agent file whose frontmatter declares `name`. */
function findUserAgentFile(userAgentsDir: string, name: string): string | null {
  if (!isDirectory(userAgentsDir)) return null
  let entries: string[]
  try {
    entries = readdirSync(userAgentsDir)
  } catch {
    return null
  }
  const needle = name.trim().toLowerCase()
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const filePath = join(userAgentsDir, entry)
    try {
      const fm = parseFrontmatter(readFileSync(filePath, 'utf8')).frontmatter as Record<
        string,
        unknown
      >
      const declared = typeof fm.name === 'string' ? fm.name.trim().toLowerCase() : ''
      if (declared && declared === needle) return filePath
    } catch {
      continue
    }
  }
  return null
}

/**
 * Validate an input and render the persona file, or explain what is wrong.
 *
 * Shared by create and update so an edit cannot slip past a rule the create
 * path enforces.
 */
function renderAgentFile(
  input: CustomSubagentInput,
): { ok: true; name: string; body: string } | { ok: false; error: string } {
  const name = input.name.trim()
  const description = input.description.trim()
  const prompt = input.prompt.trim()

  if (!SUBAGENT_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      error:
        'Name must start with a letter or number and use only letters, numbers, dot, dash, or underscore (max 48 characters).',
    }
  }
  if (!description) return { ok: false, error: 'Add a short description of what this agent is for.' }
  if (!prompt) return { ok: false, error: 'Add the instructions this agent should run with.' }

  const tools = input.tools?.map((t) => t.trim()).filter(Boolean) ?? []
  const unknown = tools.filter((t) => !isPiBuiltinToolId(t))
  if (unknown.length > 0) {
    return { ok: false, error: `Not a Pi tool: ${unknown.join(', ')}.` }
  }
  // An empty `tools:` is indistinguishable from an absent one, and the extension
  // reads absent as *unrestricted* — so silently writing an empty list would hand
  // the agent everything, the exact opposite of clearing every box.
  if (input.tools && tools.length === 0) {
    return {
      ok: false,
      error:
        'Leave at least one tool enabled. An agent with no tools cannot act, and an empty list is read as "all tools".',
    }
  }

  const timeoutSeconds = input.timeoutSeconds
  if (timeoutSeconds != null) {
    if (!Number.isInteger(timeoutSeconds)) {
      return { ok: false, error: 'Timeout must be a whole number of seconds.' }
    }
    if (
      timeoutSeconds < MIN_SUBAGENT_TIMEOUT_SECONDS ||
      timeoutSeconds > MAX_SUBAGENT_TIMEOUT_SECONDS
    ) {
      return {
        ok: false,
        error: `Timeout must be between ${MIN_SUBAGENT_TIMEOUT_SECONDS} and ${MAX_SUBAGENT_TIMEOUT_SECONDS} seconds.`,
      }
    }
  }

  // Only a genuine subset is worth recording: writing all seven is the same as
  // saying nothing, and the shorter file is easier to hand-edit later.
  const restricted = tools.length > 0 && tools.length < PI_BUILTIN_TOOL_IDS.length
  const body = [
    '---',
    `name: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
    // Plain comma list, not a quoted scalar: the extension splits this on ','.
    ...(restricted ? [`tools: ${orderedTools(tools).join(', ')}`] : []),
    ...(timeoutSeconds != null ? [`timeout_seconds: ${timeoutSeconds}`] : []),
    '---',
    '',
    prompt,
    '',
  ].join('\n')

  return { ok: true, name, body }
}

/**
 * Write a new user-scope agent persona.
 *
 * The extension re-reads `~/.pi/agent/agents` on every run, so a new persona is
 * usable immediately — only *model pins* need a broker restart, because those
 * ride in the broker's env.
 */
export function writeCustomSubagent(opts: {
  userAgentsDir: string
  /** Names already taken across every scope, so a custom agent cannot shadow a builtin. */
  existingNames: readonly string[]
  input: CustomSubagentInput
}): CustomSubagentWriteResult {
  const rendered = renderAgentFile(opts.input)
  if (!rendered.ok) return rendered
  const { name, body } = rendered

  if (opts.existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `An agent named "${name}" already exists.` }
  }

  const filePath = join(opts.userAgentsDir, `${name.toLowerCase()}.md`)
  try {
    mkdirSync(opts.userAgentsDir, { recursive: true })
    // 'wx' so a persona file left behind by a prior name is never silently clobbered.
    writeFileSync(filePath, body, { encoding: 'utf8', flag: 'wx' })
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'EEXIST') {
      return { ok: false, error: `${filePath} already exists. Pick a different name.` }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, name, filePath }
}

/** A user-scope persona as the editor needs it: every field that produced the file. */
export type CustomSubagentDetail = {
  name: string
  description: string
  prompt: string
  tools?: string[]
  timeoutSeconds?: number
  filePath: string
}

/** Read one user-scope persona back for editing. Builtin and project agents are not editable. */
export function readCustomSubagent(opts: {
  userAgentsDir: string
  name: string
}): { ok: true; agent: CustomSubagentDetail } | { ok: false; error: string } {
  const filePath = findUserAgentFile(opts.userAgentsDir, opts.name)
  if (!filePath) {
    return {
      ok: false,
      error: `No custom agent named "${opts.name}" under ${opts.userAgentsDir}. Builtin and project agents are edited as files.`,
    }
  }
  let parsed: { frontmatter: Record<string, unknown>; body: string }
  try {
    const raw = readFileSync(filePath, 'utf8')
    const fm = parseFrontmatter(raw)
    parsed = { frontmatter: fm.frontmatter as Record<string, unknown>, body: fm.body }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const fm = parsed.frontmatter
  const tools =
    typeof fm.tools === 'string'
      ? fm.tools
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : []
  const timeout = Number(fm.timeout_seconds)
  return {
    ok: true,
    agent: {
      name: typeof fm.name === 'string' ? fm.name.trim() : opts.name,
      description: typeof fm.description === 'string' ? fm.description.trim() : '',
      prompt: parsed.body.trim(),
      ...(tools.length > 0 ? { tools } : {}),
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutSeconds: timeout } : {}),
      filePath,
    },
  }
}

/**
 * Overwrite an existing user-scope persona in place.
 *
 * The name is the identity here — it keys model pins and is what `@mention`
 * types — so it is not editable; renaming is a delete plus a create.
 */
export function updateCustomSubagent(opts: {
  userAgentsDir: string
  input: CustomSubagentInput
}): CustomSubagentWriteResult {
  const rendered = renderAgentFile(opts.input)
  if (!rendered.ok) return rendered
  const { name, body } = rendered

  // Target the file that actually declares this name, which need not be
  // `<name>.md` if it was hand-created.
  const filePath = findUserAgentFile(opts.userAgentsDir, name)
  if (!filePath) {
    return {
      ok: false,
      error: `No custom agent named "${name}" to update under ${opts.userAgentsDir}.`,
    }
  }
  try {
    writeFileSync(filePath, body, 'utf8')
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, name, filePath }
}

/** Delete a user-scope persona. Builtin and project agents are not ours to remove. */
export function deleteCustomSubagent(opts: {
  userAgentsDir: string
  name: string
}): { ok: true; filePath: string } | { ok: false; error: string } {
  const filePath = findUserAgentFile(opts.userAgentsDir, opts.name)
  if (!filePath) {
    return { ok: false, error: `No custom agent named "${opts.name}" under ${opts.userAgentsDir}.` }
  }
  try {
    rmSync(filePath)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, filePath }
}
