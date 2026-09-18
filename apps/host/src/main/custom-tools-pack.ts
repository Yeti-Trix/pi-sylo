// Local share pack for operator custom tools (Custom/ / custom/).
// Exports functionality only: skills, extensions, dashboards. Skips node_modules,
// .sylo, git, credentials, and database files so saved data does not travel.
import { execFile } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { migrateMonorepoPackageSpecs } from './package-spec-migration.js'
import { readZipBuffer, writeZipBuffer } from './custom-tools-zip.js'
import {
  listLocalPackageSkillDirs,
  listSettingsLocalPackageDirs,
  skillDirsInPackageTree,
} from './local-package-skills.js'

const execFileAsync = promisify(execFile)

export const CUSTOM_TOOLS_KIND = 'sylo-custom-tools'
export const CUSTOM_TOOLS_MANIFEST = 'sylo-custom-tools.json'
export const CUSTOM_TOOLS_VERSION = 1

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.sylo',
  '.npm',
  'out',
  '__pycache__',
  '.turbo',
  '.cache',
])
const SKIP_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', '.env', '.env.local'])
const SKIP_EXTS = new Set([
  '.pyc',
  '.tsbuildinfo',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.wal',
  '.shm',
  '.log',
  '.pem',
  '.key',
])

export type CustomToolPackageInfo = {
  id: string
  name: string
  version: string | null
  description: string | null
  dir: string
}

export type CustomToolsManifest = {
  kind: typeof CUSTOM_TOOLS_KIND
  v: number
  exportedAt: string
  packages: Array<{ id: string; name: string; version: string | null; description: string | null }>
}

export type ImportCustomToolsResult = {
  imported: CustomToolPackageInfo[]
  registered: string[]
  npm: Array<{ id: string; ok: boolean; detail: string }>
  skillsCopied: string[]
}

const PACKAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function formatExportDate(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return `${mm}-${dd}-${yyyy}`
}

export function safePackageId(raw: string): string | null {
  const id = basename(raw.replace(/\\/g, '/')).trim()
  if (id === '.' || id === '..') return null
  return PACKAGE_ID_RE.test(id) ? id : null
}

export function resolveCustomToolsRoot(repoRoot: string): string {
  const titled = join(repoRoot, 'Custom')
  const lower = join(repoRoot, 'custom')
  if (existsSync(titled) && statSync(titled).isDirectory()) return titled
  if (existsSync(lower) && statSync(lower).isDirectory()) return lower
  return titled
}

function readPackageMeta(dir: string): {
  name: string | null
  version: string | null
  description: string | null
} {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
      description?: unknown
    }
    return {
      name: typeof raw.name === 'string' ? raw.name : null,
      version: typeof raw.version === 'string' ? raw.version : null,
      description: typeof raw.description === 'string' ? raw.description : null,
    }
  } catch {
    return { name: null, version: null, description: null }
  }
}

