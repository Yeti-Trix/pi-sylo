/**
 * Agent checkpoints — per-turn file snapshots so the operator can UNDO an
 * agent turn (Cursor-style), WITHOUT ever touching the operator's git repo.
 *
 * Hard rules (design: pi-sylo-dev issue #14 — folder trackers retired 2026-09-11):
 *  - Storage lives in Sylo app data (`userData/checkpoints/<convId>/...`),
 *    never in the workspace. No git commands, no .git additions, ever.
 *  - A capture happens at TURN START (pre-images of the whole tracked tree,
 *    bounded by exclusions + caps) and is registered against the assistant
 *    message id, so the renderer can offer "Undo" per reply.
 *  - Restoring first snapshots the CURRENT state (undo-of-undo is always
 *    possible), then copies pre-images back and removes files the turn added.
 *
 * v2 (issue #8): content-hash diffing (sha256 per captured file — same-size
 * same-mtime edits are detected), deferred-turn safety captures (a turn queued
 * behind another conversation snapshots the workspace at defer time and the
 * snapshot is promoted if the flush-time capture fails), and a total store
 * budget with oldest-first pruning.
 *
 * Best-effort by design: any capture failure just means that turn isn't
 * undoable — chat behavior is never affected.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import { app } from 'electron'

/** Directories never captured or diffed (huge / not source). */
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'target', 'coverage',
  '.next', '.venv', 'venv', '__pycache__', '.cache', '.turbo', '.parcel-cache',
])

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_FILES = 4000
const KEEP_TURNS_PER_CONV = 5
const KEEP_SAFETY_MS = 7 * 24 * 60 * 60 * 1000
const KEEP_DEFERRED_MS = 24 * 60 * 60 * 1000
/** Total budget across every conversation's checkpoints; oldest-first prune. */
const MAX_STORE_BYTES = 512 * 1024 * 1024

export type CheckpointManifest = {
  v: 1 | 2
  turnId: string
  convId: string
  cwd: string
  started_at: number
  assistantMessageId?: string
  safety?: boolean
  /** Deferred-turn safety snapshot: captured at queue time, promoted or
   *  discarded when the turn actually starts. */
  deferred?: boolean
  fileCount: number
  totalBytes: number
  files: string[]
  /** v2: rel path → sha256 hex of the captured content. */
  hashes?: Record<string, string>
}

export type CheckpointPreview = {
  modified: string[]
  added: string[]
  deleted: string[]
}

function checkpointRoot(): string {
  return join(app.getPath('userData'), 'checkpoints')
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'x'
}

function convDir(convId: string): string {
  return join(checkpointRoot(), sanitize(convId))
}

function manifestPath(dir: string): string {
  return join(dir, 'manifest.json')
}

function readManifest(dir: string): CheckpointManifest | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath(dir), 'utf8')) as CheckpointManifest
    return m && (m.v === 1 || m.v === 2) && typeof m.cwd === 'string' ? m : null
  } catch {
    return null
  }
}

function hashFile(abs: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex')
  } catch {
    return null
  }
}

/** Walk the workspace, applying exclusions + caps. Returns rel paths
 *  (slash-normalized) and absolute paths. */
function walkWorkspace(cwd: string): { rel: string; abs: string; size: number }[] {
  const out: { rel: string; abs: string; size: number }[] = []
  let totalBytes = 0
  const walk = (dir: string, relBase: string, depth: number): void => {
    if (depth > 24) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (out.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) return
      if (SKIP_DIR_NAMES.has(name) || name.startsWith('.git')) continue
      const abs = join(dir, name)
      const rel = relBase ? `${relBase}/${name}` : name
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(abs, rel, depth + 1)
      } else if (st.isFile()) {
        if (st.size > MAX_FILE_BYTES) continue
        if (totalBytes + st.size > MAX_TOTAL_BYTES) return
        out.push({ rel, abs, size: st.size })
        totalBytes += st.size
      }
    }
  }
  walk(cwd, '', 0)
  return out
}

