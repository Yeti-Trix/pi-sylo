import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { parsePythonScriptJsonStdout } from '../shared/python-script-json.js'
import { resolveToolsPackageDir } from './tools-bundles.js'

const execFileAsync = promisify(execFile)

export type FieldBrainDbMode = 'local' | 'remote'

export type FieldBrainConfig = {
  dbMode: FieldBrainDbMode
  postgresHost: string
  postgresPort: number
  postgresDatabase: string
  postgresUsername: string
  postgresPassword: string
  ollamaUrl: string
}

export const DEFAULT_FIELDBRAIN_CONFIG: FieldBrainConfig = {
  dbMode: 'local',
  postgresHost: 'localhost',
  postgresPort: 5432,
  postgresDatabase: 'fieldbrain',
  postgresUsername: 'fieldbrain',
  postgresPassword: '',
  ollamaUrl: 'http://127.0.0.1:11434',
}

export function fieldbrainConfigDir(userDataPath: string): string {
  return join(userDataPath, 'fieldbrain')
}

export function fieldbrainConfigPath(userDataPath: string): string {
  return join(fieldbrainConfigDir(userDataPath), 'config.json')
}

export function fieldbrainDatabaseConfigPath(): string {
  return join(homedir(), '.sylo', 'fieldbrain', 'database_config.json')
}

function clampPort(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return DEFAULT_FIELDBRAIN_CONFIG.postgresPort
  return Math.max(1, Math.min(65535, Math.floor(n)))
}

function normalizeDbMode(raw: unknown): FieldBrainDbMode {
  return raw === 'remote' ? 'remote' : 'local'
}

export function readFieldBrainConfig(userDataPath: string): FieldBrainConfig {
  const path = fieldbrainConfigPath(userDataPath)
  if (!existsSync(path)) return { ...DEFAULT_FIELDBRAIN_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const dbMode = normalizeDbMode(raw.dbMode)
    const host =
      typeof raw.postgresHost === 'string' && raw.postgresHost.trim() ?
        raw.postgresHost.trim()
      : dbMode === 'local' ?
        'localhost'
      : DEFAULT_FIELDBRAIN_CONFIG.postgresHost
    return {
      dbMode,
      postgresHost: host,
      postgresPort: clampPort(raw.postgresPort),
      postgresDatabase:
        typeof raw.postgresDatabase === 'string' && raw.postgresDatabase.trim() ?
          raw.postgresDatabase.trim()
        : DEFAULT_FIELDBRAIN_CONFIG.postgresDatabase,
      postgresUsername:
        typeof raw.postgresUsername === 'string' && raw.postgresUsername.trim() ?
          raw.postgresUsername.trim()
        : DEFAULT_FIELDBRAIN_CONFIG.postgresUsername,
      postgresPassword: typeof raw.postgresPassword === 'string' ? raw.postgresPassword : '',
      ollamaUrl:
        typeof raw.ollamaUrl === 'string' && raw.ollamaUrl.trim() ?
          raw.ollamaUrl.trim()
        : DEFAULT_FIELDBRAIN_CONFIG.ollamaUrl,
    }
  } catch {
    return { ...DEFAULT_FIELDBRAIN_CONFIG }
  }
}

