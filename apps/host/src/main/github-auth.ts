/**
 * GitHub account connection for Sylo workspace cloning.
 *
 * Stores a Personal Access Token (PAT) encrypted with Electron `safeStorage`
 * (OS keyring). Used only to *list* repos and bootstrap a one-time clone;
 * push/pull afterward reuse the OS git credential manager like the existing
 * per-workspace backup. The token is never written into repo config or the DB.
 *
 * If `safeStorage` is unavailable (rare, e.g. some headless Linux), the token
 * is stored as plaintext with a flag so the user is aware.
 */
import { app, safeStorage } from 'electron'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API_BASE = 'https://api.github.com'

/**
 * GitHub OAuth App client id for the device-flow sign-in.
 *
 * This is a PUBLIC identifier, NOT a secret. The OAuth device flow's security
 * model is "client id is public, no client secret, user authorizes per device by
 * entering a one-time code" — the same model the `gh` CLI uses (its client id
 * is public in its source). Do NOT move this to .env or treat it as secret.
 *
 * The only secret is the resulting access token, which is stored in the OS
 * keystore, never in source. To point Sylo at a different OAuth App for
 * development, set SYLO_GITHUB_CLIENT_ID in the environment before launch.
 */
const SYLO_GITHUB_OAUTH_CLIENT_ID =
  process.env.SYLO_GITHUB_CLIENT_ID || 'Ov23liBmP76abVY6ueHX'

const PREF_DEFAULT_DIR = 'sylo.github.cloneDefaultDir'
// Default clone root lives under `%HOME%/Documents/GitHub` (flat, siblings of the
// built-in `sylo-user` workspace). Local Documents, _not_ `app.getPath('documents')`
// which follows OneDrive redirection on Windows. Clones land in `<root>/<owner>/<repo>`.
const DEFAULT_CLONE_SUBDIR = 'GitHub'

export type GithubRepo = {
  id: number
  full_name: string
  name: string
  owner: string
  private: boolean
  default_branch: string
  clone_url: string
  ssh_url: string
  pushed_at: string | null
  description: string | null
  archived: boolean
}

export type GithubAuthStatus = { connected: true; login: string; encrypted: boolean } | { connected: false }

export type GithubAuthResult =
  | { ok: true; login: string; publicRepos: number | null }
  | { ok: false; error: string }

export type GithubRepoListResult =
  | { ok: true; repos: GithubRepo[]; hasMore: boolean; page: number }
  | { ok: false; error: string; status?: number }

export type GithubCreateRepoResult =
  | {
      ok: true
      repo: {
        full_name: string
        name: string
        owner: string
        private: boolean
        default_branch: string
        clone_url: string
        ssh_url: string
        html_url: string
      }
    }
  | { ok: false; error: string; status?: number }

export type GithubOrgListResult =
  | { ok: true; orgs: Array<{ login: string; id: number }> }
  | { ok: false; error: string; status?: number }

type StoredAuth = { token: string; login: string; enc: boolean }

function authFilePath(): string {
  return join(app.getPath('userData'), 'github-auth.json')
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Sylo',
  }
}

function encodeToken(token: string): { token: string; enc: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(token)
    return { token: buf.toString('base64'), enc: true }
  }
  return { token, enc: false }
}

function decodeToken(stored: string, enc: boolean): string {
  if (!enc) return stored
  return safeStorage.decryptString(Buffer.from(stored, 'base64'))
}

/** Extract a human-readable message from a non-2xx GitHub response body. */
async function readGithubErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string; errors?: Array<{ message?: string; field?: string }> }
    if (j.message) {
      const detail = j.errors?.[0]?.message
      return detail ? `${j.message}: ${detail}` : j.message
    }
  } catch {
    /* ignore — body wasn't JSON */
  }
  return ''
}

export function readGithubAuth(): { login: string; token: string; encrypted: boolean } | null {
  const fp = authFilePath()
  if (!existsSync(fp)) return null
  try {
    const j = JSON.parse(readFileSync(fp, 'utf8')) as StoredAuth
    const token = decodeToken(j.token, j.enc)
    if (!token || !j.login) return null
    return { login: j.login, token, encrypted: j.enc }
  } catch {
    return null
  }
}

