/**
 * Workspace file/folder search for the composer's `@`-references (task 06,
 * Cursor parity). Renderer can't scan the disk directly — this runs in the
 * MAIN process over the workspace's effective pi cwd and returns ranked hits
 * the picker inserts as attachment chips (a real typed path the agent reads).
 *
 * Exclusions mirror the checkpoint capture's spirit (node_modules/.git/dist/
 * build/target/.next/.venv etc., >5MB files) so the picker shows artifacts an
 * agent would actually want to read. Binary-ish executables are skipped; text
 * and images stay.
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Same exclusion list as the checkpoint capture (checkpoint-store.ts SKIP_DIR_NAMES);
 *  duplicated as a literal so this module stays electron-free for node:test. */
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'target', 'coverage',
  '.next', '.venv', 'venv', '__pycache__', '.cache', '.turbo', '.parcel-cache',
])

export type WorkspaceRefHit = {
  /** Absolute path (this is what gets staged as an attachment chip). */
  path: string
  /** Workspace-relative path (picker display + tooltips). */
  relativePath: string
  kind: 'file' | 'folder'
}

/** Skip obvious binary/package payloads — not reading material for the agent. */
const SKIP_EXTS = new Set([
  '.exe', '.dll', '.pdb', '.dylib', '.so', '.class', '.jar', '.wasm',
  '.pyc', '.pyd', '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bin',
])

const MAX_RESULTS = 50
const MAX_SCAN = 8000
const MAX_DEPTH = 12

type RankedHit = WorkspaceRefHit & { score: number }

/**
 * Fuzzy rank ONE candidate name/path against the query.
 * 0 = exact name match, 1 = name startsWith, 2 = name includes, 3 = path
 * includes; anything worse isn't a hit. Empty query = rank-by-shallowest-path.
 */
function rank(nameLower: string, pathLower: string, q: string): number | null {
  if (!q) return 3 // empty query: everything is a loose candidate, path-sort wins
  if (nameLower === q) return 0
  if (nameLower.startsWith(q)) return 1
  if (nameLower.includes(q)) return 2
  if (pathLower.includes(q)) return 3
  return null
}

export function searchWorkspaceRefs(cwd: string, rawQuery: string): WorkspaceRefHit[] {
  const query = rawQuery.trim().toLowerCase().replace(/\\/g, '/')
  const results: RankedHit[] = []
  let scanned = 0

  const push = (abs: string, rel: string, kind: 'file' | 'folder') => {
    const nameLower = rel.replace(/^.*[/\\]/, '').toLowerCase()
    const pathLower = rel.toLowerCase().replace(/\\/g, '/')
    const score = rank(nameLower, pathLower, query)
    if (score === null) return
    results.push({ path: abs, relativePath: rel, kind, score })
  }

  const walk = (dir: string, relBase: string, depth: number): void => {
    if (depth > MAX_DEPTH || scanned >= MAX_SCAN || results.length >= MAX_RESULTS * 4) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (scanned >= MAX_SCAN) return
      scanned++
      if (SKIP_DIR_NAMES.has(name) || name.startsWith('.git')) continue
      const abs = join(dir, name)
      const rel = relBase ? `${relBase}/${name}` : name
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        push(abs, rel, 'folder')
        walk(abs, rel, depth + 1)
      } else if (st.isFile()) {
        const ext = name.toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] ?? ''
        if (SKIP_EXTS.has(ext)) continue
        if (st.size > 5 * 1024 * 1024) continue
        push(abs, rel, 'file')
      }
    }
  }

  walk(cwd, '', 0)

  // Most specific first, then shallowest (files near the workspace root beat
  // deep matches for the same score), then alphabetical for determinism.
  return results
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.relativePath.split('/').length - b.relativePath.split('/').length ||
        a.relativePath.localeCompare(b.relativePath),
    )
    .slice(0, MAX_RESULTS)
}