/** Copy a capture set into <dir>/files and return the manifest payload pieces
 *  (shared by turn-start, safety, and deferred captures). Hashes every copied
 *  file (sha256) so previews can diff by content, not size+mtime. */
function copyCaptureFiles(
  dir: string,
  tracked: { rel: string; abs: string; size: number }[],
): { rels: string[]; totalBytes: number; hashes: Record<string, string> } {
  const filesDir = join(dir, 'files')
  mkdirSync(filesDir, { recursive: true })
  const rels: string[] = []
  const hashes: Record<string, string> = {}
  let totalBytes = 0
  for (const f of tracked) {
    const dest = join(filesDir, f.rel)
    mkdirSync(dest.slice(0, dest.lastIndexOf(sep)), { recursive: true })
    let buf: Buffer | null = null
    try {
      buf = readFileSync(f.abs)
    } catch {
      /* unreadable mid-walk — skip */
      continue
    }
    writeFileSync(dest, buf)
    rels.push(f.rel)
    hashes[f.rel] = createHash('sha256').update(buf).digest('hex')
    totalBytes += buf.length
  }
  return { rels, totalBytes, hashes }
}

/** Total bytes across every manifest in the store. */
function storeBytes(): { total: number; items: { dir: string; startedAt: number; bytes: number; safety: boolean; deferred: boolean; convId: string }[] } {
  const root = checkpointRoot()
  const items: { dir: string; startedAt: number; bytes: number; safety: boolean; deferred: boolean; convId: string }[] = []
  let total = 0
  if (!existsSync(root)) return { total, items }
  try {
    for (const convId of readdirSync(root)) {
      const cDir = join(root, convId)
      let entries: string[]
      try {
        entries = readdirSync(cDir)
      } catch {
        continue
      }
      for (const entry of entries) {
        const m = readManifest(join(cDir, entry))
        if (!m) continue
        items.push({ dir: join(cDir, entry), startedAt: m.started_at, bytes: m.totalBytes, safety: !!m.safety, deferred: !!m.deferred, convId })
        total += m.totalBytes
      }
    }
  } catch {
    /* best-effort */
  }
  return { total, items }
}

/** Keep the checkpoint store under MAX_STORE_BYTES: oldest-first, never
 *  deleting the newest real checkpoint of a conversation. Best-effort. */
