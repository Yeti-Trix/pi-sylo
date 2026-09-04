import { homedir } from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  makeSyloDisabledToolKey,
  mergeDisabledToolsLists,
  normalizeDisabledToolsJson,
  normalizePathListForDisabledJson,
  normalizeSkillCapabilityPath,
  normalizeSkillPathListForPolicyJson,
  normalizeSyloCapabilityPath,
  type SyloDisabledToolRef,
} from '../shared/sylo-capability-paths.js'
import { migrateSubagentTasksSchema } from './subagent-tasks-db.js'
import { deleteWebAccessRunsForConversation, migrateWebAccessSchema } from './web-access-db.js'
import { deleteThinkTankSessionsForConversation, migrateThinkTankSchema } from './think-tank-db.js'
import { dropLegacyScheduledPromptsFromMainDb } from './workspace-db.js'

export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageStatus = 'streaming' | 'complete' | 'failed' | 'cancelled'

export interface ConversationRow {
  id: string
  title: string
  created_at: number
  updated_at: number
  workspace_id: string | null
  /** Pi session jsonl relative to Pi agentDir; null = default path from workspace segment */
  pi_session_relpath: string | null
  /** Per-chat main model override (null = inherit global default). */
    model_provider: string | null
  model_id: string | null
  /** Per-chat image (fallback) model override (null = inherit global default). */
  image_model_id: string | null
  image_model_provider: string | null
  /** Per-chat thinking-level override (off/minimal/low/medium/high/[xhigh|max]; null = Pi default). */
  thinking_level: string | null
}

/** Sylo workspace: Pi cwd segment + chat grouping + optional per-workspace excluded capabilities. */
export interface WorkspaceRow {
  id: string
  name: string
  /** Pi project cwd when chatting in this workspace (optional path on disk). */
  pi_cwd: string
  /** Directory segment under `<agent>/sessions/sylo/` (legacy inbox uses `_inbox`). */
  path_segment: string
  disabled_skill_paths_json: string
  disabled_extension_paths_json: string
  disabled_tools_json: string
  /**
   * Skill paths that this workspace explicitly enables. Used to re-enable a globally-disabled
   * skill in selected workspaces (the "available in this workspace only" feature). Wins over
   * `disabled_skill_paths_json` and the global `~/.sylo/disabled.json` skill list.
   */
  enabled_skill_paths_json: string
  /**
   * Skill paths to pin into the agent system prompt for this workspace. Implies enabled (i.e.,
   * an entry here also re-enables the skill in this workspace even if globally disabled).
   */
  always_apply_skill_paths_json: string
  /** HTTPS or SSH GitHub remote for Pi project folder backup. */
  github_remote_url: string
  /** When true, Sylo pulls on startup and includes this workspace in Push all. */
  github_backup_enabled: number
  github_last_sync_at: number | null
  sort_order: number
  created_at: number
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: MessageRole
  content: string
  tool_calls_json: string | null
  status: MessageStatus
  created_at: number
}

let db: Database.Database | undefined