export function readGithubToken(): string | null {
  return readGithubAuth()?.token ?? null
}

export function githubStatus(): GithubAuthStatus {
  const a = readGithubAuth()
  if (a) return { connected: true, login: a.login, encrypted: a.encrypted }
  return { connected: false }
}

export function clearGithubAuth(): void {
  const fp = authFilePath()
  if (existsSync(fp)) {
    try {
      unlinkSync(fp)
    } catch {
      /* ignore */
    }
  }
}

export async function saveGithubAuth(rawToken: string): Promise<GithubAuthResult> {
  const token = rawToken.trim()
  if (!token) return { ok: false, error: 'Token is required.' }

  let status: number
  let data: unknown
  try {
    const res = await fetch(`${API_BASE}/user`, { headers: headers(token) })
    status = res.status
    data = res.status === 204 ? null : await res.json()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (status === 401 || status === 403) {
    const m = (data as { message?: string } | null)?.message
    return { ok: false, error: m ? `Invalid or expired token: ${m}` : 'Invalid or expired token.' }
  }
  if (status !== 200) {
    const m = (data as { message?: string; errors?: Array<{ message?: string }> } | null)
    const msg = m?.message ? (m.errors?.[0]?.message ? `${m.message}: ${m.errors[0].message}` : m.message) : ''
    return { ok: false, error: msg ? `GitHub: ${msg}` : `GitHub returned HTTP ${status}.` }
  }
  const login = (data as { login?: string } | null)?.login
  if (!login) return { ok: false, error: 'Unexpected response from GitHub (no login).' }

  const stored = encodeToken(token)
  const payload: StoredAuth = { token: stored.token, login, enc: stored.enc }
  try {
    writeFileSync(authFilePath(), JSON.stringify(payload, null, 2), 'utf8')
  } catch (e) {
    return { ok: false, error: `Could not save token: ${e instanceof Error ? e.message : String(e)}` }
  }
    const publicRepos = (data as { public_repos?: number } | null)?.public_repos ?? null
  return { ok: true, login, publicRepos }
}

/* ------------------------------------------------------------------ */
/* OAuth device flow (public client — no client secret at runtime).   */
/* ------------------------------------------------------------------ */

export type GithubDeviceFlowStartResult =
  | {
      ok: true
      userCode: string
      verificationUri: string
      verificationUriComplete?: string
      interval: number
      expiresIn: number
    }
  | { ok: false; error: string }

export type GithubDeviceFlowPollResult =
  | { status: 'success'; auth: GithubAuthResult }
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'expired'; error: string }
  | { status: 'error'; error: string }

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const DEVICE_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

let pendingDeviceFlow: { deviceCode: string; interval: number; expiresAt: number } | null = null

/** Abandon any in-flight device flow (e.g. user closed the dialog). */
export function clearPendingDeviceFlow(): void {
  pendingDeviceFlow = null
}

/**
 * Begin a device-flow sign-in. Requests `repo workflow` scope so the token can
 * clone/pull/push any of the operator's repos (public + private) and create
 * new ones. No `read:org` — org repos won't appear in the clone list unless added.
 */
export async function startGithubDeviceFlow(): Promise<GithubDeviceFlowStartResult> {
  const body = new URLSearchParams({
    client_id: SYLO_GITHUB_OAUTH_CLIENT_ID,
    scope: 'repo workflow',
  })
  let res: Response
  try {
    res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'User-Agent': 'Sylo' },
      body,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (res.status !== 200) {
    const msg = await readGithubErrorMessage(res)
    return { ok: false, error: msg ? `GitHub: ${msg}` : `GitHub returned HTTP ${res.status}.` }
  }
  let j: Record<string, unknown>
  try {
    j = (await res.json()) as Record<string, unknown>
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const deviceCode = j.device_code
  const userCode = j.user_code
  const verificationUri = j.verification_uri
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
    return { ok: false, error: 'Unexpected response from GitHub (missing device flow fields).' }
  }
  const interval = typeof j.interval === 'number' ? j.interval : 5
  const expiresIn = typeof j.expires_in === 'number' ? j.expires_in : 900
  pendingDeviceFlow = { deviceCode, interval, expiresAt: Date.now() + expiresIn * 1000 }
  return {
    ok: true,
    userCode,
    verificationUri,
    verificationUriComplete: typeof j.verification_uri_complete === 'string' ? j.verification_uri_complete : undefined,
    interval,
    expiresIn,
  }
}

