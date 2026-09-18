/**
 * Stage the installer payload.
 *
 * Sylo's main process resolves its runtime resources relative to the compiled
 * entry: `out/main/index.js` walks four levels up to find SYLO_REPO_ROOT, then
 * loads Pi extensions as live TypeScript (`packages/*\/extensions/index.ts`,
 * `apps/host/src/broker/*.ts`) and points the broker child's NODE_PATH at the
 * root `node_modules`. Rather than rewrite that resolution for a packaged
 * layout, this script reproduces the repo layout inside the payload:
 *
 *   dist/stage/
 *     package.json          <- Electron app manifest (main: apps/host/out/...)
 *     apps/host/{out,src,resources,package.json}
 *     packages/**            (minus node_modules)
 *     scripts/bootstrap-pi.mjs
 *     node_modules/**        (production dependency closure only)
 *
 * electron-builder copies this to `resources/app` with asar disabled, so
 * `__dirname/../../../..` lands on the staged root and every existing path
 * constant keeps working unchanged.
 *
 * asar stays off on purpose: the broker child runs under ELECTRON_RUN_AS_NODE,
 * which is plain Node without Electron's asar filesystem shim, and it is the
 * process that loads all of the .ts extensions.
 *
 * Files are hard-linked from the repo when the filesystem allows it, so a
 * ~500 MB payload does not rewrite ~500 MB to the disk on every build.
 * Nothing in the pipeline mutates staged files, so the links are safe.
 *
 * Usage:
 *   node scripts/stage-package.mjs              full stage
 *   node scripts/stage-package.mjs --keep-deps  reuse an already staged node_modules
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const stage = path.join(root, 'dist', 'stage')
const buildResources = path.join(root, 'build')

const keepDeps = process.argv.includes('--keep-deps')

/** Never ship the Electron runtime: electron-builder supplies its own, and a
 *  350 MB duplicate would also confuse its dependency walker. */
const NODE_MODULES_DENYLIST = new Set(['electron', '@electron', '@electron-internal'])

/** Build-time only, or regenerated on the target machine. */
const PRUNE_DIR_NAMES = new Set([
  'node_modules',
  '.vite',
  '.cache',
  '.turbo',
  '.git',
  '__pycache__', // stale bytecode from running the packages' Python tools locally
])

let linked = 0
let copied = 0
let bytes = 0

function linkOrCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  try {
    fs.linkSync(src, dest)
    linked++
  } catch {
    fs.copyFileSync(src, dest)
    copied++
  }
  try {
    bytes += fs.statSync(dest).size
  } catch {
    /* size accounting only */
  }
}

/**
 * Recursive copy that dereferences symlinks/junctions (npm workspace links in
 * node_modules are junctions, and NSIS cannot recreate them on the target).
 */
function copyTree(src, dest, { prune = PRUNE_DIR_NAMES, skip } = {}) {
  const st = fs.statSync(src) // statSync follows links, so junctions copy as dirs
  if (st.isDirectory()) {
    let entries
    try {
      entries = fs.readdirSync(src, { withFileTypes: true })
    } catch {
      return
    }
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of entries) {
      const from = path.join(src, entry.name)
      const to = path.join(dest, entry.name)
      let isDir = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(from).isDirectory()
        } catch {
          continue // dangling link
        }
      }
      if (isDir && prune.has(entry.name)) continue
      if (skip?.(path.relative(root, from).replace(/\\/g, '/'), isDir)) continue
      copyTree(from, to, { prune, skip })
    }
    return
  }
  if (st.isFile()) linkOrCopy(src, dest)
}

/**
 * Top-level package names in the production dependency closure, per npm.
 *
 * Using npm's own resolution instead of a hand-maintained allowlist is what
 * makes the payload trustworthy: anything the app can `require` at runtime is
 * a production dependency of some workspace, and anything build-only (vite,
 * typescript, esbuild, @vitejs, patch-package, electron) drops out by itself.
 */
