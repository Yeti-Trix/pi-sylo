/**
 * Sylo workflows engine — a database of operator prompt playbooks (markdown + YAML frontmatter).
 *
 * A workflow is a **saved prompt**, not executable code. The UI (Tools → Workflows → Send to agent)
 * substitutes `{workspace}` and injects the body into a new chat; the agent follows it with whatever
 * tools are available. The agent lists workflows with `sylo_workflows_list` and creates/edits/deletes
 * them with the standard file tools on `~/.pi/agent/workflows/*.md`.
 *
 * Pure TypeScript, no Python. Ported from the LogicForge `_workflows_lib.py` concept, generalized.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type WorkflowSource = 'bundled' | 'operator' | 'legacy'

export interface WorkflowEntry {
  id: string
  title: string
  description: string
  source: WorkflowSource
  path: string
  filename: string
  editable: boolean
}

export interface WorkflowRead {
  entry: WorkflowEntry
  meta: Record<string, string>
  /** Body with `{workspace}` / `{project_dir}` substituted. */
  body: string
  raw: string
  raw_body: string
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BUNDLED_WORKFLOWS_DIR = join(PACKAGE_ROOT, 'shared', 'workflows')

function resolveAgentDir(explicit?: string): string {
  const raw = (explicit ?? '').trim()
  if (raw) return resolve(raw)
  const envDir = (process.env.SYLO_PI_AGENT_DIR ?? '').trim()
  if (envDir) return resolve(envDir)
  const home = process.env.HOME || process.env.USERPROFILE || ''
  return resolve(home, '.pi', 'agent')
}

/** Operator workflow library, shared across workspaces.
 *
 * Primary location is the GitHub-synced `sylo-user` workspace (`<SYLO_USER_DIR>/.sylo/workflows/`)
 * so operator workflows back up and travel between machines. Falls back to the legacy
 * machine-local `~/.pi/agent/workflows/` when `SYLO_USER_DIR` is unset (back-compat / tests).
 * See feature tracker 2026-08-02_14-53-03 (scope-based storage refactor, Phase 1b). */
export function operatorWorkflowsDir(agentDir?: string): string {
  const userDir = (process.env.SYLO_USER_DIR ?? '').trim()
  if (userDir) return join(resolve(userDir), '.sylo', 'workflows')
  return join(resolveAgentDir(agentDir), 'workflows')
}

/** Pre-refactor operator library (machine-local `~/.pi/agent/workflows/`), read-only fallback. */
export function legacyAgentWorkflowsDir(agentDir?: string): string {
  return join(resolveAgentDir(agentDir), 'workflows')
}

/** Legacy operator library from LogicForge, read-only fallback: `~/.pi/agent/logicforge/workflows/`. */
export function legacyOperatorWorkflowsDir(agentDir?: string): string {
  return join(resolveAgentDir(agentDir), 'logicforge', 'workflows')
}

/** Parse YAML frontmatter (simple key:value, no nested structures). */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith('---')) return { meta: {}, body: text }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    val = val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    meta[key] = val
  }
  return { meta, body: m[2] }
}

