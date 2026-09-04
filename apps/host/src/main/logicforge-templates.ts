import { execFile } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve as pathResolve } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolveSyloUserDir } from './database.js'

const execFileAsync = promisify(execFile)

const hostMainDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(hostMainDir, '..', '..', '..', '..')
const packageRoot = join(repoRoot, 'packages', 'sylo-logicforge')
const scriptsDir = join(packageRoot, 'scripts')
const seedDir = join(packageRoot, 'assets', 'templates', 'Studio 5000 Templates')

/**
 * Resolve the sylo-user directory. Reads the primary workspace's `pi_cwd` from
 * the DB (respects operator edits in the Workspaces UI — rename/relocate). Falls
 * back to `SYLO_USER_DIR` env (set at startup by initOperatorEnv) and finally to
 * the canonical default path.
 */
function syloUserDir(): string {
  try {
    const dir = resolveSyloUserDir()
    if (dir) return dir
  } catch {
    /* DB not open — fall through */
  }
  const env = process.env.SYLO_USER_DIR?.trim()
  if (env) return env
  return join(homedir(), 'Documents', 'GitHub', 'sylo-user')
}

function operatorTemplatesDir(): string {
  return join(syloUserDir(), 'logicforge-templates', 'Studio 5000 Templates')
}

function operatorRevisionsDir(): string {
  return join(operatorTemplatesDir(), '_revisions')
}

/**
 * Per-operator coding standards & operations reference folder. Lives alongside
 * the templates under the LogicForge sylo-user root. Seeded as an empty folder
 * on install / "Restore default templates" — no fill-in-the-blank document is
 * seeded; the operator supplies their own standards here. The agent reads this
 * before programming and captures guidance here (see SKILL.md).
 */
function operatorCodingStandardsDir(): string {
  return join(syloUserDir(), 'logicforge-templates', 'Coding Standards and Operations')
}

// ---------- path safety ----------
function normalizeTemplateRel(name: string): string {
  let rel = (name || '').replace(/\\/g, '/').trim()
  while (rel.startsWith('./')) rel = rel.slice(2)
  rel = rel.replace(/^\/+/, '')
  const parts = rel.split('/').filter(Boolean)
  if (parts.some((p) => p === '.' || p === '..')) throw new Error('Invalid template path')
  rel = parts.join('/')
  if (!rel) throw new Error('Invalid template name')
  if (!rel.toLowerCase().endsWith('.l5x')) throw new Error('Not an L5X file')
  return rel
}

function normalizeFolderRel(p: string): string {
  let rel = (p || '').replace(/\\/g, '/').trim()
  while (rel.startsWith('./')) rel = rel.slice(2)
  rel = rel.replace(/^\/+|\/+$/g, '')
  const parts = rel.split('/').filter(Boolean)
  if (parts.some((p) => p === '.' || p === '..')) throw new Error('Invalid folder path')
  if (parts.length === 0) throw new Error('Invalid folder path')
  return parts.join('/')
}

function safeTemplatePath(name: string): string {
  const base = pathResolve(operatorTemplatesDir())
  const rel = normalizeTemplateRel(name)
  const p = pathResolve(base, rel)
  if (!p.startsWith(base + '\\') && !p.startsWith(base + '/')) throw new Error('Invalid template path')
  return p
}

function safeFolderPath(folder: string): string {
  const base = pathResolve(operatorTemplatesDir())
  const rel = normalizeFolderRel(folder)
  const p = pathResolve(base, rel)
  if (!p.startsWith(base + '\\') && !p.startsWith(base + '/')) throw new Error('Invalid folder path')
  return p
}

function relFromAbs(absPath: string): string {
  const base = pathResolve(operatorTemplatesDir())
  let rel = relative(base, absPath).replace(/\\/g, '/')
  return rel
}

// ---------- revisions (filesystem) ----------
function revisionDirFor(name: string): string {
  const safe = name.replace(/\//g, '_').replace(/\./g, '_')
  return join(operatorRevisionsDir(), safe)
}

function revisionFilePath(name: string, rev: number): string {
  return join(revisionDirFor(name), `rev_${rev}.l5x`)
}

function listRevisions(name: string): { revision: number; created_at: string }[] {
  const dir = revisionDirFor(name)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^rev_\d+\.l5x$/i.test(f))
    .map((f) => {
      const m = f.match(/rev_(\d+)\.l5x/i)
      const rev = m ? parseInt(m[1], 10) : 0
      const created = statSync(join(dir, f)).mtime
      return { revision: rev, created_at: created.toISOString() }
    })
    .sort((a, b) => a.revision - b.revision)
}

function nextRevision(name: string): number {
  const revs = listRevisions(name)
  return revs.length === 0 ? 1 : Math.max(...revs.map((r) => r.revision)) + 1
}

