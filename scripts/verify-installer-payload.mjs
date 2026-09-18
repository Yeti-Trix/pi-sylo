/**
 * Verify the packaged app tree before the installer is considered good.
 *
 * Sylo resolves most of its runtime from loose files rather than from the
 * compiled bundle — Pi extensions are live TypeScript, skills are SKILL.md,
 * subagent personas and workflow playbooks are Markdown, and several tools
 * shell out to .py scripts. None of that is referenced by an import the
 * bundler can follow, so a packaging filter can delete a whole feature area
 * without any build step complaining. (It has: a blanket '!**\/*.md' exclusion
 * removed every skill definition from the first build that produced a
 * seemingly fine 133 MB installer.)
 *
 * Two checks:
 *   1. Named paths the main process resolves during startup must exist.
 *   2. Loose-file counts per extension must match the staged payload exactly,
 *      which catches anything dropped by a filter rather than by intent.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const stage = path.join(root, 'dist', 'stage')
const packaged = path.join(root, 'dist', 'installer', 'win-unpacked', 'resources', 'app')

/** Resolved by apps/host/src/main/index.ts at startup, or spawned by it. */
const REQUIRED_PATHS = [
  'package.json',
  'apps/host/package.json',
  'apps/host/out/main/index.js',
  'apps/host/out/preload/index.cjs',
  'apps/host/out/renderer/index.html',
  'apps/host/out/renderer/skill-surface',
  'apps/host/out/broker/broker.mjs',
  'apps/host/out/broker/pi-shell-lib.mjs',
  'apps/host/out/companion/index.html',
  'apps/host/resources/splash.html',
  'apps/host/resources/icon.png',
  // Broker extensions loaded as live TypeScript (SYLO_*_EXTENSION env vars).
  'apps/host/src/broker/sylo-builtin-tools-guard.ts',
  'apps/host/src/broker/sylo-image-fallback.ts',
  'apps/host/src/broker/sylo-canvas-sketch.ts',
  'apps/host/src/broker/sylo-compaction-anchor.ts',
  'apps/host/src/shared/pi-builtin-tools.ts',
  'packages/skill-surface-extension/src/index.ts',
  'packages/sylo-subagents/extensions/index.ts',
  'packages/sylo-scheduler/extensions/index.ts',
  'packages/sylo-ask-question/extensions/index.ts',
  // First-launch bundled-skill install (see main/packaged-runtime.ts).
  'scripts/bootstrap-pi.mjs',
  // Runtime dependencies the broker child resolves through NODE_PATH.
  'node_modules/@earendil-works/pi-coding-agent/package.json',
  'node_modules/jiti/package.json',
  'node_modules/typebox/package.json',
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/node-pty/prebuilds/win32-x64/pty.node',
  'node_modules/selfsigned/package.json',
]

/**
 * Files electron-builder legitimately strips from the payload. It slims
 * dependencies (type declarations, source maps, docs, examples) and hoists
 * nested node_modules to the top level, which is why node_modules is compared
 * by resolvability above rather than file-for-file here.
 */
const BENIGN_DROPS = [
  /\.d\.ts$/,
  /\.map$/,
  /(^|\/)\.[^/]+$/, // dotfiles: .gitkeep, .gitignore, .gitattributes
  /(^|\/)(\.github|__pycache__)\//,
  /\.pyc$/,
]

/** Every file in a tree, relative and slash-normalised, skipping node_modules. */
function ownFiles(dir, base = dir, out = new Set()) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      ownFiles(full, base, out)
      continue
    }
    out.add(path.relative(base, full).replace(/\\/g, '/'))
  }
  return out
}

const failures = []

if (!fs.existsSync(packaged)) {
  console.error(`verify-installer-payload: no packaged app at ${packaged}`)
  process.exit(1)
}

for (const rel of REQUIRED_PATHS) {
  const full = path.join(packaged, rel)
  if (!fs.existsSync(full)) {
    failures.push(`missing: ${rel}`)
    continue
  }
  if (fs.statSync(full).isDirectory() && fs.readdirSync(full).length === 0) {
    failures.push(`empty directory: ${rel}`)
  }
}

// The Electron entry must sit exactly four levels below the payload root, or
// SYLO_REPO_ROOT (join(__dirname, '../../../..')) lands somewhere else.
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(packaged, 'package.json'), 'utf8'))
  if (manifest.main !== 'apps/host/out/main/index.js') {
    failures.push(`package.json main is "${manifest.main}", expected apps/host/out/main/index.js`)
  }
  if (manifest.type !== 'module') {
    failures.push('package.json is missing "type": "module" — the main entry is ESM')
  }
} catch (err) {
  failures.push(`unreadable payload package.json: ${err.message}`)
}

// Every file Sylo itself ships (apps/, packages/, scripts/) must survive
// packaging. This is the check that catches a "files" glob quietly deleting a
// feature — such as SKILL.md, agents/*.md, or a workflow playbook.
if (fs.existsSync(stage)) {
  const staged = ownFiles(stage)
  const shipped = ownFiles(packaged)
  const dropped = [...staged].filter(
    (rel) => !shipped.has(rel) && !BENIGN_DROPS.some((re) => re.test(rel)),
  )
  console.log(
    `verify-installer-payload: ${shipped.size}/${staged.size} of Sylo's own files shipped`,
  )
  if (dropped.length > 0) {
    failures.push(
      `${dropped.length} of Sylo's own files were dropped during packaging — check the ` +
        `"files" globs in electron-builder.yml. First few: ${dropped.slice(0, 10).join(', ')}`,
    )
  }
} else {
  console.warn('verify-installer-payload: dist/stage is gone — skipping the file comparison')
}

if (failures.length > 0) {
  console.error(`\nverify-installer-payload: ${failures.length} problem(s) in the packaged app:`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error('')
  process.exit(1)
}

console.log('verify-installer-payload: packaged app looks complete')