export function listCustomToolPackages(repoRoot: string): CustomToolPackageInfo[] {
  const root = resolveCustomToolsRoot(repoRoot)
  if (!existsSync(root) || !statSync(root).isDirectory()) return []
  const out: CustomToolPackageInfo[] = []
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const id = safePackageId(ent.name)
    if (!id) continue
    const dir = join(root, ent.name)
    if (!existsSync(join(dir, 'package.json'))) continue
    const meta = readPackageMeta(dir)
    out.push({
      id,
      name: meta.name ?? id,
      version: meta.version,
      description: meta.description,
      dir,
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function shouldSkipRel(rel: string): boolean {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.some((p) => p === '..')) return true
  for (const part of parts) {
    if (SKIP_DIR_NAMES.has(part)) return true
    if (part.startsWith('.env')) return true
  }
  const base = (parts[parts.length - 1] ?? '').toLowerCase()
  if (SKIP_FILE_NAMES.has(base)) return true
  if (base.endsWith('.private.json')) return true
  const dot = base.lastIndexOf('.')
  if (dot >= 0 && SKIP_EXTS.has(base.slice(dot))) return true
  return false
}

export function collectExportFiles(root: string): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = []
  const walk = (absDir: string, relDir: string): void => {
    let ents
    try {
      ents = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name
      if (shouldSkipRel(rel)) continue
      const abs = join(absDir, ent.name)
      if (ent.isDirectory()) walk(abs, rel)
      else if (ent.isFile()) out.push({ rel, abs })
    }
  }
  walk(root, '')
  return out
}

export function suggestedExportFileName(ids: string[], now = new Date()): string {
  const stamp = formatExportDate(now)
  if (ids.length === 1 && ids[0]) return `${ids[0]}-${stamp}.zip`
  return `sylo-custom-tools-${stamp}.zip`
}

export function writeCustomToolsZip(opts: {
  repoRoot: string
  destZip: string
  ids?: string[]
  now?: Date
}): { ok: true; path: string; packages: CustomToolPackageInfo[] } | { ok: false; error: string } {
  const all = listCustomToolPackages(opts.repoRoot)
  const want = opts.ids?.length ? new Set(opts.ids) : null
  const selected = want ? all.filter((p) => want.has(p.id)) : all
  if (selected.length === 0) return { ok: false, error: 'No custom tools to export' }
  if (want) {
    const missing = [...want].filter((id) => !selected.some((p) => p.id === id))
    if (missing.length) return { ok: false, error: `Unknown custom tool: ${missing.join(', ')}` }
  }
  const now = opts.now ?? new Date()
  const manifest: CustomToolsManifest = {
    kind: CUSTOM_TOOLS_KIND,
    v: CUSTOM_TOOLS_VERSION,
    exportedAt: formatExportDate(now),
    packages: selected.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
    })),
  }
  const entries = [
    {
      name: CUSTOM_TOOLS_MANIFEST,
      data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    },
  ]
  for (const pkg of selected) {
    for (const file of collectExportFiles(pkg.dir)) {
      entries.push({
        name: `packages/${pkg.id}/${file.rel}`,
        data: readFileSync(file.abs),
      })
    }
  }
  mkdirSync(dirname(opts.destZip), { recursive: true })
  writeFileSync(opts.destZip, writeZipBuffer(entries))
  return { ok: true, path: opts.destZip, packages: selected }
}

function parseManifest(raw: unknown): CustomToolsManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.kind !== CUSTOM_TOOLS_KIND) return null
  if (m.v !== CUSTOM_TOOLS_VERSION) return null
  if (!Array.isArray(m.packages)) return null
  const packages: CustomToolsManifest['packages'] = []
  for (const row of m.packages) {
    if (!row || typeof row !== 'object') return null
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? safePackageId(r.id) : null
    if (!id) return null
    packages.push({
      id,
      name: typeof r.name === 'string' ? r.name : id,
      version: typeof r.version === 'string' ? r.version : null,
      description: typeof r.description === 'string' ? r.description : null,
    })
  }
  if (packages.length === 0) return null
  return {
    kind: CUSTOM_TOOLS_KIND,
    v: CUSTOM_TOOLS_VERSION,
    exportedAt: typeof m.exportedAt === 'string' ? m.exportedAt : '',
    packages,
  }
}