// ---------- seeding ----------
function seedCodingStandardsFolder(): void {
  // Create the per-operator coding standards folder if missing. Idempotent —
  // never touches existing contents (operator-owned). No document is seeded;
  // the operator drops their own standards doc in here.
  const dir = operatorCodingStandardsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function seedIfMissing(): void {
  if (!existsSync(seedDir)) return
  const opDir = operatorTemplatesDir()
  if (!existsSync(opDir)) {
    // First run: copy default templates from the package seed into the
    // operator folder so Templates isn't empty on first open. Subsequent opens
    // respect operator state (even after deleting everything). "Restore default
    // templates" re-seeds on demand.
    seedDefaults(true)
  }
  // Always ensure the coding standards folder exists (created on install, even
  // for operators who already have templates).
  seedCodingStandardsFolder()
}

function seedDefaults(merge = true): { copied: number; skipped: number } {
  // The package no longer ships default templates (operator-supplied data lives
  // in the universal workspace — see AGENTS.md tool-data invariant). Seeding is
  // a no-op when no seed folder exists; the operator provides their own templates.
  if (!existsSync(seedDir)) return { copied: 0, skipped: 0 }
  const opDir = operatorTemplatesDir()
  mkdirSync(opDir, { recursive: true })
  let copied = 0
  let skipped = 0
  const walk = (src: string, dst: string) => {
    mkdirSync(dst, { recursive: true })
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (entry.name === '_revisions') continue
      const s = join(src, entry.name)
      const d = join(dst, entry.name)
      if (entry.isDirectory()) {
        walk(s, d)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.l5x')) {
        if (merge && existsSync(d)) {
          skipped++
        } else {
          mkdirSync(dirname(d), { recursive: true })
          copyFileSync(s, d)
          copied++
        }
      }
    }
  }
  walk(seedDir, opDir)
  return { copied, skipped }
}

// ---------- tree scan ----------
type TreeNode =
  | { kind: 'dir'; name: string; path: string; children: TreeNode[] }
  | { kind: 'file'; name: string; path: string; revisions: { revision: number; created_at: string }[] }

function scanTree(): { tree: TreeNode; files: string[] } {
  const base = operatorTemplatesDir()
  const root: { kind: 'dir'; name: string; path: string; children: TreeNode[] } = {
    kind: 'dir',
    name: 'Studio 5000 Templates',
    path: '',
    children: [],
  }
  const files: string[] = []
  if (!existsSync(base)) return { tree: root, files }

  const scan = (parent: { children: TreeNode[] }, current: string, currentRel: string) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1
      const bd = b.isDirectory() ? 0 : 1
      return ad - bd || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
    for (const entry of entries) {
      if (entry.name === '_revisions') continue
      const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        const node: { kind: 'dir'; name: string; path: string; children: TreeNode[] } = {
          kind: 'dir',
          name: entry.name,
          path: rel,
          children: [],
        }
        parent.children.push(node)
        scan(node, join(current, entry.name), rel)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.l5x')) {
        files.push(rel)
        parent.children.push({
          kind: 'file',
          name: entry.name,
          path: rel,
          revisions: listRevisions(rel),
        })
      }
    }
  }
  scan(root, base, '')
  files.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  return { tree: root, files }
}

// ---------- build (Python) ----------
function resolvePythonInvocation(sdk = false): { command: string; prefixArgs: string[] } {
  if (sdk) {
    const sdkPython = process.env.SYLO_SDK_PYTHON?.trim()
    if (sdkPython) return { command: sdkPython, prefixArgs: [] }
    if (process.platform === 'win32') return { command: 'py', prefixArgs: ['-3.12'] }
  }
  const envPython = process.env.SYLO_PYTHON?.trim()
  if (envPython) return { command: envPython, prefixArgs: [] }
  return { command: process.platform === 'win32' ? 'python' : 'python3', prefixArgs: [] }
}