/** Perform one token-exchange poll. Call repeatedly every `interval` seconds. */
export async function pollGithubDeviceFlow(): Promise<GithubDeviceFlowPollResult> {
  if (!pendingDeviceFlow) return { status: 'error', error: 'No device sign-in in progress.' }
  if (Date.now() > pendingDeviceFlow.expiresAt) {
    pendingDeviceFlow = null
    return { status: 'expired', error: 'The sign-in code expired. Try again.' }
  }
  const body = new URLSearchParams({
    client_id: SYLO_GITHUB_OAUTH_CLIENT_ID,
    device_code: pendingDeviceFlow.deviceCode,
    grant_type: DEVICE_GRANT_TYPE,
  })
  let res: Response
  try {
    res = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'User-Agent': 'Sylo' },
      body,
    })
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
  if (res.status !== 200) {
    const msg = await readGithubErrorMessage(res)
    return { status: 'error', error: msg ? `GitHub: ${msg}` : `GitHub returned HTTP ${res.status}.` }
  }
  let j: Record<string, unknown>
  try {
    j = (await res.json()) as Record<string, unknown>
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
  const err = typeof j.error === 'string' ? j.error : ''
  if (err === 'authorization_pending') return { status: 'pending' }
  if (err === 'slow_down') {
    pendingDeviceFlow.interval += 5
    return { status: 'slow_down', interval: pendingDeviceFlow.interval }
  }
  if (err === 'expired_token') {
    pendingDeviceFlow = null
    return { status: 'expired', error: 'The sign-in code expired. Try again.' }
  }
  if (err === 'incorrect_device_code' || err === 'device_flow_disabled' || err === 'unsupported_grant_type') {
    pendingDeviceFlow = null
    return {
      status: 'error',
      error:
        err === 'device_flow_disabled'
          ? 'Device flow is not enabled for this OAuth App. Enable it in the GitHub app settings.'
          : err === 'unsupported_grant_type'
            ? 'This OAuth App does not support the device flow.'
            : 'Device code rejected.',
    }
  }
  const token = typeof j.access_token === 'string' ? j.access_token : ''
  if (!token) {
    pendingDeviceFlow = null
    return { status: 'error', error: 'Unexpected response from GitHub (no access token).' }
  }
  pendingDeviceFlow = null
  // Validate + store encrypted (reuses the same path as PAT connect).
  const auth = await saveGithubAuth(token)
  return { status: 'success', auth }
}

function parseRepo(raw: unknown): GithubRepo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const ownerObj = r.owner
  const owner =
    typeof ownerObj === 'object' && ownerObj !== null ?
      (ownerObj as { login?: unknown }).login
    : undefined
  if (typeof r.full_name !== 'string' || typeof r.name !== 'string' || typeof owner !== 'string') {
    return null
  }
  return {
    id: typeof r.id === 'number' ? r.id : 0,
    full_name: r.full_name,
    name: r.name,
    owner,
    private: r.private === true,
    default_branch: typeof r.default_branch === 'string' ? r.default_branch : 'main',
    clone_url: typeof r.clone_url === 'string' ? r.clone_url : '',
    ssh_url: typeof r.ssh_url === 'string' ? r.ssh_url : '',
    pushed_at: typeof r.pushed_at === 'string' ? r.pushed_at : null,
    description: typeof r.description === 'string' ? r.description : null,
    archived: r.archived === true,
  }
}