export function writeFieldBrainConfig(
  userDataPath: string,
  values: Partial<FieldBrainConfig>,
): { ok: true; config: FieldBrainConfig } | { ok: false; error: string } {
  try {
    const current = readFieldBrainConfig(userDataPath)
    const dbMode = values.dbMode != null ? normalizeDbMode(values.dbMode) : current.dbMode
    const merged: FieldBrainConfig = {
      dbMode,
      postgresHost:
        values.postgresHost != null ?
          String(values.postgresHost).trim() || (dbMode === 'local' ? 'localhost' : current.postgresHost)
        : current.postgresHost,
      postgresPort: values.postgresPort != null ? clampPort(values.postgresPort) : current.postgresPort,
      postgresDatabase:
        values.postgresDatabase != null ?
          String(values.postgresDatabase).trim() || current.postgresDatabase
        : current.postgresDatabase,
      postgresUsername:
        values.postgresUsername != null ?
          String(values.postgresUsername).trim() || current.postgresUsername
        : current.postgresUsername,
      postgresPassword:
        values.postgresPassword != null && String(values.postgresPassword).length > 0 ?
          String(values.postgresPassword)
        : current.postgresPassword,
      ollamaUrl:
        values.ollamaUrl != null ?
          String(values.ollamaUrl).trim() || current.ollamaUrl
        : current.ollamaUrl,
    }
    if (merged.dbMode === 'local' && !values.postgresHost) {
      merged.postgresHost = 'localhost'
    }

    const dir = fieldbrainConfigDir(userDataPath)
    mkdirSync(dir, { recursive: true })
    writeFileSync(fieldbrainConfigPath(userDataPath), JSON.stringify(merged, null, 2), 'utf8')

    const synced = syncToDatabaseConfigFile(merged)
    if (!synced.ok) return synced

    return { ok: true, config: merged }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function buildFieldBrainDatabaseUrl(config: FieldBrainConfig): string {
  const user = encodeURIComponent(config.postgresUsername)
  const password = config.postgresPassword ? encodeURIComponent(config.postgresPassword) : ''
  const auth = password ? `${user}:${password}@` : `${user}@`
  return `postgresql://${auth}${config.postgresHost}:${config.postgresPort}/${config.postgresDatabase}`
}

export function syncToDatabaseConfigFile(
  config: FieldBrainConfig,
): { ok: true; path: string } | { ok: false; error: string } {
  try {
    const path = fieldbrainDatabaseConfigPath()
    mkdirSync(dirname(path), { recursive: true })
    const payload = {
      host: config.postgresHost,
      port: config.postgresPort,
      database: config.postgresDatabase,
      username: config.postgresUsername,
      password: config.postgresPassword,
    }
    writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8')
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getGuidedSetupSteps(): string[] {
  return [
    'Install PostgreSQL 13+ as a Windows service — download from https://www.postgresql.org/download/windows/',
    'Optional — semantic search: download pgvector for your Postgres major version from https://github.com/andreiramani/pgvector_pgsql_windows/releases and extract the zip.',
    'FieldBrain Settings → Create database & migrate (uses superuser once; password not saved).',
    'Optional: Browse to the pgvector folder or zip → Install pgvector & enable semantic search.',
    'Test connection. Dev: dbMode local. Shop PCs: dbMode remote + server IP.',
  ]
}

export function syloFieldBrainPackageRoot(repoRoot: string): string {
  // Package moved to the sylo-tools-controls bundle (2026-09-02); in-repo path kept as fallback.
  return resolveToolsPackageDir(repoRoot, 'sylo-tools-controls', 'sylo-fieldbrain')
}

export async function copyPgvectorFilesWindowsElevated(
  sourceDir: string,
  pgRoot: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Elevated pgvector copy is Windows-only.' }
  }
  const sourceEsc = sourceDir.replace(/'/g, "''")
  const pgEsc = pgRoot.replace(/'/g, "''")
  const scriptBody = `
$ErrorActionPreference = 'Stop'
$src = '${sourceEsc}'
$pg = '${pgEsc}'
$lib = Join-Path $pg 'lib'
$ext = Join-Path $pg 'share\\extension'
New-Item -ItemType Directory -Force -Path $lib,$ext | Out-Null
Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
  $n = $_.Name.ToLowerInvariant()
  if ($n -like '*.dll') { Copy-Item $_.FullName (Join-Path $lib $_.Name) -Force }
  elseif ($n -eq 'vector.control' -or $n -like 'vector--*.sql') { Copy-Item $_.FullName (Join-Path $ext $_.Name) -Force }
}
if (-not (Test-Path (Join-Path $ext 'vector.control'))) { throw 'vector.control missing after copy' }
Write-Host 'pgvector files copied.'
`
  const tempDir = mkdtempSync(join(tmpdir(), 'sylo-pgvector-'))
  const scriptPath = join(tempDir, 'copy-pgvector.ps1')
  writeFileSync(scriptPath, scriptBody, 'utf8')
  const scriptEsc = scriptPath.replace(/'/g, "''")

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptEsc}'`,
      ],
      { windowsHide: false },
    )
    child.on('error', (err) => {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: err.message })
    })
    child.on('exit', (code) => {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, error: `Elevated copy exited with code ${code ?? 'unknown'}` })
    })
  })
}

function resolvePython(configured?: string): string {
  const t = configured?.trim()
  if (t) return t
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function fieldBrainScriptEnv(config: FieldBrainConfig): Record<string, string> {
  return {
    SYLO_FIELDBRAIN_DATABASE_URL: buildFieldBrainDatabaseUrl(config),
    SYLO_FIELDBRAIN_OLLAMA_URL: config.ollamaUrl,
  }
}

export async function runFieldBrainScript(
  repoRoot: string,
  scriptName: string,
  args: string[],
  config: FieldBrainConfig,
): Promise<Record<string, unknown>> {
  return runFieldBrainPackageScript(repoRoot, scriptName, args, fieldBrainScriptEnv(config))
}

export async function runFieldBrainBootstrapScript(
  repoRoot: string,
  scriptName: string,
  args: string[],
  adminPassword: string,
): Promise<Record<string, unknown>> {
  return runFieldBrainPackageScript(repoRoot, scriptName, args, {
    SYLO_FIELDBRAIN_BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
  })
}

async function runFieldBrainPackageScript(
  repoRoot: string,
  scriptName: string,
  args: string[],
  extraEnv: Record<string, string>,
): Promise<Record<string, unknown>> {
  const packageRoot = syloFieldBrainPackageRoot(repoRoot)
  const scriptPath = join(packageRoot, 'scripts', scriptName)
  if (!existsSync(scriptPath)) {
    throw new Error(`FieldBrain script missing: ${scriptPath}`)
  }

  const python = resolvePython(process.env.SYLO_PYTHON)
  try {
    const { stdout, stderr } = await execFileAsync(python, [scriptPath, ...args], {
      cwd: packageRoot,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      timeout: 180_000,
      env: { ...process.env, ...extraEnv },
    })

    const trimmed = stdout.trim()
    if (!trimmed) {
      throw new Error(stderr.trim() || `${scriptName} produced no output`)
    }

    try {
      return parsePythonScriptJsonStdout(trimmed)
    } catch (parseErr) {
      const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      const stderrNote = stderr.trim() ? `\n${stderr.trim()}` : ''
      throw new Error(`${parseMsg}${stderrNote}`)
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    const stdout = typeof err.stdout === 'string' ? err.stdout.trim() : ''
    if (stdout) {
      try {
        return parsePythonScriptJsonStdout(stdout)
      } catch {
        /* fall through */
      }
    }
    throw e
  }
}