export function readCustomToolsManifest(
  zipPath: string,
): { ok: true; manifest: CustomToolsManifest } | { ok: false; error: string } {
  try {
    const entries = readZipBuffer(readFileSync(zipPath))
    const row = entries.find((e) => e.name === CUSTOM_TOOLS_MANIFEST)
    if (!row) return { ok: false, error: 'Not a Sylo custom-tools pack (missing manifest)' }
    const manifest = parseManifest(JSON.parse(row.data.toString('utf8')))
    if (!manifest) return { ok: false, error: 'Custom-tools pack manifest is invalid' }
    return { ok: true, manifest }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function assertSafeZipName(name: string): string {
  const norm = name.replace(/\\/g, '/')
  if (!norm || norm.startsWith('/') || norm.includes('..')) {
    throw new Error(`unsafe zip path: ${name}`)
  }
  return norm
}

export function extractCustomToolsZip(
  zipPath: string,
  destDir: string,
): { ok: true; manifest: CustomToolsManifest } | { ok: false; error: string } {
  try {
    const entries = readZipBuffer(readFileSync(zipPath))
    const manRow = entries.find((e) => e.name === CUSTOM_TOOLS_MANIFEST)
    if (!manRow) return { ok: false, error: 'Not a Sylo custom-tools pack (missing manifest)' }
    const manifest = parseManifest(JSON.parse(manRow.data.toString('utf8')))
    if (!manifest) return { ok: false, error: 'Custom-tools pack manifest is invalid' }
    const allowed = new Set(manifest.packages.map((p) => p.id))
    mkdirSync(destDir, { recursive: true })
    writeFileSync(join(destDir, CUSTOM_TOOLS_MANIFEST), manRow.data)
    for (const e of entries) {
      const name = assertSafeZipName(e.name)
      if (name === CUSTOM_TOOLS_MANIFEST) continue
      const m = /^packages\/([^/]+)\/(.+)$/.exec(name)
      if (!m) continue
      const id = safePackageId(m[1] ?? '')
      const rel = m[2] ?? ''
      if (!id || !allowed.has(id) || shouldSkipRel(rel)) continue
      const dest = join(destDir, 'packages', id, ...rel.split('/'))
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, e.data)
    }
    return { ok: true, manifest }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function readSettingsPackages(agentDir: string): { settings: Record<string, unknown>; packages: string[] } {
  const settingsPath = join(agentDir, 'settings.json')
  let settings: Record<string, unknown> = { packages: [] }
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    } catch {
      settings = { packages: [] }
    }
  }
  const packages = Array.isArray(settings.packages)
    ? settings.packages.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    : []
  return { settings, packages }
}

function settingsCoversDir(agentDir: string, packages: string[], destDir: string): boolean {
  const dest = resolve(destDir)
  const destKey = dest.replace(/\\/g, '/').toLowerCase()
  for (const spec of packages) {
    if (/^(npm:|git:|https?:|ssh:|file:)/i.test(spec.trim())) continue
    const abs = resolve(agentDir, spec).replace(/\\/g, '/').toLowerCase()
    if (abs === destKey || abs.startsWith(`${destKey}/`) || destKey.startsWith(`${abs}/`)) {
      return true
    }
  }
  return false
}

export function registerCustomToolPackage(agentDir: string, destDir: string): string[] {
  const dest = resolve(destDir)
  const { settings, packages } = readSettingsPackages(agentDir)
  if (settingsCoversDir(agentDir, packages, dest)) {
    migrateMonorepoPackageSpecs(agentDir)
    return []
  }
  const next = [...packages, dest]
  settings.packages = next
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  migrateMonorepoPackageSpecs(agentDir)
  return [dest]
}

function needsNpmInstall(dir: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dependencies?: unknown
      workspaces?: unknown
    }
    if (raw.workspaces) return true
    if (raw.dependencies && typeof raw.dependencies === 'object' && Object.keys(raw.dependencies).length > 0) {
      return true
    }
  } catch {
    return false
  }
  return existsSync(join(dir, 'package-lock.json'))
}

export function copyPackageSkillsToAgent(packageDir: string, agentDir: string): string[] {
  const copied: string[] = []
  const destRoot = join(agentDir, 'skills')
  mkdirSync(destRoot, { recursive: true })
  for (const src of skillDirsInPackageTree(packageDir)) {
    const name = basename(src)
    const dest = join(destRoot, name)
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    cpSync(src, dest, { recursive: true })
    copied.push(name)
  }
  return copied
}