export async function listGithubRepos(opts: { page?: number; perPage?: number } = {}): Promise<GithubRepoListResult> {
  const auth = readGithubAuth()
  if (!auth) return { ok: false, error: 'Not connected to GitHub.' }
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const perPage = Math.min(100, Math.max(1, Math.floor(opts.perPage ?? 100)))
  // NOTE: `type` and `affiliation` are mutually exclusive on GET /user/repos
  // (sending both returns HTTP 422). Use affiliation only.
  const url = `${API_BASE}/user/repos?per_page=${perPage}&page=${page}&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`

  let res: Response
  try {
    res = await fetch(url, { headers: headers(auth.token) })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'Token rejected by GitHub (reconnect).', status: res.status }
  }
  if (res.status !== 200) {
    const msg = await readGithubErrorMessage(res)
    return { ok: false, error: msg ? `GitHub: ${msg}` : `GitHub returned HTTP ${res.status}.`, status: res.status }
  }
  let arr: unknown
  try {
    arr = await res.json()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const repos = Array.isArray(arr) ? arr.map(parseRepo).filter((x): x is GithubRepo => x !== null) : []
  const link = res.headers.get('link') ?? ''
  const hasMore = /rel="next"/.test(link)
  return { ok: true, repos, hasMore, page }
}

/**
 * Default clone root: stored pref override, else `%HOME%/Documents/GitHub`.
 * Uses `%HOME%/Documents` (via `os.homedir()`) to _avoid_ OneDrive redirection —
 * on Windows machines with OneDrive backing Documents, `app.getPath('documents')`
 * returns the OneDrive path, which causes clone conflicts. Clones land in
 * `<root>/<owner>/<repo>`.
 */
export function defaultGithubCloneDir(): string {
  const pref = dbPrefGet(PREF_DEFAULT_DIR)
  if (pref && typeof pref === 'string' && pref.trim()) return pref.trim()
  return join(homedir(), 'Documents', DEFAULT_CLONE_SUBDIR)
}

export function setDefaultGithubCloneDir(dir: string): void {
  dbPrefSet(PREF_DEFAULT_DIR, dir.trim())
}

/** True when the clone root is the built-in default (no pref override). */
export function isDefaultCloneDir(): boolean {
  const pref = dbPrefGet(PREF_DEFAULT_DIR)
  return !pref || (typeof pref === 'string' && !pref.trim())
}

/**
 * Ensure the clone root exists on disk. Safe to call at startup. Only creates
 * the root folder, not per-repo subfolders (those are created at clone time).
 */
export function ensureDefaultCloneDir(): void {
  try {
    mkdirSync(defaultGithubCloneDir(), { recursive: true })
  } catch {
    /* ignore — clone will surface a real error if the dir is unusable */
  }
}

// Lightweight pref bridge so this module stays self-contained (the host DB may
// not be open yet when the renderer asks for the default dir early).
let prefGetFn: ((key: string, fallback: unknown) => unknown) | undefined
let prefSetFn: ((key: string, value: unknown) => void) | undefined

export function bindGithubPrefStore(opts: {
  get: (key: string, fallback: unknown) => unknown
  set: (key: string, value: unknown) => void
}): void {
  prefGetFn = opts.get
  prefSetFn = opts.set
}

function dbPrefGet(key: string): unknown {
  if (prefGetFn) return prefGetFn(key, '')
  return ''
}

function dbPrefSet(key: string, value: unknown): void {
  if (prefSetFn) prefSetFn(key, value)
}

/**
 * Create a new repository on GitHub under the authenticated user's account
 * (or an organization they administer). Returns the clone URL so the caller
 * can `git init`/link/push the local workspace folder to it.
 *
 * Requires a PAT with repo-creation permission:
 *  - Classic PAT: `repo` scope.
 *  - Fine-grained PAT: Administration: Read & write on the target account/org.
 */
