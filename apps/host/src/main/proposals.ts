import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import { listWorkspaces, resolveSyloUserDir } from './database.js'

const execFileAsync = promisify(execFile)

/**
 * Skill-proposal approval loop (ADR-38) — host side.
 *
 * Proposals are plain markdown files queued in the repo they target. The
 * scanner covers EVERY repo Sylo knows about:
 * - commons   → <sylo-user>/.sylo/proposals/pending/*.md (always present)
 * - workspace → every workspace's project dir from the DB (employer projects,
 *               dev project dirs, ...) scanning <project>/.sylo/proposals/pending/
 *
 * Commit policy:
 * - commons (Sylo-owned): apply/reject commits AND pushes.
 * - workspace repos: local commit only if the dir is a git repo — never a
 *   push. A non-Sylo remote must never receive Sylo queue files without the
 *   operator pushing it themselves. Not a git repo → file changes are left
 *   in the working tree, no commit at all.
 *
 * The HOST is the only apply path (ADR-38: the agent has no apply surface —
 * the gate is enforced by construction). Apply/reject are git commits, so the
 * queue doubles as an audit trail in Sylo-owned repos.
 */

export type QueueKind = 'commons' | 'workspace'

export type QueueRoot = {
  kind: QueueKind
  label: string
  /** Repo / project root that owns this proposals queue. */
  root: string
  /** true only for Sylo-owned repos (commons) — auto-push allowed. */
  pushing: boolean
}

export type ProposalItem = {
  root: string // abs queue-root (repo/project dir)
  kind: QueueKind
  label: string // display name: 'commons' | workspace name
  relPath: string // relative to the queue, e.g. 'pending/P-20260830-01-x.md'
  fileName: string
  id: string
  title: string
  status: string
  scope: string
  target: string
  source: string
  body: string
  proposedChange: string
  frontmatterError?: string
}

export type ProposalsListResult =
  | {
      ok: true
      commonsDir: string
      pending: ProposalItem[]
      recent: Array<{
        root: string
        kind: QueueKind
        label: string
        status: string
        fileName: string
        mtimeMs: number
      }>
    }
  | { ok: false; error: string }

export type ProposalActionResult =
  | { ok: true; pushOk: boolean; detail: string }
  | { ok: false; error: string; detail?: string }

function samePath(a: string, b: string): boolean {
  return resolve(a).replace(/[\\/]+$/, '').toLowerCase() === resolve(b).replace(/[\\/]+$/, '').toLowerCase()
}

/** Every repo Sylo knows that could carry a proposals queue. */
function queueRoots(): QueueRoot[] {
  const roots: QueueRoot[] = []
  const commons = resolveSyloUserDir()
  if (commons) roots.push({ kind: 'commons', label: 'commons', root: commons, pushing: true })
  for (const ws of listWorkspaces()) {
    const cwd = ws.pi_cwd?.trim()
    if (!cwd || !existsSync(cwd)) continue
    if (roots.some((r) => samePath(r.root, cwd))) continue
    roots.push({ kind: 'workspace', label: ws.name || basename(cwd), root: cwd, pushing: false })
  }
  return roots
}

function findQueueRoot(root: string): QueueRoot | null {
  return queueRoots().find((r) => samePath(r.root, root)) ?? null
}

function parseProposal(raw: string): { meta: Record<string, string>; body: string; error?: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw, error: 'missing frontmatter' }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: raw, error: 'unterminated frontmatter' }
  const fm = raw.slice(3, end)
  const bodyStart = raw.indexOf('\n', end + 1)
  const body = bodyStart === -1 ? '' : raw.slice(bodyStart + 1)
  const meta: Record<string, string> = {}
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([a-zA-Z_-]+)\s*:\s*(.*)$/.exec(line.trim())
    if (m) meta[m[1].toLowerCase()] = m[2].trim()
  }
  return { meta, body }
}

/** Text of the `## Proposed change` section, unwrapped from one outer code fence if present. */
function extractProposedChange(body: string): string {
  const idx = body.lastIndexOf('## Proposed change')
  if (idx === -1) return ''
  const section = body.slice(idx + '## Proposed change'.length).replace(/^\s*:\s*/, '').trim()
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(section)
  return (fence ? fence[1] : section).trim() + '\n'
}

function looksLikeDiff(text: string): boolean {
  if (text.startsWith('diff --git')) return true
  return text.startsWith('--- ') && text.includes('\n+++ ')
}

function relTarget(target: string): string {
  // strip a 'new '/'edit ' marker and any leading slashes; keep repo-root-relative
  return target.replace(/^(new|edit)\s+/i, '').replace(/^[/\\]+/, '')
}

