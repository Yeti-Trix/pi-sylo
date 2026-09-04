/**
 * Run: npm run test:broker-shell -w apps/host
 * Requires `out/broker/pi-shell-lib.mjs` from build:broker.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { getShellConfig, SettingsManager } from '@earendil-works/pi-coding-agent'
import { ensureWindowsPiShellFallback, resolveWindowsPiShellExe } from '../../out/broker/pi-shell-lib.mjs'

describe('resolveWindowsPiShellExe', () => {
  test('finds PowerShell when installed (Windows)', { skip: process.platform !== 'win32' }, () => {
    const p = resolveWindowsPiShellExe()
    assert.ok(p)
    assert.ok(/\\(?:powershell|pwsh)\.exe$/i.test(p.replace(/\//g, '\\')))
  })

  test('returns null off Windows', { skip: process.platform === 'win32' }, () => {
    assert.equal(resolveWindowsPiShellExe(), null)
  })
})

describe('ensureWindowsPiShellFallback', () => {
  test('no-op off Windows', { skip: process.platform === 'win32' }, () => {
    const sm = SettingsManager.inMemory({})
    assert.doesNotThrow(() => ensureWindowsPiShellFallback(sm, tmpdir()))
  })

  test('project POSIX shellPath is overridden on Windows', { skip: process.platform !== 'win32' }, () => {
    const baseTmp = mkdtempSync(join(tmpdir(), 'sylo-shell-test-'))
    const cwd = join(baseTmp, 'proj')
    const agentDir = join(baseTmp, 'agent')
    try {
      mkdirSync(join(cwd, '.pi'), { recursive: true })
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ shellPath: '/bin/bash' }))
      writeFileSync(join(agentDir, 'settings.json'), '{}')

      const sm = SettingsManager.create(cwd, agentDir)
      assert.throws(() => getShellConfig(sm.getShellPath()))

      ensureWindowsPiShellFallback(sm, cwd)

      assert.doesNotThrow(() => getShellConfig(sm.getShellPath()))
      const resolved = sm.getShellPath().replace(/\\/g, '/').toLowerCase()
      assert.ok(resolved.includes('powershell.exe') || resolved.includes('pwsh.exe'))
    } finally {
      rmSync(baseTmp, { recursive: true, force: true })
    }
  })

  test('spawn via Pi shell config after fallback', { skip: process.platform !== 'win32' }, () => {
    const baseTmp = mkdtempSync(join(tmpdir(), 'sylo-shell-spawn-'))
    const cwd = join(baseTmp, 'proj')
    const agentDir = join(baseTmp, 'agent')
    try {
      mkdirSync(join(cwd, '.pi'), { recursive: true })
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ shellPath: '/bin/bash' }))
      writeFileSync(join(agentDir, 'settings.json'), '{}')

      const sm = SettingsManager.create(cwd, agentDir)
      ensureWindowsPiShellFallback(sm, cwd)

      const { shell, args } = getShellConfig(sm.getShellPath())
      const cmd = 'Write-Output SYLO_SHELL_OK'
      const r = spawnSync(shell, [...args, cmd], {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
      })
      assert.equal(r.error, undefined, String(r.error))
      assert.equal(r.status, 0, r.stderr || r.stdout || '(no output)')
      assert.ok((r.stdout ?? '').includes('SYLO_SHELL_OK'), r.stdout ?? '')
    } finally {
      rmSync(baseTmp, { recursive: true, force: true })
    }
  })
})
