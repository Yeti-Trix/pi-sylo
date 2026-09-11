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
 * Best-effort by design: any capture failure just means that turn isn't
 * undoable — chat behavior is never affected.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

export type CheckpointManifest = {
  v: 1
  turnId: string
  convId: string
  cwd: string
  started_at: number
  assistantMessageId?: string
  safety?: boolean
  fileCount: number
  totalBytes: number
  files: string[]
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
    return m && m.v === 1 && typeof m.cwd === 'string' ? m : null
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

/** Capture pre-images of the tracked workspace tree. Returns the turn id
 *  (also written into the manifest) or null when nothing was captured. */
export function captureTurnStart(convId: string, cwd: string, assistantMessageId: string): string | null {
  if (!cwd || !existsSync(cwd)) return null
  const turnId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const dir = join(convDir(convId), turnId)
  const filesDir = join(dir, 'files')
  const tracked = walkWorkspace(cwd)
  const rels: string[] = []
  let totalBytes = 0
  try {
    mkdirSync(filesDir, { recursive: true })
    for (const f of tracked) {
      const dest = join(filesDir, f.rel)
      mkdirSync(dest.slice(0, dest.lastIndexOf(sep)), { recursive: true })
      copyFileSync(f.abs, dest)
      rels.push(f.rel)
      totalBytes += f.size
    }
    const manifest: CheckpointManifest = {
      v: 1,
      turnId,
      convId,
      cwd,
      started_at: Date.now(),
      assistantMessageId,
      fileCount: rels.length,
      totalBytes,
      files: rels,
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

/** Undoable turns for a conversation (newest first): the assistant message
 *  ids that have a registered pre-turn snapshot. */
export function listForConversation(convId: string): { assistantMessageId: string; startedAt: number }[] {
  const root = convDir(convId)
  if (!existsSync(root)) return []
  const out: { assistantMessageId: string; startedAt: number }[] = []
  try {
    for (const entry of readdirSync(root)) {
      const m = readManifest(join(root, entry))
      if (m && !m.safety && m.assistantMessageId) {
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
    if (m && !m.safety && m.assistantMessageId === assistantMessageId) return dir
  }
  return null
}

/** Diff the workspace NOW against a checkpoint's manifest. */
export function previewRestore(convId: string, assistantMessageId: string): CheckpointPreview | null {
  const dir = findDirForAssistant(convId, assistantMessageId)
  const m = dir ? readManifest(dir) : null
  if (!dir || !m || !existsSync(m.cwd)) return null
  const manifestSet = new Set(m.files)
  const current = walkWorkspace(m.cwd)
  const currentSet = new Set(current.map((f) => f.rel))
  const sizes = new Map(current.map((f) => [f.rel, f.size]))
  const modified: string[] = []
  const added: string[] = []
  const deleted: string[] = []
  for (const f of current) {
    if (!manifestSet.has(f.rel)) added.push(f.rel)
  }
  for (const rel of m.files) {
    if (!currentSet.has(rel)) deleted.push(rel)
  }
  // Modified: same rel present on both sides — compare stored size snapshot.
  const checkpointSizes = new Map<string, number>()
  for (const rel of m.files) {
    try {
      checkpointSizes.set(rel, statSync(join(dir, 'files', rel)).size)
    } catch {
      /* missing checkpoint copy — treat as deleted at restore time */
    }
  }
  for (const rel of m.files) {
    if (!currentSet.has(rel)) continue
    const cSize = checkpointSizes.get(rel)
    const nowSize = sizes.get(rel)
    if (cSize !== undefined && nowSize !== undefined && cSize !== nowSize) modified.push(rel)
  }
  return { modified: modified.sort(), added: added.sort(), deleted: deleted.sort() }
}

/** Safety-capture the CURRENT tree before overwriting (undo-of-undo). */
function captureSafety(convId: string, cwd: string): string | null {
  const dir = join(convDir(convId), `safety-${Date.now().toString(36)}`)
  const filesDir = join(dir, 'files')
  try {
    const tracked = walkWorkspace(cwd)
    const rels: string[] = []
    let totalBytes = 0
    mkdirSync(filesDir, { recursive: true })
    for (const f of tracked) {
      const dest = join(filesDir, f.rel)
      mkdirSync(dest.slice(0, dest.lastIndexOf(sep)), { recursive: true })
      copyFileSync(f.abs, dest)
      rels.push(f.rel)
      totalBytes += f.size
    }
    const manifest: CheckpointManifest = {
      v: 1,
      turnId: dir.slice(dir.lastIndexOf(sep) + 1),
      convId,
      cwd,
      started_at: Date.now(),
      safety: true,
      fileCount: rels.length,
      totalBytes,
      files: rels,
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

/** Boot-time prune: keep the newest N real checkpoints per conversation and
 *  safety checkpoints younger than the retention window. */
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