const MIGRATION = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  workspace_id TEXT,
  pi_session_relpath TEXT,
  -- Per-chat model override (null = inherit global default from prefs). Empty string = explicit "Pi default, no override".
  model_provider TEXT,
  model_id TEXT,
  image_model_id TEXT,
  image_model_provider TEXT
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pi_cwd TEXT NOT NULL DEFAULT '',
  path_segment TEXT NOT NULL DEFAULT '',
  disabled_skill_paths_json TEXT NOT NULL DEFAULT '[]',
  disabled_extension_paths_json TEXT NOT NULL DEFAULT '[]',
  enabled_skill_paths_json TEXT NOT NULL DEFAULT '[]',
  always_apply_skill_paths_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_calls_json TEXT,
  status TEXT NOT NULL DEFAULT 'complete',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`

/**
 * Deterministic Pi project folder for the built-in `sylo-user` workspace.
 * Lives under `%HOME%/Documents/GitHub/sylo-user` so the operator's user-data
 * files (profile, notes, plans, references) are visible alongside the user's
 * other GitHub repos (not buried in AppData/Roaming) and sync to GitHub as a
 * single user-data repo. Uses `%HOME%/Documents` to avoid OneDrive redirection.
 */
export function canonicalDefaultWorkspacePiProjectPath(): string {
  return path.join(homedir(), 'Documents', 'GitHub', 'sylo-user')
}

/**
 * Resolve the sylo-user (primary workspace) project directory from the
 * workspace DB row's `pi_cwd`. Respects operator edits in the Workspaces UI
 * (rename/relocate) rather than hardcoding the Documents path. Falls back to
 * the canonical default when the DB isn't open yet, the row is missing, or
 * `pi_cwd` is empty / points at a folder that no longer exists on disk.
 *
 * This is the runtime-correct way to find the sylo-user folder. Use
 * `canonicalDefaultWorkspacePiProjectPath()` only for seeding/migration logic
 * that runs before the workspaces table exists.
 */
export function resolveSyloUserDir(): string {
  try {
    if (db) {
      const row = db
        .prepare(
          'SELECT pi_cwd FROM workspaces ORDER BY sort_order ASC, created_at ASC LIMIT 1',
        )
        .get() as { pi_cwd: string | null } | undefined
      const cwd = row?.pi_cwd?.trim()
      if (cwd && fs.existsSync(cwd)) return cwd
    }
  } catch {
    /* DB not open or workspaces table missing — fall through to canonical */
  }
  return canonicalDefaultWorkspacePiProjectPath()
}

/** Built-in dev workspace name (Pi cwd = Sylo repo root when running from clone). */
export const DEV_WORKSPACE_NAME = 'Dev sylo'

function normalizePiCwd(p: string): string {
  return path.resolve(p.trim()).replace(/\\/g, '/').toLowerCase()
}

/** True when `repoRoot` looks like the pi-sylo monorepo (trackers + host app). */
export function isSyloDevRepoRoot(repoRoot: string): boolean {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) return false
  const root = path.resolve(repoRoot.trim())
  if (!fs.existsSync(root)) return false
  return (
    fs.existsSync(path.join(root, 'features_tracker')) && fs.existsSync(path.join(root, 'apps', 'host'))
  )
}

export function findWorkspaceByPiCwd(piCwd: string): WorkspaceRow | undefined {
  const target = normalizePiCwd(piCwd)
  if (!target) return undefined
  return listWorkspaces().find((w) => w.pi_cwd?.trim() && normalizePiCwd(w.pi_cwd) === target)
}

/** Idempotent: ensure a Dev sylo workspace points at the Sylo repo root (dev builds only). */
export function ensureDevWorkspace(repoRoot: string): WorkspaceRow | null {
  if (!isSyloDevRepoRoot(repoRoot)) return null
  const resolved = path.resolve(repoRoot.trim())
  let row = findWorkspaceByPiCwd(resolved)
  if (!row) {
    row = listWorkspaces().find((w) => w.name === DEV_WORKSPACE_NAME)
  }
  if (row) {
    if (!row.pi_cwd?.trim() || normalizePiCwd(row.pi_cwd) !== normalizePiCwd(resolved)) {
      updateWorkspace(row.id, { pi_cwd: resolved })
      return getWorkspace(row.id) ?? row
    }
    return row
  }
  return createWorkspace(DEV_WORKSPACE_NAME, resolved)
}

export function openDatabase(userDataPath: string, syloRepoRoot?: string): Database.Database {
  const dir = path.join(userDataPath, 'sylo-data')
  fs.mkdirSync(dir, { recursive: true })
  const fp = path.join(dir, 'sylo.sqlite')
  const d = new Database(fp)
  d.pragma('journal_mode = WAL')
  d.exec(MIGRATION)
  migrateLegacySchema(d, userDataPath)
    db = d
  migrateSubagentTasksSchema()
  migrateWebAccessSchema()
  initOperatorEnv()
  dropLegacyPersonalTablesFromMainDb(d)
  migrateThinkTankSchema()
    dropLegacyScheduledPromptsFromMainDb(d)
  // Dev sylo workspace is no longer auto-created; the operator adds workspaces
  // manually (including the pi-sylo repo when developing Sylo itself).
  return d
}

function tableHasColumn(d: Database.Database, table: string, col: string): boolean {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((r) => r.name === col)
}

function tableExists(d: Database.Database, name: string): boolean {
  const row = d
    .prepare(`SELECT 1 as x FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { x: number } | undefined
  return !!row
}

/**
 * Drop the legacy personal-domain tables from the main AppData DB now that personal
 * data lives in the git-synced JSON store (personal bundle, `sylo-user/health/`)
 * the git-synced JSON store (`sylo-user/health/`). Only drops a table when it
 * is empty — never deletes existing rows. Idempotent. (The operator's health
 * tables are currently empty, so this simply removes orphaned empty tables.)
 */
function dropLegacyPersonalTablesFromMainDb(d: Database.Database): void {
  const tables = [
    'health_profile',
    'meal_log_entries',
    'workout_log_entries',
    'weight_log_entries',
    'health_journal_entries',
    'workout_plans',
  ]
  for (const t of tables) {
    if (!tableExists(d, t)) continue
    const { c } = d.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }
    if (c === 0) d.exec(`DROP TABLE IF EXISTS ${t}`)
  }
}