function productionDependencyNames() {
  const isWin = process.platform === 'win32'
  let out = ''
  try {
    out = execFileSync(
      isWin ? 'npm.cmd' : 'npm',
      ['ls', '--omit=dev', '--all', '--parseable'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        // Node refuses to spawn .cmd without a shell (CVE-2024-27980).
        shell: isWin,
      },
    )
  } catch (err) {
    // `npm ls` exits non-zero for benign tree complaints (unmet peers, extraneous
    // packages) but still prints the full tree, which is all we need.
    out = typeof err?.stdout === 'string' ? err.stdout : ''
    if (!out) throw err
  }
  const names = new Set()
  for (const line of out.split(/\r?\n/)) {
    const norm = line.trim().replace(/\\/g, '/')
    if (!norm) continue
    // Take the innermost node_modules segment so nested deps register too.
    const idx = norm.toLowerCase().lastIndexOf('node_modules/')
    if (idx < 0) continue
    const rel = norm.slice(idx + 'node_modules/'.length)
    if (!rel) continue
    const parts = rel.split('/')
    const top = parts[0].startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : parts[0]
    if (top && !top.endsWith('/')) names.add(top)
  }
  return names
}

function stageNodeModules(srcRoot, destRoot, keep) {
  const src = path.join(srcRoot, 'node_modules')
  if (!fs.existsSync(src)) return
  const dest = path.join(destRoot, 'node_modules')
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const name = entry.name
    if (name.startsWith('.')) continue // .bin shims, .package-lock.json
    if (NODE_MODULES_DENYLIST.has(name)) continue
    if (name.startsWith('@')) {
      const scopeDir = path.join(src, name)
      let scoped
      try {
        scoped = fs.readdirSync(scopeDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of scoped) {
        const full = `${name}/${child.name}`
        if (NODE_MODULES_DENYLIST.has(full)) continue
        if (keep && !keep.has(full)) continue
        // Nested node_modules inside a kept package are part of its own
        // resolution chain and must survive.
        copyTree(path.join(scopeDir, child.name), path.join(dest, name, child.name), { prune: new Set() })
      }
      continue
    }
    if (keep && !keep.has(name)) continue
    copyTree(path.join(src, name), path.join(dest, name), { prune: new Set() })
  }
}

function requireBuilt(rel, hint) {
  if (fs.existsSync(path.join(root, rel))) return
  console.error(`\nstage-package: missing ${rel}\n  ${hint}\n`)
  process.exit(1)
}

// --- preflight ---------------------------------------------------------------
requireBuilt('apps/host/out/main/index.js', 'Run: npm run build -w apps/host')
requireBuilt('apps/host/out/renderer/index.html', 'Run: npm run build -w apps/host')
requireBuilt('apps/host/out/broker/broker.mjs', 'Run: npm run build:broker -w apps/host')
requireBuilt('apps/host/out/companion', 'Run: npm run build:companion -w apps/host')
requireBuilt(
  'node_modules/@earendil-works/pi-coding-agent',
  'Run: npm install (the Pi runtime is required at runtime, not just to build)',
)

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

