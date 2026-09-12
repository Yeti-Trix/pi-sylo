/**
 * Agent checkpoints — per-turn file snapshots so the operator can UNDO an
 * agent turn (Cursor-style), WITHOUT ever touching the operator's git repo.
 *
 * Hard rules (see features_tracker/active/2026-09-10_23-46-00_agent_checkpoints_undo.md):
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