function migrateLegacySchema(d: Database.Database, userDataPath: string): void {
  if (!tableHasColumn(d, 'conversations', 'pi_session_relpath')) {
    d.exec('ALTER TABLE conversations ADD COLUMN pi_session_relpath TEXT')
  }

  // Per-chat model override columns (null = inherit global default from prefs).
  if (!tableHasColumn(d, 'conversations', 'model_provider')) {
    d.exec('ALTER TABLE conversations ADD COLUMN model_provider TEXT')
  }
  if (!tableHasColumn(d, 'conversations', 'model_id')) {
    d.exec('ALTER TABLE conversations ADD COLUMN model_id TEXT')
  }
  if (!tableHasColumn(d, 'conversations', 'image_model_id')) {
    d.exec('ALTER TABLE conversations ADD COLUMN image_model_id TEXT')
  }
    if (!tableHasColumn(d, 'conversations', 'image_model_provider')) {
    d.exec('ALTER TABLE conversations ADD COLUMN image_model_provider TEXT')
  }
  if (!tableHasColumn(d, 'conversations', 'thinking_level')) {
    d.exec('ALTER TABLE conversations ADD COLUMN thinking_level TEXT')
  }


  const hasWorkspaceId = tableHasColumn(d, 'conversations', 'workspace_id')
  const hasFolderId = tableHasColumn(d, 'conversations', 'folder_id')

  if (!hasWorkspaceId && hasFolderId) {
    d.exec('ALTER TABLE conversations RENAME COLUMN folder_id TO workspace_id')
  } else if (!hasWorkspaceId) {
    d.exec('ALTER TABLE conversations ADD COLUMN workspace_id TEXT')
  }

  if (tableExists(d, 'chat_folders') && !tableExists(d, 'workspaces')) {
    d.exec('ALTER TABLE chat_folders RENAME TO workspaces')
  }

  if (tableExists(d, 'workspaces')) {
    if (!tableHasColumn(d, 'workspaces', 'path_segment')) {
      d.exec("ALTER TABLE workspaces ADD COLUMN path_segment TEXT NOT NULL DEFAULT ''")
    }
    if (!tableHasColumn(d, 'workspaces', 'disabled_skill_paths_json')) {
      d.exec("ALTER TABLE workspaces ADD COLUMN disabled_skill_paths_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!tableHasColumn(d, 'workspaces', 'disabled_extension_paths_json')) {
      d.exec("ALTER TABLE workspaces ADD COLUMN disabled_extension_paths_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!tableHasColumn(d, 'workspaces', 'disabled_tools_json')) {
      d.exec("ALTER TABLE workspaces ADD COLUMN disabled_tools_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!tableHasColumn(d, 'workspaces', 'enabled_skill_paths_json')) {
      d.exec("ALTER TABLE workspaces ADD COLUMN enabled_skill_paths_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!tableHasColumn(d, 'workspaces', 'always_apply_skill_paths_json')) {
      d.exec(
        "ALTER TABLE workspaces ADD COLUMN always_apply_skill_paths_json TEXT NOT NULL DEFAULT '[]'",
      )
    }
    if (!tableHasColumn(d, 'workspaces', 'github_remote_url')) {
      d.exec("ALTER TABLE workspaces ADD COLUMN github_remote_url TEXT NOT NULL DEFAULT ''")
    }
    if (!tableHasColumn(d, 'workspaces', 'github_backup_enabled')) {
      d.exec('ALTER TABLE workspaces ADD COLUMN github_backup_enabled INTEGER NOT NULL DEFAULT 0')
    }
    if (!tableHasColumn(d, 'workspaces', 'github_last_sync_at')) {
      d.exec('ALTER TABLE workspaces ADD COLUMN github_last_sync_at INTEGER')
    }
    d.prepare('UPDATE workspaces SET path_segment = id WHERE TRIM(path_segment) = \'\'').run()
  }

  bootstrapWorkspacesIfEmpty(d, userDataPath)
  backfillConversationWorkspaces(d)
  migrateDefaultWorkspaceToDocumentsDir(d, userDataPath)
}

/**
 * One-time, idempotent migration: repoint the primary workspace's pi_cwd to the
 * canonical `<Documents>/GitHub/sylo-user`. Acts when the primary still points at
 * any legacy canonical (`<userData>/sylo-project`, `<Documents>/sylo-workspaces/Default`,
 * or an in-place rename `<Documents>/sylo-workspaces/sylo-user`) or has no path.
 * When a source folder with content is
 * found it is moved to the new location (same drive → rename); if the new location
 * is already populated (e.g. the operator already moved it there) it is used as-is
 * and never clobbered. Legacy folders are removed only when empty. User-customized
 * primary folders left alone (they don't match a known legacy path and they exist).
 *
 * A primary folder that is missing on disk is deliberately NOT migrated anymore:
 * under the named-workspace model that state means "deleted externally / fresh
 * machine" and the host surfaces a create-or-clone-from-GitHub prompt instead of
 * silently re-seeding a fallback folder (which would also repoint the row and
 * destroy the link to the operator's chosen folder name).
 */
function migrateDefaultWorkspaceToDocumentsDir(d: Database.Database, userDataPath: string): void {
  if (!tableExists(d, 'workspaces')) return
  const row = d
    .prepare('SELECT id, pi_cwd FROM workspaces ORDER BY sort_order ASC, created_at ASC LIMIT 1')
    .get() as { id: string; pi_cwd: string | null } | undefined
  if (!row) return
  const docs = homedir() + '\\Documents'

  const oldCanonical = path.join(userDataPath, 'sylo-project') // legacy AppData/Roaming
  const prevCanonical = path.join(docs, 'sylo-workspaces', 'Default') // previous unreleased canonical
  const prevRenamedInPlace = path.join(docs, 'sylo-workspaces', 'sylo-user') // operator renamed in place
  const cur = row.pi_cwd?.trim() ?? ''
  const next = canonicalDefaultWorkspacePiProjectPath()

  // Already at the current canonical: just ensure the new seed files exist —
  // but only when the folder is actually on disk. A deleted canonical folder is
  // the missing-workspace state the host surfaces via its create-or-clone
  // restore prompt; silently re-seeding here would mask it.
  if (cur && normalizePiCwd(cur) === normalizePiCwd(next)) {
    if (fs.existsSync(next)) ensureDefaultWorkspaceSeedFiles(next)
    return
  }

  const isOld =
    cur === '' ||
    normalizePiCwd(cur) === normalizePiCwd(oldCanonical) ||
    normalizePiCwd(cur) === normalizePiCwd(prevCanonical) ||
    normalizePiCwd(cur) === normalizePiCwd(prevRenamedInPlace)
  if (!isOld) return

  const nextPopulated = fs.existsSync(next) && fs.readdirSync(next).length > 0
  if (!nextPopulated) {
    // Bring along the first non-empty source folder we find (priority: the row's
    // current path, then an in-place rename, then the old canonical, then legacy).
    const candidates = [cur, prevRenamedInPlace, prevCanonical, oldCanonical].filter(Boolean)
    let moved = false
    for (const c of candidates) {
      if (!c || normalizePiCwd(c) === normalizePiCwd(next)) continue
      if (fs.existsSync(c) && fs.readdirSync(c).length > 0) {
        try {
          fs.mkdirSync(path.dirname(next), { recursive: true })
          if (fs.existsSync(next)) fs.rmdirSync(next)
          fs.renameSync(c, next)
          moved = true
          break
        } catch {
          /* cross-device or locked — leave files where they are; repoint below */
        }
      }
    }
    if (!moved) {
      try {
        fs.mkdirSync(next, { recursive: true })
      } catch {
        /* leave pi_cwd alone if the new dir is unusable */
        return
      }
    }
  } else {
    try {
      fs.mkdirSync(next, { recursive: true })
    } catch {
      /* exists */
    }
  }

  ensureDefaultWorkspaceSeedFiles(next)
  d.prepare('UPDATE workspaces SET pi_cwd = ? WHERE id = ?').run(next, row.id)

  // Tidy up empty legacy folders; never remove if they still have content.
  for (const legacy of [oldCanonical, prevCanonical, prevRenamedInPlace]) {
    if (!legacy) continue
    try {
      if (fs.existsSync(legacy) && fs.readdirSync(legacy).length === 0) fs.rmdirSync(legacy)
    } catch {
      /* ignore — best-effort cleanup */
    }
  }
  try {
    const prevParent = path.join(docs, 'sylo-workspaces')
    if (fs.existsSync(prevParent) && fs.readdirSync(prevParent).length === 0) {
      fs.rmdirSync(prevParent)
    }
  } catch {
    /* ignore — best-effort cleanup */
  }
}

function bootstrapWorkspacesIfEmpty(d: Database.Database, userDataPath: string): void {
  if (!tableExists(d, 'workspaces')) return
  const n = (d.prepare('SELECT COUNT(*) as c FROM workspaces').get() as { c: number }).c
  if (n > 0) return
  const projectPath = canonicalDefaultWorkspacePiProjectPath()
  fs.mkdirSync(projectPath, { recursive: true })
  ensureDefaultWorkspaceSeedFiles(projectPath)
  const id = randomUUID()
  const now = Date.now()
  d.prepare(
    'INSERT INTO workspaces (id, name, pi_cwd, path_segment, disabled_skill_paths_json, disabled_extension_paths_json, disabled_tools_json, enabled_skill_paths_json, always_apply_skill_paths_json, github_remote_url, github_backup_enabled, github_last_sync_at, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'Sylo-user', projectPath, '_inbox', '[]', '[]', '[]', '[]', '[]', '', 0, null, 0, now)
}

function backfillConversationWorkspaces(d: Database.Database): void {
  if (!tableExists(d, 'workspaces')) return
  const def = (d
    .prepare('SELECT id FROM workspaces ORDER BY sort_order ASC, created_at ASC LIMIT 1')
    .get() as { id: string } | undefined)?.id
  if (!def) return
  d.prepare('UPDATE conversations SET workspace_id = ? WHERE workspace_id IS NULL').run(def)
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not opened')
  return db
}

export function dbPath(userDataPath: string): string {
  return path.join(userDataPath, 'sylo-data', 'sylo.sqlite')
}

/**
 * Dedicated operator DB inside the GitHub-synced `sylo-user` workspace.
 *
 * Holds global operator data (health tables) so it backs up and travels between
 * machines. `journal_mode = DELETE` keeps a single self-contained `.db` file with
 * no `-wal`/`-shm` sidecars, which is safe to commit to git (unlike WAL). See
 * feature tracker 2026-08-02_14-53-03 (scope-based storage refactor, Phase 1).
 */
/**
 * Pref key overriding the personal-bundle data directory (absolute path).
 * Absent/empty → the personal plugin derives its own default from the data
 * root (`<sylo-user>/health`). Written by the generic personal Settings card.
 * (Legacy key `sylo.health.data_dir` is still honored — see
 * {@link personalDataDirOverride}.)
 */
export const PERSONAL_DATA_DIR_PREF = 'sylo.personal.data_dir'

/** Legacy pre-split pref key (wrote the health data dir itself). */
export const LEGACY_HEALTH_DATA_DIR_PREF = 'sylo.health.data_dir'

/**
 * Explicit personal data dir override from Settings, or null. Resolution:
 *   1. `sylo.personal.data_dir` (generic personal-bundle pref)
 *   2. Legacy `sylo.health.data_dir` (pre-split key — same semantics: the
 *      data dir itself)
 */
export function personalDataDirOverride(): string | null {
  for (const key of [PERSONAL_DATA_DIR_PREF, LEGACY_HEALTH_DATA_DIR_PREF]) {
    try {
      if (db) {
        const configured = getPref<string>(key, '')
        const trimmed = typeof configured === 'string' ? configured.trim() : ''
        if (trimmed && path.isAbsolute(trimmed)) return path.resolve(trimmed)
      }
    } catch {
      /* DB not open or prefs table missing — fall through */
    }
  }
  return null
}

/**
 * Generic personal-bundle data root. The personal plugin derives its data dir
 * from this (the bundle owns the `health` default — the host owns no domain
 * names). Currently the operator workspace, `<sylo-user>`.
 */
export function personalDataRoot(): string {
  return resolveSyloUserDir()
}

/**
 * Set up operator-data environment (no SQLite). Exposes `SYLO_USER_DIR` so
 * operator workflows resolve under `<sylo-user>/.sylo/workflows/`, and ensures
 * the `.sylo` directory exists. The personal plugin creates its own data dir
 * on load. The broker child inherits `SYLO_USER_DIR` via the
 * `...process.env` spread when it is forked.
 */
export function initOperatorEnv(): void {
  const userDir = resolveSyloUserDir()
  process.env.SYLO_USER_DIR = userDir
  // When the primary workspace folder is missing on disk (deleted externally,
  // fresh machine), do NOT silently recreate it here — the host surfaces a
  // create-or-clone-from-GitHub prompt instead and calls refreshOperatorEnv()
  // once the operator has chosen.
  if (fs.existsSync(userDir)) {
    fs.mkdirSync(path.join(userDir, '.sylo'), { recursive: true })
  }
}

/**
 * Re-resolve `SYLO_USER_DIR` (and ensure `.sylo` exists) after the primary
 * workspace folder is created, restored from GitHub, or renamed at runtime.
 * Broker children forked afterwards inherit the corrected path.
 */
export function refreshOperatorEnv(): void {
  const userDir = resolveSyloUserDir()
  process.env.SYLO_USER_DIR = userDir
  fs.mkdirSync(path.join(userDir, '.sylo'), { recursive: true })
}

/** First workspace by sort order — target for chat moves when deleting a workspace. */
export function defaultWorkspaceId(): string {
  const row = getDb()
    .prepare('SELECT id FROM workspaces ORDER BY sort_order ASC, created_at ASC LIMIT 1')
    .get() as { id: string } | undefined
  if (!row) throw new Error('no workspace')
  return row.id
}

/**
 * Seed files Sylo installs into the built-in `sylo-user` workspace folder.
 *
 * Layout:
 *   profile/user_profile.md  — operator's personal profile (name, work, vehicle, prefs).
 *   profile/AGENTS.md        — tells agents to maintain user_profile.md when stable facts appear.
 *   INDEX.md                 — grouped inventory of files in this workspace.
 *   AGENTS.md                — project-level: keep INDEX.md complete when files are added.
 *   README.md                — short human readme.
 *
 * Idempotent: each file is created only when missing, never overwrites edits.
 * Also migrates a legacy root-level `user_profile.md` (old layout) into
 * `profile/user_profile.md` when the new location is absent.
 */
export const USER_PROFILE_FILENAME = 'user_profile.md'

function ensureSeedFile(filePath: string, contents: string): void {
  if (fs.existsSync(filePath)) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents, 'utf8')
}

export function ensureDefaultWorkspaceSeedFiles(projectPath: string): void {
  if (!projectPath?.trim()) return
  fs.mkdirSync(projectPath, { recursive: true })
  const profileDir = path.join(projectPath, 'profile')

  // Migrate a legacy root-level user_profile.md into profile/ (idempotent).
  const legacyProfile = path.join(projectPath, USER_PROFILE_FILENAME)
  const newProfile = path.join(profileDir, USER_PROFILE_FILENAME)
  if (fs.existsSync(legacyProfile) && !fs.existsSync(newProfile)) {
    try {
      fs.mkdirSync(profileDir, { recursive: true })
      fs.renameSync(legacyProfile, newProfile)
    } catch {
      /* leave the legacy file in place; ensureSeedFile below creates the new one */
    }
  }

  ensureSeedFile(newProfile, [
    '# User Profile',
    '',
    'Facts about the Sylo operator that the assistant should remember across',
    'sessions and computers (name, work, vehicle, preferences, etc.).',
    '',
    'This file lives in the built-in **sylo-user** workspace under `profile/`, so it',
    'is backed up with your other user-data files and travels with you between',
    'machines via GitHub sync. The assistant updates it only when you ask it to',
    'remember something about you. Edit it freely by hand as well.',
    '',
    '<!-- Add profile facts below. -->',
    '',
  ].join('\n'))

  ensureSeedFile(path.join(profileDir, 'AGENTS.md'), [
    '# Profile maintenance (sylo-user/profile)',
    '',
    'This folder holds the operator\'s personal profile (`user_profile.md`).',
    '',
    '- When the operator shares a **stable fact** about themselves (name, work,',
    '  vehicle, location, durable preferences), add or update it in `user_profile.md`.',
    '- Do **not** create separate profile files; keep all profile facts in `user_profile.md`.',
    '- Do not write speculatively — only persist what the operator explicitly asks to remember.',
  ].join('\n'))

  ensureSeedFile(path.join(projectPath, 'INDEX.md'), [
    '# sylo-user — File Index',
    '',
    'Inventory of files in the `sylo-user` workspace. Grouped by type. Keep this',
    'complete: when a new file is added to this workspace, add an entry under the',
    'matching group (create the group if needed) with a one-line description.',
    '',
    '## Profile',
    '- `profile/user_profile.md` — operator\'s personal profile (name, work, vehicle, prefs).',
    '- `profile/AGENTS.md` — instructions for maintaining `user_profile.md`.',
    '',
    '## Notes',
    '<!-- e.g. - `notes/foo.md` — one-line description. -->',
    '',
    '## Plans',
    '<!-- e.g. - `plans/bar.md` — one-line description. -->',
    '',
    '## References',
    '<!-- e.g. - `references/baz.md` — one-line description. -->',
    '',
    '## Other',
    '<!-- anything that doesn\'t fit the groups above. -->',
    '',
  ].join('\n'))

  ensureSeedFile(path.join(projectPath, 'AGENTS.md'), [
    '# sylo-user workspace',
    '',
    'This is the operator\'s cross-workspace **user-data** workspace. It holds the',
    'profile, notes, plans, and references that should follow the operator across',
    'machines (synced to GitHub). It is **not** a code project workspace.',
    '',
    '## Maintain the index',
    '',
    '`INDEX.md` is the inventory of files in this workspace. **Whenever you create a',
    'new file here, add a matching entry to `INDEX.md`** under the right group',
    '(Profile / Notes / Plans / References / Other), with a one-line description.',
    'If no group fits, add one. Keep `INDEX.md` complete and accurate.',
    '',
    '## Profile facts',
    '',
    'Operator profile facts live in `profile/user_profile.md` — see',
    '`profile/AGENTS.md` for when to update it.',
  ].join('\n'))

  ensureSeedFile(path.join(projectPath, 'README.md'), [
    '# sylo-user',
    '',
    "Operator's cross-workspace user-data workspace. Synced to GitHub.",
    '',
    '- `profile/user_profile.md` — personal profile.',
    '- `INDEX.md` — file inventory (keep it current).',
    '- `AGENTS.md` — agent instructions for this workspace.',
    '',
    "See `INDEX.md` for what's here.",
    '',
  ].join('\n'))
}

/** Ensures the canonical default project folder exists and assigns it to the primary (first) workspace row. */
export function resetPrimaryWorkspacePiProjectDir(): string {
  const p = canonicalDefaultWorkspacePiProjectPath()
  fs.mkdirSync(p, { recursive: true })
  ensureDefaultWorkspaceSeedFiles(p)
  updateWorkspace(defaultWorkspaceId(), { pi_cwd: p })
  return p
}

export function listConversations(workspaceId?: string): ConversationRow[] {
  if (workspaceId === undefined) {
    return getDb()
      .prepare(
        'SELECT id, title, created_at, updated_at, workspace_id, pi_session_relpath, model_provider, model_id, image_model_id, image_model_provider, thinking_level FROM conversations ORDER BY updated_at DESC',
      )
      .all() as ConversationRow[]
  }
  return getDb()
    .prepare(
      'SELECT id, title, created_at, updated_at, workspace_id, pi_session_relpath, model_provider, model_id, image_model_id, image_model_provider, thinking_level FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC',
    )
    .all(workspaceId) as ConversationRow[]
}

/** Conversations whose last activity (`updated_at`) is before the cutoff (exclusive). */
export function listConversationsUpdatedBefore(updatedBeforeMs: number): ConversationRow[] {
  return getDb()
    .prepare(
      'SELECT id, title, created_at, updated_at, workspace_id, pi_session_relpath, model_provider, model_id, image_model_id, image_model_provider, thinking_level FROM conversations WHERE updated_at < ? ORDER BY updated_at ASC',
    )
    .all(updatedBeforeMs) as ConversationRow[]
}

/** Most recently touched conversation in the workspace with zero messages (reuse as "new chat"). */
export function findLatestEmptyConversationId(workspaceId: string): string | undefined {
  const wid = typeof workspaceId === 'string' ? workspaceId.trim() : ''
  if (!wid) return undefined
  const row = getDb()
    .prepare(
      `SELECT c.id FROM conversations c
       WHERE c.workspace_id = ?
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
       ORDER BY c.updated_at DESC
       LIMIT 1`,
    )
    .get(wid) as { id: string } | undefined
  return row?.id
}

export function getConversation(id: string): ConversationRow | undefined {
  return getDb()
    .prepare(
      'SELECT id, title, created_at, updated_at, workspace_id, pi_session_relpath, model_provider, model_id, image_model_id, image_model_provider, thinking_level FROM conversations WHERE id = ?',
    )
    .get(id) as ConversationRow | undefined
}

export function createConversation(title = '', workspaceId?: string): ConversationRow {
  const wid = workspaceId ?? defaultWorkspaceId()
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at, workspace_id, pi_session_relpath) VALUES (?, ?, ?, ?, ?, NULL)',
    )
    .run(id, title, now, now, wid)
  return { id, title, created_at: now, updated_at: now, workspace_id: wid, pi_session_relpath: null, model_provider: null, model_id: null, image_model_id: null, image_model_provider: null, thinking_level: null }
}

export function setConversationWorkspace(id: string, workspaceId: string): void {
  const now = Date.now()
  getDb().prepare('UPDATE conversations SET workspace_id = ?, updated_at = ? WHERE id = ?').run(workspaceId, now, id)
}

export function setConversationSessionRelPath(id: string, relpath: string | null): void {
  const now = Date.now()
  getDb()
    .prepare('UPDATE conversations SET pi_session_relpath = ?, updated_at = ? WHERE id = ?')
    .run(relpath, now, id)
}

export function updateConversationTitle(id: string, title: string): void {
  const now = Date.now()
  getDb().prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id)
}

/** Per-chat model override payload. Each field is null = inherit the global default. */
export type ConversationModelOverride = {
  model_provider: string | null
  model_id: string | null
  image_model_id: string | null
  image_model_provider: string | null
  /** null = Pi default thinking level for the model. */
  thinking_level: string | null
}

/** Persist the per-chat model override (null fields inherit the global default). */
export function setConversationModel(id: string, model: ConversationModelOverride): void {
  const now = Date.now()
  getDb()
    .prepare(
      'UPDATE conversations SET model_provider = ?, model_id = ?, image_model_id = ?, image_model_provider = ?, thinking_level = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      model.model_provider,
      model.model_id,
      model.image_model_id,
      model.image_model_provider,
      model.thinking_level ?? null,
      now,
      id,
    )
}

const WORKSPACE_COLUMNS = `id, name, pi_cwd, path_segment, disabled_skill_paths_json,
    disabled_extension_paths_json, disabled_tools_json, enabled_skill_paths_json,
    always_apply_skill_paths_json, github_remote_url, github_backup_enabled,
    github_last_sync_at, sort_order, created_at`

export function listWorkspaces(): WorkspaceRow[] {
  return getDb()
    .prepare(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspaces ORDER BY sort_order ASC, created_at ASC`,
    )
    .all() as WorkspaceRow[]
}

export function createWorkspace(name: string, piCwd = ''): WorkspaceRow {
  const id = randomUUID()
  const now = Date.now()
  const maxRow = getDb().prepare('SELECT MAX(sort_order) as m FROM workspaces').get() as {
    m: number | null
  }
  const sort_order = (maxRow.m ?? 0) + 1
  getDb()
    .prepare(
      `INSERT INTO workspaces (id, name, pi_cwd, path_segment, disabled_skill_paths_json,
        disabled_extension_paths_json, disabled_tools_json, enabled_skill_paths_json,
        always_apply_skill_paths_json, github_remote_url, github_backup_enabled,
        github_last_sync_at, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, piCwd, id, '[]', '[]', '[]', '[]', '[]', '', 0, null, sort_order, now)
  return {
    id,
    name,
    pi_cwd: piCwd,
    path_segment: id,
    disabled_skill_paths_json: '[]',
    disabled_extension_paths_json: '[]',
    disabled_tools_json: '[]',
    enabled_skill_paths_json: '[]',
    always_apply_skill_paths_json: '[]',
    github_remote_url: '',
    github_backup_enabled: 0,
    github_last_sync_at: null,
    sort_order,
    created_at: now,
  }
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
  return getDb()
    .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?`)
    .get(id) as WorkspaceRow | undefined
}

export function updateWorkspace(id: string, patch: { name?: string; pi_cwd?: string }): void {
  const row = getWorkspace(id)
  if (!row) return
  const nextName =
    patch.name !== undefined ? (patch.name.trim() || row.name) : row.name
  const piCwd = patch.pi_cwd !== undefined ? patch.pi_cwd : row.pi_cwd
  getDb().prepare('UPDATE workspaces SET name = ?, pi_cwd = ? WHERE id = ?').run(nextName, piCwd, id)
}

export function updateWorkspaceGithubBackup(
  id: string,
  patch: { github_remote_url?: string; github_backup_enabled?: boolean },
): void {
  const row = getWorkspace(id)
  if (!row) return
  const url =
    patch.github_remote_url !== undefined ?
      patch.github_remote_url.trim()
    : row.github_remote_url
  const enabled =
    patch.github_backup_enabled !== undefined ?
      patch.github_backup_enabled ? 1 : 0
    : row.github_backup_enabled
  getDb()
    .prepare('UPDATE workspaces SET github_remote_url = ?, github_backup_enabled = ? WHERE id = ?')
    .run(url, enabled, id)
}

export function touchWorkspaceGithubSync(id: string, atMs: number): void {
  getDb().prepare('UPDATE workspaces SET github_last_sync_at = ? WHERE id = ?').run(atMs, id)
}

export function listGithubBackupWorkspaces(): WorkspaceRow[] {
  return getDb()
    .prepare(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspaces
       WHERE github_backup_enabled = 1 AND TRIM(github_remote_url) != ''
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all() as WorkspaceRow[]
}

export function workspaceDisabledDecoded(row: WorkspaceRow): {
  skillPaths: string[]
  extensionPaths: string[]
  disabledTools: SyloDisabledToolRef[]
} {
  let sk: unknown = []
  let ex: unknown = []
  let dt: unknown = []
  try {
    sk = JSON.parse(row.disabled_skill_paths_json || '[]') as unknown
  } catch {
    sk = []
  }
  try {
    ex = JSON.parse(row.disabled_extension_paths_json || '[]') as unknown
  } catch {
    ex = []
  }
  try {
    dt = JSON.parse(row.disabled_tools_json || '[]') as unknown
  } catch {
    dt = []
  }
  return {
    skillPaths: normalizeSkillPathListForPolicyJson(sk),
    extensionPaths: normalizePathListForDisabledJson(ex),
    disabledTools: normalizeDisabledToolsJson(dt),
  }
}

export function patchWorkspaceDisabledCapability(
  opts:
    | { workspaceId: string; kind: 'skill'; path: string; excluded: boolean }
    | { workspaceId: string; kind: 'extension'; path: string; excluded: boolean }
    | {
        workspaceId: string
        kind: 'tool'
        extensionPath: string
        toolName: string
        excluded: boolean
      },
): { skillPaths: string[]; extensionPaths: string[]; disabledTools: SyloDisabledToolRef[] } | null {
  const row = getWorkspace(opts.workspaceId)
  if (!row) {
    return null
  }
  const cur = workspaceDisabledDecoded(row)

  if (opts.kind === 'tool') {
    const ep = normalizeSyloCapabilityPath(opts.extensionPath)
    const tn = typeof opts.toolName === 'string' ? opts.toolName.trim() : ''
    if (!ep || !tn) {
      return { skillPaths: cur.skillPaths, extensionPaths: cur.extensionPaths, disabledTools: cur.disabledTools }
    }
    const map = new Map<string, SyloDisabledToolRef>()
    for (const t of cur.disabledTools) {
      const e = normalizeSyloCapabilityPath(t.extensionPath)
      const n = t.toolName.trim()
      if (!e || !n) continue
      map.set(makeSyloDisabledToolKey(e, n), { extensionPath: e, toolName: n })
    }
    const k = makeSyloDisabledToolKey(ep, tn)
    if (opts.excluded) map.set(k, { extensionPath: ep, toolName: tn })
    else map.delete(k)
    const disabledTools = mergeDisabledToolsLists(Array.from(map.values()), [])
    getDb()
      .prepare('UPDATE workspaces SET disabled_tools_json = ? WHERE id = ?')
      .run(JSON.stringify(disabledTools), opts.workspaceId)
    return { skillPaths: cur.skillPaths, extensionPaths: cur.extensionPaths, disabledTools }
  }

  const key = normalizeSyloCapabilityPath(opts.path)
  if (!key) {
    return { skillPaths: cur.skillPaths, extensionPaths: cur.extensionPaths, disabledTools: cur.disabledTools }
  }

  if (opts.kind === 'skill') {
    const set = new Set(cur.skillPaths.map((p) => normalizeSkillCapabilityPath(p)))
    const skillKey = normalizeSkillCapabilityPath(opts.path)
    if (!skillKey) {
      return { skillPaths: cur.skillPaths, extensionPaths: cur.extensionPaths, disabledTools: cur.disabledTools }
    }
    if (opts.excluded) set.add(skillKey)
    else set.delete(skillKey)
    const skillPaths = Array.from(set).sort((a, b) => a.localeCompare(b))
    getDb()
      .prepare('UPDATE workspaces SET disabled_skill_paths_json = ? WHERE id = ?')
      .run(JSON.stringify(skillPaths), opts.workspaceId)
    return { skillPaths, extensionPaths: cur.extensionPaths, disabledTools: cur.disabledTools }
  }

  const set = new Set(cur.extensionPaths)
  if (opts.excluded) set.add(key)
  else set.delete(key)
  const extensionPaths = Array.from(set).sort((a, b) => a.localeCompare(b))
  getDb()
    .prepare('UPDATE workspaces SET disabled_extension_paths_json = ? WHERE id = ?')
    .run(JSON.stringify(extensionPaths), opts.workspaceId)
  return { skillPaths: cur.skillPaths, extensionPaths, disabledTools: cur.disabledTools }
}

/**
 * Delete a workspace row only (no chat disposition). Chat + out-of-folder
 * artifact cleanup is orchestrated by `deleteWorkspaceFully` in
 * `conversation-lifecycle.ts`, which calls this after sweeping conversations.
 * Refuses to delete the last workspace or the primary workspace.
 */
export function deleteWorkspaceRow(id: string): boolean {
  const all = listWorkspaces()
  if (all.length <= 1) return false
  if (id === defaultWorkspaceId()) return false
  getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  return true
}

export function deleteConversation(id: string): void {
  const d = getDb()
  d.transaction(() => {
    deleteWebAccessRunsForConversation(id, d)
    deleteThinkTankSessionsForConversation(id, d)
    if (tableExists(d, 'agent_tasks')) {
      d.prepare('DELETE FROM agent_tasks WHERE conversation_id = ?').run(id)
    }
    d.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
    d.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  })()
}

export function listMessages(conversationId: string): MessageRow[] {
  return getDb()
    .prepare(
      'SELECT id, conversation_id, role, content, tool_calls_json, status, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    )
    .all(conversationId) as MessageRow[]
}

/**
 * Cheap COUNT used by the first-message auto-title hook. Avoid loading message
 * bodies just to check "is this the first user turn?".
 */
export function countUserMessages(conversationId: string): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) as n FROM messages WHERE conversation_id = ? AND role = 'user'",
    )
    .get(conversationId) as { n: number } | undefined
  return row?.n ?? 0
}

/** Copy SQLite transcript through the message before the last user turn (matches Pi fork-before-last-user). */
export function copyMessagesBeforeLastUser(
  sourceConversationId: string,
  targetConversationId: string,
): 'ok' | 'no_user_message' {
  const messages = listMessages(sourceConversationId)
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx < 0) return 'no_user_message'
  const toCopy = messages.slice(0, lastUserIdx)
  const d = getDb()
  const insert = d.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, tool_calls_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  d.transaction(() => {
    for (const m of toCopy) {
      insert.run(
        randomUUID(),
        targetConversationId,
        m.role,
        m.content,
        m.tool_calls_json,
        m.status,
        m.created_at,
      )
    }
    const now = Date.now()
    d.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, targetConversationId)
  })()
  return 'ok'
}

export function insertMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  status: MessageStatus = 'complete',
): MessageRow {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      'INSERT INTO messages (id, conversation_id, role, content, tool_calls_json, status, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    )
    .run(id, conversationId, role, content, status, now)
  getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
  return {
    id,
    conversation_id: conversationId,
    role,
    content,
    tool_calls_json: null,
    status,
    created_at: now,
  }
}

export function updateMessageContent(id: string, content: string, status: MessageStatus): void {
  getDb().prepare('UPDATE messages SET content = ?, status = ? WHERE id = ?').run(content, status, id)
}

/** Persist Pi broker telemetry (stored in tool_calls_json as [{ ts, event }]). */
export function appendToolCallsJson(id: string, chunk: unknown, ts?: number): void {
  const row = getDb().prepare('SELECT tool_calls_json FROM messages WHERE id = ?').get(id) as
    | { tool_calls_json: string | null }
    | undefined
  const prev = row?.tool_calls_json ? (JSON.parse(row.tool_calls_json) as unknown[]) : []
  const stamp = ts ?? Date.now()
  prev.push({ ts: stamp, event: chunk })
  getDb()
    .prepare('UPDATE messages SET tool_calls_json = ? WHERE id = ?')
    .run(JSON.stringify(prev), id)
}

/**
 * Batch-append multiple tool telemetry entries in a single SELECT + parse + UPDATE.
 * Avoids the O(n²) cost of calling appendToolCallsJson per event on long agent runs
 * where tool_calls_json grows to multiple MB — each call would re-parse and
 * re-serialize the entire blob.
 */
export function appendToolCallsJsonBatch(
  id: string,
  entries: Array<{ ts: number; event: unknown }>,
): void {
  if (entries.length === 0) return
  const row = getDb().prepare('SELECT tool_calls_json FROM messages WHERE id = ?').get(id) as
    | { tool_calls_json: string | null }
    | undefined
  const prev = row?.tool_calls_json ? (JSON.parse(row.tool_calls_json) as unknown[]) : []
  for (const entry of entries) prev.push(entry)
  getDb()
    .prepare('UPDATE messages SET tool_calls_json = ? WHERE id = ?')
    .run(JSON.stringify(prev), id)
}

export function getPref<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value_json FROM prefs WHERE key = ?').get(key) as
    | { value_json: string }
    | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

export function setPref(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO prefs (key, value_json) VALUES (?, ?)')
    .run(key, JSON.stringify(value))
}
