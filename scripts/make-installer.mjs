/**
 * Build the single-file Windows installer end to end.
 *
 *   compile (electron-vite + broker + companion + skill UIs)
 *     -> stage the payload (scripts/stage-package.mjs)
 *       -> electron-builder NSIS  ->  dist/installer/Sylo-Setup-<version>.exe
 *
 * Flags:
 *   --skip-build   payload only; assumes apps/host/out is already current
 *   --keep-deps    reuse dist/stage/node_modules from a previous run (fast iteration)
 *   --stage-only   stop after staging, do not run electron-builder
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const args = new Set(process.argv.slice(2))

function run(cmd, cmdArgs) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}\n`)
  // Node refuses to spawn .cmd/.bat without a shell (CVE-2024-27980), which is
  // how npm ships on Windows. Quote anything with whitespace since the shell,
  // not Node, now does the argument splitting.
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
  const quote = (a) => (useShell && /[\s&|<>^]/.test(a) ? `"${a}"` : a)
  execFileSync(useShell ? quote(cmd) : cmd, cmdArgs.map(quote), {
    cwd: root,
    stdio: 'inherit',
    shell: useShell,
  })
}

if (!args.has('--skip-build')) {
  run(npm, ['run', 'build', '-w', 'apps/host'])
}

run(process.execPath, [
  path.join(root, 'scripts/stage-package.mjs'),
  ...(args.has('--keep-deps') ? ['--keep-deps'] : []),
])

if (args.has('--stage-only')) {
  console.log('\nStaged only (--stage-only). Payload: dist/stage\n')
  process.exit(0)
}

/** Blocking sleep — this runs between build phases, so it costs nothing. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Clear the previous output before electron-builder does.
 *
 * With asar off, the payload unpacks to ~43k files across thousands of
 * directories. On Windows, removing a directory right after its children are
 * deleted intermittently fails with EPERM/EBUSY — the filesystem filter stack
 * (AV, indexer) has not finished releasing the entry yet. At this scale that is
 * near-certain to happen somewhere in the tree, and it is otherwise fatal:
 * electron-builder's own cleanup hits the same wall and aborts the build.
 *
 * `maxRetries` is Node's built-in remedy for precisely this. The outer loop and
 * the rename fallback cover the rarer case of a real handle still being held
 * (e.g. right after running the unpacked exe) — renaming succeeds even then, so
 * the build can proceed and sweep the leftovers on a later run.
 */
function clearOutputDir(dir, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
      return
    } catch (err) {
      if (i === attempts) {
        const aside = `${dir}.stale-${Date.now()}`
        fs.renameSync(dir, aside)
        console.log(`  output directory is held open (${err.code}); moved aside to ${path.basename(aside)}`)
        return
      }
      console.log(`  output directory not yet removable (${err.code}), retrying ${i}/${attempts}...`)
      sleep(2000)
    }
  }
}

/** Best-effort cleanup of directories a previous run had to move aside. */
function sweepStaleOutputDirs(parent) {
  let entries = []
  try {
    entries = fs.readdirSync(parent)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith('installer.stale-')) continue
    try {
      fs.rmSync(path.join(parent, entry), {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      })
    } catch {
      /* still locked — a later run will get it */
    }
  }
}

sweepStaleOutputDirs(path.join(root, 'dist'))
clearOutputDir(path.join(root, 'dist/installer'))

// electron-builder infers the Electron version from the project's dependency
// tree, but this project's app directory is a generated payload with no
// electron entry of its own — state it outright.
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8'),
).version

run(npm, [
  'exec',
  '--yes',
  '--',
  'electron-builder',
  '--win',
  '--config',
  'electron-builder.yml',
  `--config.electronVersion=${electronVersion}`,
])

run(process.execPath, [path.join(root, 'scripts/verify-installer-payload.mjs')])

const outDir = path.join(root, 'dist/installer')
const setups = fs.existsSync(outDir)
  ? fs.readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.exe'))
  : []
console.log('')
for (const f of setups) {
  const mb = (fs.statSync(path.join(outDir, f)).size / 1024 / 1024).toFixed(0)
  console.log(`Installer: ${path.join('dist/installer', f)}  (${mb} MB)`)
}
console.log('')