export async function createGithubRepo(opts: {
  name: string
  owner?: string
  private?: boolean
  description?: string
}): Promise<GithubCreateRepoResult> {
  const auth = readGithubAuth()
  if (!auth) return { ok: false, error: 'Not connected to GitHub.' }

  const name = opts.name.trim()
  if (!name) return { ok: false, error: 'Repository name is required.' }
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
    return { ok: false, error: 'Repository name may only contain letters, digits, ., _, - and be up to 100 chars.' }
  }

  const isOrg = Boolean(opts.owner) && opts.owner!.trim().toLowerCase() !== auth.login.toLowerCase()
  const endpoint = isOrg ? `${API_BASE}/orgs/${encodeURIComponent(opts.owner!.trim())}/repos` : `${API_BASE}/user/repos`

  const body = {
    name,
    private: opts.private !== false,
    description: (opts.description ?? '').trim() || '',
    auto_init: false,
    has_issues: false,
    has_wiki: false,
    has_projects: false,
  }

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers(auth.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (res.status === 401 || res.status === 403) {
    const msg = await readGithubErrorMessage(res)
    return {
      ok: false,
      status: res.status,
      error: msg ? `Token lacks permission: ${msg}` : 'Token lacks permission to create a repo (needs Administration: Write).',
    }
  }
  if (res.status === 422) {
    const msg = await readGithubErrorMessage(res)
    return { ok: false, status: 422, error: msg ? `Could not create repo: ${msg}` : `A repo named "${name}" may already exist.` }
  }
  if (res.status !== 201) {
    const msg = await readGithubErrorMessage(res)
    return { ok: false, status: res.status, error: msg ? `GitHub: ${msg}` : `GitHub returned HTTP ${res.status}.` }
  }

  let data: unknown
  try {
    data = await res.json()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const r = data as Record<string, unknown> | null
  const ownerObj = r?.owner
  const owner =
    typeof ownerObj === 'object' && ownerObj !== null ? (ownerObj as { login?: unknown }).login : undefined
  if (typeof r?.full_name !== 'string' || typeof r.name !== 'string' || typeof owner !== 'string' || typeof r.clone_url !== 'string') {
    return { ok: false, error: 'Unexpected response from GitHub (missing repo fields).' }
  }
  return {
    ok: true,
    repo: {
      full_name: r.full_name,
      name: r.name,
      owner,
      private: r.private === true,
      default_branch: typeof r.default_branch === 'string' ? r.default_branch : 'main',
      clone_url: r.clone_url as string,
      ssh_url: typeof r.ssh_url === 'string' ? r.ssh_url : '',
      html_url: typeof r.html_url === 'string' ? r.html_url : `https://github.com/${r.full_name}`,
    },
  }
}

/**
 * Best-effort list of organizations the authenticated user can create repos in.
 * Used to populate an owner dropdown in the Publish UI. A token without `read:org`
 * / "Members: Read" returns 403; callers should treat that as "personal account only".
 */
export async function listGithubOrgs(): Promise<GithubOrgListResult> {
  const auth = readGithubAuth()
  if (!auth) return { ok: false, error: 'Not connected to GitHub.' }
  let res: Response
  try {
    res = await fetch(`${API_BASE}/user/orgs?per_page=100`, { headers: headers(auth.token) })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (res.status === 401 || res.status === 403) {
    // Token can't list orgs — not fatal; UI hides the org selector.
    return { ok: false, status: res.status, error: 'Token cannot list orgs.' }
  }
  if (res.status !== 200) {
    const msg = await readGithubErrorMessage(res)
    return { ok: false, status: res.status, error: msg ? `GitHub: ${msg}` : `GitHub returned HTTP ${res.status}.` }
  }
  let arr: unknown
  try {
    arr = await res.json()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const orgs = Array.isArray(arr)
    ? arr
        .map((o) => {
          if (typeof o !== 'object' || o === null) return null
          const r = o as Record<string, unknown>
          return typeof r.login === 'string' && typeof r.id === 'number' ? { login: r.login, id: r.id } : null
        })
        .filter((x): x is { login: string; id: number } => x !== null)
    : []
  return { ok: true, orgs }
}