function safeQueuePath(rootDir: string, relPath: string): string | null {
  if (!relPath.startsWith('pending/') || relPath.includes('..')) return null
  const abs = join(rootDir, '.sylo', 'proposals', relPath)
  if (!abs.startsWith(join(rootDir, '.sylo', 'proposals') + sep)) return null
  return abs
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { ok: true, out: [stdout, stderr].filter(Boolean).join('\n').trim() }
  } catch (err) {
    const e = err as { message?: string; stdout?: string; stderr?: string }
    return { ok: false, out: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim() }
  }
}

async function isGitRepo(rootDir: string): Promise<boolean> {
  const r = await git(rootDir, ['rev-parse', '--is-inside-work-tree'])
  return r.ok && r.out.trim() === 'true'
}

async function commitAndPush(
  rootDir: string,
  message: string,
  targetRel: string | null,
  doPush: boolean,
): Promise<{ commitOk: boolean; pushOk: boolean; out: string }> {
  const addArgs = ['add', '--', '.sylo/proposals']
  if (targetRel) addArgs.push(targetRel)
  const add = await git(rootDir, addArgs)
  if (!add.ok) return { commitOk: false, pushOk: false, out: `git add failed: ${add.out}` }
  const commit = await git(rootDir, ['commit', '-m', message])
  if (!commit.ok) {
    if (/nothing to commit/i.test(commit.out)) return { commitOk: true, pushOk: true, out: commit.out }
    return { commitOk: false, pushOk: false, out: `git commit failed: ${commit.out}` }
  }
  if (!doPush) return { commitOk: true, pushOk: false, out: 'committed locally (auto-push off for this repo)' }
  const push = await git(rootDir, ['push'])
  return { commitOk: true, pushOk: push.ok, out: push.ok ? push.out : `push failed: ${push.out}` }
}

/** Commit/push appropriate for the queue's repo kind (workspace = local commit at most). */
async function finalizeRepo(
  qr: QueueRoot,
  message: string,
  targetRel: string | null,
): Promise<{ commitOk: boolean; pushOk: boolean; out: string }> {
  if (!(await isGitRepo(qr.root))) {
    return { commitOk: false, pushOk: false, out: 'directory is not a git repo — changes left untracked, nothing committed' }
  }
  return commitAndPush(qr.root, message, targetRel, qr.pushing)
}

export function listProposals(): ProposalsListResult {
  const commonsDir = resolveSyloUserDir()
  if (!commonsDir) return { ok: false, error: 'sylo_user_dir_unresolved' }
  const pending: ProposalItem[] = []
  const recent: Array<{
    root: string
    kind: QueueKind
    label: string
    status: string
    fileName: string
    mtimeMs: number
  }> = []

  for (const qr of queueRoots()) {
    const queue = join(qr.root, '.sylo', 'proposals')
    if (!existsSync(queue)) continue
    for (const sub of ['pending', 'applied', 'rejected'] as const) {
      const dir = join(queue, sub)
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.md')) continue
        const full = join(dir, f)
        if (sub !== 'pending') {
          try {
            recent.push({ root: qr.root, kind: qr.kind, label: qr.label, status: sub, fileName: f, mtimeMs: statSync(full).mtimeMs })
          } catch {
            /* ignore */
          }
          continue
        }
        let item: ProposalItem
        try {
          const { meta, body, error } = parseProposal(readFileSync(full, 'utf8'))
          item = {
            root: qr.root,
            kind: qr.kind,
            label: qr.label,
            relPath: `pending/${f}`,
            fileName: f,
            id: meta.id ?? f.replace(/\.md$/, ''),
            title: meta.title ?? '(untitled proposal)',
            status: meta.status ?? 'pending',
            scope: meta.scope ?? 'commons',
            target: meta.target ?? '',
            source: meta.source ?? '',
            body,
            proposedChange: extractProposedChange(body),
            frontmatterError: error,
          }
        } catch (err) {
          item = {
            root: qr.root,
            kind: qr.kind,
            label: qr.label,
            relPath: `pending/${f}`,
            fileName: f,
            id: f,
            title: '(unreadable proposal)',
            status: 'pending',
            scope: 'commons',
            target: '',
            source: '',
            body: '',
            proposedChange: '',
            frontmatterError: String(err),
          }
        }
        pending.push(item)
      }
    }
  }

  pending.sort((a, b) => a.id.localeCompare(b.id))
  recent.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return {
    ok: true,
    commonsDir,
    pending,
    recent: recent.slice(0, 15),
  }
}

