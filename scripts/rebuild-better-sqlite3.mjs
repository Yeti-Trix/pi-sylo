/**
 * Prefer prebuild-install for better-sqlite3 (fast, no local toolchain).
 * Windows + Electron 42+: MSBuild often fails on Node cppgc headers, and
 * prebuilds may lag; Electron 41.x usually has win32-x64 prebuilds on npm.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

function firstExisting(paths) {
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return null
}

const electronPkg = firstExisting([
  path.join(root, 'node_modules', 'electron', 'package.json'),
  path.join(root, 'apps', 'host', 'node_modules', 'electron', 'package.json'),
])
if (!electronPkg) {
  console.error('electron is not installed (missing node_modules/electron).')
  process.exit(1)
}
const electronVer = readJson(electronPkg).version

const betterPkg = firstExisting([
  path.join(root, 'node_modules', 'better-sqlite3', 'package.json'),
  path.join(root, 'apps', 'host', 'node_modules', 'better-sqlite3', 'package.json'),
])
if (!betterPkg) {
  console.error('better-sqlite3 is not installed.')
  process.exit(1)
}
const betterRoot = path.dirname(betterPkg)

const prebuildBin = firstExisting([
  path.join(betterRoot, 'node_modules', 'prebuild-install', 'bin.js'),
  path.join(root, 'node_modules', 'prebuild-install', 'bin.js'),
])
if (!prebuildBin) {
  console.error('prebuild-install not found under better-sqlite3 or repo root.')
  process.exit(1)
}

const pre = spawnSync(
  process.execPath,
  [
    prebuildBin,
    '--runtime',
    'electron',
    '--target',
    electronVer,
    '--arch',
    process.env.npm_config_arch || process.arch,
  ],
  { cwd: betterRoot, stdio: 'inherit', env: process.env },
)

if (pre.status === 0) {
  process.exit(0)
}

const nativeOut = path.join(betterRoot, 'build', 'Release', 'better_sqlite3.node')
if (existsSync(nativeOut)) {
  try {
    const st = readFileSync(nativeOut)
    if (st.byteLength > 0) {
      console.warn(
        '\nprebuild-install failed (Sylo/Electron may still be running or no prebuild for this Electron). ' +
          'Keeping existing better_sqlite3.node — close Sylo before the next npm install if you upgraded Electron.\n',
      )
      process.exit(0)
    }
  } catch {
    // fall through to electron-rebuild
  }
}

console.error(
  '\nprebuild-install failed (no binary for this Electron/OS?). Falling back to electron-rebuild — requires VS Build Tools.\n',
)

const cli = firstExisting([
  path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'),
  path.join(root, 'apps', 'host', 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'),
])
if (!cli) {
  console.error('@electron/rebuild CLI not found.')
  process.exit(pre.status ?? 1)
}

const hostDir = path.join(root, 'apps', 'host')
const rebuild = spawnSync(process.execPath, [cli, '-w', 'better-sqlite3'], {
  cwd: hostDir,
  stdio: 'inherit',
  env: process.env,
})

process.exit(rebuild.status ?? 1)
