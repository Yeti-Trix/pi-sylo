import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  deployGlobalAgents,
  globalAgentsSourcePath,
  globalAgentsTargetPath,
  readGlobalAgentsStatus,
  writeGlobalAgentsSource,
  GLOBAL_AGENTS_SEED,
} from './global-agents.ts'

function freshDirs() {
  const base = join(tmpdir(), `sylo-global-agents-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const primaryDir = join(base, 'sylo-user')
  const agentDir = join(base, '.pi', 'agent')
  mkdirSync(primaryDir, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  return { base, primaryDir, agentDir }
}

test('deployGlobalAgents seeds template when neither file exists', () => {
  const { base, primaryDir, agentDir } = freshDirs()
  try {
    const r = deployGlobalAgents({ primaryDir, agentDir })
    assert.equal(r.action, 'seeded')
    assert.equal(readFileSync(globalAgentsSourcePath(primaryDir), 'utf8'), GLOBAL_AGENTS_SEED)
    assert.equal(readFileSync(globalAgentsTargetPath(agentDir), 'utf8'), GLOBAL_AGENTS_SEED)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('deployGlobalAgents adopts existing global file into an empty universal workspace', () => {
  const { base, primaryDir, agentDir } = freshDirs()
  try {
    const targetPath = globalAgentsTargetPath(agentDir)
    writeFileSync(targetPath, '# Existing operator instructions\n', 'utf8')
    const r = deployGlobalAgents({ primaryDir, agentDir })
    assert.equal(r.action, 'adopted')
    assert.equal(
      readFileSync(globalAgentsSourcePath(primaryDir), 'utf8'),
      '# Existing operator instructions\n',
    )
    // Adoption never changes the target.
    assert.equal(readFileSync(targetPath, 'utf8'), '# Existing operator instructions\n')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('deployGlobalAgents deploys source over target and reports unchanged when in sync', () => {
  const { base, primaryDir, agentDir } = freshDirs()
  try {
    const sourcePath = globalAgentsSourcePath(primaryDir)
    mkdirSync(join(primaryDir, 'agent'), { recursive: true })
    writeFileSync(sourcePath, '# Veritas\n', 'utf8')

    const r1 = deployGlobalAgents({ primaryDir, agentDir })
    assert.equal(r1.action, 'deployed')
    assert.equal(readFileSync(globalAgentsTargetPath(agentDir), 'utf8'), '# Veritas\n')

    const r2 = deployGlobalAgents({ primaryDir, agentDir })
    assert.equal(r2.action, 'unchanged')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('writeGlobalAgentsSource + deploy round-trips editor saves', () => {
  const { base, primaryDir, agentDir } = freshDirs()
  try {
    const w = writeGlobalAgentsSource(primaryDir, '# Voice v2\n')
    assert.equal(w.ok, true)
    const r = deployGlobalAgents({ primaryDir, agentDir })
    assert.equal(r.action, 'deployed')
    assert.equal(readFileSync(globalAgentsTargetPath(agentDir), 'utf8'), '# Voice v2\n')

    const status = readGlobalAgentsStatus({ primaryDir, agentDir })
    assert.equal(status.inSync, true)
    assert.equal(status.content, '# Voice v2\n')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('readGlobalAgentsStatus falls back to target content when source is missing', () => {
  const { base, primaryDir, agentDir } = freshDirs()
  try {
    writeFileSync(globalAgentsTargetPath(agentDir), '# From global\n', 'utf8')
    const status = readGlobalAgentsStatus({ primaryDir, agentDir })
    assert.equal(status.sourceExists, false)
    assert.equal(status.targetExists, true)
    assert.equal(status.inSync, false)
    assert.equal(status.content, '# From global\n')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})