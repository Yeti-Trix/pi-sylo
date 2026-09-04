import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SYNC_COMMIT_MESSAGE = 'Sylo workspace sync'

/**
 * Written into a freshly-initialized workspace repo (first publish) when no
 * `.gitignore` exists, so build artifacts / virtualenvs / OS junk that happen
 * to live in the folder aren't pushed to the new GitHub repo. Intentionally
 * permissive — Sylo workspace content stays tracked.
 */
const DEFAULT_PUBLISH_GITIGNORE = [
  '# Virtual environments',
  '.venv/',
  'venv/',
  'env/',
  '',
  '# Dependencies',
  'node_modules/',
  '',
  '# Python',
  '__pycache__/',
  '*.py[cod]',
  '*$py.class',
  '*.egg-info/',
  '',
  '# Build output',
  'dist/',
  'build/',
  'out/',
  '',
  '# Logs',
  '*.log',
  '',
  '# OS',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '',
  '# IDE',
  '.vscode/',
  '.idea/',
  '',
].join('\n')

export type WorkspaceGitStatus = {
  isRepo: boolean
  branch: string
  dirty: boolean
  ahead: number
  behind: number
  remoteUrl: string
}

export type WorkspaceGitResult =
  | { ok: true; detail?: string }
  | { ok: false; error: WorkspaceGitError; detail?: string }

export type WorkspaceGitError =
  | 'git_not_installed'
  | 'path_not_found'
  | 'not_linked'
  | 'not_a_repo'
  | 'link_failed'
  | 'pull_failed'
  | 'push_failed'
  | 'nothing_to_push'
  | 'clone_failed'
  | 'dest_not_empty'

let gitAvailable: boolean | undefined

/** Strip `.git` suffix and trailing slashes for remote URL comparison. */
export function normalizeGithubRemoteUrl(raw: string): string {
  return raw.trim().replace(/\.git\/?$/i, '').replace(/\/+$/, '')
}

function remoteUrlsEquivalent(a: string, b: string): boolean {
  const na = normalizeGithubRemoteUrl(a).toLowerCase()
  const nb = normalizeGithubRemoteUrl(b).toLowerCase()
  if (na === nb) return true
  const httpsFromSsh = na.replace(/^git@github\.com:/i, 'https://github.com/')
  const httpsFromSshB = nb.replace(/^git@github\.com:/i, 'https://github.com/')
  return httpsFromSsh === httpsFromSshB
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
  return { stdout: stdout.toString(), stderr: stderr.toString() }
}

export async function probeGitInstalled(): Promise<boolean> {
  if (gitAvailable !== undefined) return gitAvailable
  try {
    await execFileAsync('git', ['--version'], { windowsHide: true })
    gitAvailable = true
  } catch {
    gitAvailable = false
  }
  return gitAvailable
}

async function isInsideWorkTree(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

async function readRemoteUrl(cwd: string, remote = 'origin'): Promise<string> {
  try {
    const { stdout } = await runGit(cwd, ['remote', 'get-url', remote])
    return stdout.trim()
  } catch {
    return ''
  }
}

export async function readWorkspaceGitStatus(cwd: string): Promise<WorkspaceGitStatus> {
  const empty: WorkspaceGitStatus = {
    isRepo: false,
    branch: '',
    dirty: false,
    ahead: 0,
    behind: 0,
    remoteUrl: '',
  }
  if (!existsSync(cwd)) return empty
  if (!(await isInsideWorkTree(cwd))) return empty

  let branch = ''
  try {
    const { stdout } = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    branch = stdout.trim()
  } catch {
    branch = ''
  }

  let dirty = false
  try {
    const { stdout } = await runGit(cwd, ['status', '--porcelain'])
    dirty = stdout.trim().length > 0
  } catch {
    dirty = false
  }

  let ahead = 0
  let behind = 0
  try {
    const { stdout } = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
    const parts = stdout.trim().split(/\s+/)
    if (parts.length >= 2) {
      ahead = Number.parseInt(parts[0] ?? '0', 10) || 0
      behind = Number.parseInt(parts[1] ?? '0', 10) || 0
    }
  } catch {
    ahead = 0
    behind = 0
  }

  const remoteUrl = await readRemoteUrl(cwd)
  return { isRepo: true, branch, dirty, ahead, behind, remoteUrl }
}

/**
 * Attach Sylo backup to an existing git repo or initialize a new one.
 * Existing repos are never re-inited; we only add/update `origin` when needed.
 */
export async function linkWorkspaceGitRepo(cwd: string, remoteUrl: string): Promise<WorkspaceGitResult> {
  if (!(await probeGitInstalled())) {
    return { ok: false, error: 'git_not_installed', detail: 'Install Git for Windows and retry.' }
  }
  if (!existsSync(cwd)) {
    return { ok: false, error: 'path_not_found', detail: cwd }
  }

  const url = normalizeGithubRemoteUrl(remoteUrl)
  if (!url) {
    return { ok: false, error: 'not_linked', detail: 'GitHub URL is required.' }
  }

  const alreadyRepo = await isInsideWorkTree(cwd)
  try {
    if (!alreadyRepo) {
      await runGit(cwd, ['init'])
      await runGit(cwd, ['remote', 'add', 'origin', url])
      try {
        await runGit(cwd, ['add', '-A'])
        await runGit(cwd, ['commit', '-m', 'Initial Sylo workspace backup'])
      } catch {
        /* empty folder — remote link still valid */
      }
      return { ok: true, detail: 'Initialized git repo and linked origin.' }
    }

    const existing = await readRemoteUrl(cwd)
    if (!existing) {
      await runGit(cwd, ['remote', 'add', 'origin', url])
      return { ok: true, detail: 'Linked origin on existing repo.' }
    }
    if (!remoteUrlsEquivalent(existing, url)) {
      await runGit(cwd, ['remote', 'set-url', 'origin', url])
      return {
        ok: true,
        detail: `Updated origin (was ${existing}).`,
      }
    }
    return { ok: true, detail: 'Already linked to this remote.' }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, error: 'link_failed', detail }
  }
}