export function syncSkillSurfaceAssets(skillDir: string, destRoot: string): boolean {
  if (!existsSync(join(skillDir, 'SKILL.md'))) return false
  const skillFolderName = basename(skillDir)
  let wrote = false
  const routesSrc = join(skillDir, 'routes')
  if (existsSync(routesSrc) && statSync(routesSrc).isDirectory()) {
    const routesDest = join(destRoot, 'routes', skillFolderName)
    mkdirSync(join(destRoot, 'routes'), { recursive: true })
    if (existsSync(routesDest)) rmSync(routesDest, { recursive: true, force: true })
    cpSync(routesSrc, routesDest, { recursive: true })
    wrote = true
  }
  const widgetsRoot = join(skillDir, 'assets', 'widgets')
  if (existsSync(widgetsRoot) && statSync(widgetsRoot).isDirectory()) {
    for (const ent of readdirSync(widgetsRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const widgetDest = join(destRoot, 'widgets', skillFolderName)
      mkdirSync(join(destRoot, 'widgets'), { recursive: true })
      if (existsSync(widgetDest)) rmSync(widgetDest, { recursive: true, force: true })
      cpSync(join(widgetsRoot, ent.name), widgetDest, { recursive: true })
      wrote = true
    }
  }
  return wrote
}

/** Fill in agent/skills + surface fixtures for local-path packages that were
 *  imported (or `pi install`'d) but never copied. Skips names that already exist. */
export function ensureLocalPackageSkillsInstalled(agentDir: string): string[] {
  const copied: string[] = []
  mkdirSync(join(agentDir, 'skills'), { recursive: true })
  for (const pkgDir of listSettingsLocalPackageDirs(agentDir)) {
    for (const src of skillDirsInPackageTree(pkgDir)) {
      const dest = join(agentDir, 'skills', basename(src))
      if (existsSync(join(dest, 'SKILL.md'))) continue
      cpSync(src, dest, { recursive: true })
      copied.push(basename(src))
    }
  }
  return copied
}

export function ensureLocalPackageSkillSurfaces(agentDir: string, surfaceDests: string[]): number {
  let n = 0
  for (const destRoot of surfaceDests) {
    if (!destRoot.trim()) continue
    mkdirSync(destRoot, { recursive: true })
    for (const skillDir of listLocalPackageSkillDirs(agentDir)) {
      const routesDest = join(destRoot, 'routes', basename(skillDir))
      if (existsSync(routesDest)) continue
      if (syncSkillSurfaceAssets(skillDir, destRoot)) n++
    }
  }
  return n
}

export function activateImportedCustomTools(opts: {
  packageDir: string
  agentDir: string
  surfaceDests: string[]
}): { skills: string[]; surfaces: number } {
  const skills = copyPackageSkillsToAgent(opts.packageDir, opts.agentDir)
  let surfaces = 0
  for (const destRoot of opts.surfaceDests) {
    if (!destRoot.trim()) continue
    mkdirSync(destRoot, { recursive: true })
    for (const skillDir of skillDirsInPackageTree(opts.packageDir)) {
      if (syncSkillSurfaceAssets(skillDir, destRoot)) surfaces++
    }
  }
  return { skills, surfaces }
}

export async function runNpmInstall(
  dir: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!needsNpmInstall(dir)) return { ok: true, detail: 'skipped (no installable deps)' }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  try {
    const { stdout, stderr } = await execFileAsync(npm, ['install'], {
      cwd: dir,
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      shell: process.platform === 'win32',
      maxBuffer: 8 * 1024 * 1024,
    })
    const detail = `${stdout}\n${stderr}`.trim()
    return { ok: true, detail: detail || 'npm install finished' }
  } catch (e) {
    const err = e as { message?: string; stdout?: string; stderr?: string }
    return {
      ok: false,
      detail: [err.stderr, err.stdout, err.message].filter(Boolean).join('\n').trim() || 'npm install failed',
    }
  }
}

export async function importCustomToolsFromZip(opts: {
  repoRoot: string
  agentDir: string
  zipPath: string
  stagingDir: string
  installDeps?: boolean
  surfaceDests?: string[]
}): Promise<{ ok: true } & ImportCustomToolsResult | { ok: false; error: string }> {
  const extracted = join(opts.stagingDir, 'extracted')
  if (existsSync(opts.stagingDir)) rmSync(opts.stagingDir, { recursive: true, force: true })
  const extractedOk = extractCustomToolsZip(opts.zipPath, extracted)
  if (!extractedOk.ok) return extractedOk
  const customRoot = resolveCustomToolsRoot(opts.repoRoot)
  mkdirSync(customRoot, { recursive: true })
  const imported: CustomToolPackageInfo[] = []
  const registered: string[] = []
  const npm: ImportCustomToolsResult['npm'] = []
  const skillsCopied: string[] = []
  try {
    for (const row of extractedOk.manifest.packages) {
      const src = join(extracted, 'packages', row.id)
      if (!existsSync(src) || !existsSync(join(src, 'package.json'))) {
        return { ok: false, error: `Pack is missing package files for ${row.id}` }
      }
      const dest = join(customRoot, row.id)
      mkdirSync(dest, { recursive: true })
      for (const file of collectExportFiles(src)) {
        const out = join(dest, file.rel.split('/').join(sep))
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, readFileSync(file.abs))
      }
      registered.push(...registerCustomToolPackage(opts.agentDir, dest))
      const activated = activateImportedCustomTools({
        packageDir: dest,
        agentDir: opts.agentDir,
        surfaceDests: opts.surfaceDests ?? [],
      })
      skillsCopied.push(...activated.skills)
      const meta = readPackageMeta(dest)
      imported.push({
        id: row.id,
        name: meta.name ?? row.name,
        version: meta.version,
        description: meta.description,
        dir: dest,
      })
      if (opts.installDeps !== false) {
        npm.push({ id: row.id, ...(await runNpmInstall(dest)) })
      }
    }
  } finally {
    rmSync(opts.stagingDir, { recursive: true, force: true })
  }
  return { ok: true, imported, registered, npm, skillsCopied: [...new Set(skillsCopied)] }
}