function enforceStoreBudget(): void {
  try {
    const { total, items } = storeBytes()
    if (total <= MAX_STORE_BYTES) return
    // Protect the newest non-safety/non-deferred manifest per conversation.
    const newestPerConv = new Map<string, number>()
    for (const it of items) {
      if (it.safety || it.deferred) continue
      const cur = newestPerConv.get(it.convId)
      if (cur === undefined || it.startedAt > cur) newestPerConv.set(it.convId, it.startedAt)
    }
    const deletable = items
      .filter((it) => !(newestPerConv.get(it.convId) === it.startedAt && !it.safety && !it.deferred))
      .sort((a, b) => a.startedAt - b.startedAt)
    let running = total
    for (const it of deletable) {
      if (running <= MAX_STORE_BYTES) break
      try {
        rmSync(it.dir, { recursive: true, force: true })
        running -= it.bytes
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* budget enforcement is best-effort */
  }
}

/** Capture pre-images of the tracked workspace tree. Returns the turn id
 *  (also written into the manifest) or null when nothing was captured. */
export function captureTurnStart(convId: string, cwd: string, assistantMessageId: string): string | null {
  if (!cwd || !existsSync(cwd)) return null
  enforceStoreBudget()
  const turnId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const dir = join(convDir(convId), turnId)
  const tracked = walkWorkspace(cwd)
  const rels: string[] = []
  let totalBytes = 0
  try {
    const { rels: copied, totalBytes: bytes, hashes } = copyCaptureFiles(dir, tracked)
    rels.push(...copied)
    totalBytes = bytes
    const manifest: CheckpointManifest = {
      v: 2,
      turnId,
      convId,
      cwd,
      started_at: Date.now(),
      assistantMessageId,
      fileCount: rels.length,
      totalBytes,
      files: rels,
      hashes,
    }
    writeFileSync(manifestPath(dir), JSON.stringify(manifest), 'utf8')
    return turnId
  } catch {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* leave partial dir; prune will collect it */
    }
    return null
  }
}

/** Deferred-turn safety snapshot: taken when a cross-conversation turn is
 *  QUEUED (user message already inserted), because the other conversation's
 *  agent may edit the same workspace before this turn flushes. Invisible in
 *  the undo list; promoted if the flush-time capture fails. */
export function captureDeferredStart(convId: string, cwd: string): string | null {
  if (!cwd || !existsSync(cwd)) return null
  const dir = join(convDir(convId), `deferred-${Date.now().toString(36)}`)
  try {
    const tracked = walkWorkspace(cwd)
    const { rels, totalBytes, hashes } = copyCaptureFiles(dir, tracked)
    const manifest: CheckpointManifest = {
      v: 2,
      turnId: dir.slice(dir.lastIndexOf(sep) + 1),
      convId,
      cwd,
      started_at: Date.now(),
      safety: false,
      deferred: true,
      fileCount: rels.length,
      totalBytes,
      files: rels,
      hashes,
    }
    writeFileSync(manifestPath(dir), JSON.stringify(manifest), 'utf8')
    return dir
  } catch {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return null
  }
}

/** After the flush-time capture: on success, discard the deferred safety
 *  snapshots; on failure, promote the newest one to be the turn's undoable
 *  checkpoint (registered against the assistant message id). */
export function reconcileDeferredCapture(convId: string, assistantMessageId: string, capturedOk: boolean): void {
  const root = convDir(convId)
  if (!existsSync(root)) return
  const deferredDirs: { dir: string; startedAt: number }[] = []
  try {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry)
      const m = readManifest(dir)
      if (m && m.deferred && !m.assistantMessageId) deferredDirs.push({ dir, startedAt: m.started_at })
    }
  } catch {
    return
  }
  if (deferredDirs.length === 0) return
  deferredDirs.sort((a, b) => b.startedAt - a.startedAt)
  const [newest, ...rest] = deferredDirs
  for (const d of rest) {
    try {
      rmSync(d.dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  if (capturedOk) {
    try {
      rmSync(newest.dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return
  }
  try {
    const m = readManifest(newest.dir)
    if (!m) return
    m.assistantMessageId = assistantMessageId
    delete m.deferred
    writeFileSync(manifestPath(newest.dir), JSON.stringify(m), 'utf8')
  } catch {
    /* ignore */
  }
}

/** Undoable turns for a conversation (newest first): the assistant message
 *  ids that have a registered pre-turn snapshot. */
export function listForConversation(convId: string): { assistantMessageId: string; startedAt: number }[] {
  const root = convDir(convId)
  if (!existsSync(root)) return []
  const out: { assistantMessageId: string; startedAt: number }[] = []
  try {
    for (const entry of readdirSync(root)) {
      const m = readManifest(join(root, entry))
      if (m && !m.safety && !m.deferred && m.assistantMessageId) {
        out.push({ assistantMessageId: m.assistantMessageId, startedAt: m.started_at })
      }
    }
  } catch {
    return []
  }
  return out.sort((a, b) => b.startedAt - a.startedAt)
}

function findDirForAssistant(convId: string, assistantMessageId: string): string | null {
  const root = convDir(convId)
  if (!existsSync(root)) return null
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    const m = readManifest(dir)
    if (m && !m.safety && !m.deferred && m.assistantMessageId === assistantMessageId) return dir
  }
  return null
}

/** Diff the workspace NOW against a checkpoint's manifest. v2 manifests carry
 *  sha256 hashes, so same-size same-mtime edits are detected; v1 manifests
 *  fall back to size comparison. */
export function previewRestore(convId: string, assistantMessageId: string): CheckpointPreview | null {
  const dir = findDirForAssistant(convId, assistantMessageId)
  const m = dir ? readManifest(dir) : null
  if (!dir || !m || !existsSync(m.cwd)) return null
  const manifestSet = new Set(m.files)
  const current = walkWorkspace(m.cwd)
  const currentSet = new Set(current.map((f) => f.rel))
  const modified: string[] = []
  const added: string[] = []
  const deleted: string[] = []
  for (const f of current) {
    if (!manifestSet.has(f.rel)) added.push(f.rel)
  }
  for (const rel of m.files) {
    if (!currentSet.has(rel)) deleted.push(rel)
  }
  const hashes = m.v >= 2 ? (m.hashes ?? {}) : {}
  for (const rel of m.files) {
    if (!currentSet.has(rel)) continue
    if (hashes[rel]) {
      const now = hashFile(join(m.cwd, rel))
      if (now !== null && now !== hashes[rel]) modified.push(rel)
      continue
    }
    // v1 fallback: size snapshot from the stored copy.
    try {
      const cSize = statSync(join(dir, 'files', rel)).size
      const nowSize = statSync(join(m.cwd, rel)).size
      if (cSize !== nowSize) modified.push(rel)
    } catch {
      /* missing on either side — treat as added/deleted at restore time */
    }
  }
  return { modified: modified.sort(), added: added.sort(), deleted: deleted.sort() }
}

/** Safety-capture the CURRENT tree before overwriting (undo-of-undo). */
function captureSafety(convId: string, cwd: string): string | null {
  const dir = join(convDir(convId), `safety-${Date.now().toString(36)}`)
  try {
    const tracked = walkWorkspace(cwd)
    const { rels, totalBytes, hashes } = copyCaptureFiles(dir, tracked)
    const manifest: CheckpointManifest = {
      v: 2,
      turnId: dir.slice(dir.lastIndexOf(sep) + 1),
      convId,
      cwd,
      started_at: Date.now(),
      safety: true,
      fileCount: rels.length,
      totalBytes,
      files: rels,
      hashes,
    }
    writeFileSync(manifestPath(dir), JSON.stringify(manifest), 'utf8')
    return dir
  } catch {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return null
  }
}

/** Restore a turn's pre-images: safety-capture current state, copy the
 *  checkpoint files back, then remove files the turn ADDED (same exclusion
 *  rules, so node_modules/.git etc. are never touched). */
export function restoreTurn(convId: string, assistantMessageId: string): { ok: true; restored: number; removed: number } | { ok: false; error: string } {
  const dir = findDirForAssistant(convId, assistantMessageId)
  const m = dir ? readManifest(dir) : null
  if (!dir || !m) return { ok: false, error: 'checkpoint_not_found' }
  if (!existsSync(m.cwd)) return { ok: false, error: 'workspace_missing' }
  const preview = previewRestore(convId, assistantMessageId)
  captureSafety(convId, m.cwd)
  let restored = 0
  try {
    for (const rel of m.files) {
      const src = join(dir, 'files', rel)
      if (!existsSync(src)) continue
      const dest = join(m.cwd, rel)
      mkdirSync(dest.slice(0, dest.lastIndexOf(sep)), { recursive: true })
      copyFileSync(src, dest)
      restored++
    }
    let removed = 0
    for (const rel of preview?.added ?? []) {
      const abs = join(m.cwd, rel)
      try {
        if (existsSync(abs) && statSync(abs).isFile()) {
          rmSync(abs, { force: true })
          removed++
        }
      } catch {
        /* best-effort removal */
      }
    }
    return { ok: true, restored, removed }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Boot-time prune: keep the newest N real checkpoints per conversation,
 *  safety checkpoints younger than the retention window, deferred snapshots
 *  younger than 24h, and the whole store under the size budget. */
export function pruneAll(): void {
  const root = checkpointRoot()
  if (!existsSync(root)) return
  const now = Date.now()
  try {
    for (const convId of readdirSync(root)) {
      const cDir = join(root, convId)
      let entries: string[]
      try {
        entries = readdirSync(cDir)
      } catch {
        continue
      }
      const turns: { entry: string; startedAt: number }[] = []
      for (const entry of entries) {
        const dir = join(cDir, entry)
        const m = readManifest(dir)
        if (!m) {
          // Unreadable/partial dir: old enough to collect unconditionally.
          try {
            if (now - statSync(dir).mtimeMs > KEEP_SAFETY_MS) rmSync(dir, { recursive: true, force: true })
          } catch {
            /* ignore */
          }
          continue
        }
        if (m.deferred) {
          if (now - m.started_at > KEEP_DEFERRED_MS) {
            try {
              rmSync(dir, { recursive: true, force: true })
            } catch {
              /* ignore */
            }
          }
          continue
        }
        if (m.safety) {
          if (now - m.started_at > KEEP_SAFETY_MS) {
            try {
              rmSync(dir, { recursive: true, force: true })
            } catch {
              /* ignore */
            }
          }
          continue
        }
        turns.push({ entry, startedAt: m.started_at })
      }
      turns.sort((a, b) => b.startedAt - a.startedAt)
      for (const t of turns.slice(KEEP_TURNS_PER_CONV)) {
        try {
          rmSync(join(cDir, t.entry), { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }
    enforceStoreBudget()
  } catch {
    /* prune is best-effort */
  }
}

/** Delete every checkpoint for a conversation (called on conversation delete). */
export function purgeConversation(convId: string): void {
  try {
    rmSync(convDir(convId), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/** Relative-path helper kept for tests/debug — slash-normalized rel of abs. */
export function relOf(cwd: string, abs: string): string {
  return relative(cwd, abs).replace(/\\/g, '/')
}
// ── Per-turn change review (task 07 diff cards) + per-turn diff (task 13 panel)
// Stats for a turn come from diffing its manifest against the PREVIOUS kept
// manifest in the conversation — pure hash math over stored manifests, no
// current-disk reads (only `previewRestore` diffs against the live tree).

export type CheckpointTurnChanges = {
  modified: string[]
  added: string[]
  deleted: string[]
}

/** All real (non-safety, non-deferred) manifests for a conversation, oldest first. */
function realManifestsOldestFirst(convId: string): { dir: string; m: CheckpointManifest }[] {
  const root = convDir(convId)
  if (!existsSync(root)) return []
  const out: { dir: string; m: CheckpointManifest }[] = []
  try {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry)
      const m = readManifest(dir)
      if (m && !m.safety && !m.deferred && m.assistantMessageId) out.push({ dir, m })
    }
  } catch {
    return []
  }
  return out.sort((a, b) => a.m.started_at - b.m.started_at)
}

/**
 * Per-turn change counts + file lists for every kept checkpoint in a
 * conversation, keyed by assistant message id. Each entry diffs the turn's
 * manifest against the previous turn's manifest (same rel and a different
 * hash = modified; only in this manifest = added; only in the previous =
 * deleted), so the numbers describe what THAT TURN did — matching the Undo
 * semantics. v1 manifests carry no hashes: only added/deleted are provable.
 */
export function turnChangesForConversation(
  convId: string,
): Map<string, CheckpointTurnChanges> {
  const out = new Map<string, CheckpointTurnChanges>()
  const manifests = realManifestsOldestFirst(convId)
  let prevFiles: string[] = []
  let prevHashes: Record<string, string> = {}
  for (const { m } of manifests) {
    const changes: CheckpointTurnChanges = { modified: [], added: [], deleted: [] }
    const set = new Set(m.files)
    for (const rel of m.files) {
      const knownBefore = prevFiles.includes(rel)
      const hash = m.v >= 2 ? (m.hashes ?? {})[rel] : undefined
      const prevHash = m.v >= 2 ? prevHashes[rel] : undefined
      if (!knownBefore) changes.added.push(rel)
      else if (hash && prevHash && hash !== prevHash) changes.modified.push(rel)
    }
    for (const rel of prevFiles) {
      if (!set.has(rel)) changes.deleted.push(rel)
    }
    changes.modified.sort()
    changes.added.sort()
    changes.deleted.sort()
    if (m.assistantMessageId) out.set(m.assistantMessageId, changes)
    prevFiles = m.files
    prevHashes = m.v >= 2 ? (m.hashes ?? {}) : {}
  }
  return out
}

export type CheckpointFileDiff = {
  rel: string
  status: 'modified' | 'added' | 'deleted'
  /** Unified-style diff text (added/deleted render as all +/− lines). */
  diff: string
  /** When diffing was skipped for this file. */
  skipped?: 'size' | 'binary'
}

const DIFF_MAX_FILE_BYTES = 300 * 1024
const DIFF_MAX_TOTAL_BYTES = 1024 * 1024
const DIFF_BINARY_CHECK_BYTES = 8192

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split('\n')
}

/** LCS-based op list (keep/add/del) for two line arrays; bounded middle. */
function lcsOps(a: string[], b: string[]): Array<{ op: 'keep' | 'add' | 'del'; line: string }> {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((line) => ({ op: 'add' as const, line }))
  if (m === 0) return a.map((line) => ({ op: 'del' as const, line }))
  if (n * m > 4_000_000) {
    // Pathological middle: replace-all style (still correct, just coarse).
    return [
      ...a.map((line) => ({ op: 'del' as const, line })),
      ...b.map((line) => ({ op: 'add' as const, line })),
    ]
  }
  const dp = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  const ops: Array<{ op: 'keep' | 'add' | 'del'; line: string }> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'keep', line: a[i]! })
      i++
      j++
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      ops.push({ op: 'del', line: a[i]! })
      i++
    } else {
      ops.push({ op: 'add', line: b[j]! })
      j++
    }
  }
  while (i < n) {
    ops.push({ op: 'del', line: a[i]! })
    i++
  }
  while (j < m) {
    ops.push({ op: 'add', line: b[j]! })
    j++
  }
  return ops
}

/**
 * Compact unified diff for the read-only diff side pane. Display aid, not
 * patch format: hunks with ≤3 context lines; hunks merge when the gap is
 * ≤6 keep lines.
 */
function renderUnified(rel: string, ops: Array<{ op: 'keep' | 'add' | 'del'; line: string }>): string {
  let hasChange = false
  for (const op of ops) {
    if (op.op !== 'keep') {
      hasChange = true
      break
    }
  }
  if (!hasChange) return ''

  const body: string[] = []
  let ai = 0 // lines of A consumed (keeps + dels)
  let bi = 0 // lines of B consumed (keeps + adds)
  let hunkLines: string[] | null = null
  let hunkAStart = 0
  let hunkBStart = 0
  let hunkA = 0
  let hunkB = 0
  let pendingCtx: string[] = [] // trailing keeps while a hunk is open (≤3 kept)
  let lastKeeps: string[] = [] // rolling last 3 keeps before the first hunk

  for (const op of ops) {
    if (op.op === 'keep') {
      ai++
      bi++
      if (hunkLines === null) {
        lastKeeps.push(` ${op.line}`)
        if (lastKeeps.length > 3) lastKeeps.shift()
        continue
      }
      pendingCtx.push(` ${op.line}`)
      if (pendingCtx.length >= 4) {
        // Gap too big to merge: first 3 pending keeps become trailing context
        // and the hunk closes; the current keep leads the NEXT hunk instead.
        hunkLines!.push(...pendingCtx.slice(0, 3))
        hunkA += 3
        hunkB += 3
        body.push(`@@ -${hunkAStart},${hunkA} +${hunkBStart},${hunkB} @@`, ...hunkLines)
        hunkLines = null
        pendingCtx = []
        lastKeeps.push(` ${op.line}`)
        if (lastKeeps.length > 3) lastKeeps.shift()
      }
      continue
    }
    // Change op: reopen or extend the hunk, absorbing pending trailing keeps.
    if (hunkLines === null) {
      const lead = lastKeeps.slice(-3)
      hunkLines = [...lead]
      hunkAStart = ai - lead.length + 1
      hunkBStart = bi - lead.length + 1
      hunkA = lead.length
      hunkB = lead.length
    } else {
      hunkLines.push(...pendingCtx)
      hunkA += pendingCtx.length
      hunkB += pendingCtx.length
      pendingCtx = []
    }
    if (op.op === 'del') {
      hunkLines!.push(`-${op.line}`)
      hunkA++
      ai++
    } else {
      hunkLines!.push(`+${op.line}`)
      hunkB++
      bi++
    }
  }
  if (hunkLines !== null) {
    const tail = pendingCtx.slice(0, 3)
    hunkLines.push(...tail)
    hunkA += tail.length
    hunkB += tail.length
    body.push(`@@ -${hunkAStart},${hunkA} +${hunkBStart},${hunkB} @@`, ...hunkLines)
  }
  return `--- a/${rel}\n+++ b/${rel}\n${body.join('\n')}`
}

function isBinary(buf: Buffer): boolean {
  const head = buf.length > DIFF_BINARY_CHECK_BYTES ? buf.subarray(0, DIFF_BINARY_CHECK_BYTES) : buf
  return head.includes(0)
}

function safeRead(abs: string): Buffer | null {
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return null
    return readFileSync(abs)
  } catch {
    return null
  }
}

/**
 * Unified diffs for a turn's changed files: pre-image from the checkpoint's
 * `files/` copy vs the CURRENT disk content (same basis as Undo preview).
 * Only files the turn itself touched get diffed (modified/added/deleted
 * relative to the previous kept manifest — see turnChangesForConversation).
 * Files >300KB (either side) or binary are flagged `skipped` — placeholders,
 * never failures; total output is capped at 1MB (the overflow marker row is
 * appended). Read-only: nothing here writes files.
 */
export function diffTurn(convId: string, assistantMessageId: string): CheckpointFileDiff[] | null {
  const dir = findDirForAssistant(convId, assistantMessageId)
  const m = dir ? readManifest(dir) : null
  if (!dir || !m || !existsSync(m.cwd)) return null
  const changes = turnChangesForConversation(convId).get(assistantMessageId) ?? {
    modified: [],
    added: [],
    deleted: [],
  }
  const targets: { rel: string; status: CheckpointFileDiff['status'] }[] = [
    ...changes.modified.map((rel) => ({ rel, status: 'modified' as const })),
    ...changes.added.map((rel) => ({ rel, status: 'added' as const })),
    ...changes.deleted.map((rel) => ({ rel, status: 'deleted' as const })),
  ]
  const out: CheckpointFileDiff[] = []
  let total = 0
  for (const { rel, status } of targets) {
    const preAbs = join(dir, 'files', rel)
    const curAbs = join(m.cwd, rel)
    const preBuf = status === 'added' ? Buffer.alloc(0) : safeRead(preAbs)
    const curBuf = status === 'deleted' ? Buffer.alloc(0) : safeRead(curAbs)
    if ((preBuf && isBinary(preBuf)) || (curBuf && isBinary(curBuf))) {
      out.push({ rel, status, diff: '', skipped: 'binary' })
      continue
    }
    if ((preBuf?.length ?? 0) > DIFF_MAX_FILE_BYTES || (curBuf?.length ?? 0) > DIFF_MAX_FILE_BYTES) {
      out.push({ rel, status, diff: '', skipped: 'size' })
      continue
    }
    const a = splitLines(preBuf?.toString('utf8') ?? '')
    const b = splitLines(curBuf?.toString('utf8') ?? '')
    const text = renderUnified(rel, lcsOps(a, b))
    if (total + text.length > DIFF_MAX_TOTAL_BYTES) break
    total += text.length
    out.push({ rel, status, diff: text })
  }
  if (out.length < targets.length) {
    out.push({ rel: '…', status: 'modified', diff: '(diff truncated — total output cap reached)', skipped: 'size' })
  }
  return out
}