async function runBuildScript(runDir: string, templatePath: string): Promise<unknown> {
  const scriptPath = join(scriptsDir, 'build_l5x.py')
  if (!existsSync(scriptPath)) throw new Error(`missing script: ${scriptPath}`)
  const { command, prefixArgs } = resolvePythonInvocation(false)
  const { stdout } = await execFileAsync(command, [...prefixArgs, scriptPath, '--run-dir', runDir, '--template', templatePath], {
    cwd: packageRoot,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    timeout: 300_000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('build_l5x.py produced no output')
  const parsed = JSON.parse(trimmed) as { ok?: boolean; error?: string }
  if (parsed.ok === false) throw new Error(parsed.error ?? 'build_l5x.py failed')
  return parsed
}

// ---------- public dispatch ----------
export async function logicforgeTemplates(
  op: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; [key: string]: unknown }> {
  seedIfMissing()

  switch (op) {
    case 'list': {
      const { tree, files } = scanTree()
      return { ok: true, tree, files, dir: operatorTemplatesDir() }
    }

    case 'upload': {
      const path = String(payload.path ?? '')
      const content = String(payload.content ?? '')
      if (!content) throw new Error('content is required')
      const dest = safeTemplatePath(path)
      const rel = relFromAbs(dest)
      const rev = nextRevision(rel)
      // bootstrap rev 1 from existing file on first overwrite
      if (rev === 1 && existsSync(dest)) {
        mkdirSync(revisionDirFor(rel), { recursive: true })
        copyFileSync(dest, revisionFilePath(rel, 1))
        const rev2 = 2
        mkdirSync(revisionDirFor(rel), { recursive: true })
        writeFileSync(revisionFilePath(rel, rev2), content, 'utf8')
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, content, 'utf8')
        return { ok: true, path: rel, revision: rev2 }
      }
      mkdirSync(revisionDirFor(rel), { recursive: true })
      writeFileSync(revisionFilePath(rel, rev), content, 'utf8')
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, content, 'utf8')
      return { ok: true, path: rel, revision: rev }
    }

    case 'delete': {
      const p = safeTemplatePath(String(payload.path ?? ''))
      if (!existsSync(p)) throw new Error('Template not found')
      const rel = relFromAbs(p)
      rmSync(p)
      const revDir = revisionDirFor(rel)
      if (existsSync(revDir)) rmSync(revDir, { recursive: true, force: true })
      return { ok: true }
    }

    case 'renameFile': {
      const src = safeTemplatePath(String(payload.old_path ?? ''))
      if (!existsSync(src)) throw new Error('Template not found')
      const dst = safeTemplatePath(String(payload.new_path ?? ''))
      if (existsSync(dst)) throw new Error('Destination already exists')
      mkdirSync(dirname(dst), { recursive: true })
      renameSync(src, dst)
      const oldRel = relFromAbs(src)
      const newRel = relFromAbs(dst)
      const oldRevDir = revisionDirFor(oldRel)
      const newRevDir = revisionDirFor(newRel)
      if (existsSync(oldRevDir) && oldRevDir !== newRevDir) {
        mkdirSync(dirname(newRevDir), { recursive: true })
        renameSync(oldRevDir, newRevDir)
      }
      return { ok: true, path: newRel }
    }

    case 'renameFolder': {
      const src = safeFolderPath(String(payload.old_path ?? ''))
      if (!existsSync(src)) throw new Error('Folder not found')
      const dst = safeFolderPath(String(payload.new_path ?? ''))
      if (existsSync(dst)) throw new Error('Destination already exists')
      mkdirSync(dirname(dst), { recursive: true })
      renameSync(src, dst)
      return { ok: true }
    }

    case 'createFolder': {
      const p = safeFolderPath(String(payload.path ?? ''))
      mkdirSync(p, { recursive: true })
      return { ok: true }
    }

    case 'deleteFolder': {
      const p = safeFolderPath(String(payload.path ?? ''))
      if (!existsSync(p)) throw new Error('Folder not found')
      // also remove revisions for contained templates
      const walk = (dir: string, rel: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === '_revisions') continue
          const childRel = rel ? `${rel}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            walk(join(dir, entry.name), childRel)
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.l5x')) {
            const rd = revisionDirFor(childRel)
            if (existsSync(rd)) rmSync(rd, { recursive: true, force: true })
          }
        }
      }
      walk(p, normalizeFolderRel(String(payload.path ?? '')))
      rmSync(p, { recursive: true, force: true })
      return { ok: true }
    }

    case 'rollback': {
      const rel = normalizeTemplateRel(String(payload.path ?? ''))
      const rev = Number(payload.revision)
      if (!Number.isFinite(rev)) throw new Error('revision is required')
      const revPath = revisionFilePath(rel, rev)
      if (!existsSync(revPath)) throw new Error(`Revision ${rev} not found`)
      const dest = safeTemplatePath(rel)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, readFileSync(revPath, 'utf8'), 'utf8')
      return { ok: true, path: rel, restored_to_revision: rev }
    }

    case 'download': {
      const p = safeTemplatePath(String(payload.path ?? ''))
      if (!existsSync(p)) throw new Error('Template not found')
      return { ok: true, path: relFromAbs(p), content: readFileSync(p, 'utf8') }
    }

    case 'seed': {
      const res = seedDefaults(true)
      seedCodingStandardsFolder()
      return { ok: true, ...res, dir: operatorTemplatesDir() }
    }

    case 'build': {
      const runDir = String(payload.run_dir ?? '')
      const template = String(payload.template ?? '')
      if (!runDir || !template) throw new Error('run_dir and template are required')
      const tp = safeTemplatePath(template)
      if (!existsSync(tp)) throw new Error(`Template not found: ${template}`)
      const result = await runBuildScript(runDir, tp)
      return { ok: true, build: result }
    }

    default:
      throw new Error(`unknown templates op: ${op}`)
  }
}