// --- clean -------------------------------------------------------------------
if (fs.existsSync(stage)) {
  if (keepDeps) {
    for (const entry of fs.readdirSync(stage)) {
      if (entry === 'node_modules') continue
      fs.rmSync(path.join(stage, entry), { recursive: true, force: true })
    }
  } else {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}
fs.mkdirSync(stage, { recursive: true })

// --- app manifest ------------------------------------------------------------
// `name` is deliberately NOT "@sylo/host": Electron derives userData from the
// app name, and main pins userData explicitly (see packaged-runtime.ts) so the
// directory stays %APPDATA%\@sylo\host for existing installs regardless of what
// goes here. `type: module` is required because out/main/index.js is ESM.
// No `productName` here either — that lives in electron-builder.yml, so it
// cannot leak into app.getName() and move the userData directory.
fs.writeFileSync(
  path.join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'sylo',
      version: rootPkg.version,
      description: rootPkg.description,
      license: rootPkg.license,
      // Becomes the installer's "Publisher" and the exe's company name.
      author: rootPkg.author ?? 'Yeti-Trix',
      type: 'module',
      main: 'apps/host/out/main/index.js',
      // electron-builder resolves which node_modules to ship from the app
      // manifest's dependency tree; an empty list would ship none of them.
      dependencies: {},
    },
    null,
    2,
  )}\n`,
  'utf8',
)

// --- host app ----------------------------------------------------------------
// out/: everything except the test bundles.
copyTree(path.join(root, 'apps/host/out'), path.join(stage, 'apps/host/out'), {
  skip: (rel, isDir) => isDir && rel === 'apps/host/out/test',
})
// src/: not dead weight — Pi loads apps/host/src/broker/*.ts as live extensions
// at runtime (builtin-tools guard, image fallback, canvas sketch, compaction
// anchor), and those import from apps/host/src/shared.
copyTree(path.join(root, 'apps/host/src'), path.join(stage, 'apps/host/src'))
copyTree(path.join(root, 'apps/host/resources'), path.join(stage, 'apps/host/resources'))
for (const f of ['apps/host/package.json', 'apps/host/tsconfig.json', 'apps/host/tsconfig.node.json']) {
  if (fs.existsSync(path.join(root, f))) linkOrCopy(path.join(root, f), path.join(stage, f))
}

// --- capability packages -----------------------------------------------------
copyTree(path.join(root, 'packages'), path.join(stage, 'packages'), {
  skip: (rel, isDir) => isDir && /\/(ui\/dist|coverage)$/.test(rel),
})

// --- runtime scripts ---------------------------------------------------------
// bootstrap-pi runs on first launch / after an upgrade to refresh the bundled
// skills in ~/.pi/agent.
linkOrCopy(path.join(root, 'scripts/bootstrap-pi.mjs'), path.join(stage, 'scripts/bootstrap-pi.mjs'))
for (const f of ['tsconfig.base.json', 'LICENSE', 'README.md']) {
  if (fs.existsSync(path.join(root, f))) linkOrCopy(path.join(root, f), path.join(stage, f))
}

// --- dependencies ------------------------------------------------------------
if (keepDeps && fs.existsSync(path.join(stage, 'node_modules'))) {
  console.log('stage-package: reusing existing dist/stage/node_modules (--keep-deps)')
} else {
  const keep = productionDependencyNames()
  console.log(`stage-package: ${keep.size} production packages in the dependency closure`)
  stageNodeModules(root, stage, keep)
  // apps/host keeps a few non-hoisted installs of its own.
  stageNodeModules(path.join(root, 'apps/host'), path.join(stage, 'apps/host'), null)
}

// Record the top-level dependencies actually staged, so electron-builder's
// dependency walker keeps them instead of filtering node_modules down to
// nothing.
const stagedModules = path.join(stage, 'node_modules')
if (fs.existsSync(stagedModules)) {
  const deps = {}
  for (const entry of fs.readdirSync(stagedModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      for (const child of fs.readdirSync(path.join(stagedModules, entry.name))) {
        deps[`${entry.name}/${child}`] = '*'
      }
      continue
    }
    deps[entry.name] = '*'
  }
  const pkgPath = path.join(stage, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.dependencies = Object.fromEntries(Object.keys(deps).sort().map((k) => [k, '*']))
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
}

// --- electron-builder resources ---------------------------------------------
// icon.png is 512x512; electron-builder generates the .ico for the exe,
// installer, and shortcuts from build/icon.png. installer.nsh is the custom
// NSIS include (electron-builder looks for it under buildResources).
fs.mkdirSync(buildResources, { recursive: true })
fs.copyFileSync(path.join(root, 'apps/host/resources/icon.png'), path.join(buildResources, 'icon.png'))
fs.copyFileSync(path.join(root, 'scripts/nsis/installer.nsh'), path.join(buildResources, 'installer.nsh'))

// --- summary -----------------------------------------------------------------
console.log(
  `stage-package: ${(bytes / 1024 / 1024).toFixed(0)} MB staged ` +
    `(${linked} hard-linked, ${copied} copied) -> ${path.relative(root, stage)}`,
)