async function writeChange(
  rootDir: string,
  target: string,
  change: string,
): Promise<{ ok: true; inRepoRel: string | null; wrote: string[] } | { ok: false; error: string; detail?: string }> {
  const scopeMachineLocal = target.startsWith('~')
  if (scopeMachineLocal) {
    const abs = resolve(target.replace(/^~(?=\/|\\|$)/, homedir()))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, change)
    return { ok: true, inRepoRel: null, wrote: [abs] }
  }
  const rel = relTarget(target)
  if (!rel) return { ok: false, error: 'missing_target' }
  const abs = resolve(rootDir, rel)
  if (!abs.startsWith(resolve(rootDir) + sep)) return { ok: false, error: 'target_escape' }
  if (looksLikeDiff(change)) {
    const patch = join(tmpdir(), 'sylo-proposal.apply.patch')
    writeFileSync(patch, change)
    const applied = await git(rootDir, ['apply', '--whitespace=nowarn', patch])
    if (!applied.ok) return { ok: false, error: 'git_apply_failed', detail: applied.out }
  } else {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, change)
  }
  return { ok: true, inRepoRel: rel, wrote: [rel] }
}

function finalizeQueueFile(
  rootDir: string,
  relPath: string,
  status: 'applied' | 'rejected',
  extraSection: string | null = null,
): { ok: true } | { ok: false; error: string } {
  const queueDir = join(rootDir, '.sylo', 'proposals')
  const from = join(queueDir, relPath)
  let raw: string
  try {
    raw = readFileSync(from, 'utf8')
  } catch {
    return { ok: false, error: 'proposal_not_found' }
  }
  let out = /^status:.*$/m.test(raw)
    ? raw.replace(/^status:.*$/m, `status: ${status}`)
    : raw.replace(/^---$/m, `---\nstatus: ${status}`)
  if (extraSection) out = out.trimEnd() + '\n\n' + extraSection.trim() + '\n'
  const destDir = join(queueDir, status)
  try {
    mkdirSync(destDir, { recursive: true })
    writeFileSync(from, out)
    renameSync(from, join(destDir, basename(from)))
  } catch (err) {
    return { ok: false, error: `queue_move_failed: ${String(err)}` }
  }
  return { ok: true }
}

export async function applyProposal(
  root: string,
  relPath: string,
  editedBody?: string,
): Promise<ProposalActionResult> {
  const qr = findQueueRoot(root)
  if (!qr) return { ok: false, error: 'unknown_queue_root' }
  const pendingPath = safeQueuePath(qr.root, relPath)
  if (!pendingPath) return { ok: false, error: 'invalid_path' }
  if (!existsSync(pendingPath)) return { ok: false, error: 'proposal_not_found' }

  const { meta, body } = parseProposal(readFileSync(pendingPath, 'utf8'))
  const finalBody = editedBody && editedBody.trim() ? editedBody : body
  const target = meta.target ?? ''
  const change = extractProposedChange(finalBody)
  if (!target) return { ok: false, error: 'missing_target_meta' }
  if (!change.trim()) return { ok: false, error: 'empty_proposed_change' }

  const written = await writeChange(qr.root, target, change)
  if (!written.ok) return { ok: false, error: written.error, detail: written.detail }

  const moved = finalizeQueueFile(qr.root, relPath, 'applied')
  if (!moved.ok) return { ok: false, error: moved.error }

  const id = meta.id || basename(relPath, '.md')
  const c = await finalizeRepo(qr, `apply ${id}: ${meta.title ?? ''} (Proposal dashboard)`, written.inRepoRel)
  return {
    ok: true,
    pushOk: c.pushOk,
    detail: [`wrote: ${written.wrote.join(', ')}`, c.out].filter(Boolean).join('\n'),
  }
}

export async function rejectProposal(
  root: string,
  relPath: string,
  reason: string,
): Promise<ProposalActionResult> {
  const qr = findQueueRoot(root)
  if (!qr) return { ok: false, error: 'unknown_queue_root' }
  const pendingPath = safeQueuePath(qr.root, relPath)
  if (!pendingPath) return { ok: false, error: 'invalid_path' }
  if (!existsSync(pendingPath)) return { ok: false, error: 'proposal_not_found' }

  const { meta } = parseProposal(readFileSync(pendingPath, 'utf8'))
  const moved = finalizeQueueFile(
    qr.root,
    relPath,
    'rejected',
    `## Rejection\n- ${reason.trim() || 'no reason given'} (${new Date().toISOString().slice(0, 10)})`,
  )
  if (!moved.ok) return { ok: false, error: moved.error }

  const id = meta.id || basename(relPath, '.md')
  const c = await finalizeRepo(qr, `reject ${id}: ${(reason || 'no reason given').trim()} (Proposal dashboard)`, null)
  return { ok: true, pushOk: c.pushOk, detail: c.out }
}