#!/usr/bin/env node
/**
 * Ensure Electron binary exists after npm install (especially after --ignore-scripts retry).
 * Uses cached zip + PowerShell Expand-Archive on Windows when extract-zip left a broken dist.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const distDir = join(electronDir, 'dist')
const pkg = JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf8'))
const version = pkg.version
const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const exePath = join(distDir, exeName)

function electronOk() {
  if (!existsSync(exePath)) return false
  try {
    const pathTxt = join(electronDir, 'path.txt')
    if (!existsSync(pathTxt)) return false
    if (readFileSync(pathTxt, 'utf8').trim() !== exeName) return false
    return statSync(exePath).size > 1_000_000
  } catch {
    return false
  }
}

async function downloadZip() {
  const { downloadArtifact } = await import('@electron/get')
  return downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform === 'win32' ? 'win32' : process.platform,
    arch: process.arch,
    force: true,
  })
}

function extractWindows(zipPath) {
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' },
  )
  if (ps.status !== 0) {
    throw new Error(`Expand-Archive failed (exit ${ps.status})`)
  }
}

async function extractDefault(zipPath) {
  const extract = (await import('extract-zip')).default
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })
  await extract(zipPath, { dir: distDir })
}

async function main() {
  if (!existsSync(join(electronDir, 'package.json'))) {
    console.error('[ensure-electron] node_modules/electron missing — run npm install first.')
    process.exit(1)
  }

  if (electronOk()) {
    console.log('[ensure-electron] OK —', exePath)
    return
  }

  console.log('[ensure-electron] Binary missing or incomplete — downloading Electron', version)
  const zipPath = await downloadZip()
  console.log('[ensure-electron] Extracting', zipPath)

  if (process.platform === 'win32') {
    extractWindows(zipPath)
  } else {
    await extractDefault(zipPath)
  }

  if (!existsSync(exePath)) {
    console.error('[ensure-electron] Extract finished but', exePath, 'not found.')
    process.exit(1)
  }

  writeFileSync(join(electronDir, 'path.txt'), exeName)
  writeFileSync(join(distDir, 'version'), `v${version}`)
  console.log('[ensure-electron] Ready —', exePath)
}

main().catch((err) => {
  console.error('[ensure-electron]', err)
  process.exit(1)
})