export function renderFrontmatter(meta: Record<string, string>, body: string): string {
  const lines = ['---']
  for (const key of ['id', 'title', 'description', 'source']) {
    if (meta[key] && meta[key].trim()) lines.push(`${key}: ${meta[key].trim()}`)
  }
  for (const [key, val] of Object.entries(meta)) {
    if (['id', 'title', 'description', 'source'].includes(key)) continue
    if (val && val.trim()) lines.push(`${key}: ${val.trim()}`)
  }
  lines.push('---', '')
  return lines.join('\n') + body.replace(/^\n+/, '')
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function workflowId(filenameStem: string, meta: Record<string, string>): string {
  const explicit = (meta.id ?? '').trim()
  return explicit || filenameStem
}

function filenameOf(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

async function readEntry(
  path: string,
  source: WorkflowSource,
  editable: boolean,
): Promise<WorkflowEntry | null> {
  try {
    const text = await readFile(path, 'utf-8')
    const { meta } = parseFrontmatter(text)
    const filename = filenameOf(path)
    const stem = filename.replace(/\.md$/i, '')
    const id = workflowId(stem, meta)
    const title = (meta.title ?? '').trim() || titleCase(id)
    const description = (meta.description ?? '').trim()
    return { id, title, description, source, path: resolve(path), filename, editable }
  } catch {
    return null
  }
}

async function listMd(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && /\.md$/i.test(e.name) && e.name.toUpperCase() !== 'README.MD')
    .map((e) => join(dir, e.name))
}

/**
 * Discover workflows. Precedence (operator overrides bundled/legacy on same id):
 * bundled → legacy operator (only if id not seen) → operator (overrides all).
 * Sort: operator first, then by title.
 *
 * `bundledDir` defaults to the package's bundled workflows dir (via import.meta.url). The host
 * main process passes an explicit repo-root-derived `bundledDir` because import.meta.url is
 * unreliable when this module is bundled into the host main chunk.
 */
export async function discoverWorkflows(
  opts: { agentDir?: string; bundledDir?: string } = {},
): Promise<WorkflowEntry[]> {
  const bundledDir = opts.bundledDir?.trim() ? resolve(opts.bundledDir) : BUNDLED_WORKFLOWS_DIR
  const byId = new Map<string, WorkflowEntry>()

  for (const p of await listMd(bundledDir)) {
    const e = await readEntry(p, 'bundled', false)
    if (e) byId.set(e.id, e)
  }
    for (const p of await listMd(legacyOperatorWorkflowsDir(opts.agentDir))) {
    const e = await readEntry(p, 'legacy', false)
    if (e && !byId.has(e.id)) byId.set(e.id, e)
  }
  // Pre-refactor operator library (~/.pi/agent/workflows) — read-only fallback so
  // existing operator workflows still surface after the move to sylo-user.
  for (const p of await listMd(legacyAgentWorkflowsDir(opts.agentDir))) {
    const e = await readEntry(p, 'legacy', false)
    if (e && !byId.has(e.id)) byId.set(e.id, e)
  }
  for (const p of await listMd(operatorWorkflowsDir(opts.agentDir))) {
    const e = await readEntry(p, 'operator', true)
    if (e) byId.set(e.id, e)
  }

  return Array.from(byId.values()).sort((a, b) => {
    const ao = a.source === 'operator' ? 0 : 1
    const bo = b.source === 'operator' ? 0 : 1
    if (ao !== bo) return ao - bo
    return a.title.toLowerCase().localeCompare(b.title.toLowerCase())
  })
}

export function substituteTokens(text: string, values: Record<string, string>): string {
  let out = text
  for (const [key, val] of Object.entries(values)) {
    const token = key.startsWith('{') ? key : `{${key}}`
    out = out.split(token).join(val)
  }
  return out
}

/** Read a workflow by id, substituting `{workspace}` / `{project_dir}` with the workspace Pi cwd. */
export async function readWorkflowBody(
  id: string,
  opts: { agentDir?: string; projectDir?: string; bundledDir?: string } = {},
): Promise<WorkflowRead | null> {
  const entry = (await discoverWorkflows(opts)).find(
    (e) => e.id === id || e.filename === id || e.filename === `${id}.md`,
  )
  if (!entry) return null
  const raw = await readFile(entry.path, 'utf-8')
  const { meta, body: raw_body } = parseFrontmatter(raw)
  const project = resolve(opts.projectDir ?? process.env.SYLO_PI_CWD ?? process.cwd())
  const body = substituteTokens(raw_body, { workspace: project, project_dir: project })
  return { entry, meta, body, raw, raw_body }
}

function slugId(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'new-workflow'
}

export function newWorkflowTemplate(title = 'New workflow'): string {
  const id = slugId(title)
  return `---
id: ${id}
title: ${title || 'New workflow'}
description: Short description for the workflow list
---

Describe what this workflow does and when to run it. This is a **prompt** loaded into chat — the agent follows it using whatever tools are available.

## Inputs (operator provides in chat)

Attach required files to the chat message before sending. If anything is missing, **ask and stop**.

## Steps

1. (describe tool order here)

## Rules

- Project folder = workspace Pi cwd (\`{workspace}\`)
`
}

/** Validate a workflow id slug (lowercase letters/digits/hyphens, must start alphanumeric). */
export function isValidWorkflowId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id)
}

/**
 * Save a workflow to the operator library (`~/.pi/agent/workflows/<id>.md`).
 * If `previousId` is set and differs from the new id, the old file is removed (rename).
 * Returns the refreshed operator entry.
 */
export async function saveWorkflow(
  content: string,
  opts: { agentDir?: string; previousId?: string } = {},
): Promise<WorkflowEntry> {
  if (!content.trim()) throw new Error('workflow content is required')
  const { meta } = parseFrontmatter(content)
  const id = (meta.id ?? '').trim()
  if (!id) throw new Error('workflow frontmatter must include a non-empty `id`')
  if (!isValidWorkflowId(id))
    throw new Error(`workflow id must be lowercase letters, digits, and hyphens (got \`${id}\`)`)

  const dir = operatorWorkflowsDir(opts.agentDir)
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${id}.md`)
  await writeFile(target, content, 'utf-8')

  const prevId = opts.previousId?.trim()
  if (prevId && prevId !== id) {
    const prev = join(dir, `${prevId}.md`)
    if (existsSync(prev) && resolve(prev) !== resolve(target)) {
      await rm(prev, { force: true })
    }
  }

  const entry = await readEntry(target, 'operator', true)
  if (!entry) throw new Error(`failed to read saved workflow: ${target}`)
  return entry
}

/**
 * Delete a workflow from the operator library. Bundled/legacy workflows are not deletable here —
 * duplicate to an operator copy to customize.
 */
export async function deleteWorkflow(
  id: string,
  opts: { agentDir?: string } = {},
): Promise<WorkflowEntry> {
  const entry = (await discoverWorkflows(opts)).find(
    (e) => e.id === id || e.filename === id || e.filename === `${id}.md`,
  )
  if (!entry) throw new Error(`workflow not found: ${id}`)
  if (entry.source !== 'operator')
    throw new Error(
      `cannot delete ${entry.source} workflow \`${entry.id}\` — only operator workflows (in ${operatorWorkflowsDir(
        opts.agentDir,
      )}) are deletable. Duplicate to edit.`,
    )
  await rm(entry.path, { force: true })
  return entry
}