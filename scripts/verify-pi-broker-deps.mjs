#!/usr/bin/env node
/**
 * Broker requires @earendil-works/pi-coding-agent >= 0.83 with ModelRuntime export.
 * Fails fast when node_modules is incomplete (e.g. after a bad npm audit fix) or an
 * older global Pi shadows the workspace install.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
const pkgJsonPath = join(pkgDir, 'package.json')
const indexPath = join(pkgDir, 'dist', 'index.js')

function fail(msg) {
  console.error(`[verify-pi-broker-deps] ${msg}`)
  console.error('[verify-pi-broker-deps] Run: npm install')
  console.error('[verify-pi-broker-deps] Then close Sylo and run full-build-run-sylo.cmd again.')
  process.exit(1)
}

if (!existsSync(pkgJsonPath)) {
  fail('@earendil-works/pi-coding-agent is missing from node_modules.')
}

const version = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version ?? ''
const majorMinor = version.split('.').map((n) => Number(n))
if (majorMinor[0] < 0 || (majorMinor[0] === 0 && (majorMinor[1] ?? 0) < 83)) {
  fail(`@earendil-works/pi-coding-agent@${version} is too old — broker needs >= 0.83.0 (ModelRuntime).`)
}

if (!existsSync(indexPath)) {
  fail(`@earendil-works/pi-coding-agent@${version} is incomplete (missing dist/index.js).`)
}

const indexSrc = readFileSync(indexPath, 'utf8')
if (!indexSrc.includes('ModelRuntime')) {
  fail(`@earendil-works/pi-coding-agent@${version} does not export ModelRuntime — broker cannot start.`)
}

try {
  const mod = await import(pathToFileURL(join(pkgDir, 'dist', 'index.js')).href)
  if (typeof mod.ModelRuntime !== 'function') {
    fail(`ModelRuntime export is missing at runtime for pi-coding-agent@${version}.`)
  }
} catch (err) {
  fail(
    `Failed to load pi-coding-agent@${version}: ${err instanceof Error ? err.message : String(err)}`,
  )
}

console.log(`[verify-pi-broker-deps] OK — pi-coding-agent@${version} (ModelRuntime)`)

// The global `pi` CLI is NOT required to run Sylo — the broker uses the
// bundled @earendil-works/pi-coding-agent package in-process. The CLI matters
// only for provider sign-in (pi auth) and `pi install` of community packages.
// Warn (don't fail) when it is absent so new users know what it's for.
try {
  const { execFileSync } = await import('node:child_process')
  const where = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(where, ['pi'], { stdio: 'pipe' })
  } catch {
    console.log(
      '[verify-pi-broker-deps] Note: global `pi` CLI not found on PATH.\n' +
      '[verify-pi-broker-deps] Sylo runs fine without it (the agent runtime is bundled above).\n' +
      '[verify-pi-broker-deps] Install it only for provider sign-in / `pi install`:\n' +
      '[verify-pi-broker-deps]   npm install -g @earendil-works/pi-coding-agent',
    )
  }
} catch {
  /* best-effort only */
}