/**
 * Run a network git operation (fetch/pull/push) with the stored GitHub token.
 * When a token is supplied and origin is an https URL, origin is temporarily
 * pointed at a token-in-URL variant (same pattern as the initial publish) so
 * private repos never consult the OS Git Credential Manager — which would
 * otherwise pop its account-picker dialog on machines with a cold credential
 * cache. The clean origin URL is always restored, even on failure.
 */
async function withOriginToken<T>(
  cwd: string,
  token: string | undefined,
  op: () => Promise<T>,
): Promise<T> {
  const tokenTrimmed = token?.trim()
  if (!tokenTrimmed) return op()
  const originUrl = await readRemoteUrl(cwd)
  if (!originUrl.startsWith('https://')) return op()
  const tokenUrl = withTokenInUrl(originUrl, tokenTrimmed)
  await runGit(cwd, ['remote', 'set-url', 'origin', tokenUrl])
  try {
    return await op()
  } finally {
    try {
      await runGit(cwd, ['remote', 'set-url', 'origin', originUrl])
    } catch {
      /* non-fatal: restore of the clean URL failed */
    }
  }
}

export async function pullWorkspaceGitRepo(
  cwd: string,
  opts: { token?: string } = {},
): Promise<WorkspaceGitResult> {
  if (!(await probeGitInstalled())) {
    return { ok: false, error: 'git_not_installed' }
  }
  if (!existsSync(cwd)) {
    return { ok: false, error: 'path_not_found' }
  }
  if (!(await isInsideWorkTree(cwd))) {
    return { ok: false, error: 'not_a_repo' }
  }

  return withOriginToken(cwd, opts.token, async () => {
    try {
      await runGit(cwd, ['fetch', 'origin'])
      const { stdout: upstream } = await runGit(cwd, ['rev-parse', '--abbrev-ref', '@{u}'])
      if (!upstream.trim()) {
        try {
          const branch = (await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
          if (branch && branch !== 'HEAD') {
            await runGit(cwd, ['branch', '--set-upstream-to', `origin/${branch}`, branch])
          }
        } catch {
          /* first pull on a repo with no upstream yet */
        }
      }
      await runGit(cwd, ['pull', '--ff-only', 'origin'])
      return { ok: true }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      return { ok: false, error: 'pull_failed' as const, detail }
    }
  })
}

export async function pushWorkspaceGitRepo(
  cwd: string,
  opts: { token?: string } = {},
): Promise<WorkspaceGitResult> {
  if (!(await probeGitInstalled())) {
    return { ok: false, error: 'git_not_installed' }
  }
  if (!existsSync(cwd)) {
    return { ok: false, error: 'path_not_found' }
  }
  if (!(await isInsideWorkTree(cwd))) {
    return { ok: false, error: 'not_a_repo' }
  }

  const before = await readWorkspaceGitStatus(cwd)
  if (!before.remoteUrl) {
    return { ok: false, error: 'not_linked', detail: 'No origin remote configured.' }
  }

  return withOriginToken(cwd, opts.token, async () => {
    try {
      if (before.dirty) {
        await runGit(cwd, ['add', '-A'])
        await runGit(cwd, ['commit', '-m', SYNC_COMMIT_MESSAGE])
      }

      const afterCommit = await readWorkspaceGitStatus(cwd)
      if (!afterCommit.dirty && afterCommit.ahead === 0) {
        return { ok: false, error: 'nothing_to_push' as const, detail: 'Working tree clean and nothing unpushed.' }
      }

      const branch = afterCommit.branch || 'main'
      try {
        await runGit(cwd, ['push', '-u', 'origin', branch])
      } catch {
        await runGit(cwd, ['push', 'origin', branch])
      }
      return { ok: true }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      return { ok: false, error: 'push_failed' as const, detail }
    }
  })
}

/**
 * Inject a PAT into an https clone URL (`https://x-access-token:<tok>@host/...`).
 * Used for the one-time clone of private repos; the clean URL is restored as
 * `origin` afterward so the token never persists in repo config.
 */
function withTokenInUrl(cloneUrl: string, token: string): string {
  const u = cloneUrl.trim()
  if (!u.startsWith('https://')) return u // ssh URLs rely on keys; nothing to inject
  return u.replace(/^https:\/\/([^@/]+)/, `https://x-access-token:${encodeURIComponent(token)}@$1`)
}

/**
 * Clone a repo into `destDir`. For private repos a token may be supplied to
 * seed auth for the clone; the clean clone URL is restored as `origin` so the
 * token is not written into git config. Recurses submodules.
 */
export async function cloneWorkspaceRepo(
  cloneUrl: string,
  destDir: string,
  opts: { token?: string; privateRepo?: boolean } = {},
): Promise<WorkspaceGitResult> {
  if (!(await probeGitInstalled())) {
    return { ok: false, error: 'git_not_installed' }
  }
  const url = cloneUrl.trim()
  if (!url) {
    return { ok: false, error: 'not_linked', detail: 'Clone URL is required.' }
  }
  const dest = destDir.trim()
  if (!dest) {
    return { ok: false, error: 'path_not_found', detail: 'Destination directory is required.' }
  }

  // Reject a non-empty destination so we never clobber an existing checkout.
  if (existsSync(dest)) {
    let empty = false
    try {
      empty = readdirSync(dest).length === 0
    } catch {
      empty = false
    }
    if (!empty) {
      return { ok: false, error: 'dest_not_empty', detail: 'Destination already exists and is not empty.' }
    }
  } else {
    try {
      mkdirSync(dirname(dest), { recursive: true })
    } catch (e) {
      return { ok: false, error: 'path_not_found', detail: e instanceof Error ? e.message : String(e) }
    }
  }

  const wantToken = Boolean(opts.token) && (opts.privateRepo ?? false)
  const cloneWithToken = wantToken ? withTokenInUrl(url, opts.token!) : url
  const parent = dirname(dest)

  const attempt = async (urlToUse: string): Promise<void> => {
    await runGit(parent, ['clone', '--recurse-submodules', '--', urlToUse, dest])
  }

  try {
    await attempt(cloneWithToken)
  } catch (e1) {
    // If we tried a plain (no-token) clone and it failed (e.g. private repo
    // without a credential-manager entry), retry once with the token.
    if (!wantToken && opts.token) {
      try {
        await attempt(withTokenInUrl(url, opts.token))
      } catch (e2) {
        return { ok: false, error: 'clone_failed', detail: e2 instanceof Error ? e2.message : String(e2) }
      }
    } else {
      return { ok: false, error: 'clone_failed', detail: e1 instanceof Error ? e1.message : String(e1) }
    }
  }

  // Scrub any token we injected so it never persists in origin / git remote -v.
  if (wantToken) {
    try {
      await runGit(dest, ['remote', 'set-url', 'origin', url])
    } catch {
      /* non-fatal: clone still succeeded */
    }
  }
  return { ok: true, detail: 'Cloned.' }
}

/**
 * Publish an existing local workspace folder to a freshly-created GitHub repo:
 * ensure a git repo exists, commit any pending work, point `origin` at the
 * clean remote URL, and push the default branch upstream.
 *
 * When a token is supplied, the first push uses a one-time token-in-URL origin
 * (so it works without OS Git Credential Manager being set up yet) and the
 * clean URL is restored immediately so the token never persists in config.
 * With no token, push relies on the OS credential manager.
 */
export async function publishWorkspaceRepo(
  cwd: string,
  remoteUrl: string,
  opts: { token?: string; defaultBranch: string },
): Promise<WorkspaceGitResult> {
  if (!(await probeGitInstalled())) {
    return { ok: false, error: 'git_not_installed', detail: 'Install Git for Windows and retry.' }
  }
  if (!existsSync(cwd)) {
    return { ok: false, error: 'path_not_found', detail: cwd }
  }
  const url = normalizeGithubRemoteUrl(remoteUrl)
  if (!url) {
    return { ok: false, error: 'not_linked', detail: 'Remote URL is required.' }
  }
  const branch = opts.defaultBranch?.trim() || 'main'

  try {
    const alreadyRepo = await isInsideWorkTree(cwd)
    if (!alreadyRepo) {
      await runGit(cwd, ['init', '--initial-branch', branch])
    }

    // Normalize the current branch name to the repo's default branch.
    let hasCommits = false
    try {
      await runGit(cwd, ['rev-parse', '--verify', 'HEAD'])
      hasCommits = true
    } catch {
      hasCommits = false
    }
    if (hasCommits) {
      try {
        await runGit(cwd, ['branch', '-M', branch])
      } catch {
        /* detached/odd state — leave as-is */
      }
    } else {
      // No commits yet: set the unborn branch name.
      try {
        await runGit(cwd, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
      } catch {
        /* ignore */
      }
    }

        // Fresh repo: seed a sensible .gitignore (if none exists) and drop anything
    // an earlier run may have staged, so ignored junk (.venv, node_modules,
    // __pycache__, …) is not committed. Existing repos with real history are
    // left untouched.
    if (!hasCommits) {
      if (!existsSync(join(cwd, '.gitignore'))) {
        try {
          writeFileSync(join(cwd, '.gitignore'), DEFAULT_PUBLISH_GITIGNORE)
        } catch {
          /* non-fatal */
        }
      }
      try {
        await runGit(cwd, ['rm', '-r', '--cached', '--quiet', '.'])
      } catch {
        /* nothing staged yet is fine */
      }
    }

    // Stage + commit anything present so there's something to push.
    let committed = false
    let commitError: string | undefined
    try {
      await runGit(cwd, ['add', '-A'])
    } catch {
      /* empty tree is fine */
    }
    if (!hasCommits) {
      try {
        await runGit(cwd, ['commit', '-m', 'Initial Sylo workspace backup'])
        committed = true
      } catch (e) {
        committed = false
        commitError = e instanceof Error ? e.message : String(e)
      }
    } else {
      try {
        const { stdout } = await runGit(cwd, ['status', '--porcelain'])
        if (stdout.trim().length > 0) {
          await runGit(cwd, ['commit', '-m', SYNC_COMMIT_MESSAGE])
          committed = true
        }
      } catch (e) {
        commitError = e instanceof Error ? e.message : String(e)
      }
    }

    // Attach / correct origin to the CLEAN url (never the token url).
    const existing = await readRemoteUrl(cwd)
    if (!existing) {
      await runGit(cwd, ['remote', 'add', 'origin', url])
    } else if (!remoteUrlsEquivalent(existing, url)) {
      await runGit(cwd, ['remote', 'set-url', 'origin', url])
    }

    if (!hasCommits && !committed) {
      // Nothing to push. Surface the real reason instead of a misleading
      // "folder is empty" — the commit may have failed (e.g. missing git
      // identity) even when files are present.
      const detail = commitError
        ? `Could not create the initial commit: ${commitError.trim()}`
        : 'Folder is empty — nothing to push to the new repo.'
      return { ok: false, error: 'nothing_to_push', detail }
    }

    // First push. Use token-in-URL temporarily so private repos push without
    // requiring the OS credential manager to be pre-configured; restore the
    // clean origin immediately afterward.
    const token = opts.token?.trim()
    if (token && url.startsWith('https://')) {
      const tokenUrl = withTokenInUrl(url, token)
      try {
        await runGit(cwd, ['remote', 'set-url', 'origin', tokenUrl])
        await runGit(cwd, ['push', '-u', 'origin', branch])
      } finally {
        try {
          await runGit(cwd, ['remote', 'set-url', 'origin', url])
        } catch {
          /* non-fatal */
        }
      }
    } else {
      try {
        await runGit(cwd, ['push', '-u', 'origin', branch])
      } catch {
        await runGit(cwd, ['push', 'origin', branch])
      }
    }
    return { ok: true, detail: 'Published.' }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, error: 'push_failed', detail }
  }
}
